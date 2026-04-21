import { User } from '@/types'
import { getDb } from './connection'

function parseAllowedClis(raw: string | null | undefined): string[] {
  if (!raw) return ['opencode']
  return raw.split(',').map(s => s.trim()).filter(Boolean)
}

export function mapUser(r: any): User {
  return {
    id: r.id, email: r.email, name: r.name, avatar: r.avatar || 'av-01',
    isAdmin: !!r.is_admin, maxAgents: r.max_agents ?? 0, maxTurns: r.max_turns ?? 0,
    allowedClis: parseAllowedClis(r.allowed_clis) as User['allowedClis'],
    locale: r.locale,
    timezone: r.timezone,
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

export function getAllUsers(): User[] {
  const rows = getDb().prepare('SELECT * FROM users ORDER BY created_at ASC').all() as any[]
  return rows.map(mapUser)
}

export function deleteUser(id: string) {
  getDb().prepare('DELETE FROM users WHERE id = ?').run(id)
}

export function updateUserAvatar(id: string, avatar: string) {
  getDb().prepare('UPDATE users SET avatar = ? WHERE id = ?').run(avatar, id)
}

export function updateUserLocale(id: string, locale: string) {
  getDb().prepare('UPDATE users SET locale = ? WHERE id = ?').run(locale, id)
}

export function updateUserTimezone(id: string, timezone: string) {
  getDb().prepare('UPDATE users SET timezone = ? WHERE id = ?').run(timezone, id)
}

export function createUser(u: any) {
  getDb().prepare('INSERT INTO users (id, email, password, name) VALUES (?, ?, ?, ?)').run(u.id, u.email, u.password, u.name)
}

export function clearUserOAuth(userId: string) {
  getDb().prepare(`UPDATE users SET
    oauth_provider_id = NULL,
    oauth_user_id = NULL,
    oauth_access_token = NULL,
    oauth_refresh_token = NULL,
    oauth_token_expires_at = NULL
    WHERE id = ?`).run(userId)
}
