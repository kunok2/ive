import { Project } from "@/types";

/**
 * GitLab API URL에서 프로젝트 경로를 추출하여 인코딩된 문자열로 반환합니다.
 * 예: https://gitlab.com/kojoung/dazzlepf -> kojoung%2Fdazzlepf
 */
function getProjectPath(repoUrl: string): string {
  try {
    const url = new URL(repoUrl.replace(/\.git$/, ''));
    const path = url.pathname.startsWith('/') ? url.pathname.slice(1) : url.pathname;
    return encodeURIComponent(path);
  } catch (e) {
    return "";
  }
}

/**
 * 프로젝트 ID를 추출합니다.
 */
function getProjectId(repoUrl: string): string {
  try {
    const url = new URL(repoUrl.replace(/\.git$/, ''));
    const parts = url.pathname.split('/').filter(p => p);
    return parts[parts.length - 1] || "";
  } catch (e) {
    return "";
  }
}

/**
 * GitLab 프로젝트에 필요한 레이블들이 있는지 확인하고, 없으면 생성합니다.
 */
export async function ensureGitLabLabels(project: Project, decryptedToken: string) {
  const projectPath = getProjectPath(project.repoUrl);
  if (!projectPath) return;

  const labelsToEnsure = [
    { name: project.labelTarget, color: '#34d399', description: 'IVE Target Issue' },
    { name: project.labelInProgress, color: '#22d3ee', description: 'IVE Development in Progress' },
    { name: project.labelFailDev, color: '#ef4444', description: 'IVE Development Failed' },
    { name: project.labelValidation, color: '#fbbf24', description: 'IVE Validation in Progress' },
    { name: project.labelFailVal, color: '#f87171', description: 'IVE Validation Failed' },
    { name: project.labelDone, color: '#a3e635', description: 'IVE Completed' },
  ];

  try {
    // 1. 기존 레이블 조회
    const res = await fetch(`https://gitlab.com/api/v4/projects/${projectPath}/labels`, {
      headers: { 'PRIVATE-TOKEN': decryptedToken }
    });

    if (!res.ok) throw new Error(`Failed to fetch labels: ${res.statusText}`);
    const existingLabels: any[] = await res.json();
    const existingNames = existingLabels.map(l => l.name);

    // 2. 없는 레이블 생성
    for (const label of labelsToEnsure) {
      if (!existingNames.includes(label.name)) {
        console.log(`[GitLab] Creating label: ${label.name} for project: ${project.name}`);
        await fetch(`https://gitlab.com/api/v4/projects/${projectPath}/labels`, {
          method: 'POST',
          headers: { 
            'PRIVATE-TOKEN': decryptedToken,
            'Content-Type': 'application/json'
          },
          body: JSON.stringify(label)
        });
      }
    }
  } catch (err) {
    console.error(`[GitLab] Error ensuring labels for ${project.name}:`, err);
  }
}

/**
 * 특정 레이블이 붙은 열린 이슈 목록을 가져옵니다.
 */
export async function fetchGitLabIssues(project: Project, decryptedToken: string, label: string) {
  const projectPath = getProjectPath(project.repoUrl);
  if (!projectPath) return [];

  try {
    const res = await fetch(
      `https://gitlab.com/api/v4/projects/${projectPath}/issues?labels=${encodeURIComponent(label)}&state=opened`,
      {
        headers: { 'PRIVATE-TOKEN': decryptedToken }
      }
    );

    if (!res.ok) {
      const status = res.status;
      if (status === 401) throw new Error('인증 토큰이 유효하지 않거나 만료되었습니다.');
      if (status === 404) throw new Error('프로젝트를 찾을 수 없습니다. 저장소 주소를 확인하세요.');
      if (status === 403) throw new Error('접근 권한이 없습니다. 토큰 권한을 확인하세요.');
      throw new Error(`GitLab API 오류 (${status}): ${res.statusText}`);
    }
    return await res.json();
  } catch (err) {
    throw err;
  }
}

/**
 * 특정 이슈의 레이블을 업데이트합니다.
 */
export async function updateGitLabIssueLabels(
  project: Project, 
  issueIid: number, 
  decryptedToken: string, 
  addLabels: string[], 
  removeLabels: string[]
) {
  const projectPath = getProjectPath(project.repoUrl);
  if (!projectPath) return;

  try {
    // 1. 현재 레이블 조회
    const res = await fetch(`https://gitlab.com/api/v4/projects/${projectPath}/issues/${issueIid}`, {
      headers: { 'PRIVATE-TOKEN': decryptedToken }
    });
    
    if (!res.ok) throw new Error(`Fetch issue failed: ${res.statusText}`);
    const issueData = await res.json();
    let currentLabels: string[] = issueData.labels || [];
    
    // 2. 레이블 수정
    let newLabels = currentLabels.filter(l => !removeLabels.includes(l));
    addLabels.forEach(l => {
      if (!newLabels.includes(l)) newLabels.push(l);
    });
    
    // 3. 업데이트 적용
    await fetch(`https://gitlab.com/api/v4/projects/${projectPath}/issues/${issueIid}`, {
      method: 'PUT',
      headers: { 
        'PRIVATE-TOKEN': decryptedToken,
        'Content-Type': 'application/json' 
      },
      body: JSON.stringify({ labels: newLabels.join(',') })
    });
    
    console.log(`[GitLab] Updated labels for issue #${issueIid}: [${newLabels.join(', ')}]`);
  } catch (err) {
    console.error(`[GitLab] Error updating labels for issue #${issueIid}:`, err);
  }
}

/**
 * 이슈에 코멘트를 추가합니다.
 */
export async function addGitLabIssueComment(project: Project, issueIid: number, decryptedToken: string, body: string) {
  const projectPath = getProjectPath(project.repoUrl);
  if (!projectPath) return;

  try {
    await fetch(`https://gitlab.com/api/v4/projects/${projectPath}/issues/${issueIid}/notes`, {
      method: 'POST',
      headers: { 
        'PRIVATE-TOKEN': decryptedToken,
        'Content-Type': 'application/json' 
      },
      body: JSON.stringify({ body })
    });
  } catch (err) {
    console.error(`[GitLab] Error adding comment to issue #${issueIid}:`, err);
  }
}

/**
 * 이슈의 노트(코멘트) 목록을 조회합니다.
 */
export async function fetchGitLabIssueNotes(project: Project, issueIid: number, decryptedToken: string) {
  const projectPath = getProjectPath(project.repoUrl);
  if (!projectPath) return [];

  try {
    const res = await fetch(`https://gitlab.com/api/v4/projects/${projectPath}/issues/${issueIid}/notes?sort=asc&per_page=100`, {
      headers: { 'PRIVATE-TOKEN': decryptedToken }
    });
    if (!res.ok) throw new Error(`Fetch notes failed: ${res.statusText}`);
    return await res.json();
  } catch (err) {
    console.error(`[GitLab] Error fetching notes for issue #${issueIid}:`, err);
    return [];
  }
}

/**
 * 이슈에 소요 시간을 등록합니다.
 */
export async function addGitLabSpentTime(project: Project, issueIid: number, decryptedToken: string, duration: string) {
  const projectPath = getProjectPath(project.repoUrl);
  if (!projectPath) return;

  try {
    await fetch(`https://gitlab.com/api/v4/projects/${projectPath}/issues/${issueIid}/add_spent_time`, {
      method: 'POST',
      headers: { 
        'PRIVATE-TOKEN': decryptedToken,
        'Content-Type': 'application/json' 
      },
      body: JSON.stringify({ duration })
    });
  } catch (err) {
    console.error(`[GitLab] Error adding spent time to issue #${issueIid}:`, err);
  }
}

/**
 * 병합 요청(MR)을 생성합니다.
 */
export async function createGitLabMR(project: Project, decryptedToken: string, payload: any) {
  const projectPath = getProjectPath(project.repoUrl);
  if (!projectPath) return null;

  try {
    const res = await fetch(`https://gitlab.com/api/v4/projects/${projectPath}/merge_requests`, {
      method: 'POST',
      headers: { 
        'PRIVATE-TOKEN': decryptedToken,
        'Content-Type': 'application/json' 
      },
      body: JSON.stringify(payload)
    });
    if (!res.ok) throw new Error(`Create MR failed: ${res.statusText}`);
    return await res.json();
  } catch (err) {
    console.error(`[GitLab] Error creating MR for ${project.name}:`, err);
    return null;
  }
}

/**
 * 기존 병합 요청(MR)을 조회합니다.
 */
export async function getGitLabMR(project: Project, decryptedToken: string, sourceBranch: string) {
  const projectPath = getProjectPath(project.repoUrl);
  if (!projectPath) return null;

  try {
    const res = await fetch(`https://gitlab.com/api/v4/projects/${projectPath}/merge_requests?source_branch=${sourceBranch}&state=opened`, {
      headers: { 'PRIVATE-TOKEN': decryptedToken }
    });
    if (!res.ok) throw new Error(`Fetch MR failed: ${res.statusText}`);
    const mrs = await res.json();
    return mrs.length > 0 ? mrs[0] : null;
  } catch (err) {
    console.error(`[GitLab] Error fetching MR for ${project.name}:`, err);
    return null;
  }
}

/**
 * 병합 요청(MR)에 노트를 추가합니다.
 */
export async function addGitLabMRNote(project: Project, decryptedToken: string, mrIid: number, body: string) {
  const projectPath = getProjectPath(project.repoUrl);
  if (!projectPath) return;

  try {
    await fetch(`https://gitlab.com/api/v4/projects/${projectPath}/merge_requests/${mrIid}/notes`, {
      method: 'POST',
      headers: { 
        'PRIVATE-TOKEN': decryptedToken,
        'Content-Type': 'application/json' 
      },
      body: JSON.stringify({ body })
    });
  } catch (err) {
    console.error(`[GitLab] Error adding note to MR #${mrIid}:`, err);
  }
}

/**
 * 프로젝트의 IVE 관련 이슈를 모두 가져옵니다 (모든 IVE 레이블 대상).
 */
export async function fetchAllIveIssues(project: Project, decryptedToken: string) {
  const projectPath = getProjectPath(project.repoUrl);
  if (!projectPath) return [];

  const allLabels = [
    project.labelTarget, project.labelInProgress, project.labelFailDev,
    project.labelValidation, project.labelFailVal, project.labelDone,
  ];

  try {
    const results: any[] = [];
    for (const label of allLabels) {
      const res = await fetch(
        `https://gitlab.com/api/v4/projects/${projectPath}/issues?labels=${encodeURIComponent(label)}&state=opened&per_page=100`,
        { headers: { 'PRIVATE-TOKEN': decryptedToken } }
      );
      if (res.ok) {
        const issues = await res.json();
        for (const issue of issues) {
          if (!results.some(r => r.iid === issue.iid)) {
            results.push(issue);
          }
        }
      }
    }
    return results.sort((a, b) => b.iid - a.iid);
  } catch (err) {
    console.error(`[GitLab] Error fetching all IVE issues for ${project.name}:`, err);
    return [];
  }
}

/**
 * 이슈를 생성합니다.
 */
export async function createGitLabIssue(
  project: Project,
  decryptedToken: string,
  title: string,
  description: string,
  labels: string[]
) {
  const projectPath = getProjectPath(project.repoUrl);
  if (!projectPath) throw new Error('Invalid repo URL');

  const res = await fetch(`https://gitlab.com/api/v4/projects/${projectPath}/issues`, {
    method: 'POST',
    headers: {
      'PRIVATE-TOKEN': decryptedToken,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ title, description, labels: labels.join(',') }),
  });

  if (!res.ok) throw new Error(`이슈 생성 실패: ${res.statusText}`);
  return await res.json();
}
