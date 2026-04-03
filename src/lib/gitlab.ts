import { Project } from "@/types";

/**
 * GitLab API URL에서 프로젝트 경로를 추출하여 인코딩된 문자열로 반환합니다.
 * 예: https://gitlab.com/kojoung/dazzlepf -> kojoung%2Fdazzlepf
 */
export function getProjectPath(repoUrl: string): string {
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
 * 저장소 URL에서 GitLab API 베이스 URL을 추출합니다.
 * 예: https://gitlab.example.com/user/repo → https://gitlab.example.com/api/v4
 */
export function getApiBaseUrl(repoUrl: string): string {
  try {
    const url = new URL(repoUrl.replace(/\.git$/, ''));
    return `${url.protocol}//${url.host}/api/v4`;
  } catch {
    return 'https://gitlab.com/api/v4';
  }
}

/**
 * 프로젝트의 인증 방식에 따라 적절한 HTTP 헤더를 반환합니다.
 */
export function getAuthHeaders(project: Project, decryptedToken: string): Record<string, string> {
  if (project.authType === 'basic') {
    const encoded = Buffer.from(`${project.gitUsername}:${decryptedToken}`).toString('base64');
    return { 'Authorization': `Basic ${encoded}` };
  }
  return { 'PRIVATE-TOKEN': decryptedToken };
}

/**
 * API 요청을 위한 URL과 헤더를 반환합니다.
 */
function apiUrl(project: Project, path: string): string {
  const base = getApiBaseUrl(project.repoUrl);
  const projectPath = getProjectPath(project.repoUrl);
  return `${base}/projects/${projectPath}${path}`;
}

/**
 * GitLab 프로젝트에 필요한 레이블들이 있는지 확인하고, 없으면 생성합니다.
 */
export async function ensureGitLabLabels(project: Project, decryptedToken: string) {
  const projectPath = getProjectPath(project.repoUrl);
  if (!projectPath) return;

  const headers = getAuthHeaders(project, decryptedToken);
  const labelsToEnsure = [
    { name: project.labelTarget, color: '#34d399', description: 'IVE 관리 대상 이슈 표시.' },
    { name: project.labelSchedule || 'IVE-S', color: '#fbbf24', description: '스케줄 대상. 스캐너가 이 레이블의 이슈를 에이전트에 배정합니다.' },
    { name: project.labelDev || 'IVE-D', color: '#22d3ee', description: '개발 중. 에이전트가 작업을 시작하면 자동 부착됩니다.' },
    { name: project.labelVerify || 'IVE-V', color: '#fb923c', description: '검증 대기. 개발이 완료되어 리뷰가 필요합니다.' },
    { name: project.labelEnd || 'IVE-E', color: '#60a5fa', description: '처리 완료. 코드가 수정되었으면 MR/PR 머지 대상입니다.' },
  ];

  try {
    const res = await fetch(apiUrl(project, '/labels'), { headers });

    if (!res.ok) {
      if (res.status === 401) throw new Error('인증 정보가 유효하지 않거나 만료되었습니다. GitLab Personal Access Token을 확인해주세요.');
      throw new Error(`Failed to fetch labels: ${res.statusText}`);
    }
    const existingLabels: any[] = await res.json();
    const existingNames = existingLabels.map(l => l.name);

    for (const label of labelsToEnsure) {
      if (!existingNames.includes(label.name)) {
        console.log(`[GitLab] Creating label: ${label.name} for project: ${project.name}`);
        await fetch(apiUrl(project, '/labels'), {
          method: 'POST',
          headers: { ...headers, 'Content-Type': 'application/json' },
          body: JSON.stringify(label)
        });
      }
    }
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.warn(`[GitLab] Label sync failed for ${project.name}: ${msg}`);
  }
}

export async function addGitLabIssueLabels(project: Project, issueIid: number, decryptedToken: string, labels: string[]) {
  const headers = getAuthHeaders(project, decryptedToken);
  // GitLab: PUT으로 기존 레이블에 추가
  const res = await fetch(apiUrl(project, `/issues/${issueIid}`), {
    method: 'PUT',
    headers: { ...headers, 'Content-Type': 'application/json' },
    body: JSON.stringify({ add_labels: labels.join(',') }),
  });
  return res.ok;
}

export async function removeGitLabIssueLabels(project: Project, issueIid: number, decryptedToken: string, labels: string[]) {
  const headers = getAuthHeaders(project, decryptedToken);
  const res = await fetch(apiUrl(project, `/issues/${issueIid}`), {
    method: 'PUT',
    headers: { ...headers, 'Content-Type': 'application/json' },
    body: JSON.stringify({ remove_labels: labels.join(',') }),
  });
  return res.ok;
}

export async function checkGitLabLabelsExist(project: Project, decryptedToken: string): Promise<{ label: string; exists: boolean }[]> {
  const headers = getAuthHeaders(project, decryptedToken);
  const labelsToCheck = [
    project.labelTarget,
    project.labelSchedule || 'IVE-S', project.labelDev || 'IVE-D',
    project.labelVerify || 'IVE-V', project.labelEnd || 'IVE-E',
  ];
  try {
    const res = await fetch(apiUrl(project, '/labels?per_page=100'), { headers });
    if (!res.ok) return labelsToCheck.map(l => ({ label: l, exists: false }));
    const existing = (await res.json()).map((l: any) => l.name);
    return labelsToCheck.map(l => ({ label: l, exists: existing.includes(l) }));
  } catch {
    return labelsToCheck.map(l => ({ label: l, exists: false }));
  }
}

/**
 * 특정 레이블이 붙은 열린 이슈 목록을 가져옵니다.
 */
export async function fetchGitLabIssues(project: Project, decryptedToken: string, label: string) {
  const projectPath = getProjectPath(project.repoUrl);
  if (!projectPath) return [];

  const headers = getAuthHeaders(project, decryptedToken);

  try {
    const res = await fetch(
      apiUrl(project, `/issues?labels=${encodeURIComponent(label)}&state=opened`),
      { headers }
    );

    if (!res.ok) {
      const status = res.status;
      if (status === 401) throw new Error('인증 정보가 유효하지 않거나 만료되었습니다.');
      if (status === 404) throw new Error('프로젝트를 찾을 수 없습니다. 저장소 주소를 확인하세요.');
      if (status === 403) throw new Error('접근 권한이 없습니다. 인증 정보를 확인하세요.');
      throw new Error(`GitLab API 오류 (${status}): ${res.statusText}`);
    }
    return await res.json();
  } catch (err) {
    throw err;
  }
}


/**
 * 이슈에 코멘트를 추가합니다.
 */
export async function addGitLabIssueComment(project: Project, issueIid: number, decryptedToken: string, body: string) {
  const projectPath = getProjectPath(project.repoUrl);
  if (!projectPath) return;

  const headers = getAuthHeaders(project, decryptedToken);

  try {
    await fetch(apiUrl(project, `/issues/${issueIid}/notes`), {
      method: 'POST',
      headers: { ...headers, 'Content-Type': 'application/json' },
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

  const headers = getAuthHeaders(project, decryptedToken);

  try {
    const res = await fetch(apiUrl(project, `/issues/${issueIid}/notes?sort=asc&per_page=100`), { headers });
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

  const headers = getAuthHeaders(project, decryptedToken);

  try {
    await fetch(apiUrl(project, `/issues/${issueIid}/add_spent_time`), {
      method: 'POST',
      headers: { ...headers, 'Content-Type': 'application/json' },
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

  const headers = getAuthHeaders(project, decryptedToken);

  try {
    const res = await fetch(apiUrl(project, '/merge_requests'), {
      method: 'POST',
      headers: { ...headers, 'Content-Type': 'application/json' },
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

  const headers = getAuthHeaders(project, decryptedToken);

  try {
    const res = await fetch(apiUrl(project, `/merge_requests?source_branch=${sourceBranch}&state=opened`), { headers });
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

  const headers = getAuthHeaders(project, decryptedToken);

  try {
    await fetch(apiUrl(project, `/merge_requests/${mrIid}/notes`), {
      method: 'POST',
      headers: { ...headers, 'Content-Type': 'application/json' },
      body: JSON.stringify({ body })
    });
  } catch (err) {
    console.error(`[GitLab] Error adding note to MR #${mrIid}:`, err);
  }
}

/**
 * source_branch로 MR을 조회합니다 (opened + merged 모두).
 */
export async function fetchGitLabMRByBranch(project: Project, decryptedToken: string, sourceBranch: string) {
  const projectPath = getProjectPath(project.repoUrl);
  if (!projectPath) return null;

  const headers = getAuthHeaders(project, decryptedToken);

  try {
    // opened 먼저 조회
    let res = await fetch(
      apiUrl(project, `/merge_requests?source_branch=${encodeURIComponent(sourceBranch)}&state=opened&per_page=1`),
      { headers }
    );
    if (res.ok) {
      const mrs = await res.json();
      if (mrs.length > 0) return mrs[0];
    }
    // merged도 조회
    res = await fetch(
      apiUrl(project, `/merge_requests?source_branch=${encodeURIComponent(sourceBranch)}&state=merged&per_page=1`),
      { headers }
    );
    if (res.ok) {
      const mrs = await res.json();
      if (mrs.length > 0) return mrs[0];
    }
    return null;
  } catch (err) {
    console.error(`[GitLab] Error fetching MR by branch ${sourceBranch}:`, err);
    return null;
  }
}

/**
 * MR의 변경사항(diff)을 조회합니다.
 */
export async function fetchGitLabMRChanges(project: Project, decryptedToken: string, mrIid: number) {
  const projectPath = getProjectPath(project.repoUrl);
  if (!projectPath) return null;

  const headers = getAuthHeaders(project, decryptedToken);

  try {
    const res = await fetch(
      apiUrl(project, `/merge_requests/${mrIid}/changes`),
      { headers }
    );
    if (!res.ok) throw new Error(`Fetch MR changes failed: ${res.statusText}`);
    return await res.json();
  } catch (err) {
    console.error(`[GitLab] Error fetching MR changes for !${mrIid}:`, err);
    return null;
  }
}

/**
 * MR을 머지합니다.
 */
export async function mergeGitLabMR(project: Project, decryptedToken: string, mrIid: number) {
  const projectPath = getProjectPath(project.repoUrl);
  if (!projectPath) throw new Error('Invalid repo URL');

  const headers = getAuthHeaders(project, decryptedToken);

  // MR 상태 확인 — checking 중이면 대기 후 재시도
  const checkRes = await fetch(
    apiUrl(project, `/merge_requests/${mrIid}`),
    { headers }
  );
  if (checkRes.ok) {
    const mrInfo = await checkRes.json();
    if (mrInfo.merge_status === 'checking' || mrInfo.detailed_merge_status === 'checking') {
      await new Promise(r => setTimeout(r, 3000));
    }
  }

  const res = await fetch(
    apiUrl(project, `/merge_requests/${mrIid}/merge`),
    {
      method: 'PUT',
      headers: { ...headers, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        should_remove_source_branch: true,
      }),
    }
  );

  if (!res.ok) {
    const body = await res.text();
    console.error(`[mergeGitLabMR] 실패 status=${res.status} body=${body} mrIid=${mrIid} projectPath=${projectPath}`);
    if (res.status === 405) {
      try {
        const parsed = JSON.parse(body);
        throw new Error(parsed.message || `머지 불가 (405): ${body}`);
      } catch (e) {
        if (e instanceof Error && e.message !== body) throw e;
        throw new Error(`머지 불가 (405): ${body}`);
      }
    }
    if (res.status === 406) {
      throw new Error(`머지 불가: 충돌이 있거나 파이프라인 진행 중입니다.`);
    }
    throw new Error(`MR 머지 실패 (${res.status}): ${body}`);
  }
  return await res.json();
}

/**
 * MR을 닫습니다 (머지하지 않고).
 */
export async function closeGitLabMR(project: Project, decryptedToken: string, mrIid: number) {
  const headers = getAuthHeaders(project, decryptedToken);
  const res = await fetch(
    apiUrl(project, `/merge_requests/${mrIid}`),
    {
      method: 'PUT',
      headers: { ...headers, 'Content-Type': 'application/json' },
      body: JSON.stringify({ state_event: 'close' }),
    }
  );
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`MR 닫기 실패 (${res.status}): ${body}`);
  }
  return await res.json();
}

/**
 * 열린 MR 전체 목록을 조회합니다 (충돌 감지용).
 */
export async function fetchOpenGitLabMRs(project: Project, decryptedToken: string) {
  const projectPath = getProjectPath(project.repoUrl);
  if (!projectPath) return [];

  const headers = getAuthHeaders(project, decryptedToken);
  const mrs: any[] = [];
  let page = 1;

  while (true) {
    const res = await fetch(
      apiUrl(project, `/merge_requests?state=opened&per_page=100&page=${page}`),
      { headers }
    );
    if (!res.ok) break;
    const data = await res.json();
    if (!data.length) break;
    mrs.push(...data);
    if (data.length < 100) break;
    page++;
  }

  return mrs.map((mr: any) => ({
    iid: mr.iid,
    title: mr.title,
    source_branch: mr.source_branch,
    target_branch: mr.target_branch,
    has_conflicts: mr.has_conflicts === true || mr.merge_status === 'cannot_be_merged',
    web_url: mr.web_url,
  }));
}

/**
 * 프로젝트의 IVE 관련 이슈를 모두 가져옵니다 (모든 IVE 레이블 대상).
 */
export async function fetchAllIveIssues(project: Project, decryptedToken: string) {
  const projectPath = getProjectPath(project.repoUrl);
  if (!projectPath) return [];

  const headers = getAuthHeaders(project, decryptedToken);
  const allLabels = [project.labelTarget];

  try {
    const results: any[] = [];
    for (const label of allLabels) {
      const res = await fetch(
        apiUrl(project, `/issues?labels=${encodeURIComponent(label)}&state=opened&per_page=100`),
        { headers }
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
 * 프로젝트의 모든 열린 이슈를 가져옵니다 (IVE 라벨 유무 상관없이).
 */
export async function fetchAllProjectIssues(project: Project, decryptedToken: string) {
  const projectPath = getProjectPath(project.repoUrl);
  if (!projectPath) return [];

  const headers = getAuthHeaders(project, decryptedToken);

  try {
    const allIssues: any[] = [];
    let page = 1;
    while (true) {
      const res = await fetch(
        apiUrl(project, `/issues?state=opened&per_page=100&page=${page}`),
        { headers }
      );
      if (!res.ok) break;
      const issues = await res.json();
      if (issues.length === 0) break;
      allIssues.push(...issues);
      if (issues.length < 100) break;
      page++;
    }
    return allIssues.sort((a: any, b: any) => b.iid - a.iid);
  } catch (err) {
    console.error(`[GitLab] Error fetching all project issues for ${project.name}:`, err);
    return [];
  }
}

export async function fetchClosedProjectIssues(project: Project, decryptedToken: string) {
  const projectPath = getProjectPath(project.repoUrl);
  if (!projectPath) return [];

  const headers = getAuthHeaders(project, decryptedToken);

  try {
    const allIssues: any[] = [];
    let page = 1;
    while (true) {
      const res = await fetch(
        apiUrl(project, `/issues?state=closed&per_page=100&page=${page}`),
        { headers }
      );
      if (!res.ok) break;
      const issues = await res.json();
      if (issues.length === 0) break;
      allIssues.push(...issues);
      if (issues.length < 100) break;
      page++;
    }
    return allIssues.sort((a: any, b: any) => new Date(b.updated_at).getTime() - new Date(a.updated_at).getTime());
  } catch (err) {
    console.error(`[GitLab] Error fetching closed project issues for ${project.name}:`, err);
    return [];
  }
}

/**
 * GitLab 이슈를 닫습니다.
 */
export async function closeGitLabIssue(project: Project, issueIid: number, decryptedToken: string) {
  const projectPath = getProjectPath(project.repoUrl);
  if (!projectPath) throw new Error('Invalid repo URL');

  const headers = getAuthHeaders(project, decryptedToken);

  const res = await fetch(apiUrl(project, `/issues/${issueIid}`), {
    method: 'PUT',
    headers: { ...headers, 'Content-Type': 'application/json' },
    body: JSON.stringify({ state_event: 'close' }),
  });

  if (!res.ok) throw new Error(`이슈 닫기 실패: ${res.statusText}`);
  return await res.json();
}

/**
 * GitLab 이슈를 다시 엽니다.
 */
export async function reopenGitLabIssue(project: Project, issueIid: number, decryptedToken: string) {
  const projectPath = getProjectPath(project.repoUrl);
  if (!projectPath) throw new Error('Invalid repo URL');

  const headers = getAuthHeaders(project, decryptedToken);

  const res = await fetch(apiUrl(project, `/issues/${issueIid}`), {
    method: 'PUT',
    headers: { ...headers, 'Content-Type': 'application/json' },
    body: JSON.stringify({ state_event: 'reopen' }),
  });

  if (!res.ok) throw new Error(`이슈 다시 열기 실패: ${res.statusText}`);
  return await res.json();
}

/**
 * 이슈 제목/설명을 수정합니다.
 */
export async function updateGitLabIssue(
  project: Project,
  issueIid: number,
  decryptedToken: string,
  updates: { title?: string; description?: string; assigneeIds?: number[] }
) {
  const projectPath = getProjectPath(project.repoUrl);
  if (!projectPath) throw new Error('Invalid repo URL');

  const headers = getAuthHeaders(project, decryptedToken);

  const payload: any = {};
  if (updates.title) payload.title = updates.title;
  if (updates.description !== undefined) payload.description = updates.description;
  if (updates.assigneeIds !== undefined) payload.assignee_ids = updates.assigneeIds;

  const res = await fetch(apiUrl(project, `/issues/${issueIid}`), {
    method: 'PUT',
    headers: { ...headers, 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });

  if (!res.ok) throw new Error(`이슈 수정 실패: ${res.statusText}`);
  return await res.json();
}

/**
 * MR의 파이프라인 목록을 조회합니다.
 */
export async function fetchGitLabMRPipelines(project: Project, decryptedToken: string, mrIid: number) {
  const projectPath = getProjectPath(project.repoUrl);
  if (!projectPath) return [];

  const headers = getAuthHeaders(project, decryptedToken);

  try {
    const res = await fetch(
      apiUrl(project, `/merge_requests/${mrIid}/pipelines`),
      { headers }
    );
    if (!res.ok) return [];
    return await res.json();
  } catch (err) {
    console.error(`[GitLab] Error fetching pipelines for MR !${mrIid}:`, err);
    return [];
  }
}

/**
 * 특정 브랜치(ref)의 최신 파이프라인을 조회합니다.
 * 머지 후 타겟 브랜치의 배포 파이프라인 조회에 사용됩니다.
 */
export async function fetchGitLabBranchPipelines(project: Project, decryptedToken: string, ref: string) {
  const projectPath = getProjectPath(project.repoUrl);
  if (!projectPath) return [];

  const headers = getAuthHeaders(project, decryptedToken);

  try {
    const res = await fetch(
      apiUrl(project, `/pipelines?ref=${encodeURIComponent(ref)}&order_by=id&sort=desc&per_page=5`),
      { headers }
    );
    if (!res.ok) return [];
    return await res.json();
  } catch (err) {
    console.error(`[GitLab] Error fetching pipelines for ref ${ref}:`, err);
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
  labels: string[],
  assigneeIds?: number[]
) {
  const projectPath = getProjectPath(project.repoUrl);
  if (!projectPath) throw new Error('Invalid repo URL');

  const headers = getAuthHeaders(project, decryptedToken);

  const body: any = { title, description, labels: labels.join(',') };
  if (assigneeIds && assigneeIds.length > 0) body.assignee_ids = assigneeIds;

  const res = await fetch(apiUrl(project, '/issues'), {
    method: 'POST',
    headers: { ...headers, 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });

  if (!res.ok) throw new Error(`이슈 생성 실패: ${res.statusText}`);
  return await res.json();
}

export async function fetchGitLabProjectMembers(project: Project, decryptedToken: string) {
  const headers = getAuthHeaders(project, decryptedToken);
  const res = await fetch(apiUrl(project, '/members/all?per_page=100'), { headers });
  if (!res.ok) return [];
  const members = await res.json();
  return members
    .filter((m: any) => !m.bot && m.state === 'active' && !m.username.startsWith('project_') && !m.username.includes('_bot'))
    .map((m: any) => ({
      id: m.id,
      username: m.username,
      name: m.name,
      avatarUrl: m.avatar_url,
    }));
}
