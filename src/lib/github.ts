import { Project } from "@/types";

/**
 * GitHub 저장소 URL에서 owner/repo를 추출합니다.
 * 예: https://github.com/owner/repo → owner/repo
 */
export function getOwnerRepo(repoUrl: string): string {
  try {
    const url = new URL(repoUrl.replace(/\.git$/, ''));
    const path = url.pathname.startsWith('/') ? url.pathname.slice(1) : url.pathname;
    return path; // "owner/repo"
  } catch {
    return "";
  }
}

/**
 * GitHub API 베이스 URL을 반환합니다.
 */
export function getGitHubApiBase(_repoUrl: string): string {
  return 'https://api.github.com';
}

/**
 * GitHub 인증 헤더를 반환합니다.
 */
export function getGitHubAuthHeaders(project: Project, decryptedToken: string): Record<string, string> {
  if (project.authType === 'basic') {
    const encoded = Buffer.from(`${project.gitUsername}:${decryptedToken}`).toString('base64');
    return { 'Authorization': `Basic ${encoded}`, 'Accept': 'application/vnd.github+json' };
  }
  return { 'Authorization': `Bearer ${decryptedToken}`, 'Accept': 'application/vnd.github+json' };
}

function apiUrl(project: Project, path: string): string {
  const base = getGitHubApiBase(project.repoUrl);
  const ownerRepo = getOwnerRepo(project.repoUrl);
  return `${base}/repos/${ownerRepo}${path}`;
}

/**
 * GitHub 프로젝트에 필요한 레이블들이 있는지 확인하고, 없으면 생성합니다.
 */
export async function ensureGitHubLabels(project: Project, decryptedToken: string) {
  const ownerRepo = getOwnerRepo(project.repoUrl);
  if (!ownerRepo) return;

  const headers = getGitHubAuthHeaders(project, decryptedToken);
  const labelsToEnsure = [
    { name: project.labelTarget, color: '34d399', description: 'IVE 관리 대상 이슈' },
  ];

  try {
    // 전체 레이블 조회
    const res = await fetch(apiUrl(project, '/labels?per_page=100'), { headers });
    if (!res.ok) {
      if (res.status === 401) throw new Error('인증 정보가 유효하지 않거나 만료되었습니다.');
      throw new Error(`Failed to fetch labels: ${res.statusText}`);
    }
    const existingLabels: any[] = await res.json();
    const existingNames = existingLabels.map(l => l.name);

    for (const label of labelsToEnsure) {
      if (!existingNames.includes(label.name)) {
        console.log(`[GitHub] Creating label: ${label.name} for project: ${project.name}`);
        await fetch(apiUrl(project, '/labels'), {
          method: 'POST',
          headers: { ...headers, 'Content-Type': 'application/json' },
          body: JSON.stringify(label),
        });
      }
    }
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.warn(`[GitHub] Label sync failed for ${project.name}: ${msg}`);
  }
}

/**
 * 특정 레이블이 붙은 열린 이슈 목록을 가져옵니다.
 */
export async function fetchGitHubIssues(project: Project, decryptedToken: string, label: string) {
  const ownerRepo = getOwnerRepo(project.repoUrl);
  if (!ownerRepo) return [];

  const headers = getGitHubAuthHeaders(project, decryptedToken);

  try {
    const res = await fetch(
      apiUrl(project, `/issues?labels=${encodeURIComponent(label)}&state=open&per_page=100`),
      { headers }
    );
    if (!res.ok) {
      if (res.status === 401) throw new Error('인증 정보가 유효하지 않거나 만료되었습니다.');
      if (res.status === 404) throw new Error('프로젝트를 찾을 수 없습니다. 저장소 주소를 확인하세요.');
      if (res.status === 403) throw new Error('접근 권한이 없습니다. 인증 정보를 확인하세요.');
      throw new Error(`GitHub API 오류 (${res.status}): ${res.statusText}`);
    }
    const issues = await res.json();
    // GitHub issues API에는 PR도 포함되므로 제외
    return issues
      .filter((i: any) => !i.pull_request)
      .map((i: any) => normalizeIssue(i));
  } catch (err) {
    throw err;
  }
}

/**
 * GitHub 이슈를 GitLab 이슈와 동일한 형태로 정규화합니다.
 */
function normalizeIssue(ghIssue: any): any {
  return {
    iid: ghIssue.number,
    id: ghIssue.id,
    title: ghIssue.title,
    description: ghIssue.body || '',
    state: ghIssue.state === 'open' ? 'opened' : 'closed',
    labels: (ghIssue.labels || []).map((l: any) => typeof l === 'string' ? l : l.name),
    created_at: ghIssue.created_at,
    updated_at: ghIssue.updated_at,
    web_url: ghIssue.html_url,
    author: ghIssue.user ? { name: ghIssue.user.login } : undefined,
  };
}

/**
 * 특정 이슈의 레이블을 업데이트합니다.
 */
export async function updateGitHubIssueLabels(
  project: Project,
  issueNumber: number,
  decryptedToken: string,
  addLabels: string[],
  removeLabels: string[]
) {
  const ownerRepo = getOwnerRepo(project.repoUrl);
  if (!ownerRepo) return;

  const headers = getGitHubAuthHeaders(project, decryptedToken);

  try {
    // 현재 이슈 조회
    const res = await fetch(apiUrl(project, `/issues/${issueNumber}`), { headers });
    if (!res.ok) throw new Error(`Fetch issue failed: ${res.statusText}`);
    const issueData = await res.json();
    let currentLabels: string[] = (issueData.labels || []).map((l: any) => typeof l === 'string' ? l : l.name);

    let newLabels = currentLabels.filter(l => !removeLabels.includes(l));
    addLabels.forEach(l => {
      if (!newLabels.includes(l)) newLabels.push(l);
    });

    await fetch(apiUrl(project, `/issues/${issueNumber}`), {
      method: 'PATCH',
      headers: { ...headers, 'Content-Type': 'application/json' },
      body: JSON.stringify({ labels: newLabels }),
    });

    console.log(`[GitHub] Updated labels for issue #${issueNumber}: [${newLabels.join(', ')}]`);
  } catch (err) {
    console.error(`[GitHub] Error updating labels for issue #${issueNumber}:`, err);
  }
}

/**
 * 이슈에 코멘트를 추가합니다.
 */
export async function addGitHubIssueComment(project: Project, issueNumber: number, decryptedToken: string, body: string) {
  const ownerRepo = getOwnerRepo(project.repoUrl);
  if (!ownerRepo) return;

  const headers = getGitHubAuthHeaders(project, decryptedToken);

  try {
    await fetch(apiUrl(project, `/issues/${issueNumber}/comments`), {
      method: 'POST',
      headers: { ...headers, 'Content-Type': 'application/json' },
      body: JSON.stringify({ body }),
    });
  } catch (err) {
    console.error(`[GitHub] Error adding comment to issue #${issueNumber}:`, err);
  }
}

/**
 * 이슈의 코멘트 목록을 조회합니다.
 */
export async function fetchGitHubIssueNotes(project: Project, issueNumber: number, decryptedToken: string) {
  const ownerRepo = getOwnerRepo(project.repoUrl);
  if (!ownerRepo) return [];

  const headers = getGitHubAuthHeaders(project, decryptedToken);

  try {
    const res = await fetch(apiUrl(project, `/issues/${issueNumber}/comments?per_page=100`), { headers });
    if (!res.ok) throw new Error(`Fetch comments failed: ${res.statusText}`);
    const comments = await res.json();
    // GitLab notes 형태로 정규화
    return comments.map((c: any) => ({
      id: c.id,
      body: c.body,
      author: { name: c.user?.login || 'unknown', avatar_url: c.user?.avatar_url || '' },
      system: false,
      created_at: c.created_at,
    }));
  } catch (err) {
    console.error(`[GitHub] Error fetching comments for issue #${issueNumber}:`, err);
    return [];
  }
}

/**
 * Pull Request를 생성합니다.
 */
export async function createGitHubPR(project: Project, decryptedToken: string, payload: {
  source_branch: string;
  target_branch: string;
  title: string;
  description?: string;
}) {
  const ownerRepo = getOwnerRepo(project.repoUrl);
  if (!ownerRepo) return null;

  const headers = getGitHubAuthHeaders(project, decryptedToken);

  try {
    const res = await fetch(apiUrl(project, '/pulls'), {
      method: 'POST',
      headers: { ...headers, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        head: payload.source_branch,
        base: payload.target_branch,
        title: payload.title,
        body: payload.description || '',
      }),
    });
    if (!res.ok) {
      const errBody = await res.json().catch(() => ({}));
      console.error(`[GitHub] PR creation failed (${res.status}):`, errBody);
      throw new Error(errBody.message || `Create PR failed: ${res.statusText}`);
    }
    const pr = await res.json();
    return normalizePR(pr);
  } catch (err) {
    console.error(`[GitHub] Error creating PR for ${project.name}:`, err);
    return null;
  }
}

/**
 * GitHub PR을 GitLab MR과 동일한 형태로 정규화합니다.
 */
function normalizePR(pr: any): any {
  return {
    iid: pr.number,
    id: pr.id,
    title: pr.title,
    state: pr.merged_at ? 'merged' : pr.state === 'open' ? 'opened' : 'closed',
    source_branch: pr.head?.ref,
    target_branch: pr.base?.ref,
    merge_status: pr.mergeable ? 'can_be_merged' : 'cannot_be_merged',
    has_conflicts: pr.mergeable === false,
    web_url: pr.html_url,
    changes_count: pr.changed_files,
    user_notes_count: pr.comments,
    created_at: pr.created_at,
    merged_at: pr.merged_at,
    merged_by: pr.merged_by ? { name: pr.merged_by.login } : null,
    diff_refs: null,
  };
}

/**
 * source_branch로 PR을 조회합니다 (open + closed/merged 모두).
 */
export async function fetchGitHubPRByBranch(project: Project, decryptedToken: string, sourceBranch: string) {
  const ownerRepo = getOwnerRepo(project.repoUrl);
  if (!ownerRepo) return null;

  const headers = getGitHubAuthHeaders(project, decryptedToken);

  try {
    // open 먼저
    let res = await fetch(
      apiUrl(project, `/pulls?head=${ownerRepo.split('/')[0]}:${sourceBranch}&state=open&per_page=1`),
      { headers }
    );
    if (res.ok) {
      const prs = await res.json();
      if (prs.length > 0) return normalizePR(prs[0]);
    }
    // closed (merged 포함)
    res = await fetch(
      apiUrl(project, `/pulls?head=${ownerRepo.split('/')[0]}:${sourceBranch}&state=closed&per_page=1`),
      { headers }
    );
    if (res.ok) {
      const prs = await res.json();
      if (prs.length > 0) return normalizePR(prs[0]);
    }
    return null;
  } catch (err) {
    console.error(`[GitHub] Error fetching PR by branch ${sourceBranch}:`, err);
    return null;
  }
}

/**
 * 기존 PR을 조회합니다 (source_branch로).
 */
export async function getGitHubPR(project: Project, decryptedToken: string, sourceBranch: string) {
  return fetchGitHubPRByBranch(project, decryptedToken, sourceBranch);
}

/**
 * PR의 변경사항(diff)을 조회합니다.
 */
export async function fetchGitHubPRChanges(project: Project, decryptedToken: string, prNumber: number) {
  const ownerRepo = getOwnerRepo(project.repoUrl);
  if (!ownerRepo) return null;

  const headers = getGitHubAuthHeaders(project, decryptedToken);

  try {
    const res = await fetch(
      apiUrl(project, `/pulls/${prNumber}/files?per_page=300`),
      { headers }
    );
    if (!res.ok) throw new Error(`Fetch PR files failed: ${res.statusText}`);
    const files = await res.json();
    // GitLab MR changes 형태로 정규화
    return {
      changes: files.map((f: any) => ({
        old_path: f.previous_filename || f.filename,
        new_path: f.filename,
        new_file: f.status === 'added',
        renamed_file: f.status === 'renamed',
        deleted_file: f.status === 'removed',
        diff: f.patch || '',
      })),
    };
  } catch (err) {
    console.error(`[GitHub] Error fetching PR files for #${prNumber}:`, err);
    return null;
  }
}

/**
 * PR을 머지합니다.
 */
export async function mergeGitHubPR(project: Project, decryptedToken: string, prNumber: number) {
  const ownerRepo = getOwnerRepo(project.repoUrl);
  if (!ownerRepo) throw new Error('Invalid repo URL');

  const headers = getGitHubAuthHeaders(project, decryptedToken);

  const res = await fetch(
    apiUrl(project, `/pulls/${prNumber}/merge`),
    {
      method: 'PUT',
      headers: { ...headers, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        merge_method: 'squash',
      }),
    }
  );

  if (!res.ok) {
    const body = await res.text();
    console.error(`[mergeGitHubPR] 실패 status=${res.status} body=${body} prNumber=${prNumber}`);
    if (res.status === 405) {
      throw new Error(`머지 불가: PR이 머지 가능한 상태가 아닙니다.`);
    }
    if (res.status === 409) {
      throw new Error(`머지 불가: 충돌이 있거나 머지 조건이 충족되지 않았습니다.`);
    }
    throw new Error(`PR 머지 실패 (${res.status}): ${body}`);
  }
  return await res.json();
}

/**
 * PR에 코멘트를 추가합니다.
 */
export async function addGitHubPRNote(project: Project, decryptedToken: string, prNumber: number, body: string) {
  // GitHub에서 PR 코멘트는 issue 코멘트와 동일 (PR number = issue number)
  await addGitHubIssueComment(project, prNumber, decryptedToken, body);
}

/**
 * PR의 커밋에 연결된 check runs (CI 상태)를 조회합니다.
 * GitLab 파이프라인에 대응하는 GitHub 기능입니다.
 */
export async function fetchGitHubPRCheckRuns(project: Project, decryptedToken: string, prNumber: number) {
  const ownerRepo = getOwnerRepo(project.repoUrl);
  if (!ownerRepo) return [];

  const headers = getGitHubAuthHeaders(project, decryptedToken);

  try {
    // PR의 최신 커밋 SHA 조회
    const prRes = await fetch(apiUrl(project, `/pulls/${prNumber}`), { headers });
    if (!prRes.ok) return [];
    const prData = await prRes.json();
    const sha = prData.head?.sha;
    if (!sha) return [];

    // 해당 커밋의 check runs 조회
    const checksRes = await fetch(apiUrl(project, `/commits/${sha}/check-runs`), { headers });
    if (!checksRes.ok) return [];
    const checksData = await checksRes.json();

    // GitLab 파이프라인 형식으로 변환
    const runs = checksData.check_runs || [];
    if (runs.length === 0) return [];

    // 전체 상태 판단
    const allCompleted = runs.every((r: any) => r.status === 'completed');
    const anyFailed = runs.some((r: any) => r.conclusion === 'failure');
    let status = 'running';
    if (allCompleted) status = anyFailed ? 'failed' : 'success';

    return [{ id: 0, status, web_url: prData.html_url, created_at: runs[0]?.started_at }];
  } catch (err) {
    console.error(`[GitHub] Error fetching check runs for PR #${prNumber}:`, err);
    return [];
  }
}

/**
 * 특정 브랜치(ref)의 최신 check runs를 조회합니다.
 * 머지 후 타겟 브랜치의 CI 상태 조회에 사용됩니다.
 */
export async function fetchGitHubBranchCheckRuns(project: Project, decryptedToken: string, ref: string) {
  const ownerRepo = getOwnerRepo(project.repoUrl);
  if (!ownerRepo) return [];

  const headers = getGitHubAuthHeaders(project, decryptedToken);

  try {
    const branchRes = await fetch(apiUrl(project, `/branches/${encodeURIComponent(ref)}`), { headers });
    if (!branchRes.ok) return [];
    const branchData = await branchRes.json();
    const sha = branchData.commit?.sha;
    if (!sha) return [];

    const checksRes = await fetch(apiUrl(project, `/commits/${sha}/check-runs`), { headers });
    if (!checksRes.ok) return [];
    const checksData = await checksRes.json();

    const runs = checksData.check_runs || [];
    if (runs.length === 0) return [];

    const allCompleted = runs.every((r: any) => r.status === 'completed');
    const anyFailed = runs.some((r: any) => r.conclusion === 'failure');
    let status = 'running';
    if (allCompleted) status = anyFailed ? 'failed' : 'success';

    return [{ id: 0, status, web_url: branchData.commit?.html_url, created_at: runs[0]?.started_at }];
  } catch (err) {
    console.error(`[GitHub] Error fetching check runs for branch ${ref}:`, err);
    return [];
  }
}

/**
 * 프로젝트의 IVE 관련 이슈를 모두 가져옵니다 (모든 IVE 레이블 대상).
 */
export async function fetchAllIveIssues(project: Project, decryptedToken: string) {
  const ownerRepo = getOwnerRepo(project.repoUrl);
  if (!ownerRepo) return [];

  const headers = getGitHubAuthHeaders(project, decryptedToken);
  const allLabels = [
    project.labelTarget, project.labelInProgress, project.labelFailDev, project.labelDone,
  ];

  try {
    const results: any[] = [];
    for (const label of allLabels) {
      const res = await fetch(
        apiUrl(project, `/issues?labels=${encodeURIComponent(label)}&state=open&per_page=100`),
        { headers }
      );
      if (res.ok) {
        const issues = await res.json();
        for (const issue of issues) {
          if (issue.pull_request) continue; // PR 제외
          const normalized = normalizeIssue(issue);
          if (!results.some(r => r.iid === normalized.iid)) {
            results.push(normalized);
          }
        }
      }
    }
    return results.sort((a, b) => b.iid - a.iid);
  } catch (err) {
    console.error(`[GitHub] Error fetching all IVE issues for ${project.name}:`, err);
    return [];
  }
}

/**
 * 프로젝트의 모든 열린 이슈를 가져옵니다.
 */
export async function fetchAllProjectIssues(project: Project, decryptedToken: string) {
  const ownerRepo = getOwnerRepo(project.repoUrl);
  if (!ownerRepo) return [];

  const headers = getGitHubAuthHeaders(project, decryptedToken);

  try {
    const allIssues: any[] = [];
    let page = 1;
    while (true) {
      const res = await fetch(
        apiUrl(project, `/issues?state=open&per_page=100&page=${page}`),
        { headers }
      );
      if (!res.ok) break;
      const issues = await res.json();
      if (issues.length === 0) break;
      // PR 제외
      for (const issue of issues) {
        if (!issue.pull_request) {
          allIssues.push(normalizeIssue(issue));
        }
      }
      if (issues.length < 100) break;
      page++;
    }
    return allIssues.sort((a: any, b: any) => b.iid - a.iid);
  } catch (err) {
    console.error(`[GitHub] Error fetching all project issues for ${project.name}:`, err);
    return [];
  }
}

/**
 * GitHub 이슈를 닫습니다.
 */
export async function closeGitHubIssue(project: Project, issueNumber: number, decryptedToken: string) {
  const ownerRepo = getOwnerRepo(project.repoUrl);
  if (!ownerRepo) throw new Error('Invalid repo URL');

  const headers = getGitHubAuthHeaders(project, decryptedToken);

  const res = await fetch(apiUrl(project, `/issues/${issueNumber}`), {
    method: 'PATCH',
    headers: { ...headers, 'Content-Type': 'application/json' },
    body: JSON.stringify({ state: 'closed' }),
  });

  if (!res.ok) throw new Error(`이슈 닫기 실패: ${res.statusText}`);
  return normalizeIssue(await res.json());
}

/**
 * 이슈 제목/설명을 수정합니다.
 */
export async function updateGitHubIssue(
  project: Project,
  issueNumber: number,
  decryptedToken: string,
  updates: { title?: string; description?: string }
) {
  const ownerRepo = getOwnerRepo(project.repoUrl);
  if (!ownerRepo) throw new Error('Invalid repo URL');

  const headers = getGitHubAuthHeaders(project, decryptedToken);

  const payload: any = {};
  if (updates.title) payload.title = updates.title;
  if (updates.description !== undefined) payload.body = updates.description;

  const res = await fetch(apiUrl(project, `/issues/${issueNumber}`), {
    method: 'PATCH',
    headers: { ...headers, 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });

  if (!res.ok) throw new Error(`이슈 수정 실패: ${res.statusText}`);
  return normalizeIssue(await res.json());
}

/**
 * 이슈를 생성합니다.
 */
export async function createGitHubIssue(
  project: Project,
  decryptedToken: string,
  title: string,
  description: string,
  labels: string[]
) {
  const ownerRepo = getOwnerRepo(project.repoUrl);
  if (!ownerRepo) throw new Error('Invalid repo URL');

  const headers = getGitHubAuthHeaders(project, decryptedToken);

  // 레이블이 있으면 먼저 동기화 시도 후, 실제 존재하는 레이블만 사용
  let validLabels = labels;
  if (labels.length > 0) {
    await ensureGitHubLabels(project, decryptedToken); // 내부에서 에러 catch됨
    // 실제 존재하는 레이블만 필터링 (권한 부족으로 생성 실패했을 수 있으므로)
    try {
      const labelsRes = await fetch(apiUrl(project, '/labels?per_page=100'), { headers });
      if (labelsRes.ok) {
        const existing = (await labelsRes.json()).map((l: any) => l.name);
        validLabels = labels.filter(l => existing.includes(l));
      } else {
        validLabels = [];
      }
    } catch {
      validLabels = [];
    }
  }

  const res = await fetch(apiUrl(project, '/issues'), {
    method: 'POST',
    headers: { ...headers, 'Content-Type': 'application/json' },
    body: JSON.stringify({ title, body: description, labels: validLabels }),
  });

  if (!res.ok) {
    const errBody = await res.json().catch(() => ({}));
    console.error(`[GitHub] Issue creation failed (${res.status}):`, errBody);
    throw new Error(errBody.message || `이슈 생성 실패: ${res.statusText}`);
  }
  return normalizeIssue(await res.json());
}

/**
 * 단일 이슈를 조회합니다.
 */
export async function fetchGitHubIssue(project: Project, issueNumber: number, decryptedToken: string) {
  const ownerRepo = getOwnerRepo(project.repoUrl);
  if (!ownerRepo) return null;

  const headers = getGitHubAuthHeaders(project, decryptedToken);

  const res = await fetch(apiUrl(project, `/issues/${issueNumber}`), { headers });
  if (!res.ok) {
    if (res.status === 404) return null;
    throw new Error(`GitHub API 오류: ${res.statusText}`);
  }
  return normalizeIssue(await res.json());
}
