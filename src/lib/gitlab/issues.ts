import { Project } from "@/types";
import { parseIidSearch, type ClosedIssuePage, type ClosedIssuePageOptions } from "@/lib/closed-issues";
import { getProjectPath, getAuthHeaders, apiUrl } from "./common";

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
export async function addGitLabIssueComment(project: Project, issueIid: number, decryptedToken: string, body: string, options?: { isOAuth?: boolean; silent?: boolean }) {
  const projectPath = getProjectPath(project.repoUrl);
  if (!projectPath) return;

  const headers = getAuthHeaders(project, decryptedToken, options);

  try {
    // CLI 출력에 포함될 수 있는 제어 문자(ANSI 이스케이프, null 바이트 등) 제거
    const sanitized = body.replace(/\x00/g, '').replace(/\x1b\[[0-9;]*[a-zA-Z]/g, '').replace(/[\x01-\x08\x0b\x0c\x0e-\x1f]/g, '');
    const res = await fetch(apiUrl(project, `/issues/${issueIid}/notes`), {
      method: 'POST',
      headers: { ...headers, 'Content-Type': 'application/json' },
      body: JSON.stringify({ body: sanitized })
    });
    if (!res.ok) {
      const errorBody = await res.text().catch(() => 'No body');
      throw new Error(`GitLab 코멘트 등록 실패 (${res.status} ${res.statusText}): ${errorBody}`);
    }
  } catch (err) {
    console.error(`[GitLab] Error adding comment to issue #${issueIid}:`, err instanceof Error ? err.message : err);
    throw err;
  }
}

/**
 * 이슈의 노트(코멘트) 목록을 조회합니다.
 */
export async function fetchGitLabIssueNotes(project: Project, issueIid: number, decryptedToken: string, options?: { isOAuth?: boolean; silent?: boolean }) {
  const projectPath = getProjectPath(project.repoUrl);
  if (!projectPath) return [];

  const headers = getAuthHeaders(project, decryptedToken, options);

  try {
    const res = await fetch(apiUrl(project, `/issues/${issueIid}/notes?sort=asc&per_page=100`), { headers });
    if (!res.ok) {
      if (!options?.silent) {
        console.error(`[GitLab] Error fetching notes for issue #${issueIid}: ${res.statusText} (${res.status})`);
      }
      return [];
    }
    return await res.json();
  } catch (err) {
    if (!options?.silent) {
      console.error(`[GitLab] Error fetching notes for issue #${issueIid}:`, err);
    }
    return [];
  }
}

/**
 * 이슈의 노트를 삭제합니다.
 */
export async function deleteGitLabIssueNote(project: Project, issueIid: number, noteId: number, decryptedToken: string, options?: { isOAuth?: boolean }) {
  const projectPath = getProjectPath(project.repoUrl);
  if (!projectPath) return;

  const headers = getAuthHeaders(project, decryptedToken, options);

  try {
    const res = await fetch(apiUrl(project, `/issues/${issueIid}/notes/${noteId}`), {
      method: 'DELETE',
      headers
    });
    if (!res.ok) {
      const errorBody = await res.text().catch(() => 'No body');
      throw new Error(`GitLab 코멘트 삭제 실패 (${res.status} ${res.statusText}): ${errorBody}`);
    }
  } catch (err) {
    console.error(`[GitLab] Error deleting note ${noteId} for issue #${issueIid}:`, err);
    throw err;
  }
}

/**
 * 이슈의 GitLab 기록 작업시간(/spend = time_stats.total_time_spent, 초)을 조회합니다.
 * ⚠️ 1회 백필 전용(ive-meta 없는 과거 GitLab 이슈의 작업시간 복구). 보고서 런타임에서는 호출 금지.
 */
export async function fetchGitLabIssueTimeSpentSec(project: Project, issueIid: number, decryptedToken: string): Promise<number> {
  if (!getProjectPath(project.repoUrl)) return 0;
  const headers = getAuthHeaders(project, decryptedToken);
  try {
    const res = await fetch(apiUrl(project, `/issues/${issueIid}`), { headers });
    if (!res.ok) return 0;
    const issue = await res.json();
    const sec = issue?.time_stats?.total_time_spent;
    return typeof sec === 'number' && sec > 0 ? sec : 0;
  } catch {
    return 0;
  }
}

/**
 * 이슈에 소요 시간을 등록합니다.
 */
export async function addGitLabSpentTime(project: Project, issueIid: number, decryptedToken: string, duration: string, options?: { isOAuth?: boolean }) {
  const projectPath = getProjectPath(project.repoUrl);
  if (!projectPath) return;

  const headers = getAuthHeaders(project, decryptedToken, options);

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

/**
 * 닫힌 이슈를 한 페이지씩 가져온다 (이력 탭).
 *
 * 종전엔 닫힌 이슈 전체(Meta-Shop 1,744건 = 18페이지, 약 36초·10MB)를 매번 순차로 받았다.
 * 이력은 최근 것부터 보면 되므로 정렬·검색을 GitLab 에 맡기고 요청 1번으로 한 페이지만 받는다.
 * - search 가 숫자(#123)면 이슈 번호로, 아니면 제목·본문 검색 (3글자 미만 단어는 GitLab 이 무시 → 호출측이 iids 로 한정)
 * - total 은 X-Total (GitLab 이 1만 건 초과 시 생략 → null)
 */
export async function fetchClosedProjectIssuesPage(
  project: Project,
  decryptedToken: string,
  opts: ClosedIssuePageOptions,
): Promise<ClosedIssuePage> {
  const projectPath = getProjectPath(project.repoUrl);
  if (!projectPath) return { issues: [], total: 0, hasMore: false };

  const q = new URLSearchParams({
    state: 'closed',
    order_by: 'created_at',
    sort: opts.sort,
    per_page: String(opts.perPage),
    page: String(opts.page),
  });
  if (opts.label) q.set('labels', opts.label);
  const search = (opts.search || '').trim();
  const iid = parseIidSearch(search);
  if (opts.iids) {
    // 짧은 검색어 — 호출측이 IVE DB 제목으로 찾은 번호로 한정 (정렬·페이지는 GitLab 이 그대로 처리)
    if (opts.iids.length === 0) return { issues: [], total: 0, hasMore: false };
    for (const n of opts.iids) q.append('iids[]', String(n));
  } else if (iid != null) q.append('iids[]', String(iid));
  else if (search) q.set('search', search);

  const res = await fetch(apiUrl(project, `/issues?${q.toString()}`), { headers: getAuthHeaders(project, decryptedToken) });
  if (!res.ok) throw new Error(`닫힌 이슈 조회 실패: ${res.status} ${res.statusText}`);
  const issues = await res.json();
  const totalHeader = res.headers.get('x-total');
  const nextPage = res.headers.get('x-next-page');
  return {
    issues,
    total: totalHeader ? Number(totalHeader) : null,
    hasMore: nextPage != null ? nextPage !== '' : issues.length === opts.perPage,
  };
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
  updates: { title?: string; description?: string; assigneeIds?: number[]; dueDate?: string | null }
) {
  const projectPath = getProjectPath(project.repoUrl);
  if (!projectPath) throw new Error('Invalid repo URL');

  const headers = getAuthHeaders(project, decryptedToken);

  const payload: any = {};
  if (updates.title) payload.title = updates.title;
  if (updates.description !== undefined) payload.description = updates.description;
  if (updates.assigneeIds !== undefined) payload.assignee_ids = updates.assigneeIds;
  // due_date: 'YYYY-MM-DD' 또는 빈 문자열(해제). GitLab은 null을 받지 않고 ''로 해제.
  if (updates.dueDate !== undefined) payload.due_date = updates.dueDate ?? '';

  const res = await fetch(apiUrl(project, `/issues/${issueIid}`), {
    method: 'PUT',
    headers: { ...headers, 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });

  if (!res.ok) throw new Error(`이슈 수정 실패: ${res.statusText}`);
  return await res.json();
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
  assigneeIds?: number[],
  options?: { isOAuth?: boolean; dueDate?: string | null }
) {
  const projectPath = getProjectPath(project.repoUrl);
  if (!projectPath) throw new Error('Invalid repo URL');

  // OAuth 토큰은 Authorization: Bearer로 보내야 함. PRIVATE-TOKEN 헤더는 PAT 전용이라
  // OAuth 토큰을 거기 실으면 GitLab이 401 Unauthorized로 거부한다.
  const headers = getAuthHeaders(project, decryptedToken, options);

  const body: any = { title, description, labels: labels.join(',') };
  if (assigneeIds && assigneeIds.length > 0) body.assignee_ids = assigneeIds;
  if (options?.dueDate) body.due_date = options.dueDate;

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

/**
 * 이슈가 마지막으로 닫힌 것이 커밋·MR 때문인가 (GitLab 닫기 키워드 — 「resolve #N」 등이 기본 브랜치에 들어옴).
 * 사람이 직접 닫았으면 false, 알 수 없으면 null.
 */
export async function isGitLabIssueClosedByGit(project: Project, issueIid: number, decryptedToken: string): Promise<boolean | null> {
  try {
    const res = await fetch(apiUrl(project, `/issues/${issueIid}/resource_state_events?per_page=100`), { headers: getAuthHeaders(project, decryptedToken) });
    if (!res.ok) return null;
    const events = (await res.json()) as any[];
    const closed = events.filter(e => e?.state === 'closed').pop();
    if (!closed) return null;
    return !!(closed.source_commit || closed.source_merge_request);
  } catch {
    return null;
  }
}
