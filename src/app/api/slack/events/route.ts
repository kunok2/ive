import { NextResponse } from 'next/server'
import { getSlackWorkspaceRaw } from '@/lib/db'
import { decrypt } from '@/lib/crypto'
import { verifySlackSignature, handleAppMention, getSlackAppConfig, DecryptedWorkspace } from '@/lib/slack'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

/**
 * Slack Event Subscriptions 수신 엔드포인트.
 * - URL Verification 챌린지 응답
 * - 서명 검증 (워크스페이스별 signing secret)
 * - app_mention 200 ACK 후 백그라운드 처리
 */
export async function POST(req: Request) {
  const rawBody = await req.text()

  let body: any
  try {
    body = JSON.parse(rawBody)
  } catch {
    return NextResponse.json({ error: 'invalid json' }, { status: 400 })
  }

  // 1) URL Verification — team_id가 없으므로 서명 없이 챌린지 echo
  if (body.type === 'url_verification') {
    return NextResponse.json({ challenge: body.challenge })
  }

  // 2) Event callback
  if (body.type !== 'event_callback') {
    return NextResponse.json({ ok: true })
  }

  const teamId: string | undefined = body.team_id
  if (!teamId) return NextResponse.json({ ok: true })

  const raw = getSlackWorkspaceRaw(teamId)
  if (!raw || raw.enabled !== 1) {
    // 등록 안 됐거나 비활성 — 검증 불가, 조용히 무시
    return NextResponse.json({ ok: true })
  }

  // 워크스페이스별 signing secret(수동 등록) 우선, 비어 있으면 앱 단위(OAuth 설치) 사용
  const signingSecret = decrypt(raw.signing_secret) || getSlackAppConfig().signingSecret
  const valid = verifySlackSignature({
    signingSecret,
    timestamp: req.headers.get('x-slack-request-timestamp'),
    signature: req.headers.get('x-slack-signature'),
    rawBody,
  })
  if (!valid) {
    return NextResponse.json({ error: 'invalid signature' }, { status: 401 })
  }

  const event = body.event
  if (event?.type === 'app_mention') {
    const workspace: DecryptedWorkspace = {
      id: raw.id,
      teamId: raw.team_id,
      botToken: decrypt(raw.bot_token),
      signingSecret,
      botUserId: raw.bot_user_id,
      defaultUserId: raw.default_user_id,
    }
    // 3초 ACK 보장: 응답 후 백그라운드 처리 (커스텀 long-running 서버)
    void handleAppMention(workspace, event)
  }

  return NextResponse.json({ ok: true })
}
