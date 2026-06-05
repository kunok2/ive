import { NextResponse } from 'next/server'
import { getCurrentUser } from '@/lib/auth'
import { setUserMailUnsubscribed } from '@/lib/db'
import { logActivity } from '@/lib/activity'

/**
 * 안내·소식(브로드캐스트) 메일 수신 여부를 본인이 직접 변경한다.
 * body: { subscribed: boolean } — true=수신(mail_unsubscribed=false), false=수신거부.
 * 수신거부는 본인의 동의 선택이므로 관리자가 대신 켤 수 없고 이 셀프서비스 경로로만 변경한다.
 */
export async function PUT(req: Request) {
  const user = await getCurrentUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const body = await req.json().catch(() => ({}))
  const subscribed = body.subscribed === undefined ? !user.mailUnsubscribed : !!body.subscribed
  const unsubscribed = !subscribed

  setUserMailUnsubscribed(user.id, unsubscribed)

  logActivity({
    userId: user.id,
    category: 'settings',
    action: 'update_mail_subscription',
    detail: `안내·소식 메일 수신 ${subscribed ? 'on' : 'off'}`,
    req,
  })

  return NextResponse.json({ ok: true, subscribed })
}
