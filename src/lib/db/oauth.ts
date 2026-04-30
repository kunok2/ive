import { OAuthProvider, User } from '@/types'
import { getDb } from './connection'
import { mapUser } from './users'

function mapOAuthProvider(r: any): OAuthProvider {
  return {
    id: r.id,
    type: r.type,
    name: r.name,
    baseUrl: r.base_url,
    clientId: r.client_id,
    enabled: r.enabled === 1,
    createdAt: r.created_at,
  }
}

export function getAllOAuthProviders(): OAuthProvider[] {
  const rows = getDb().prepare('SELECT * FROM oauth_providers ORDER BY created_at ASC').all() as any[]
  return rows.map(mapOAuthProvider)
}

export function getEnabledOAuthProviders(): OAuthProvider[] {
  const rows = getDb().prepare('SELECT * FROM oauth_providers WHERE enabled = 1 ORDER BY created_at ASC').all() as any[]
  return rows.map(mapOAuthProvider)
}

export function getOAuthProviderById(id: string): OAuthProvider | null {
  const r = getDb().prepare('SELECT * FROM oauth_providers WHERE id = ?').get(id) as any
  return r ? mapOAuthProvider(r) : null
}

export function getOAuthProviderRaw(id: string): { id: string; type: 'github' | 'gitlab'; name: string; base_url: string; client_id: string; client_secret: string; enabled: number } | null {
  return getDb().prepare('SELECT * FROM oauth_providers WHERE id = ?').get(id) as any ?? null
}

export function createOAuthProvider(p: {
  id: string; type: 'github' | 'gitlab'; name: string; baseUrl: string;
  clientId: string; clientSecretEncrypted: string; enabled?: boolean
}) {
  getDb().prepare(`INSERT INTO oauth_providers (id, type, name, base_url, client_id, client_secret, enabled)
                   VALUES (?, ?, ?, ?, ?, ?, ?)`).run(
    p.id, p.type, p.name, p.baseUrl, p.clientId, p.clientSecretEncrypted, p.enabled === false ? 0 : 1
  )
}

export function updateOAuthProvider(id: string, patch: {
  name?: string; baseUrl?: string; clientId?: string; clientSecretEncrypted?: string; enabled?: boolean
}) {
  const fields: string[] = []
  const values: any[] = []
  if (patch.name !== undefined) { fields.push('name = ?'); values.push(patch.name) }
  if (patch.baseUrl !== undefined) { fields.push('base_url = ?'); values.push(patch.baseUrl) }
  if (patch.clientId !== undefined) { fields.push('client_id = ?'); values.push(patch.clientId) }
  if (patch.clientSecretEncrypted !== undefined) { fields.push('client_secret = ?'); values.push(patch.clientSecretEncrypted) }
  if (patch.enabled !== undefined) { fields.push('enabled = ?'); values.push(patch.enabled ? 1 : 0) }
  if (fields.length === 0) return
  values.push(id)
  getDb().prepare(`UPDATE oauth_providers SET ${fields.join(', ')} WHERE id = ?`).run(...values)
}

export function deleteOAuthProvider(id: string) {
  getDb().prepare('DELETE FROM oauth_providers WHERE id = ?').run(id)
}

export function getUserByOAuth(providerId: string, oauthUserId: string): User | null {
  const r = getDb().prepare(
    'SELECT * FROM users WHERE oauth_provider_id = ? AND oauth_user_id = ?'
  ).get(providerId, oauthUserId) as any
  return r ? mapUser(r) : null
}

export function linkUserOAuth(userId: string, params: {
  providerId: string
  oauthUserId: string
  accessTokenEncrypted: string
  refreshTokenEncrypted: string | null
  tokenExpiresAt: string | null
}) {
  getDb().prepare(`UPDATE users SET
    oauth_provider_id = ?,
    oauth_user_id = ?,
    oauth_access_token = ?,
    oauth_refresh_token = ?,
    oauth_token_expires_at = ?
    WHERE id = ?`).run(
    params.providerId, params.oauthUserId, params.accessTokenEncrypted,
    params.refreshTokenEncrypted, params.tokenExpiresAt, userId
  )
}

export function createOAuthUser(u: {
  id: string; email: string; name: string; avatar?: string;
  providerId: string; oauthUserId: string;
  accessTokenEncrypted: string;
  refreshTokenEncrypted: string | null;
  tokenExpiresAt: string | null;
}) {
  getDb().prepare(`INSERT INTO users (
    id, email, password, name, avatar,
    oauth_provider_id, oauth_user_id,
    oauth_access_token, oauth_refresh_token, oauth_token_expires_at
  ) VALUES (?, ?, NULL, ?, ?, ?, ?, ?, ?, ?)`).run(
    u.id, u.email, u.name, u.avatar ?? 'av-01',
    u.providerId, u.oauthUserId,
    u.accessTokenEncrypted, u.refreshTokenEncrypted, u.tokenExpiresAt
  )
}

export function updateUserOAuthTokens(userId: string, params: {
  accessTokenEncrypted: string
  refreshTokenEncrypted: string | null
  tokenExpiresAt: string | null
}) {
  getDb().prepare(`UPDATE users SET
    oauth_access_token = ?,
    oauth_refresh_token = ?,
    oauth_token_expires_at = ?
    WHERE id = ?`).run(
    params.accessTokenEncrypted, params.refreshTokenEncrypted,
    params.tokenExpiresAt, userId
  )
}

export function getUserOAuthTokenRaw(userId: string): { encrypted: string; providerId: string | null } | null {
  const r = getDb().prepare(
    'SELECT oauth_access_token, oauth_provider_id FROM users WHERE id = ?'
  ).get(userId) as any
  if (!r || !r.oauth_access_token) return null
  return { encrypted: r.oauth_access_token, providerId: r.oauth_provider_id ?? null }
}

/**
 * 사용자 OAuth 자격 전체(access/refresh/expiry + provider) 조회 — 토큰 자동 갱신 경로에서 사용.
 */
export function getUserOAuthFullRaw(userId: string): {
  accessEncrypted: string
  refreshEncrypted: string | null
  expiresAt: string | null
  providerId: string | null
} | null {
  const r = getDb().prepare(
    'SELECT oauth_access_token, oauth_refresh_token, oauth_token_expires_at, oauth_provider_id FROM users WHERE id = ?'
  ).get(userId) as any
  if (!r || !r.oauth_access_token) return null
  return {
    accessEncrypted: r.oauth_access_token,
    refreshEncrypted: r.oauth_refresh_token ?? null,
    expiresAt: r.oauth_token_expires_at ?? null,
    providerId: r.oauth_provider_id ?? null,
  }
}

export function getProjectWithUserOAuth(projectId: string) {
  const p = getDb().prepare(`
    SELECT p.*, u.oauth_provider_id, u.oauth_access_token, u.oauth_refresh_token, u.oauth_token_expires_at
    FROM projects p
    LEFT JOIN users u ON p.user_id = u.id
    WHERE p.id = ?
  `).get(projectId) as any
  if (!p) return null
  return p
}
