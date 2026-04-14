import { Project } from "@/types";
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
    const res = await fetch(apiUrl(project, `/issues/${issueIid}/notes`), {
      method: 'POST',
      headers: { ...headers, 'Content-Type': 'application/json' },
      body: JSON.stringify({ body })
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
