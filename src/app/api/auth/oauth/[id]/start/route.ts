import { NextResponse } from 'next/server'
import { cookies } from 'next/headers'
import { loadProvider, buildRedirectUri, buildAuthorizeUrl, generateState } from '@/lib/oauth'

const STATE_COOKIE = 'ive-oauth-state'
const STATE_MAX_AGE = 60 * 10 // 10분

/** OAuth 로그인 시작: state 쿠키 발급 후 provider authorize URL로 302 */
export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const provider = loadProvider(id)
  if (!provider) {
    return NextResponse.json({ error: 'Provider not found' }, { status: 404 })
  }
  if (!provider.enabled) {
    return NextResponse.json({ error: 'Provider disabled' }, { status: 403 })
  }

  const redirectUri = buildRedirectUri(provider, req)
  const state = generateState()
  const authorizeUrl = buildAuthorizeUrl(provider, state, redirectUri)

  // state와 redirect_uri를 함께 쿠키에 저장 — 토큰 교환 시 authorize와 동일한 redirect_uri를
  // 재사용해야 하기 때문 (GitLab/GitHub는 바이트 단위 일치를 요구)
  const cookieStore = await cookies()
  const payload = Buffer.from(JSON.stringify({ id, state, redirectUri })).toString('base64url')
  cookieStore.set(STATE_COOKIE, payload, {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax',
    maxAge: STATE_MAX_AGE,
    path: '/',
  })

  return NextResponse.redirect(authorizeUrl)
}
