import { NextResponse } from 'next/server'
import { getCurrentUser } from '@/lib/auth'
import { getPublicOrigin, generateState } from '@/lib/oauth'
import { getSlackAppConfig, buildInstallUrl } from '@/lib/slack'

export const runtime = 'nodejs'

const STATE_COOKIE = 'ive-slack-install-state'
const STATE_MAX_AGE = 60 * 10

/** Add to Slack 시작: 로그인 사용자 누구나(본인 워크스페이스에 설치). state 쿠키 발급 후 Slack authorize로 302 */
export async function GET(req: Request) {
  const user = await getCurrentUser()
  if (!user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const { clientId } = getSlackAppConfig()
  if (!clientId) {
    return NextResponse.json({ error: 'Slack 앱 client_id가 설정되지 않았습니다. 먼저 앱 자격증명을 저장하세요.' }, { status: 400 })
  }

  // Slack OAuth redirect는 git 로그인용 oauth.redirect_base와 분리: 요청 origin을 그대로 사용.
  // (개발 터널·운영 도메인 모두에서 접속한 origin과 콜백이 일치하도록)
  const redirectUri = `${getPublicOrigin(req)}/api/slack/install/callback`
  const state = generateState()
  const authorizeUrl = buildInstallUrl(clientId, redirectUri, state)

  // from: 'profile'면 설치 후 홈으로(사용자 설정), 그 외엔 관리자 탭으로 복귀.
  const from = new URL(req.url).searchParams.get('from') === 'profile' ? 'profile' : 'admin'
  const payload = Buffer.from(JSON.stringify({ state, redirectUri, installerUserId: user.id, from })).toString('base64url')
  const response = NextResponse.redirect(authorizeUrl)
  response.cookies.set(STATE_COOKIE, payload, {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax',
    maxAge: STATE_MAX_AGE,
    path: '/',
  })
  return response
}
