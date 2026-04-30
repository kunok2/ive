import { NextResponse } from 'next/server'
import { getCurrentUser } from '@/lib/auth'
import { getReportSchedule, getReportScheduleByType } from '@/lib/db'
import { sendReport } from '@/lib/report-mailer'
import { logActivity } from '@/lib/activity'

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
    logActivity({
      userId: user.id,
      category: 'admin',
      action: 'send_report',
      detail: `보고서 즉시 발송: ${schedule.reportType} (수신자 ${schedule.recipients.length}명)`,
      targetType: 'report_schedule',
      targetId: schedule.id,
      req,
    })
    return NextResponse.json(result)
  } catch (err: unknown) {
    console.error('[reports/send] failed:', err)
    return NextResponse.json({ error: '보고서 발송에 실패했습니다' }, { status: 500 })
  }
}
