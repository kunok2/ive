import { NextResponse } from 'next/server'
import { getCurrentUser } from '@/lib/auth'
import { setUserReportMailUnsubscribed } from '@/lib/db'
import { logActivity } from '@/lib/activity'

/**
 * 보고서 메일(주간·월간·연간) 수신 여부를 본인이 직접 바꾼다. body: { subscribed: boolean }.
 * 관리자는 받을 사람을 정하지만, 받지 않겠다는 선택은 본인만 할 수 있다(관리자 화면은 배지로만 보인다).
 */
export async function PUT(req: Request) {
  const user = await getCurrentUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const body = await req.json().catch(() => ({}))
  if (typeof body?.subscribed !== 'boolean') return NextResponse.json({ error: 'subscribed(boolean)가 필요합니다' }, { status: 400 })
  const subscribed: boolean = body.subscribed
  setUserReportMailUnsubscribed(user.id, !subscribed)
  logActivity({ userId: user.id, category: 'settings', action: 'update_report_mail_subscription', detail: `보고서 메일 수신 ${subscribed ? 'on' : 'off'}`, req })
  return NextResponse.json({ ok: true, subscribed })
}
