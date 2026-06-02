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
import { getOAuthProviderRaw, getOAuthProviderById, getSlackProviderRaw, getSystemSetting } from './db'
import type { OAuthProvider } from '@/types'

/** system_settings에 저장되는 서버 공개 origin의 key (Admin → 시스템 설정에서 관리) */
export const OAUTH_REDIRECT_BASE_KEY = 'oauth.redirect_base'

/**
 * Slack provider 행의 정규 id. github/gitlab과 동일하게 oauth_providers 테이블에 1행으로 저장된다.
 * 같은 Slack 앱이 "Sign in with Slack"(OIDC 로그인)과 "Add to Slack"(봇 설치) 양쪽에 쓰인다.
 */
export const SLACK_PROVIDER_ID = 'slack'

type ProviderType = 'github' | 'gitlab' | 'slack'

// 프로젝트 토큰으로도 재사용하기 위한 scope (api/repo 권한 포함). slack은 OIDC scope.
const SCOPES = {
  github: ['read:user', 'user:email', 'repo'],
  gitlab: ['read_user', 'api'],
  slack: ['openid', 'email', 'profile'],
} as const

/** scope 문자열 조립 (모든 provider 공백 구분) */
function joinScopes(type: ProviderType): string {
  return SCOPES[type].join(' ')
}

export interface ResolvedProvider {
  id: string
  type: ProviderType
  name: string
  baseUrl: string          // 끝에 슬래시 없음
  clientId: string
  clientSecret: string     // 복호화된 평문
  enabled: boolean
}

/** "Sign in with Slack" 버튼을 노출할지 — slack provider 행이 있고 enabled일 때 */
export function isSlackLoginEnabled(): boolean {
  const raw = getSlackProviderRaw()
  return !!raw && raw.enabled === 1
}

/** DB에서 provider 레코드를 가져와 client_secret까지 복호화 (github/gitlab/slack 공통) */
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

/**
 * 요청의 공개 origin을 추정 (역프록시 기준).
 *
 * 우선순위:
 *   1. X-Forwarded-Proto + X-Forwarded-Host (표준 프록시 헤더)
 *   2. X-Forwarded-Proto + Host
 *   3. req.url의 origin (로컬 개발용 최후 수단)
 */
export function getPublicOrigin(req: Request): string {
  const h = req.headers
  const xfProto = h.get('x-forwarded-proto')?.split(',')[0]?.trim()
  const xfHost = h.get('x-forwarded-host')?.split(',')[0]?.trim()
  const host = h.get('host')?.trim()

  const urlProto = (() => {
    try { return new URL(req.url).protocol.replace(':', '') } catch { return 'http' }
  })()
  const proto = xfProto || urlProto
  const finalHost = xfHost || host

  if (finalHost) return `${proto}://${finalHost}`.replace(/\/+$/, '')
  try { return new URL(req.url).origin } catch { return '' }
}

/**
 * 서버 공개 origin 해석 — OAuth 콜백 URL의 base. 시스템 전역 설정.
 *   1. system_settings['oauth.redirect_base'] (관리자 UI → 시스템 설정)
 *   2. OAUTH_REDIRECT_BASE 환경변수 (운영 override)
 *   3. 요청 헤더(X-Forwarded-*)로 자동 감지
 */
export function resolveRedirectBase(req: Request): string {
  const stored = getSystemSetting(OAUTH_REDIRECT_BASE_KEY)
  if (stored && stored.trim()) return stored.trim().replace(/\/+$/, '')
  const env = process.env.OAUTH_REDIRECT_BASE
  if (env) return env.replace(/\/+$/, '')
  return getPublicOrigin(req)
}

/** 콜백 URL 생성 — 역프록시 환경에서도 공개 origin을 사용 */
export function buildRedirectUri(providerId: string, req: Request): string {
  const base = resolveRedirectBase(req)
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
  if (p.type === 'slack') {
    // Sign in with Slack (OpenID Connect). nonce는 OIDC 권장 — state를 재사용.
    params.set('nonce', state)
    return `https://slack.com/openid/connect/authorize?${params.toString()}`
  }
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
  const tokenUrl = p.type === 'slack'
    ? 'https://slack.com/api/openid.connect.token'
    : p.type === 'github'
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
  // Slack은 HTTP 200 + {ok:false, error}로 실패를 알린다.
  if (p.type === 'slack' && data.ok === false) {
    throw new Error(`Slack token error: ${data.error || 'unknown'}`)
  }
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
  if (p.type === 'slack') {
    return fetchSlackProfile(accessToken)
  }
  if (p.type === 'github') {
    return fetchGitHubProfile(p, accessToken)
  }
  return fetchGitLabProfile(p, accessToken)
}

/**
 * Sign in with Slack — OpenID Connect userInfo로 프로필 조회.
 * Slack 워크스페이스 이메일은 가입 시 확인된 것으로 간주(email_verified가 명시적으로 false면 거부).
 */
async function fetchSlackProfile(accessToken: string): Promise<OAuthUserProfile> {
  const res = await fetch('https://slack.com/api/openid.connect.userInfo', {
    headers: { Authorization: `Bearer ${accessToken}` },
  })
  const u = await res.json().catch(() => ({ ok: false })) as any
  if (!u.ok) throw new Error(`Slack userInfo 실패: ${u.error || res.status}`)
  const email: string | null = u.email || null
  if (!email) throw new Error('Slack 계정 이메일을 가져오지 못했습니다 (email scope 확인 필요)')
  if (u.email_verified === false) {
    throw new Error('Slack 이메일이 확인되지 않았습니다')
  }
  // user_id는 워크스페이스 내 고유. 같은 사람이 여러 워크스페이스에 있어도 sub로 동일 식별.
  const providerUserId = String(u.sub || u['https://slack.com/user_id'] || email)
  return {
    providerUserId,
    email,
    emailVerified: true,
    name: u.name || email,
    username: u.name || email,
    avatarUrl: u.picture || u['https://slack.com/user_image_192'] || null,
  }
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
  if (!email) {
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
