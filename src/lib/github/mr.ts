import { Project } from "@/types";
import { getOwnerRepo, getGitHubAuthHeaders, apiUrl, normalizePR } from "./common";
import { addGitHubIssueComment } from "./issues";

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
 * PR을 닫습니다 (머지하지 않고).
 */
export async function closeGitHubPR(project: Project, decryptedToken: string, prNumber: number) {
  const headers = getGitHubAuthHeaders(project, decryptedToken);
  const res = await fetch(
    apiUrl(project, `/pulls/${prNumber}`),
    {
      method: 'PATCH',
      headers: { ...headers, 'Content-Type': 'application/json' },
      body: JSON.stringify({ state: 'closed' }),
    }
  );
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`PR 닫기 실패 (${res.status}): ${body}`);
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
 * 열린 PR 전체 목록을 조회합니다 (충돌 감지용).
 */
export async function fetchOpenGitHubPRs(project: Project, decryptedToken: string) {
  const ownerRepo = getOwnerRepo(project.repoUrl);
  if (!ownerRepo) return [];

  const headers = getGitHubAuthHeaders(project, decryptedToken);
  const prs: any[] = [];
  let page = 1;

  while (true) {
    let res: Response;
    try {
      res = await fetch(
        apiUrl(project, `/pulls?state=open&per_page=100&page=${page}`),
        { headers }
      );
    } catch (e) {
      console.error(`[GitHub] fetchOpenGitHubPRs 네트워크 오류 (${ownerRepo}):`, (e as Error).message);
      return prs;
    }
    if (!res.ok) break;
    const data = await res.json();
    if (!data.length) break;
    prs.push(...data);
    if (data.length < 100) break;
    page++;
  }

  return prs.map((pr: any) => ({
    iid: pr.number,
    title: pr.title,
    source_branch: pr.head?.ref,
    target_branch: pr.base?.ref,
    has_conflicts: pr.mergeable === false,
    web_url: pr.html_url,
  }));
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
