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

export function apiUrl(project: Project, path: string): string {
  const base = getGitHubApiBase(project.repoUrl);
  const ownerRepo = getOwnerRepo(project.repoUrl);
  return `${base}/repos/${ownerRepo}${path}`;
}

/**
 * GitHub 이슈를 GitLab 이슈와 동일한 형태로 정규화합니다.
 */
export function normalizeIssue(ghIssue: any): any {
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
    author: ghIssue.user ? { id: ghIssue.user.id, name: ghIssue.user.login, username: ghIssue.user.login, avatar_url: ghIssue.user.avatar_url } : undefined,
  };
}

/**
 * GitHub PR을 GitLab MR과 동일한 형태로 정규화합니다.
 */
export function normalizePR(pr: any): any {
  return {
    iid: pr.number,
    id: pr.id,
    title: pr.title,
    state: pr.merged_at ? 'merged' : pr.state === 'open' ? 'opened' : 'closed',
    source_branch: pr.head?.ref,
    target_branch: pr.base?.ref,
    merge_status: pr.mergeable === false ? 'cannot_be_merged' : 'can_be_merged',
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
