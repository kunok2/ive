/**
 * GitHub 이슈 첨부 URL 판별 (클라이언트·서버 공용).
 * private 저장소의 첨부(github.com/user-attachments/assets/…, raw.githubusercontent.com/…)는
 * 브라우저가 그대로 열 수 없어(404) IVE 서버가 프로젝트 토큰으로 대신 받아 준다.
 * 토큰을 붙여도 되는 GitHub 호스트만 true — 그 밖의 외부 이미지에 토큰을 보내지 않기 위함.
 */
const GITHUB_ATTACHMENT_HOSTS = new Set([
  'github.com',
  'raw.githubusercontent.com',
  'user-images.githubusercontent.com',
  'private-user-images.githubusercontent.com',
])

export function isGitHubAttachmentUrl(url: string): boolean {
  try {
    const u = new URL(url)
    return u.protocol === 'https:' && GITHUB_ATTACHMENT_HOSTS.has(u.hostname)
  } catch {
    return false
  }
}
