import { NextResponse } from 'next/server'
import { updateUserSlack } from '@/lib/db'
import { getCurrentUser } from '@/lib/auth'
import { logActivity } from '@/lib/activity'

// 본인 Slack 연결(member ID) + 작업완료 알림 수신 여부 저장 (셀프서비스)
// slackUserId 형식: Slack 프로필 > 더보기 > "멤버 ID 복사"로 얻는 'U...' 또는 'W...'
const SLACK_ID_RE = /^[UW][A-Z0-9]{6,}$/

export async function PUT(req: Request) {
  const user = await getCurrentUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const body = await req.json().catch(() => ({}))
  const slackUserId = typeof body.slackUserId === 'string' ? body.slackUserId.trim() : ''
  const slackNotify = body.slackNotify === undefined ? user.slackNotify : !!body.slackNotify

  if (slackUserId && !SLACK_ID_RE.test(slackUserId)) {
    return NextResponse.json({ error: 'invalid_slack_id' }, { status: 400 })
  }

  updateUserSlack(user.id, slackUserId, slackNotify)

  logActivity({
    userId: user.id,
    category: 'settings',
    action: 'update_slack_account',
    detail: `Slack 알림 설정 변경 (연결: ${slackUserId ? 'O' : 'X'}, 수신: ${slackNotify ? 'on' : 'off'})`,
    req,
  })

  return NextResponse.json({ ok: true, slackUserId, slackNotify })
}
