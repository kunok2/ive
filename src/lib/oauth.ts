/**
 * OAuth 2.0 Authorization Code Flow — GitHub / GitLab 공통 로직.
 *
 * 지원 provider 타입:
 *   - 'github' : github.com (base_url 고정). Enterprise도 동일한 API 형태로 동작 가능.
 *   - 'gitlab' : gitlab.com 또는 self-hosted. base_url이 인스턴스 루트.
 *
 * 저장된 client_secret은 crypto.ts로 암호화되어 있으므로,
 * provider 레코드를 사용하기 전에 decryptProviderSecret() 로 복호화해야 함.
 */
import crypto from 'crypto'
import { decrypt } from './crypto'
import { getOAuthProviderRaw, getOAuthProviderById } from './db'
import type { OAuthProvider } from '@/types'

// 프로젝트 토큰으로도 재사용하기 위한 scope (api/repo 권한 포함)
const SCOPES = {
  github: ['read:user', 'user:email', 'repo'],
  gitlab: ['read_user', 'api'],
} as const

/** GitHub는 scope를 공백 구분, GitLab은 공백 구분(+URL encoded) */
function joinScopes(type: 'github' | 'gitlab'): string {
  return SCOPES[type].join(' ')
}

export interface ResolvedProvider {
  id: string
  type: 'github' | 'gitlab'
  name: string
  baseUrl: string          // 끝에 슬래시 없음
  clientId: string
  clientSecret: string     // 복호화된 평문
  enabled: boolean
}

/** DB에서 provider 레코드를 가져와 client_secret까지 복호화 */
export function loadProvider(id: string): ResolvedProvider | null {
  const raw = getOAuthProviderRaw(id)
  if (!raw) return null
  return {
    id: raw.id,
    type: raw.type,
    name: raw.name,
    baseUrl: raw.base_url.replace(/\/+$/, ''),
    clientId: raw.client_id,
    clientSecret: decrypt(raw.client_secret),
    enabled: raw.enabled === 1,
  }
}

/** 콜백 URL 생성 (환경변수 OAUTH_REDIRECT_BASE 우선, 없으면 요청 origin 사용) */
export function buildRedirectUri(providerId: string, requestOrigin: string): string {
  const base = (process.env.OAUTH_REDIRECT_BASE || requestOrigin).replace(/\/+$/, '')
  return `${base}/api/auth/oauth/${providerId}/callback`
}

/** state 토큰 생성 (CSRF 방어) */
export function generateState(): string {
  return crypto.randomBytes(32).toString('hex')
}

/** authorize URL 조립 */
export function buildAuthorizeUrl(p: ResolvedProvider, state: string, redirectUri: string): string {
  const params = new URLSearchParams({
    client_id: p.clientId,
    redirect_uri: redirectUri,
    response_type: 'code',
    scope: joinScopes(p.type),
    state,
  })
  if (p.type === 'github') {
    // GitHub는 query에 allow_signup도 지정 가능 (기본 true)
    return `${p.baseUrl}/login/oauth/authorize?${params.toString()}`
  }
  // GitLab: /oauth/authorize
  return `${p.baseUrl}/oauth/authorize?${params.toString()}`
}

/** code → access_token 교환 */
export async function exchangeCodeForToken(p: ResolvedProvider, code: string, redirectUri: string): Promise<{
  accessToken: string
  refreshToken: string | null
  expiresIn: number | null    // 초 단위
  tokenType: string | null
}> {
  const tokenUrl = p.type === 'github'
    ? `${p.baseUrl}/login/oauth/access_token`
    : `${p.baseUrl}/oauth/token`

  const body = new URLSearchParams({
    client_id: p.clientId,
    client_secret: p.clientSecret,
    code,
    redirect_uri: redirectUri,
    grant_type: 'authorization_code',
  })

  const res = await fetch(tokenUrl, {
    method: 'POST',
    headers: {
      'Accept': 'application/json',
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body: body.toString(),
  })

  if (!res.ok) {
    const text = await res.text().catch(() => '')
    throw new Error(`OAuth token exchange failed (${res.status}): ${text.slice(0, 300)}`)
  }

  const data = await res.json() as any
  if (data.error) {
    throw new Error(`OAuth token error: ${data.error_description || data.error}`)
  }
  if (!data.access_token) {
    throw new Error('OAuth token response missing access_token')
  }

  return {
    accessToken: data.access_token as string,
    refreshToken: (data.refresh_token as string) || null,
    expiresIn: typeof data.expires_in === 'number' ? data.expires_in : null,
    tokenType: (data.token_type as string) || null,
  }
}

export interface OAuthUserProfile {
  providerUserId: string        // 공급자 측 고유 ID (숫자도 문자열화)
  email: string                 // verified 이메일만 반환됨
  emailVerified: boolean
  name: string
  username: string              // github login / gitlab username
  avatarUrl: string | null
}

/** access_token으로 사용자 프로필 조회. verified 이메일 확보가 책임. */
export async function fetchUserProfile(p: ResolvedProvider, accessToken: string): Promise<OAuthUserProfile> {
  if (p.type === 'github') {
    return fetchGitHubProfile(p, accessToken)
  }
  return fetchGitLabProfile(p, accessToken)
}

async function fetchGitHubProfile(p: ResolvedProvider, accessToken: string): Promise<OAuthUserProfile> {
  // GitHub API 베이스는 github.com이면 api.github.com, Enterprise면 base_url/api/v3
  // 일단 github.com 단일 가정: api.github.com 사용
  const apiBase = p.baseUrl.includes('github.com')
    ? 'https://api.github.com'
    : `${p.baseUrl}/api/v3`

  const headers = {
    'Authorization': `Bearer ${accessToken}`,
    'Accept': 'application/vnd.github+json',
    'X-GitHub-Api-Version': '2022-11-28',
  }

  const userRes = await fetch(`${apiBase}/user`, { headers })
  if (!userRes.ok) throw new Error(`GitHub /user failed: ${userRes.status}`)
  const user = await userRes.json() as any

  // /user의 email은 public이 아니면 null → /user/emails로 primary & verified 조회
  let email: string | null = user.email || null
  let emailVerified = false
  if (!email || !user.email) {
    const emailsRes = await fetch(`${apiBase}/user/emails`, { headers })
    if (emailsRes.ok) {
      const emails = await emailsRes.json() as Array<{ email: string; primary: boolean; verified: boolean }>
      const primary = emails.find(e => e.primary && e.verified) || emails.find(e => e.verified)
      if (primary) {
        email = primary.email
        emailVerified = true
      }
    }
  } else {
    // /user가 email을 반환했다면 /user/emails로 verified 여부만 재확인
    const emailsRes = await fetch(`${apiBase}/user/emails`, { headers })
    if (emailsRes.ok) {
      const emails = await emailsRes.json() as Array<{ email: string; primary: boolean; verified: boolean }>
      const match = emails.find(e => e.email === email)
      emailVerified = !!match?.verified
    }
  }

  if (!email || !emailVerified) {
    throw new Error('GitHub 이메일이 확인되지 않았습니다 (verified primary email 필요)')
  }

  return {
    providerUserId: String(user.id),
    email,
    emailVerified: true,
    name: user.name || user.login,
    username: user.login,
    avatarUrl: user.avatar_url || null,
  }
}

async function fetchGitLabProfile(p: ResolvedProvider, accessToken: string): Promise<OAuthUserProfile> {
  const apiBase = `${p.baseUrl}/api/v4`
  const res = await fetch(`${apiBase}/user`, {
    headers: { 'Authorization': `Bearer ${accessToken}` },
  })
  if (!res.ok) throw new Error(`GitLab /user failed: ${res.status}`)
  const user = await res.json() as any

  // GitLab: confirmed_at이 null이면 미확인 이메일
  if (!user.email) throw new Error('GitLab 계정에 이메일이 없습니다')
  if (!user.confirmed_at) {
    throw new Error('GitLab 이메일이 확인되지 않았습니다 (email confirmation 필요)')
  }

  return {
    providerUserId: String(user.id),
    email: user.email,
    emailVerified: true,
    name: user.name || user.username,
    username: user.username,
    avatarUrl: user.avatar_url || null,
  }
}

/** expiresIn(초)을 ISO 문자열로 */
export function expiresInToISO(expiresIn: number | null): string | null {
  if (expiresIn == null) return null
  return new Date(Date.now() + expiresIn * 1000).toISOString()
}

/** 공개용 provider 메타(로그인 버튼 렌더용). secret 포함 안 함 */
export function toPublicProvider(p: OAuthProvider) {
  return {
    id: p.id,
    type: p.type,
    name: p.name,
    baseUrl: p.baseUrl,
  }
}

// getOAuthProviderById는 db에서 재-export하지 않고 그냥 직접 사용하려고 import함
export { getOAuthProviderById }
