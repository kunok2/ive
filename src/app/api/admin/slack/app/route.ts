import { NextResponse } from 'next/server'
import { getCurrentUser } from '@/lib/auth'
import { getSystemSetting, setSystemSetting } from '@/lib/db'
import { encrypt } from '@/lib/crypto'
import { logActivity } from '@/lib/activity'

const MASK = '__secret_set__'

/** 관리자: Slack 앱 자격증명 조회 (시크릿은 설정 여부만) */
export async function GET() {
  const user = await getCurrentUser()
  if (!user?.isAdmin) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  return NextResponse.json({
    clientId: getSystemSetting('slack.client_id') || '',
    hasClientSecret: !!getSystemSetting('slack.client_secret'),
    hasSigningSecret: !!getSystemSetting('slack.signing_secret'),
  })
}

/** 관리자: Slack 앱 자격증명 저장 (client_id 평문, secret/signing 암호화) */
export async function POST(req: Request) {
  const user = await getCurrentUser()
  if (!user?.isAdmin) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const { clientId, clientSecret, signingSecret } = await req.json()

  if (typeof clientId === 'string') setSystemSetting('slack.client_id', clientId.trim())
  // 마스크값/빈값이면 기존 유지
  if (clientSecret && clientSecret !== MASK) setSystemSetting('slack.client_secret', encrypt(clientSecret))
  if (signingSecret && signingSecret !== MASK) setSystemSetting('slack.signing_secret', encrypt(signingSecret))

  logActivity({ userId: user.id, category: 'admin', action: 'update_slack_app', detail: 'Slack 앱 자격증명 저장', req })
  return NextResponse.json({ success: true })
}
