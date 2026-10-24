import { gitFetch } from "@/lib/git-fetch";
import { Project } from "@/types";

/**
 * GitLab API URL에서 프로젝트 경로를 추출하여 인코딩된 문자열로 반환합니다.
 * 예: https://gitlab.com/kojoung/dazzlepf -> kojoung%2Fdazzlepf
 */
export function getProjectPath(repoUrl: string): string {
  try {
    const url = new URL(repoUrl.replace(/\.git$/, ''));
    const path = url.pathname.startsWith('/') ? url.pathname.slice(1) : url.pathname;
    return encodeURIComponent(path);
  } catch (e) {
    return "";
  }
}

/**
 * GitLab OAuth 토큰을 refresh_token을 사용하여 갱신합니다.
 */
export async function refreshGitLabToken(repoUrl: string, clientId: string, clientSecret: string, refreshToken: string) {
  const url = new URL(repoUrl);
  const tokenUrl = `${url.protocol}//${url.host}/oauth/token`;

  const res = await gitFetch(tokenUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      client_id: clientId,
      client_secret: clientSecret,
      refresh_token: refreshToken,
      grant_type: 'refresh_token',
    }),
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`GitLab OAuth token refresh failed: ${res.status} ${text}`);
  }

  return await res.json(); // { access_token, refresh_token, expires_in, ... }
}


/**
 * 저장소 URL에서 GitLab API 베이스 URL을 추출합니다.
 * 예: https://gitlab.example.com/user/repo → https://gitlab.example.com/api/v4
 */
export function getApiBaseUrl(repoUrl: string): string {
  try {
    const url = new URL(repoUrl.replace(/\.git$/, ''));
    return `${url.protocol}//${url.host}/api/v4`;
  } catch {
    return 'https://gitlab.com/api/v4';
  }
}

/**
 * 프로젝트의 인증 방식에 따라 적절한 HTTP 헤더를 반환합니다.
 */
export function getAuthHeaders(project: Project, decryptedToken: string, options?: { isOAuth?: boolean }): Record<string, string> {
  if (options?.isOAuth || project.usesOAuthToken) {
    return { 'Authorization': `Bearer ${decryptedToken}` };
  }
  if (project.authType === 'basic') {
    const encoded = Buffer.from(`${project.gitUsername}:${decryptedToken}`).toString('base64');
    return { 'Authorization': `Basic ${encoded}` };
  }
  return { 'PRIVATE-TOKEN': decryptedToken };
}

/**
 * API 요청을 위한 URL과 헤더를 반환합니다.
 */
export function apiUrl(project: Project, path: string): string {
  const base = getApiBaseUrl(project.repoUrl);
  const projectPath = getProjectPath(project.repoUrl);
  return `${base}/projects/${projectPath}${path}`;
}
