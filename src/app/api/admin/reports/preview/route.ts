import { NextRequest, NextResponse } from 'next/server'
import { getCurrentUser } from '@/lib/auth'
import { getUserByEmail, mapUser } from '@/lib/db'
import { buildReportMailFor, reportPeriodToSend } from '@/lib/report-mailer'
import type { ReportType } from '@/lib/report-model'

/** 관리자: 이 사람에게 갈 보고서 메일 미리보기 — 실제 발송과 같은 함수로 만든다(같은 범위·같은 확정본·같은 문구). */
export async function GET(req: NextRequest) {
  const user = await getCurrentUser()
  if (!user?.isAdmin) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  const type = req.nextUrl.searchParams.get('type') as ReportType | null
  const email = req.nextUrl.searchParams.get('email') || ''
  if (type !== 'weekly' && type !== 'monthly' && type !== 'yearly') return NextResponse.json({ error: 'type 은 weekly|monthly|yearly' }, { status: 400 })
  const row = getUserByEmail(email)
  if (!row) return NextResponse.json({ error: 'IVE 계정이 없는 주소입니다 — 이 주소로는 보고서를 보내지 않습니다.' }, { status: 404 })
  const period = reportPeriodToSend(type)
  try {
    const mail = buildReportMailFor(mapUser(row), type, period.start)
    return NextResponse.json({ ...mail, period })
  } catch (e) {
    console.error('[reports/preview] failed:', e)
    return NextResponse.json({ error: (e as Error).message }, { status: 500 })
  }
}
