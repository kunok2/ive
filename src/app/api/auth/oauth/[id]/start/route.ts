import { NextResponse } from 'next/server'
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

  const redirectUri = buildRedirectUri(id, req)
  const state = generateState()
  const authorizeUrl = buildAuthorizeUrl(provider, state, redirectUri)

  // state와 redirect_uri를 함께 쿠키에 저장 — 토큰 교환 시 authorize와 동일한 redirect_uri를
  // 재사용해야 하기 때문 (GitLab/GitHub는 바이트 단위 일치를 요구)
  //
  // ⚠️ sameSite: 'lax' 필수 — GitHub/GitLab이 콜백 URL로 redirect할 때
  // 브라우저가 cross-site top-level GET 요청을 보내는데, 이때 lax 쿠키는 전송됨.
  // strict로 변경하면 콜백에서 state 쿠키를 읽지 못해 OAuth 로그인이 완전히 불가.
  const payload = Buffer.from(JSON.stringify({ id, state, redirectUri })).toString('base64url')
  const response = NextResponse.redirect(authorizeUrl)
  // 브라우저/프록시가 start URL을 캐시해서 동일 state로 재방문하는 것을 방지
  response.headers.set('Cache-Control', 'no-store, no-cache, must-revalidate, private')
  response.headers.set('Pragma', 'no-cache')
  response.cookies.set(STATE_COOKIE, payload, {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax',
    maxAge: STATE_MAX_AGE,
    path: '/',
  })
  return response
}
