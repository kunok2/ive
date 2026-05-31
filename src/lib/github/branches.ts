import { Project } from "@/types";
import { getOwnerRepo, getGitHubAuthHeaders, apiUrl } from "./common";

/**
 * GitHub 저장소에 브랜치를 생성합니다.
 */
export async function createGitHubBranch(project: Project, decryptedToken: string, branchName: string, ref: string): Promise<boolean> {
  const headers = getGitHubAuthHeaders(project, decryptedToken);
  // 먼저 ref의 SHA를 가져옴
  const refRes = await fetch(apiUrl(project, `/git/ref/heads/${ref}`), { headers });
  if (!refRes.ok) {
    console.warn(`[GitHub] Failed to get ref SHA for ${ref}: ${refRes.status}`);
    return false;
  }
  const refData = await refRes.json();
  const sha = refData.object?.sha;
  if (!sha) return false;

  const res = await fetch(apiUrl(project, '/git/refs'), {
    method: 'POST',
    headers: { ...headers, 'Content-Type': 'application/json' },
    body: JSON.stringify({ ref: `refs/heads/${branchName}`, sha }),
  });
  if (res.ok) return true;
  // 이미 존재하면 성공으로 처리
  if (res.status === 422) return true;
  console.warn(`[GitHub] Failed to create branch ${branchName}: ${res.status}`);
  return false;
}

/**
 * GitHub 저장소의 기본 브랜치를 조회합니다.
 */
export async function getGitHubDefaultBranch(project: Project, decryptedToken: string): Promise<string> {
  const headers = getGitHubAuthHeaders(project, decryptedToken);
  const res = await fetch(apiUrl(project, ''), { headers });
  if (res.ok) {
    const data = await res.json();
    return data.default_branch || 'main';
  }
  return 'main';
}

/**
 * GitHub 저장소의 텍스트 파일을 읽습니다.
 * 존재하지 않으면 null 반환.
 *
 * GitHub API: GET /repos/:owner/:repo/contents/:path?ref=:branch
 */
export async function readGitHubRepoFile(
  project: Project,
  decryptedToken: string,
  filePath: string,
  branch?: string,
): Promise<{ content: string; sha: string } | null> {
  const headers = getGitHubAuthHeaders(project, decryptedToken);
  const ref = branch || (await getGitHubDefaultBranch(project, decryptedToken));
  const res = await fetch(apiUrl(project, `/contents/${encodeURIComponent(filePath)}?ref=${encodeURIComponent(ref)}`), { headers });
  if (res.status === 404) return null;
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(`GitHub 파일 읽기 실패: ${res.status} ${text}`);
  }
  const data = await res.json();
  const content = Buffer.from(String(data.content || ''), 'base64').toString('utf-8');
  return { content, sha: String(data.sha || '') };
}

/**
 * GitHub 저장소의 파일을 생성하거나 업데이트합니다 (멱등).
 * 이미 같은 내용이면 커밋하지 않습니다.
 *
 * GitHub API: PUT /repos/:owner/:repo/contents/:path
 */
export async function upsertGitHubRepoFile(
  project: Project,
  decryptedToken: string,
  filePath: string,
  newContent: string,
  commitMessage: string,
  branch?: string,
): Promise<{ created: boolean; updated: boolean; unchanged: boolean }> {
  const headers = { ...getGitHubAuthHeaders(project, decryptedToken), 'Content-Type': 'application/json' };
  const ref = branch || (await getGitHubDefaultBranch(project, decryptedToken));

  const existing = await readGitHubRepoFile(project, decryptedToken, filePath, ref);
  if (existing && existing.content === newContent) {
    return { created: false, updated: false, unchanged: true };
  }

  const body: Record<string, string> = {
    message: commitMessage,
    content: Buffer.from(newContent, 'utf-8').toString('base64'),
    branch: ref,
  };
  if (existing) body.sha = existing.sha;

  const res = await fetch(apiUrl(project, `/contents/${encodeURIComponent(filePath)}`), {
    method: 'PUT',
    headers,
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(`GitHub 파일 ${existing ? '업데이트' : '생성'} 실패: ${res.status} ${text}`);
  }
  return { created: !existing, updated: !!existing, unchanged: false };
}

/**
 * GitHub 저장소에 파일을 커밋해 업로드합니다 (이슈 본문/코멘트에 첨부할 이미지 등).
 * GitHub은 이슈 첨부용 공개 API가 없으므로, 저장소 기본 브랜치의 `.ive-assets/` 경로에
 * 파일을 커밋한 뒤 raw 다운로드 URL을 마크다운으로 반환합니다.
 */
export async function uploadGitHubFile(
  project: Project,
  decryptedToken: string,
  filename: string,
  buffer: Buffer,
  mimeType: string,
): Promise<{ markdown: string; url: string }> {
  const headers = getGitHubAuthHeaders(project, decryptedToken);
  const branch = await getGitHubDefaultBranch(project, decryptedToken);
  const safe = (filename || 'file').replace(/[^\w.\-]/g, '_').slice(-80) || 'file';
  const ts = Date.now();
  const rand = Math.random().toString(36).slice(2, 8);
  const path = `.ive-assets/${ts}-${rand}-${safe}`;

  const content = buffer.toString('base64');
  const putRes = await fetch(apiUrl(project, `/contents/${path}`), {
    method: 'PUT',
    headers: { ...headers, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      message: `chore(ive): upload issue attachment ${safe}`,
      content,
      branch,
    }),
  });
  if (!putRes.ok) {
    const text = await putRes.text().catch(() => '');
    throw new Error(`GitHub 파일 업로드 실패: ${putRes.status} ${text}`);
  }
  const data = await putRes.json();
  const rawUrl: string = data?.content?.download_url || '';
  const isImage = (mimeType || '').startsWith('image/');
  const markdown = isImage ? `![${safe}](${rawUrl})` : `[${safe}](${rawUrl})`;
  return { markdown, url: rawUrl };
}

/**
 * GitHub 첨부(raw download_url)를 인증 토큰으로 다운로드한다.
 * private 저장소의 raw URL 은 인증이 필요하므로 헤더를 붙여 받는다.
 */
export async function downloadGitHubFile(
  project: Project,
  decryptedToken: string,
  url: string,
): Promise<{ buffer: Buffer; contentType: string } | null> {
  const res = await fetch(url, { headers: getGitHubAuthHeaders(project, decryptedToken) });
  if (!res.ok) {
    console.error(`[GitHub] file download failed (${res.status}) ${url}`);
    return null;
  }
  const contentType = res.headers.get('content-type') || 'application/octet-stream';
  const buffer = Buffer.from(await res.arrayBuffer());
  return { buffer, contentType };
}
