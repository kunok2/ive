import { NextResponse } from 'next/server'
import { getCurrentUser } from '@/lib/auth'
import { getAllReportSchedules, upsertReportSchedule, deleteReportSchedule, getAllUsers } from '@/lib/db'
import { ReportSchedule } from '@/types'
import { logActivity } from '@/lib/activity'

export async function GET() {
  const user = await getCurrentUser()
  if (!user?.isAdmin) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const schedules = getAllReportSchedules()
  return NextResponse.json(schedules)
}

export async function POST(req: Request) {
  const user = await getCurrentUser()
  if (!user?.isAdmin) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const body = await req.json()
  const { reportType, enabled, recipients, sendHour } = body

  if (!reportType || !['weekly', 'monthly', 'yearly'].includes(reportType)) {
    return NextResponse.json({ error: '유효하지 않은 보고서 유형입니다.' }, { status: 400 })
  }

  // 수신자 이메일 검증 — userIds가 오면 이메일로 변환
  let recipientEmails: string[] = recipients || []
  if (body.recipientUserIds?.length) {
    const users = getAllUsers()
    recipientEmails = body.recipientUserIds
      .map((id: string) => users.find(u => u.id === id)?.email)
      .filter(Boolean) as string[]
  }

  const schedule: ReportSchedule = {
    id: body.id || `rs-${reportType}`,
    reportType,
    enabled: enabled ?? true,
    recipients: recipientEmails,
    sendHour: sendHour ?? 9,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  }

  upsertReportSchedule(schedule)
  logActivity({
    userId: user.id,
    category: 'admin',
    action: 'upsert_report_schedule',
    detail: `보고서 스케줄 저장: ${reportType} (${schedule.enabled ? '활성' : '비활성'}, 수신자 ${recipientEmails.length}명)`,
    targetType: 'report_schedule',
    targetId: schedule.id,
    req,
  })
  return NextResponse.json(schedule)
}

export async function DELETE(req: Request) {
  const user = await getCurrentUser()
  if (!user?.isAdmin) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const { id } = await req.json()
  if (!id) return NextResponse.json({ error: 'ID가 필요합니다.' }, { status: 400 })

  deleteReportSchedule(id)
  logActivity({ userId: user.id, category: 'admin', action: 'delete_report_schedule', detail: `보고서 스케줄 삭제 (${id})`, targetType: 'report_schedule', targetId: id, req })
  return NextResponse.json({ success: true })
}
