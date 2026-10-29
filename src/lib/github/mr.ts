import { gitFetch } from "@/lib/git-fetch";
import { Project, PipelineFilter } from "@/types";
import { getOwnerRepo, getGitHubAuthHeaders, apiUrl, normalizePR } from "./common";
import { addGitHubIssueComment } from "./issues";
import { fetchAllPages } from "@/lib/git-paging";

/**
 * Pull Request를 생성합니다.
 */
export async function createGitHubPR(project: Project, decryptedToken: string, payload: {
  source_branch: string;
  target_branch: string;
  title: string;
  description?: string;
  labels?: string[];
}) {
  const ownerRepo = getOwnerRepo(project.repoUrl);
  if (!ownerRepo) return null;

  const headers = getGitHubAuthHeaders(project, decryptedToken);

  try {
    const res = await gitFetch(apiUrl(project, '/pulls'), {
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
    if (payload.labels?.length) await addGitHubPRLabels(project, decryptedToken, pr.number, payload.labels);
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
  const head = encodeURIComponent(`${ownerRepo.split('/')[0]}:${sourceBranch}`);

  // 조회 실패는 throw 해서 withGitToken fallback 발동시킴 — 「PR 없음」(200 with [])과 구분한다.
  // GitHub 은 토큰에 권한이 없는 비공개 저장소에 401/403 이 아니라 404 를 준다.
  // open 먼저, 없으면 closed (merged 포함)
  for (const state of ['open', 'closed']) {
    const res = await gitFetch(apiUrl(project, `/pulls?head=${head}&state=${state}&per_page=1`), { headers });
    if (!res.ok) throw new Error(`GitHub PR fetch failed: ${res.status} ${res.statusText}`);
    const prs = await res.json();
    if (prs.length > 0) return normalizePR(prs[0]);
  }
  return null;
}

/**
 * 기존 PR을 조회합니다 (source_branch로).
 */
export async function getGitHubPR(project: Project, decryptedToken: string, sourceBranch: string) {
  try {
    return await fetchGitHubPRByBranch(project, decryptedToken, sourceBranch);
  } catch (err) {
    console.error(`[GitHub] Error fetching PR for ${project.name}:`, err);
    return null;
  }
}

/**
 * PR의 변경사항(diff)을 조회합니다.
 */
export async function fetchGitHubPRChanges(project: Project, decryptedToken: string, prNumber: number) {
  const ownerRepo = getOwnerRepo(project.repoUrl);
  if (!ownerRepo) return null;

  const headers = getGitHubAuthHeaders(project, decryptedToken);

  try {
    const res = await fetchAllPages(apiUrl(project, `/pulls/${prNumber}/files`), headers, 30);
    if (!res.ok) throw new Error(`Fetch PR files failed: ${res.statusText}`);
    const files = res.items;
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
 * 저장소가 허용하는 머지 방식 — squash 우선, 막혀 있으면 merge commit, 그다음 rebase.
 * 저장소 설정에서 squash 를 끈 곳(merge commit 만 허용)에 squash 로 머지하면 GitHub 이 405 로 거절한다.
 * 설정을 못 읽으면 종전대로 squash.
 */
async function getAllowedMergeMethod(project: Project, headers: Record<string, string>): Promise<'squash' | 'merge' | 'rebase'> {
  try {
    const res = await gitFetch(apiUrl(project, ''), { headers });
    if (!res.ok) return 'squash';
    const repo = await res.json();
    if (repo.allow_squash_merge !== false) return 'squash';
    if (repo.allow_merge_commit !== false) return 'merge';
    if (repo.allow_rebase_merge !== false) return 'rebase';
  } catch { /* 종전 동작 */ }
  return 'squash';
}

/**
 * PR을 머지합니다.
 */
export async function mergeGitHubPR(project: Project, decryptedToken: string, prNumber: number, options?: { sha?: string }) {
  const ownerRepo = getOwnerRepo(project.repoUrl);
  if (!ownerRepo) throw new Error('Invalid repo URL');

  const headers = getGitHubAuthHeaders(project, decryptedToken);
  const mergeMethod = await getAllowedMergeMethod(project, headers);

  const res = await gitFetch(
    apiUrl(project, `/pulls/${prNumber}/merge`),
    {
      method: 'PUT',
      headers: { ...headers, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        merge_method: mergeMethod,
        ...(options?.sha ? { sha: options.sha } : {}),
      }),
    }
  );

  if (!res.ok) {
    const body = await res.text();
    console.error(`[mergeGitHubPR] 실패 status=${res.status} method=${mergeMethod} body=${body} prNumber=${prNumber}`);
    if (res.status === 405) {
      const reason = (() => { try { return JSON.parse(body).message as string } catch { return '' } })();
      throw new Error(`머지 불가: PR이 머지 가능한 상태가 아닙니다.${reason ? ` (${reason})` : ''}`);
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
  const res = await gitFetch(
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
      res = await gitFetch(
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
    labels: (pr.labels || []).map((l: any) => l.name) as string[],
  }));
}

/**
 * 기존 PR에 레이블을 더합니다 (PR 은 이슈 API 로 레이블을 다룬다).
 */
export async function addGitHubPRLabels(project: Project, decryptedToken: string, prNumber: number, labels: string[]) {
  const headers = getGitHubAuthHeaders(project, decryptedToken);
  try {
    await gitFetch(apiUrl(project, `/issues/${prNumber}/labels`), {
      method: 'POST',
      headers: { ...headers, 'Content-Type': 'application/json' },
      body: JSON.stringify({ labels }),
    });
  } catch (err) {
    console.error(`[GitHub] PR 레이블 추가 실패 (${project.name} #${prNumber}):`, err);
  }
}

/**
 * PR 리뷰어에 사람을 더한다 (이미 요청돼 있으면 그대로). 더했으면 true.
 * PR 작성자 본인 등 GitHub 이 거절하는 경우 false 로 돌려준다(검증 시작을 막지 않는다).
 */
export async function addGitHubPRReviewer(project: Project, decryptedToken: string, prNumber: number, login: string): Promise<boolean> {
  const headers = getGitHubAuthHeaders(project, decryptedToken);
  try {
    const cur = await gitFetch(apiUrl(project, `/pulls/${prNumber}`), { headers });
    if (!cur.ok) return false;
    const pr = await cur.json();
    if ((pr.requested_reviewers || []).some((r: any) => String(r.login).toLowerCase() === login.toLowerCase())) return false;
    const res = await gitFetch(apiUrl(project, `/pulls/${prNumber}/requested_reviewers`), {
      method: 'POST',
      headers: { ...headers, 'Content-Type': 'application/json' },
      body: JSON.stringify({ reviewers: [login] }),
    });
    return res.ok;
  } catch (err) {
    console.error(`[GitHub] PR 리뷰어 추가 실패 (${project.name} #${prNumber}):`, err);
    return false;
  }
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
    const prRes = await gitFetch(apiUrl(project, `/pulls/${prNumber}`), { headers });
    if (!prRes.ok) return [];
    const prData = await prRes.json();
    const sha = prData.head?.sha;
    if (!sha) return [];

    // 해당 커밋의 check runs 조회
    const checksRes = await gitFetch(apiUrl(project, `/commits/${sha}/check-runs`), { headers });
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
export async function fetchGitHubBranchCheckRuns(project: Project, decryptedToken: string, ref: string, filter?: PipelineFilter) {
  const ownerRepo = getOwnerRepo(project.repoUrl);
  if (!ownerRepo) return [];

  const headers = getGitHubAuthHeaders(project, decryptedToken);

  try {
    const branchRes = await gitFetch(apiUrl(project, `/branches/${encodeURIComponent(ref)}`), { headers });
    if (!branchRes.ok) return [];
    const branchData = await branchRes.json();
    // filter.sha — 브랜치 머리가 아니라 그 커밋의 check runs
    const sha = filter?.sha || branchData.commit?.sha;
    if (!sha) return [];

    const checksRes = await gitFetch(apiUrl(project, `/commits/${sha}/check-runs`), { headers });
    if (!checksRes.ok) return [];
    const checksData = await checksRes.json();

    const runs = checksData.check_runs || [];
    if (runs.length === 0) return [];

    const allCompleted = runs.every((r: any) => r.status === 'completed');
    const anyFailed = runs.some((r: any) => r.conclusion === 'failure');
    let status = 'running';
    if (allCompleted) status = anyFailed ? 'failed' : 'success';

    if (filter?.status && filter.status !== status) return [];
    return [{ id: 0, status, sha, web_url: filter?.sha ? undefined : branchData.commit?.html_url, created_at: runs[0]?.started_at }];
  } catch (err) {
    console.error(`[GitHub] Error fetching check runs for branch ${ref}:`, err);
    return [];
  }
}
