import { Project } from "@/types";
import { getOwnerRepo, getGitHubAuthHeaders, getGitHubApiBase, apiUrl, normalizeIssue } from "./common";
import { closedLabelSet, type ClosedIssuePage, type ClosedIssuePageOptions } from "@/lib/closed-issues";
import { ensureGitHubLabels } from "./labels";
import { setIveDueMarker } from "@/lib/ive-author";
import { fetchAllPages } from "@/lib/git-paging";

/**
 * 특정 레이블이 붙은 열린 이슈 목록을 가져옵니다.
 */
export async function fetchGitHubIssues(project: Project, decryptedToken: string, label: string) {
  const ownerRepo = getOwnerRepo(project.repoUrl);
  if (!ownerRepo) return [];

  const headers = getGitHubAuthHeaders(project, decryptedToken);

  try {
    const res = await fetchAllPages(
      apiUrl(project, `/issues?labels=${encodeURIComponent(label)}&state=open`),
      headers
    );
    if (!res.ok) {
      if (res.status === 401) throw new Error('인증 정보가 유효하지 않거나 만료되었습니다. GitHub Personal Access Token을 확인해주세요.');
      if (res.status === 404) throw new Error('프로젝트를 찾을 수 없습니다. 저장소 주소를 확인하세요.');
      if (res.status === 403) throw new Error('접근 권한이 없습니다. 인증 정보를 확인하세요.');
      throw new Error(`GitHub API 오류 (${res.status}): ${res.statusText}`);
    }
    const issues = res.items;
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
    const res = await fetchAllPages(apiUrl(project, `/issues/${issueNumber}/comments`), headers);
    if (!res.ok) throw new Error(`Fetch comments failed: ${res.statusText}`);
    const comments = res.items;
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
      const res = await fetchAllPages(
        apiUrl(project, `/issues?labels=${encodeURIComponent(label)}&state=open`),
        headers
      );
      if (res.ok) {
        for (const issue of res.items) {
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
 * 닫힌 이슈를 한 페이지씩 가져온다 (이력 탭). GitLab 구현과 같은 모양을 돌려준다.
 * - 검색어 없음: /issues (PR 이 섞여 오므로 걸러냄 — 한 페이지가 perPage 보다 적을 수 있음), 다음 페이지는 Link rel="next"
 * - 검색어: Search API (제목·본문), 숫자(#123)면 이슈 단건
 */
export async function fetchClosedProjectIssuesPage(
  project: Project,
  decryptedToken: string,
  opts: ClosedIssuePageOptions,
): Promise<ClosedIssuePage> {
  const ownerRepo = getOwnerRepo(project.repoUrl);
  if (!ownerRepo) return { issues: [], total: 0, hasMore: false };
  const headers = getGitHubAuthHeaders(project, decryptedToken);
  const search = (opts.search || '').trim();

  const iidMatch = search.match(/^#?(\d+)$/);
  if (iidMatch) {
    if (opts.page > 1) return { issues: [], total: null, hasMore: false };
    const res = await fetch(apiUrl(project, `/issues/${iidMatch[1]}`), { headers });
    if (res.status === 404) return { issues: [], total: 0, hasMore: false };
    if (!res.ok) throw new Error(`닫힌 이슈 조회 실패: ${res.status} ${res.statusText}`);
    const issue = await res.json();
    const wanted = closedLabelSet(opts);
    const hasLabel = !opts.label || (issue.labels || []).some((l: string | { name?: string }) => wanted.includes((typeof l === 'string' ? l : l.name) ?? ''));
    const ok = issue.state === 'closed' && !issue.pull_request && hasLabel;
    return { issues: ok ? [normalizeIssue(issue)] : [], total: ok ? 1 : 0, hasMore: false };
  }

  // 라벨 OR(label, orLabel)는 Search API 만 된다(쉼표 = OR) — /issues 의 labels 는 AND
  const orLabels = closedLabelSet(opts).filter(l => l !== opts.label);
  if (search || orLabels.length) {
    const quote = (l: string) => `"${l.replace(/"/g, '')}"`;
    const labelQ = opts.label ? ` label:${closedLabelSet(opts).map(quote).join(',')}` : '';
    const q = `repo:${ownerRepo} is:issue is:closed${labelQ}${search ? ` ${search}` : ''}`;
    const params = new URLSearchParams({
      q, sort: 'updated', order: opts.sort, per_page: String(opts.perPage), page: String(opts.page),
    });
    const res = await fetch(`${getGitHubApiBase(project.repoUrl)}/search/issues?${params.toString()}`, { headers });
    if (!res.ok) throw new Error(`닫힌 이슈 검색 실패: ${res.status} ${res.statusText}`);
    const data = await res.json();
    const total = typeof data.total_count === 'number' ? data.total_count : null;
    const items = (data.items || []).map(normalizeIssue);
    return { issues: items, total, hasMore: total != null ? opts.page * opts.perPage < total : items.length === opts.perPage };
  }

  const params = new URLSearchParams({
    state: 'closed', sort: 'updated', direction: opts.sort, per_page: String(opts.perPage), page: String(opts.page),
  });
  if (opts.label) params.set('labels', opts.label);
  const res = await fetch(apiUrl(project, `/issues?${params.toString()}`), { headers });
  if (!res.ok) throw new Error(`닫힌 이슈 조회 실패: ${res.status} ${res.statusText}`);
  const raw = await res.json();
  const link = res.headers.get('link') || '';
  return {
    issues: raw.filter((i: { pull_request?: unknown }) => !i.pull_request).map(normalizeIssue),
    total: null,
    hasMore: /rel="next"/.test(link),
  };
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
  updates: { title?: string; description?: string; assignees?: string[]; dueDate?: string | null }
) {
  const ownerRepo = getOwnerRepo(project.repoUrl);
  if (!ownerRepo) throw new Error('Invalid repo URL');

  const headers = getGitHubAuthHeaders(project, decryptedToken);

  // dueDate가 명시된 경우, description이 함께 오지 않으면 GitHub에서 현재 본문을 가져와
  // ive-due 마커만 갱신해 PATCH한다 (다른 변경 없이 마감일만 수정하는 케이스).
  let bodyToWrite = updates.description;
  if (updates.dueDate !== undefined) {
    if (bodyToWrite !== undefined) {
      bodyToWrite = setIveDueMarker(bodyToWrite, updates.dueDate);
    } else {
      const cur = await fetch(apiUrl(project, `/issues/${issueNumber}`), { headers });
      if (cur.ok) {
        const data = await cur.json().catch(() => ({} as any));
        const baseBody = (data?.body as string | undefined) ?? '';
        bodyToWrite = setIveDueMarker(baseBody, updates.dueDate);
      }
    }
  }

  const payload: any = {};
  if (updates.title) payload.title = updates.title;
  if (bodyToWrite !== undefined) payload.body = bodyToWrite;
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
  assignees?: string[],
  options?: { dueDate?: string | null }
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
      const labelsRes = await fetchAllPages(apiUrl(project, '/labels'), headers);
      if (labelsRes.ok) {
        const existing = labelsRes.items.map((l: any) => l.name);
        validLabels = labels.filter(l => existing.includes(l));
      } else {
        validLabels = [];
      }
    } catch {
      validLabels = [];
    }
  }

  // GitHub은 native due_date 미지원 — 본문에 ive-due 마커로 보존.
  const bodyText = options?.dueDate ? setIveDueMarker(description, options.dueDate) : description;
  const body: any = { title, body: bodyText, labels: validLabels };
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
  const res = await fetchAllPages(apiUrl(project, '/collaborators'), headers);
  if (!res.ok) return [];
  const members = res.items;
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

/**
 * 이슈가 마지막으로 닫힌 것이 커밋·PR 머지 때문인가 (GitHub 닫기 키워드 — 「fixes #N」 등).
 * 사람이 직접 닫았으면 false, 알 수 없으면 null.
 */
export async function isGitHubIssueClosedByGit(project: Project, issueNumber: number, decryptedToken: string): Promise<boolean | null> {
  try {
    const res = await fetchAllPages(apiUrl(project, `/issues/${issueNumber}/events`), getGitHubAuthHeaders(project, decryptedToken));
    if (!res.ok) return null;
    const events = res.items;
    const closed = events.filter(e => e?.event === 'closed').pop();
    if (!closed) return null;
    return !!closed.commit_id;
  } catch {
    return null;
  }
}
