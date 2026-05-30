import { NextResponse } from 'next/server'
import { cookies } from 'next/headers'
import { getPublicOrigin } from '@/lib/oauth'
import { getSlackAppConfig, exchangeInstallCode, slackAuthTest } from '@/lib/slack'
import { upsertSlackWorkspaceFromOAuth } from '@/lib/db'
import { encrypt } from '@/lib/crypto'
import { logActivity } from '@/lib/activity'

export const runtime = 'nodejs'

const STATE_COOKIE = 'ive-slack-install-state'

function redirectToAdmin(req: Request, params: Record<string, string>) {
  const url = new URL('/', getPublicOrigin(req))
  url.searchParams.set('tab', 'admin')
  for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v)
  return NextResponse.redirect(url)
}

/** Add to Slack 콜백: code → 봇 토큰 교환 → slack_workspaces upsert */
export async function GET(req: Request) {
  const url = new URL(req.url)
  const code = url.searchParams.get('code')
  const returnedState = url.searchParams.get('state')
  const errorParam = url.searchParams.get('error')

  if (errorParam) return redirectToAdmin(req, { slack_install_error: errorParam })
  if (!code || !returnedState) return redirectToAdmin(req, { slack_install_error: 'missing_code_or_state' })

  const cookieStore = await cookies()
  const stateCookie = cookieStore.get(STATE_COOKIE)?.value
  cookieStore.delete(STATE_COOKIE)
  if (!stateCookie) return redirectToAdmin(req, { slack_install_error: 'state_cookie_missing' })

  let stateData: { state: string; redirectUri: string; installerUserId: string }
  try {
    stateData = JSON.parse(Buffer.from(stateCookie, 'base64url').toString('utf8'))
  } catch {
    return redirectToAdmin(req, { slack_install_error: 'state_malformed' })
  }
  if (stateData.state !== returnedState) {
    return redirectToAdmin(req, { slack_install_error: 'state_mismatch' })
  }

  const { clientId, clientSecret } = getSlackAppConfig()
  if (!clientId || !clientSecret) {
    return redirectToAdmin(req, { slack_install_error: 'app_credentials_missing' })
  }

  const result = await exchangeInstallCode(clientId, clientSecret, code, stateData.redirectUri)
  if (!result.ok || !result.botToken || !result.teamId || !result.botUserId) {
    return redirectToAdmin(req, { slack_install_error: result.error || 'oauth_exchange_failed' })
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

  return redirectToAdmin(req, { slack_install_ok: result.teamName || result.teamId })
}
