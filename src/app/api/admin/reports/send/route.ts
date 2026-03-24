import { NextResponse } from 'next/server'
import { getCurrentUser } from '@/lib/auth'
import { getReportSchedule, getReportScheduleByType } from '@/lib/db'
import { sendReport } from '@/lib/report-mailer'

/** 보고서 즉시 발송 */
export async function POST(req: Request) {
  const user = await getCurrentUser()
  if (!user?.isAdmin) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const { scheduleId, reportType, force } = await req.json()

  // scheduleId 또는 reportType으로 스케줄 조회
  const schedule = scheduleId
    ? getReportSchedule(scheduleId)
    : reportType
      ? getReportScheduleByType(reportType)
      : null

  if (!schedule) {
    return NextResponse.json({ error: '보고서 스케줄을 찾을 수 없습니다.' }, { status: 404 })
  }

  if (schedule.recipients.length === 0) {
    return NextResponse.json({ error: '수신자가 설정되지 않았습니다.' }, { status: 400 })
  }

  try {
    const result = await sendReport(schedule, { force: force ?? true })
    return NextResponse.json(result)
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err)
    return NextResponse.json({ error: msg }, { status: 500 })
  }
}
