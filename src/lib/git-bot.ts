// GitLab/GitHub 사용자 객체에서 bot 여부 판별.
// 멤버 조회(`fetchGitLabProjectMembers` / `fetchGitHubCollaborators`)와 동일한 규칙을 사용한다.
export function isGitBotUser(user: any): boolean {
  if (!user) return false
  if (user.bot === true) return true
  if (user.type === 'Bot') return true
  const login: string = user.username || user.login || ''
  return isBotName(login)
}

// 표시명/사용자명 문자열만으로 bot 여부 판별 (DB 적재된 userName 검사용).
// `project_xxx_bot_xxx`(GitLab project access token), `name[bot]`(GitHub Apps),
// `name-bot` 같은 명시적 패턴만 매칭하여 일반 사용자(예: 'Robot')의 오탐을 막는다.
export function isBotName(name: string | null | undefined): boolean {
  if (!name) return false
  if (name.startsWith('project_') && name.includes('_bot')) return true
  if (name.includes('[bot]')) return true
  if (name.endsWith('-bot')) return true
  if (name.includes('_bot_')) return true
  return false
}
