import { ReportSchedule, ReportSendLog, ReportType } from '@/types'
import { getGlobalExecutionsInRange, ReportExecution, createReportSendLog, hasAlreadySent } from './db'
import { createTransporter, getFromAddress } from './mail'
import { getKSTTodayString } from './date-utils'

const REPORT_TYPE_LABELS: Record<ReportType, string> = {
  weekly: '주간',
  monthly: '월간',
  yearly: '연간',
}

/** 보고서 기간 계산 (KST 기준 YYYY-MM-DD) */
export function calculateReportPeriod(reportType: ReportType, baseDate: Date = new Date()): { start: string; end: string } {
  // KST 기준 오늘
  const kstToday = getKSTTodayString(baseDate)
  const [y, m, d] = kstToday.split('-').map(Number)

  switch (reportType) {
    case 'weekly': {
      // 지난주 월~일
      const today = new Date(y, m - 1, d)
      const dayOfWeek = today.getDay() // 0=일 ~ 6=토
      const lastSunday = new Date(today)
      lastSunday.setDate(today.getDate() - (dayOfWeek === 0 ? 7 : dayOfWeek))
      const lastMonday = new Date(lastSunday)
      lastMonday.setDate(lastSunday.getDate() - 6)
      const endDay = new Date(lastSunday)
      endDay.setDate(endDay.getDate() + 1) // exclusive end
      return {
        start: fmt(lastMonday),
        end: fmt(endDay),
      }
    }
    case 'monthly': {
      // 지난달
      const prevMonth = m === 1 ? 12 : m - 1
      const prevYear = m === 1 ? y - 1 : y
      return {
        start: `${prevYear}-${pad(prevMonth)}-01`,
        end: `${y}-${pad(m)}-01`,
      }
    }
    case 'yearly': {
      // 작년
      return {
        start: `${y - 1}-01-01`,
        end: `${y}-01-01`,
      }
    }
  }
}

function pad(n: number): string { return n.toString().padStart(2, '0') }
function fmt(d: Date): string { return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}` }

/** 보고서 HTML 생성 */
export function generateReportHtml(reportType: ReportType, periodStart: string, periodEnd: string, executions: ReportExecution[]): string {
  const label = REPORT_TYPE_LABELS[reportType]
  const periodEndDisplay = new Date(new Date(periodEnd).getTime() - 86400000).toISOString().slice(0, 10)

  // 통계 집계
  const total = executions.length
  const success = executions.filter(e => e.status === 'success').length
  const failed = executions.filter(e => e.status === 'failed').length
  const running = executions.filter(e => e.status === 'running').length
  const totalTokens = executions.reduce((s, e) => s + e.inputTokens + e.outputTokens, 0)
  const totalCost = executions.reduce((s, e) => s + e.costUsd, 0)

  // 프로젝트별 집계
  const byProject = new Map<string, { name: string; color: string; total: number; success: number; failed: number; cost: number; tokens: number }>()
  for (const e of executions) {
    const p = byProject.get(e.projectId) || { name: e.projectName, color: e.projectColor, total: 0, success: 0, failed: 0, cost: 0, tokens: 0 }
    p.total++
    if (e.status === 'success') p.success++
    if (e.status === 'failed') p.failed++
    p.cost += e.costUsd
    p.tokens += e.inputTokens + e.outputTokens
    byProject.set(e.projectId, p)
  }

  // 에이전트별 집계
  const byAgent = new Map<string, { name: string; cli: string; total: number; success: number; failed: number; cost: number }>()
  for (const e of executions) {
    const a = byAgent.get(e.agentId) || { name: e.agentName, cli: e.cliName, total: 0, success: 0, failed: 0, cost: 0 }
    a.total++
    if (e.status === 'success') a.success++
    if (e.status === 'failed') a.failed++
    a.cost += e.costUsd
    byAgent.set(e.agentId, a)
  }

  const successRate = total > 0 ? ((success / total) * 100).toFixed(1) : '0.0'

  const projectRows = Array.from(byProject.values())
    .sort((a, b) => b.total - a.total)
    .map(p => `
      <tr>
        <td style="padding:8px 12px;border-bottom:1px solid #2a2f3e;">
          <span style="display:inline-block;width:8px;height:8px;border-radius:50%;background:${p.color};margin-right:6px;"></span>${esc(p.name)}
        </td>
        <td style="padding:8px 12px;border-bottom:1px solid #2a2f3e;text-align:center;">${p.total}</td>
        <td style="padding:8px 12px;border-bottom:1px solid #2a2f3e;text-align:center;color:#4ade80;">${p.success}</td>
        <td style="padding:8px 12px;border-bottom:1px solid #2a2f3e;text-align:center;color:#f87171;">${p.failed}</td>
        <td style="padding:8px 12px;border-bottom:1px solid #2a2f3e;text-align:right;">$${p.cost.toFixed(2)}</td>
      </tr>
    `).join('')

  const agentRows = Array.from(byAgent.values())
    .sort((a, b) => b.total - a.total)
    .map(a => `
      <tr>
        <td style="padding:8px 12px;border-bottom:1px solid #2a2f3e;">${esc(a.name)} <span style="color:#666;font-size:11px;">(${a.cli})</span></td>
        <td style="padding:8px 12px;border-bottom:1px solid #2a2f3e;text-align:center;">${a.total}</td>
        <td style="padding:8px 12px;border-bottom:1px solid #2a2f3e;text-align:center;color:#4ade80;">${a.success}</td>
        <td style="padding:8px 12px;border-bottom:1px solid #2a2f3e;text-align:center;color:#f87171;">${a.failed}</td>
        <td style="padding:8px 12px;border-bottom:1px solid #2a2f3e;text-align:right;">$${a.cost.toFixed(2)}</td>
      </tr>
    `).join('')

  return `
<!DOCTYPE html>
<html>
<head><meta charset="utf-8"></head>
<body style="margin:0;padding:0;background:#0d1117;color:#e0e0e0;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;">
  <div style="max-width:600px;margin:0 auto;padding:24px;">
    <!-- 헤더 -->
    <div style="text-align:center;margin-bottom:24px;">
      <h1 style="color:#4ade80;font-size:22px;margin:0 0 4px;">Spring IVE</h1>
      <h2 style="color:#e0e0e0;font-size:16px;margin:0 0 8px;">${label} 보고서</h2>
      <p style="color:#9ca3af;font-size:13px;margin:0;">${periodStart} ~ ${periodEndDisplay}</p>
    </div>

    <!-- 요약 카드 -->
    <div style="background:#161b22;border:1px solid #2a2f3e;border-radius:12px;padding:20px;margin-bottom:20px;">
      <table width="100%" cellpadding="0" cellspacing="0">
        <tr>
          <td style="text-align:center;padding:8px;">
            <div style="font-size:28px;font-weight:800;color:#e0e0e0;">${total}</div>
            <div style="font-size:11px;color:#9ca3af;margin-top:2px;">총 작업</div>
          </td>
          <td style="text-align:center;padding:8px;">
            <div style="font-size:28px;font-weight:800;color:#4ade80;">${success}</div>
            <div style="font-size:11px;color:#9ca3af;margin-top:2px;">성공</div>
          </td>
          <td style="text-align:center;padding:8px;">
            <div style="font-size:28px;font-weight:800;color:#f87171;">${failed}</div>
            <div style="font-size:11px;color:#9ca3af;margin-top:2px;">실패</div>
          </td>
          ${running > 0 ? `
          <td style="text-align:center;padding:8px;">
            <div style="font-size:28px;font-weight:800;color:#22d3ee;">${running}</div>
            <div style="font-size:11px;color:#9ca3af;margin-top:2px;">진행중</div>
          </td>` : ''}
        </tr>
      </table>
      <div style="margin-top:16px;padding-top:16px;border-top:1px solid #2a2f3e;">
        <table width="100%" cellpadding="0" cellspacing="0">
          <tr>
            <td style="text-align:center;padding:4px;">
              <div style="font-size:18px;font-weight:700;color:#22d3ee;">${successRate}%</div>
              <div style="font-size:11px;color:#9ca3af;">성공률</div>
            </td>
            <td style="text-align:center;padding:4px;">
              <div style="font-size:18px;font-weight:700;color:#fbbf24;">${formatTokens(totalTokens)}</div>
              <div style="font-size:11px;color:#9ca3af;">총 토큰</div>
            </td>
            <td style="text-align:center;padding:4px;">
              <div style="font-size:18px;font-weight:700;color:#fb923c;">$${totalCost.toFixed(2)}</div>
              <div style="font-size:11px;color:#9ca3af;">총 비용</div>
            </td>
          </tr>
        </table>
      </div>
    </div>

    ${byProject.size > 0 ? `
    <!-- 프로젝트별 -->
    <div style="background:#161b22;border:1px solid #2a2f3e;border-radius:12px;padding:16px;margin-bottom:20px;">
      <h3 style="color:#e0e0e0;font-size:14px;margin:0 0 12px;font-weight:700;">프로젝트별 현황</h3>
      <table width="100%" cellpadding="0" cellspacing="0" style="font-size:13px;">
        <thead>
          <tr style="color:#9ca3af;font-size:11px;">
            <th style="padding:6px 12px;text-align:left;border-bottom:1px solid #2a2f3e;">프로젝트</th>
            <th style="padding:6px 12px;text-align:center;border-bottom:1px solid #2a2f3e;">전체</th>
            <th style="padding:6px 12px;text-align:center;border-bottom:1px solid #2a2f3e;">성공</th>
            <th style="padding:6px 12px;text-align:center;border-bottom:1px solid #2a2f3e;">실패</th>
            <th style="padding:6px 12px;text-align:right;border-bottom:1px solid #2a2f3e;">비용</th>
          </tr>
        </thead>
        <tbody>${projectRows}</tbody>
      </table>
    </div>
    ` : ''}

    ${byAgent.size > 0 ? `
    <!-- 에이전트별 -->
    <div style="background:#161b22;border:1px solid #2a2f3e;border-radius:12px;padding:16px;margin-bottom:20px;">
      <h3 style="color:#e0e0e0;font-size:14px;margin:0 0 12px;font-weight:700;">에이전트별 현황</h3>
      <table width="100%" cellpadding="0" cellspacing="0" style="font-size:13px;">
        <thead>
          <tr style="color:#9ca3af;font-size:11px;">
            <th style="padding:6px 12px;text-align:left;border-bottom:1px solid #2a2f3e;">에이전트</th>
            <th style="padding:6px 12px;text-align:center;border-bottom:1px solid #2a2f3e;">전체</th>
            <th style="padding:6px 12px;text-align:center;border-bottom:1px solid #2a2f3e;">성공</th>
            <th style="padding:6px 12px;text-align:center;border-bottom:1px solid #2a2f3e;">실패</th>
            <th style="padding:6px 12px;text-align:right;border-bottom:1px solid #2a2f3e;">비용</th>
          </tr>
        </thead>
        <tbody>${agentRows}</tbody>
      </table>
    </div>
    ` : ''}

    ${total === 0 ? `
    <div style="background:#161b22;border:1px solid #2a2f3e;border-radius:12px;padding:32px;text-align:center;margin-bottom:20px;">
      <p style="color:#9ca3af;font-size:14px;margin:0;">해당 기간에 실행된 작업이 없습니다.</p>
    </div>
    ` : ''}

    <!-- 푸터 -->
    <div style="text-align:center;padding-top:16px;border-top:1px solid #2a2f3e;">
      <p style="color:#666;font-size:11px;margin:0;">이 메일은 Spring IVE에서 자동 발송되었습니다.</p>
    </div>
  </div>
</body>
</html>`
}

function esc(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
}

function formatTokens(n: number): string {
  if (n >= 1_000_000) return (n / 1_000_000).toFixed(1) + 'M'
  if (n >= 1_000) return (n / 1_000).toFixed(1) + 'K'
  return n.toString()
}

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
  const html = generateReportHtml(schedule.reportType, periodStart, periodEnd, executions)

  const label = REPORT_TYPE_LABELS[schedule.reportType]
  const periodEndDisplay = new Date(new Date(periodEnd).getTime() - 86400000).toISOString().slice(0, 10)
  const subject = `[Spring IVE] ${label} 보고서 (${periodStart} ~ ${periodEndDisplay})`

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
        from: `"Spring IVE" <${fromAddr}>`,
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
