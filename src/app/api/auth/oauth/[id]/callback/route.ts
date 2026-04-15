import { NextResponse } from 'next/server'
import { cookies } from 'next/headers'
import fs from 'fs'
import path from 'path'
import {
  loadProvider, exchangeCodeForToken,
  fetchUserProfile, expiresInToISO, getPublicOrigin,
} from '@/lib/oauth'
import {
  getUserByEmail, getUserByOAuth, createOAuthUser, linkUserOAuth,
  updateUserOAuthTokens, updateUserAvatar,
} from '@/lib/db'
import { encrypt } from '@/lib/crypto'
import { setAuthCookie } from '@/lib/auth'
import { logActivity } from '@/lib/activity'

const STATE_COOKIE = 'ive-oauth-state'

/**
 * 302 대신 다크 배경 HTML을 반환해 페이지 전환 시 흰색 깜빡임을 방지.
 * JS + meta refresh 이중 안전장치.
 */
function renderLoadingRedirect(targetUrl: string): string {
  const escaped = targetUrl.replace(/"/g, '&quot;')
  return `<!DOCTYPE html>
<html lang="ko" style="background:#050505;">
<head>
<meta charset="utf-8">
<meta http-equiv="refresh" content="0; url=${escaped}">
<title>Spring IVE</title>
<style>
  html, body { margin:0; padding:0; background:#050505; color:#d4d4d8; height:100%;
    font-family:-apple-system,BlinkMacSystemFont,'Apple SD Gothic Neo','Segoe UI',sans-serif; }
  .wrap { position:fixed; inset:0; display:flex; flex-direction:column; align-items:center; justify-content:center; gap:12px; }
  .spinner { width:32px; height:32px; border:3px solid #27272a; border-top-color:#4ade80; border-radius:50%;
    animation: spin .8s linear infinite; }
  @keyframes spin { to { transform: rotate(360deg); } }
  .text { font-size:14px; color:#71717a; font-weight:600; }
</style>
</head>
<body>
<div class="wrap">
  <div class="spinner"></div>
  <div class="text">로그인 처리 중...</div>
</div>
<script>window.location.replace(${JSON.stringify(targetUrl)});</script>
</body>
</html>`
}

/**
 * 공급자 아바타 URL을 data/avatars/{userId}.{ext}로 저장하고 user.avatar='photo'로 설정.
 * 실패는 무시 (아바타는 필수 아님 — 실패 시 av-01 기본 유지).
 */
async function downloadAndSaveAvatar(userId: string, avatarUrl: string): Promise<boolean> {
  try {
    const res = await fetch(avatarUrl, {
      headers: { 'User-Agent': 'Spring-IVE-OAuth' },
      redirect: 'follow',
    })
    if (!res.ok) return false

    const contentType = res.headers.get('content-type') || ''
    let ext = 'png'
    if (contentType.includes('jpeg') || contentType.includes('jpg')) ext = 'jpg'
    else if (contentType.includes('webp')) ext = 'webp'
    else if (contentType.includes('gif')) ext = 'gif'
    else if (contentType.includes('png')) ext = 'png'
    else {
      // Content-Type이 이미지가 아니면 거부
      if (!contentType.startsWith('image/')) return false
    }

    const buf = Buffer.from(await res.arrayBuffer())
    // 5MB 상한 (기존 업로드와 동일 정책)
    if (buf.length > 5 * 1024 * 1024) return false

    const avatarDir = path.join(process.cwd(), 'data', 'avatars')
    if (!fs.existsSync(avatarDir)) fs.mkdirSync(avatarDir, { recursive: true })

    // 기존 파일 삭제 (확장자가 달라질 수 있음)
    for (const e of ['jpg', 'jpeg', 'png', 'webp', 'gif']) {
      const old = path.join(avatarDir, `${userId}.${e}`)
      if (fs.existsSync(old)) {
        try { fs.unlinkSync(old) } catch { /* ignore */ }
      }
    }

    fs.writeFileSync(path.join(avatarDir, `${userId}.${ext}`), buf)
    updateUserAvatar(userId, 'photo')
    return true
  } catch (e) {
    console.warn('[OAuth callback] avatar download failed:', e)
    return false
  }
}

function redirectToLoginWithError(req: Request, message: string) {
  const url = new URL('/login', getPublicOrigin(req))
  url.searchParams.set('oauth_error', message)
  return NextResponse.redirect(url)
}

/** OAuth provider로부터 콜백 수신 → code 교환 → user upsert → JWT 발급 */
export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const url = new URL(req.url)
  const code = url.searchParams.get('code')
  const returnedState = url.searchParams.get('state')
  const errorParam = url.searchParams.get('error')

  if (errorParam) {
    return redirectToLoginWithError(req, `OAuth 거부됨: ${errorParam}`)
  }
  if (!code || !returnedState) {
    return redirectToLoginWithError(req, 'OAuth 응답 누락 (code/state)')
  }

  // state 쿠키 검증 + 즉시 삭제. 쿠키에는 {id, state, redirectUri}가 base64url JSON으로 저장됨
  const cookieStore = await cookies()
  const stateCookie = cookieStore.get(STATE_COOKIE)?.value
  cookieStore.delete(STATE_COOKIE)
  if (!stateCookie) {
    return redirectToLoginWithError(req, 'state 쿠키 없음 (만료 또는 브라우저 쿠키 차단)')
  }
  let stateData: { id: string; state: string; redirectUri: string }
  try {
    stateData = JSON.parse(Buffer.from(stateCookie, 'base64url').toString('utf8'))
  } catch {
    return redirectToLoginWithError(req, 'state 쿠키 형식 오류')
  }
  if (stateData.id !== id || stateData.state !== returnedState) {
    return redirectToLoginWithError(req, 'state 불일치 (CSRF 의심)')
  }

  const provider = loadProvider(id)
  if (!provider || !provider.enabled) {
    return redirectToLoginWithError(req, 'Provider를 찾을 수 없거나 비활성')
  }

  // authorize 시점에 보낸 redirect_uri를 그대로 재사용 (GitLab/GitHub는 바이트 단위 일치 요구)
  const redirectUri = stateData.redirectUri

  // 1. code → access_token 교환
  let tokens
  try {
    tokens = await exchangeCodeForToken(provider, code, redirectUri)
  } catch (e: any) {
    console.error('[OAuth callback] token exchange failed:', e, 'redirectUri:', redirectUri)
    return redirectToLoginWithError(req, '인증 처리 중 오류가 발생했습니다')
  }

  // 2. access_token으로 사용자 프로필 조회 (verified 이메일 강제)
  let profile
  try {
    profile = await fetchUserProfile(provider, tokens.accessToken)
  } catch (e: any) {
    console.error('[OAuth callback] fetch profile failed:', e)
    return redirectToLoginWithError(req, '인증 처리 중 오류가 발생했습니다')
  }

  const accessTokenEnc = encrypt(tokens.accessToken)
  const refreshTokenEnc = tokens.refreshToken ? encrypt(tokens.refreshToken) : null
  const tokenExpiresAt = expiresInToISO(tokens.expiresIn)

  // 3. 유저 upsert
  // 3a. 이미 같은 (provider, providerUserId)로 연결된 계정이 있으면 토큰만 갱신
  const byOAuth = getUserByOAuth(provider.id, profile.providerUserId)
  let userId: string
  let action: 'login' | 'link' | 'register'

  if (byOAuth) {
    updateUserOAuthTokens(byOAuth.id, {
      accessTokenEncrypted: accessTokenEnc,
      refreshTokenEncrypted: refreshTokenEnc,
      tokenExpiresAt,
    })
    userId = byOAuth.id
    action = 'login'
    // 재로그인 시에는 사용자가 직접 올린 사진이 있을 수 있으니 건드리지 않음
  } else {
    // 3b. 이메일이 기존 계정에 있는지 확인 → 자동 링크 (A안)
    const byEmail = getUserByEmail(profile.email)
    if (byEmail) {
      linkUserOAuth(byEmail.id, {
        providerId: provider.id,
        oauthUserId: profile.providerUserId,
        accessTokenEncrypted: accessTokenEnc,
        refreshTokenEncrypted: refreshTokenEnc,
        tokenExpiresAt,
      })
      userId = byEmail.id
      action = 'link'

      // 기본 아바타(av-*)인 경우에만 OAuth 아바타로 덮어씀. 사용자가 직접 업로드한 'photo'는 보존.
      if (profile.avatarUrl && byEmail.avatar !== 'photo') {
        await downloadAndSaveAvatar(byEmail.id, profile.avatarUrl)
      }
    } else {
      // 3c. 신규 OAuth 유저 생성
      const newId = `user-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
      createOAuthUser({
        id: newId,
        email: profile.email,
        name: profile.name,
        avatar: 'av-01', // 일단 기본으로 생성, 아래에서 아바타 다운로드 성공 시 'photo'로 업데이트
        providerId: provider.id,
        oauthUserId: profile.providerUserId,
        accessTokenEncrypted: accessTokenEnc,
        refreshTokenEncrypted: refreshTokenEnc,
        tokenExpiresAt,
      })
      userId = newId
      action = 'register'

      if (profile.avatarUrl) {
        await downloadAndSaveAvatar(newId, profile.avatarUrl)
      }
    }
  }

  // 4. JWT 쿠키 발급
  await setAuthCookie(userId)

  // 5. 활동 로그
  try {
    logActivity({
      userId,
      category: 'auth',
      action: action === 'register' ? 'oauth_register' : action === 'link' ? 'oauth_link' : 'oauth_login',
      detail: `${provider.type} OAuth (${provider.name}) — ${profile.email}`,
      req,
    })
  } catch { /* ignore */ }

  // 6. 홈으로 — 302 대신 다크 배경 로딩 HTML을 반환해 흰색 깜빡임 방지
  const homeUrl = new URL('/', getPublicOrigin(req)).toString()
  return new NextResponse(renderLoadingRedirect(homeUrl), {
    status: 200,
    headers: { 'Content-Type': 'text/html; charset=utf-8' },
  })
}
