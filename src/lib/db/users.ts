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
    rateMultiplier: r.rate_multiplier ?? 1,
    slackUserId: r.slack_user_id ?? '',
    slackNotify: r.slack_notify == null ? true : r.slack_notify === 1,
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

export function getAllUsers(): User[] {
  const rows = getDb().prepare('SELECT * FROM users ORDER BY created_at ASC').all() as any[]
  return rows.map(mapUser)
}

export function deleteUser(id: string) {
  // 소유한 Slack 워크스페이스를 함께 정리(고아 방지 — 고아가 되면 아무도 재설치 못 함)
  const wsIds = (getDb().prepare('SELECT id FROM slack_workspaces WHERE default_user_id = ?').all(id) as any[]).map(r => r.id)
  for (const wid of wsIds) deleteSlackWorkspace(wid)
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

export function createUser(u: any) {
  // 회원가입 자체가 약관·처리방침 동의 시점이므로 terms_agreed_at을 함께 기록한다.
  getDb().prepare("INSERT INTO users (id, email, password, name, terms_agreed_at) VALUES (?, ?, ?, ?, datetime('now'))").run(u.id, u.email, u.password, u.name)
}
