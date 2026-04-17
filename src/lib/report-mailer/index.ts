import { ReportSchedule } from '@/types'
import { getGlobalExecutionsInRange, createReportSendLog, hasAlreadySent } from '../db'
import { createTransporter, getFromAddress } from '../mail'
import { REPORT_TYPE_LABELS, calculateReportPeriod, calculatePreviousPeriod } from './schedule'
import { generateReportHtml } from './templates'

// ─── Re-exports ───
export { calculateReportPeriod, calculatePreviousPeriod } from './schedule'
export { generateReportHtml } from './templates'

/** 보고서를 생성하여 수신자들에게 발송 */
export async function sendReport(
  schedule: ReportSchedule,
  options?: { force?: boolean; periodStart?: string; periodEnd?: string }
): Promise<{ sent: number; skipped: number; failed: number }> {
  const force = options?.force ?? false
  const { start, end } = options?.periodStart && options?.periodEnd
    ? { start: options.periodStart, end: options.periodEnd }
    : calculateReportPeriod(schedule.reportType)

  const periodStart = start
  const periodEnd = end

  const executions = getGlobalExecutionsInRange(periodStart, periodEnd)

  // 전 기간 데이터 조회
  const prevPeriod = calculatePreviousPeriod(schedule.reportType, periodStart, periodEnd)
  const prevExecutions = getGlobalExecutionsInRange(prevPeriod.start, prevPeriod.end)

  const html = generateReportHtml(schedule.reportType, periodStart, periodEnd, executions, prevExecutions)

  const label = REPORT_TYPE_LABELS[schedule.reportType]
  const periodEndDisplay = new Date(new Date(periodEnd).getTime() - 86400000).toISOString().slice(0, 10)
  const subject = `[Springware IVE] ${label} 보고서 (${periodStart} ~ ${periodEndDisplay})`

  const transporter = createTransporter()
  const fromAddr = getFromAddress()

  let sent = 0, skipped = 0, failed = 0

  for (const email of schedule.recipients) {
    // 중복발송 체크
    if (!force && hasAlreadySent(schedule.id, periodStart, periodEnd, email)) {
      skipped++
      continue
    }

    const logId = `rsl-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
    try {
      await transporter.sendMail({
        from: `"Springware IVE" <${fromAddr}>`,
        to: email,
        subject,
        html,
      })

      createReportSendLog({
        id: logId,
        scheduleId: schedule.id,
        reportType: schedule.reportType,
        periodStart,
        periodEnd,
        recipientEmail: email,
        status: 'success',
        sentAt: new Date().toISOString(),
      })
      sent++
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err)
      console.error(`[ReportMailer] 발송 실패 (${email}):`, msg)

      createReportSendLog({
        id: logId,
        scheduleId: schedule.id,
        reportType: schedule.reportType,
        periodStart,
        periodEnd,
        recipientEmail: email,
        status: 'failed',
        errorMessage: msg,
        sentAt: new Date().toISOString(),
      })
      failed++
    }
  }

  console.log(`[ReportMailer] ${label} 보고서 발송 완료: sent=${sent}, skipped=${skipped}, failed=${failed}`)
  return { sent, skipped, failed }
}
