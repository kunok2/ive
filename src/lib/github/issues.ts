import { Project } from "@/types";
import { getOwnerRepo, getGitHubAuthHeaders, apiUrl, normalizeIssue } from "./common";
import { ensureGitHubLabels } from "./labels";

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
      if (res.status === 401) throw new Error('인증 정보가 유효하지 않거나 만료되었습니다. GitHub Personal Access Token을 확인해주세요.');
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
      author: { id: c.user?.id, name: c.user?.login || 'unknown', avatar_url: c.user?.avatar_url || '' },
      system: false,
      created_at: c.created_at,
    }));
  } catch (err) {
    console.error(`[GitHub] Error fetching comments for issue #${issueNumber}:`, err);
    return [];
  }
}

/**
 * 이슈의 코멘트를 삭제합니다.
 */
export async function deleteGitHubIssueComment(project: Project, _issueNumber: number, commentId: number, decryptedToken: string) {
  const headers = getGitHubAuthHeaders(project, decryptedToken);
  try {
    const res = await fetch(apiUrl(project, `/issues/comments/${commentId}`), {
      method: 'DELETE',
      headers
    });
    if (!res.ok) {
      const errorBody = await res.text().catch(() => 'No body');
      throw new Error(`GitHub 코멘트 삭제 실패 (${res.status} ${res.statusText}): ${errorBody}`);
    }
  } catch (err) {
    console.error(`[GitHub] Error deleting comment ${commentId}:`, err);
    throw err;
  }
}

/**
 * 프로젝트의 IVE 관련 이슈를 모두 가져옵니다 (모든 IVE 레이블 대상).
 */
export async function fetchAllIveIssues(project: Project, decryptedToken: string) {
  const ownerRepo = getOwnerRepo(project.repoUrl);
  if (!ownerRepo) return [];

  const headers = getGitHubAuthHeaders(project, decryptedToken);
  const allLabels = [project.labelTarget];

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

export async function fetchClosedProjectIssues(project: Project, decryptedToken: string) {
  const ownerRepo = getOwnerRepo(project.repoUrl);
  if (!ownerRepo) return [];

  const headers = getGitHubAuthHeaders(project, decryptedToken);

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
      for (const issue of issues) {
        if (!issue.pull_request) {
          allIssues.push(normalizeIssue(issue));
        }
      }
      if (issues.length < 100) break;
      page++;
    }
    return allIssues.sort((a: any, b: any) => new Date(b.updated_at).getTime() - new Date(a.updated_at).getTime());
  } catch (err) {
    console.error(`[GitHub] Error fetching closed project issues for ${project.name}:`, err);
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
 * GitHub 이슈를 다시 엽니다.
 */
export async function reopenGitHubIssue(project: Project, issueNumber: number, decryptedToken: string) {
  const ownerRepo = getOwnerRepo(project.repoUrl);
  if (!ownerRepo) throw new Error('Invalid repo URL');

  const headers = getGitHubAuthHeaders(project, decryptedToken);

  const res = await fetch(apiUrl(project, `/issues/${issueNumber}`), {
    method: 'PATCH',
    headers: { ...headers, 'Content-Type': 'application/json' },
    body: JSON.stringify({ state: 'open' }),
  });

  if (!res.ok) throw new Error(`이슈 다시 열기 실패: ${res.statusText}`);
  return normalizeIssue(await res.json());
}

/**
 * 이슈 제목/설명을 수정합니다.
 */
export async function updateGitHubIssue(
  project: Project,
  issueNumber: number,
  decryptedToken: string,
  updates: { title?: string; description?: string; assignees?: string[] }
) {
  const ownerRepo = getOwnerRepo(project.repoUrl);
  if (!ownerRepo) throw new Error('Invalid repo URL');

  const headers = getGitHubAuthHeaders(project, decryptedToken);

  const payload: any = {};
  if (updates.title) payload.title = updates.title;
  if (updates.description !== undefined) payload.body = updates.description;
  if (updates.assignees !== undefined) payload.assignees = updates.assignees;

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
  labels: string[],
  assignees?: string[]
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

  const body: any = { title, body: description, labels: validLabels };
  if (assignees && assignees.length > 0) body.assignees = assignees;

  const res = await fetch(apiUrl(project, '/issues'), {
    method: 'POST',
    headers: { ...headers, 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });

  if (!res.ok) {
    const errBody = await res.json().catch(() => ({}));
    console.error(`[GitHub] Issue creation failed (${res.status}):`, errBody);
    throw new Error(errBody.message || `이슈 생성 실패: ${res.statusText}`);
  }
  return normalizeIssue(await res.json());
}

export async function fetchGitHubCollaborators(project: Project, decryptedToken: string) {
  const headers = getGitHubAuthHeaders(project, decryptedToken);
  const res = await fetch(apiUrl(project, '/collaborators?per_page=100'), { headers });
  if (!res.ok) return [];
  const members = await res.json();
  return members
    .filter((m: any) => m.type !== 'Bot' && !m.login.includes('[bot]') && !m.login.endsWith('-bot'))
    .map((m: any) => ({
      id: m.id,
      username: m.login,
      name: m.login,
      avatarUrl: m.avatar_url,
    }));
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
