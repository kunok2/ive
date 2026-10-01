import { clearPreferredAgentRefs } from './issues'
import { User } from '@/types'
import { getDb } from './connection'
import { deleteSlackWorkspace } from './slack'

function parseAllowedClis(raw: string | null | undefined): string[] {
  if (!raw) return ['opencode']
  return raw.split(',').map(s => s.trim()).filter(Boolean)
}

export function mapUser(r: any): User {
  return {
    id: r.id, email: r.email, name: r.name, avatar: r.avatar || 'av-01',
    avatarSource: r.avatar_source ?? null,
    isAdmin: !!r.is_admin, maxAgents: r.max_agents ?? 0, maxTurns: r.max_turns ?? 0,
    allowedClis: parseAllowedClis(r.allowed_clis) as User['allowedClis'],
    locale: r.locale,
    timezone: r.timezone,
    currency: r.currency ?? null,
    currencyRate: r.currency_rate ?? null,
    gitlabUsername: r.gitlab_username ?? null,
    githubUsername: r.github_username ?? null,
    slackUserId: r.slack_user_id ?? '',
    slackNotify: r.slack_notify == null ? true : r.slack_notify === 1,
    mailUnsubscribed: r.mail_unsubscribed === 1,
    oauthProviderId: r.oauth_provider_id ?? null,
    oauthUserId: r.oauth_user_id ?? null,
    oauthTokenExpiresAt: r.oauth_token_expires_at ?? null,
    createdAt: r.created_at,
  }
}

export function getUserByEmail(email: string): any {
  return getDb().prepare('SELECT * FROM users WHERE email = ?').get(email)
}

export function getUserById(id: string): User | null {
  const row = getDb().prepare('SELECT * FROM users WHERE id = ?').get(id) as any
  if (!row) return null
  return mapUser(row)
}

/**
 * Git 사용자 식별자(oauth_user_id, 숫자 ID 문자열화)로 IVE 사용자 lookup.
 * provider type ('github'|'gitlab') 으로 필터하여 정확히 매칭.
 */
export function getUserByOAuthId(providerType: 'github' | 'gitlab', oauthUserId: string): User | null {
  const row = getDb().prepare(`
    SELECT u.* FROM users u
    JOIN oauth_providers op ON op.id = u.oauth_provider_id
    WHERE op.type = ? AND u.oauth_user_id = ?
    LIMIT 1
  `).get(providerType, oauthUserId) as any
  return row ? mapUser(row) : null
}

/**
 * Git 사용자명(username/login)으로 IVE 사용자 lookup.
 * getUserByOAuthId(숫자 id 매칭) 가 실패할 때의 fallback —
 * Slack 등 다른 provider 로 로그인해 GitLab/GitHub oauth_user_id 가 없는 계정이라도,
 * 본인의 gitlab_username/github_username 만 채워져 있으면 담당자/확인자로 식별된다.
 * (Git 이슈의 assignee 는 항상 username 을 가지므로 이 경로로 연결 가능.)
 * 대소문자 무시 매칭.
 */
/**
 * 본인 git username 저장. provider 별로 컬럼 분리(gitlab_username/github_username).
 * 빈 문자열이면 연결 해제. OAuth 로그인 시 자동 + 프로필에서 직접 입력 둘 다 사용.
 */
export function updateUserGitUsername(id: string, providerType: 'github' | 'gitlab', username: string) {
  const col = providerType === 'github' ? 'github_username' : 'gitlab_username'
  getDb().prepare(`UPDATE users SET ${col} = ? WHERE id = ?`).run(username.trim() || null, id)
}

export function getUserByGitUsername(providerType: 'github' | 'gitlab', username: string): User | null {
  if (!username) return null
  const col = providerType === 'github' ? 'github_username' : 'gitlab_username'
  const row = getDb().prepare(
    `SELECT * FROM users WHERE ${col} IS NOT NULL AND ${col} <> '' AND ${col} = ? COLLATE NOCASE LIMIT 1`
  ).get(username) as any
  return row ? mapUser(row) : null
}

export function getAllUsers(): User[] {
  const rows = getDb().prepare('SELECT * FROM users ORDER BY created_at ASC').all() as any[]
  return rows.map(mapUser)
}

/** 확인자 picker 후보 1명 (Git member 와 동일한 형태). id = provider 측 숫자 사용자 id. */
export interface IveConfirmerCandidate {
  id: number
  username: string
  name: string
  avatarUrl: string
}

/**
 * 확인자(확인 단계) 후보 목록 — "프로젝트 멤버" 가 아니라 "해당 provider 로 식별 가능한 모든 IVE 사용자".
 *
 * 확인자는 검증자와 달리 프로젝트 멤버일 필요가 없고 IVE 사용자이기만 하면 된다.
 * 단, 확인 단계 알림/배정이 git 숫자 id 로 매핑되므로(getUserByOAuthId, assignee),
 * 그 provider 로 로그인해 oauth_user_id(=git 숫자 id) 가 있는 사용자만 후보가 된다.
 *  - id:       oauth_user_id (provider 측 숫자 id) → preset_confirmer_user_id 로 저장
 *  - username: 본인 gitlab/github username (없으면 빈 문자열 — 매핑/배정은 id 로 가능)
 *  - avatarUrl: 'photo' 인 경우만 IVE 이미지 API URL, 프리셋(av-XX)은 빈 값(아이콘 표시)
 */
export function getIveConfirmerCandidates(providerType: 'github' | 'gitlab'): IveConfirmerCandidate[] {
  const rows = getDb().prepare(`
    SELECT u.id AS ive_id, u.oauth_user_id, u.name, u.avatar,
           u.gitlab_username, u.github_username
    FROM users u
    JOIN oauth_providers op ON op.id = u.oauth_provider_id
    WHERE op.type = ? AND u.oauth_user_id IS NOT NULL AND u.oauth_user_id <> ''
    ORDER BY u.name COLLATE NOCASE ASC
  `).all(providerType) as any[]
  const out: IveConfirmerCandidate[] = []
  for (const r of rows) {
    const id = Number(r.oauth_user_id)
    if (!Number.isFinite(id)) continue
    const username = (providerType === 'github' ? r.github_username : r.gitlab_username) || ''
    const avatarUrl = r.avatar === 'photo' ? `/api/auth/avatar/image?id=${r.ive_id}` : ''
    out.push({ id, username, name: r.name || username || String(id), avatarUrl })
  }
  return out
}

export function deleteUser(id: string) {
  // 소유한 Slack 워크스페이스를 함께 정리(고아 방지 — 고아가 되면 아무도 재설치 못 함)
  const wsIds = (getDb().prepare('SELECT id FROM slack_workspaces WHERE default_user_id = ?').all(id) as any[]).map(r => r.id)
  for (const wid of wsIds) deleteSlackWorkspace(wid)
  // 그 사람의 에이전트는 FK 로 함께 지워진다 — 이슈 배정·역할 명부의 참조를 먼저 정리(아무도 맡지 않은 이슈가 생기지 않게)
  for (const a of getDb().prepare('SELECT id FROM agents WHERE user_id = ?').all(id) as { id: string }[]) clearPreferredAgentRefs(a.id)
  getDb().prepare('DELETE FROM users WHERE id = ?').run(id)
}

/**
 * 아바타 변경. source를 주면 출처도 같이 기록한다.
 *  - 'upload': 사용자가 직접 업로드/선택 → OAuth 로그인이 덮어쓰지 않음(보호)
 *  - 'oauth' : provider에서 가져옴 → 다음 OAuth 로그인 때 현재 provider 것으로 갱신 가능
 */
export function updateUserAvatar(id: string, avatar: string, source?: 'upload' | 'oauth') {
  if (source) {
    getDb().prepare('UPDATE users SET avatar = ?, avatar_source = ? WHERE id = ?').run(avatar, source, id)
  } else {
    getDb().prepare('UPDATE users SET avatar = ? WHERE id = ?').run(avatar, id)
  }
}

export function updateUserLocale(id: string, locale: string) {
  getDb().prepare('UPDATE users SET locale = ? WHERE id = ?').run(locale, id)
}

export function updateUserTimezone(id: string, timezone: string) {
  getDb().prepare('UPDATE users SET timezone = ? WHERE id = ?').run(timezone, id)
}

/**
 * 사용자 표시 통화 + 수동 환율 갱신.
 *  - currency: null/'USD' → 환산 안 함
 *  - rate: null → 자동 글로벌 환율 사용, 값 있으면 수동 고정(자동보다 우선)
 */
export function updateUserCurrency(id: string, currency: string | null, rate: number | null) {
  getDb().prepare('UPDATE users SET currency = ?, currency_rate = ? WHERE id = ?').run(currency, rate, id)
}

/**
 * 본인 Slack 연결(member ID) + 작업완료 알림 수신 여부 갱신.
 *  - slackUserId: 'U...' member ID. 빈 값이면 DM·멘션 대상 해제.
 *  - slackNotify: false면 라벨이 붙은 이슈여도 알림을 받지 않음(본인 veto).
 */
export function updateUserSlack(id: string, slackUserId: string, slackNotify: boolean) {
  getDb().prepare('UPDATE users SET slack_user_id = ?, slack_notify = ? WHERE id = ?')
    .run(slackUserId.trim(), slackNotify ? 1 : 0, id)
}

/**
 * 브로드캐스트(관리자 일괄) 메일 수신거부 여부 설정.
 * 메일 하단의 수신거부 링크(서명 토큰)로 비로그인 상태에서 호출된다.
 */
export function setUserMailUnsubscribed(id: string, unsubscribed: boolean) {
  getDb().prepare('UPDATE users SET mail_unsubscribed = ? WHERE id = ?').run(unsubscribed ? 1 : 0, id)
}

export function createUser(u: any) {
  // 회원가입 자체가 약관·처리방침 동의 시점이므로 terms_agreed_at을 함께 기록한다.
  getDb().prepare("INSERT INTO users (id, email, password, name, terms_agreed_at) VALUES (?, ?, ?, ?, datetime('now'))").run(u.id, u.email, u.password, u.name)
}
