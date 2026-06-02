import { NextResponse } from 'next/server'
import { cookies } from 'next/headers'
import { getPublicOrigin } from '@/lib/oauth'
import { getSlackAppConfig, exchangeInstallCode, slackAuthTest } from '@/lib/slack'
import { upsertSlackWorkspaceFromOAuth, getSlackWorkspaceByTeamId, getUserById } from '@/lib/db'
import { encrypt } from '@/lib/crypto'
import { logActivity } from '@/lib/activity'

export const runtime = 'nodejs'

const STATE_COOKIE = 'ive-slack-install-state'

/** 설치 결과 리다이렉트. from='profile'면 홈(사용자 설정), 그 외엔 관리자 탭으로. */
function redirectBack(req: Request, from: string, params: Record<string, string>) {
  const url = new URL('/', getPublicOrigin(req))
  if (from !== 'profile') url.searchParams.set('tab', 'admin')
  for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v)
  return NextResponse.redirect(url)
}

/** Add to Slack 콜백: code → 봇 토큰 교환 → slack_workspaces upsert */
export async function GET(req: Request) {
  const url = new URL(req.url)
  const code = url.searchParams.get('code')
  const returnedState = url.searchParams.get('state')
  const errorParam = url.searchParams.get('error')

  // state에서 from을 먼저 파싱하려면 쿠키를 읽어야 하므로, 초기 오류는 admin 기본으로 둔다.
  if (errorParam) return redirectBack(req, 'admin', { slack_install_error: errorParam })
  if (!code || !returnedState) return redirectBack(req, 'admin', { slack_install_error: 'missing_code_or_state' })

  const cookieStore = await cookies()
  const stateCookie = cookieStore.get(STATE_COOKIE)?.value
  cookieStore.delete(STATE_COOKIE)
  if (!stateCookie) return redirectBack(req, 'admin', { slack_install_error: 'state_cookie_missing' })

  let stateData: { state: string; redirectUri: string; installerUserId: string; from?: string }
  try {
    stateData = JSON.parse(Buffer.from(stateCookie, 'base64url').toString('utf8'))
  } catch {
    return redirectBack(req, 'admin', { slack_install_error: 'state_malformed' })
  }
  const from = stateData.from === 'profile' ? 'profile' : 'admin'
  if (stateData.state !== returnedState) {
    return redirectBack(req, from, { slack_install_error: 'state_mismatch' })
  }

  const { clientId, clientSecret } = getSlackAppConfig()
  if (!clientId || !clientSecret) {
    return redirectBack(req, from, { slack_install_error: 'app_credentials_missing' })
  }

  const result = await exchangeInstallCode(clientId, clientSecret, code, stateData.redirectUri)
  if (!result.ok || !result.botToken || !result.teamId || !result.botUserId) {
    return redirectBack(req, from, { slack_install_error: result.error || 'oauth_exchange_failed' })
  }

  // 소유권 가드(멀티테넌트): 이미 '존재하는' 다른 사용자가 소유한 워크스페이스면 가로채기 금지.
  // 단, 기존 소유자가 삭제된 고아 상태면 새 설치자가 가져갈 수 있게 허용(self-healing).
  const existing = getSlackWorkspaceByTeamId(result.teamId)
  if (existing && existing.defaultUserId && existing.defaultUserId !== stateData.installerUserId) {
    const ownerStillExists = !!getUserById(existing.defaultUserId)
    if (ownerStillExists) {
      return redirectBack(req, from, { slack_install_error: 'already_claimed' })
    }
    // 고아(소유자 삭제됨) → 그대로 진행하면 아래 upsert가 default_user_id를 새 설치자로 갱신(reclaim)
  }

  // 워크스페이스 URL은 auth.test로 조회 (oauth.v2.access에는 없음)
  let teamUrl = ''
  try { teamUrl = (await slackAuthTest(result.botToken)).teamUrl || '' } catch { /* ignore */ }

  upsertSlackWorkspaceFromOAuth({
    teamId: result.teamId,
    teamName: result.teamName || '',
    teamUrl,
    name: result.teamName || result.teamId,
    botTokenEncrypted: encrypt(result.botToken),
    botUserId: result.botUserId,
    defaultUserId: stateData.installerUserId,
  })

  try {
    logActivity({
      userId: stateData.installerUserId, category: 'admin', action: 'install_slack_workspace',
      detail: `Slack 워크스페이스 설치(OAuth): ${result.teamName || result.teamId}`,
      targetType: 'slack_workspace', targetId: result.teamId, req,
    })
  } catch { /* ignore */ }

  return redirectBack(req, from, { slack_install_ok: result.teamName || result.teamId })
}
