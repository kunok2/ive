import { Project, PipelineFilter } from "@/types";
import { getProjectPath, getAuthHeaders, apiUrl } from "./common";

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
export async function fetchGitLabMRByBranch(project: Project, decryptedToken: string, sourceBranch: string, options?: { isOAuth?: boolean }) {
  const projectPath = getProjectPath(project.repoUrl);
  if (!projectPath) return null;

  const headers = getAuthHeaders(project, decryptedToken, options);

  // opened 먼저 조회 — 인증 실패(401/403)는 throw 해서 withGitToken fallback 발동시킴.
  // 빈 결과(200 with [])일 때만 다음 단계(merged)로 진행.
  let res = await fetch(
    apiUrl(project, `/merge_requests?source_branch=${encodeURIComponent(sourceBranch)}&state=opened&per_page=1`),
    { headers }
  );
  if (res.status === 401 || res.status === 403) {
    throw new Error(`GitLab MR fetch failed: ${res.status}`);
  }
  if (res.ok) {
    const mrs = await res.json();
    if (mrs.length > 0) return mrs[0];
  }
  // merged도 조회
  res = await fetch(
    apiUrl(project, `/merge_requests?source_branch=${encodeURIComponent(sourceBranch)}&state=merged&per_page=1`),
    { headers }
  );
  if (res.status === 401 || res.status === 403) {
    throw new Error(`GitLab MR fetch failed: ${res.status}`);
  }
  if (res.ok) {
    const mrs = await res.json();
    if (mrs.length > 0) return mrs[0];
  }
  return null;
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
export async function mergeGitLabMR(project: Project, decryptedToken: string, mrIid: number, options?: { isOAuth?: boolean; sha?: string }) {
  const projectPath = getProjectPath(project.repoUrl);
  if (!projectPath) throw new Error('Invalid repo URL');

  const headers = getAuthHeaders(project, decryptedToken, options);

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
        ...(options?.sha ? { sha: options.sha } : {}),
      }),
    }
  );

  if (!res.ok) {
    const body = await res.text();
    console.error(`[mergeGitLabMR] 실패 status=${res.status} body=${body} mrIid=${mrIid} projectPath=${projectPath}`);
    if (res.status === 405) {
      try {
        const parsed = JSON.parse(body);
        throw new Error(parsed.message || `GitLab 이 머지를 허용하지 않았습니다 — 보호된 브랜치 권한이나 파이프라인·승인 조건을 확인해 주세요 (405: ${body})`);
      } catch (e) {
        if (e instanceof Error && e.message !== body) throw e;
        throw new Error(`GitLab 이 머지를 허용하지 않았습니다 — 보호된 브랜치 권한이나 파이프라인·승인 조건을 확인해 주세요 (405: ${body})`);
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
export async function closeGitLabMR(project: Project, decryptedToken: string, mrIid: number, options?: { isOAuth?: boolean }) {
  const headers = getAuthHeaders(project, decryptedToken, options);
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
    labels: (mr.labels || []) as string[],
  }));
}

/**
 * 기존 MR에 레이블을 더합니다 (이미 있으면 그대로).
 */
export async function addGitLabMRLabels(project: Project, decryptedToken: string, mrIid: number, labels: string[]) {
  const headers = getAuthHeaders(project, decryptedToken);
  try {
    await fetch(apiUrl(project, `/merge_requests/${mrIid}`), {
      method: 'PUT',
      headers: { ...headers, 'Content-Type': 'application/json' },
      body: JSON.stringify({ add_labels: labels.join(',') }),
    });
  } catch (err) {
    console.error(`[GitLab] MR 레이블 추가 실패 (${project.name} !${mrIid}):`, err);
  }
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
 * 최근 5건만 읽으므로, 특정 커밋의 파이프라인이나 마지막으로 성공한 파이프라인을 찾을 때는 filter 로 직접 묻는다
 * (실패가 5번 이어지면 그 앞의 성공·그 앞 커밋의 파이프라인이 목록에서 밀려난다).
 */
export async function fetchGitLabBranchPipelines(project: Project, decryptedToken: string, ref: string, filter?: PipelineFilter) {
  const projectPath = getProjectPath(project.repoUrl);
  if (!projectPath) return [];

  const headers = getAuthHeaders(project, decryptedToken);

  try {
    const res = await fetch(
      apiUrl(project, `/pipelines?ref=${encodeURIComponent(ref)}&order_by=id&sort=desc&per_page=5${filter?.status ? `&status=${encodeURIComponent(filter.status)}` : ''}${filter?.sha ? `&sha=${encodeURIComponent(filter.sha)}` : ''}`),
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
 * 파이프라인 잡 목록(이름·단계·상태) — 파이프라인이 success 여도 배포 잡이 돌지 않았으면(규칙으로 생략·스킵) 배포된 것이 아니다.
 * 조회 실패는 null (모른다).
 */
export async function fetchGitLabPipelineJobs(project: Project, decryptedToken: string, pipelineId: number): Promise<{ name: string; stage: string; status: string }[] | null> {
  try {
    const res = await fetch(apiUrl(project, `/pipelines/${pipelineId}/jobs?per_page=100`), { headers: getAuthHeaders(project, decryptedToken) });
    if (!res.ok) return null;
    return ((await res.json()) as any[]).map(j => ({ name: String(j?.name), stage: String(j?.stage), status: String(j?.status) }));
  } catch { return null; }
}
