import { Project } from "@/types";
import { getAuthHeaders, apiUrl } from "./common";

/**
 * GitLab 저장소에 브랜치를 생성합니다.
 */
export async function createGitLabBranch(project: Project, decryptedToken: string, branchName: string, ref: string): Promise<boolean> {
  const headers = getAuthHeaders(project, decryptedToken);
  const url = apiUrl(project, '/repository/branches');
  const res = await fetch(url, {
    method: 'POST',
    headers: { ...headers, 'Content-Type': 'application/json' },
    body: JSON.stringify({ branch: branchName, ref }),
  });
  if (res.ok) return true;
  // 이미 존재하면 성공으로 처리
  if (res.status === 400) {
    const data = await res.json().catch(() => ({}));
    if (data.message?.includes('already exists')) return true;
  }
  console.warn(`[GitLab] Failed to create branch ${branchName}: ${res.status}`);
  return false;
}

/**
 * GitLab 저장소의 기본 브랜치를 조회합니다.
 */
export async function getGitLabDefaultBranch(project: Project, decryptedToken: string): Promise<string> {
  const headers = getAuthHeaders(project, decryptedToken);
  const url = apiUrl(project, '');
  const res = await fetch(url, { headers });
  if (res.ok) {
    const data = await res.json();
    return data.default_branch || 'main';
  }
  return 'main';
}

/**
 * GitLab 저장소의 파일을 읽습니다 (저장소에 커밋된 텍스트 파일 대상).
 * 존재하지 않으면 null 반환. base64 디코딩하여 UTF-8 문자열로 돌려줍니다.
 *
 * GitLab API: GET /projects/:id/repository/files/:file_path?ref=:branch
 */
export async function readGitLabRepoFile(
  project: Project,
  decryptedToken: string,
  filePath: string,
  branch?: string,
): Promise<{ content: string; sha: string } | null> {
  const headers = getAuthHeaders(project, decryptedToken);
  const ref = branch || (await getGitLabDefaultBranch(project, decryptedToken));
  const encoded = encodeURIComponent(filePath);
  const res = await fetch(apiUrl(project, `/repository/files/${encoded}?ref=${encodeURIComponent(ref)}`), { headers });
  if (res.status === 404) return null;
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(`GitLab 파일 읽기 실패: ${res.status} ${text}`);
  }
  const data = await res.json();
  // GitLab은 base64 인코딩된 content를 반환
  const content = Buffer.from(String(data.content || ''), 'base64').toString('utf-8');
  return { content, sha: String(data.blob_id || '') };
}

/**
 * GitLab 저장소의 파일을 생성하거나 업데이트합니다 (멱등).
 * 이미 같은 내용이면 커밋하지 않습니다.
 *
 * GitLab API:
 *   POST /projects/:id/repository/files/:file_path  (생성)
 *   PUT  /projects/:id/repository/files/:file_path  (업데이트)
 */
export async function upsertGitLabRepoFile(
  project: Project,
  decryptedToken: string,
  filePath: string,
  newContent: string,
  commitMessage: string,
  branch?: string,
): Promise<{ created: boolean; updated: boolean; unchanged: boolean }> {
  const headers = { ...getAuthHeaders(project, decryptedToken), 'Content-Type': 'application/json' };
  const ref = branch || (await getGitLabDefaultBranch(project, decryptedToken));
  const encoded = encodeURIComponent(filePath);

  const existing = await readGitLabRepoFile(project, decryptedToken, filePath, ref);
  if (existing && existing.content === newContent) {
    return { created: false, updated: false, unchanged: true };
  }

  const body = JSON.stringify({
    branch: ref,
    content: newContent,
    commit_message: commitMessage,
    encoding: 'text',
  });

  const method = existing ? 'PUT' : 'POST';
  const res = await fetch(apiUrl(project, `/repository/files/${encoded}`), {
    method,
    headers,
    body,
  });
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(`GitLab 파일 ${existing ? '업데이트' : '생성'} 실패: ${res.status} ${text}`);
  }
  return { created: !existing, updated: !!existing, unchanged: false };
}

/**
 * GitLab 프로젝트에 파일을 업로드합니다 (이슈 설명/코멘트에 첨부할 이미지 등).
 * GitLab API: POST /projects/:id/uploads → { alt, url, markdown, full_path }
 * markdown 필드에는 GitLab이 인식하는 상대 경로 참조가 들어 있으므로 그대로 본문에 삽입하면 됩니다.
 */
export async function uploadGitLabFile(
  project: Project,
  decryptedToken: string,
  filename: string,
  buffer: Buffer,
  mimeType: string,
): Promise<{ markdown: string; url: string }> {
  const headers = getAuthHeaders(project, decryptedToken);
  const form = new FormData();
  const ab = buffer.buffer.slice(buffer.byteOffset, buffer.byteOffset + buffer.byteLength) as ArrayBuffer;
  const blob = new Blob([ab], { type: mimeType || 'application/octet-stream' });
  form.append('file', blob, filename);
  const res = await fetch(apiUrl(project, '/uploads'), {
    method: 'POST',
    headers, // Content-Type는 FormData가 자동으로 boundary 포함해 지정
    body: form,
  });
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(`GitLab 파일 업로드 실패: ${res.status} ${text}`);
  }
  const data = await res.json();
  return { markdown: String(data.markdown || ''), url: String(data.url || '') };
}

/**
 * GitLab 업로드 첨부(/uploads/<secret>/<file>)를 인증 토큰으로 다운로드한다.
 * uploadGitLabFile 이 돌려주는 url 은 프로젝트 상대 경로라 직접 접근이 불가 →
 * 프로젝트 web base + 상대경로로 절대화하고 인증 헤더를 붙여 받는다.
 */
export async function downloadGitLabUpload(
  project: Project,
  decryptedToken: string,
  url: string,
): Promise<{ buffer: Buffer; contentType: string } | null> {
  let abs: string;
  if (/^https?:\/\//.test(url)) {
    abs = url;
  } else {
    const u = new URL(project.repoUrl.replace(/\.git$/, ''));
    // url 은 "/uploads/<secret>/<file>" (프로젝트 경로 기준 상대)
    abs = `${u.origin}${u.pathname}${url.startsWith('/') ? '' : '/'}${url}`;
  }
  // 토큰은 저장소와 같은 GitLab 호스트에만 — 본문에 박힌 외부 이미지 URL 로 토큰이 새지 않게
  const sameOrigin = (() => {
    try { return new URL(abs).origin === new URL(project.repoUrl.replace(/\.git$/, '')).origin } catch { return false }
  })();
  const res = await fetch(abs, { headers: sameOrigin ? getAuthHeaders(project, decryptedToken) : {} });
  if (!res.ok) {
    console.error(`[GitLab] upload download failed (${res.status}) ${abs}`);
    return null;
  }
  const contentType = res.headers.get('content-type') || 'application/octet-stream';
  const buffer = Buffer.from(await res.arrayBuffer());
  return { buffer, contentType };
}

/**
 * ancestor 커밋이 descendant 커밋의 조상(같은 커밋 포함)인가.
 * `git merge-base --is-ancestor A B` 와 같은 판정: merge_base(A, B) == A.
 * GitLab API: GET /projects/:id/repository/merge_base?refs[]=A&refs[]=B
 * @returns true/false, 판정 불가(커밋 없음·권한)면 null
 */
export async function isGitLabAncestorCommit(
  project: Project, decryptedToken: string, ancestor: string, descendant: string,
): Promise<boolean | null> {
  const headers = getAuthHeaders(project, decryptedToken);
  const q = `refs[]=${encodeURIComponent(ancestor)}&refs[]=${encodeURIComponent(descendant)}`;
  const res = await fetch(apiUrl(project, `/repository/merge_base?${q}`), { headers });
  if (!res.ok) return null;
  const data = await res.json().catch(() => null);
  const base = String(data?.id || '');
  if (!base) return null;
  return base.startsWith(ancestor) || ancestor.startsWith(base);
}
