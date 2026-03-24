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

  // 개발자별 집계 (에이전트 소유자 기준)
  const byDeveloper = new Map<string, { name: string; agent: string; total: number; success: number; failed: number; cost: number }>()
  for (const e of executions) {
    const devKey = e.developerName || e.agentName
    const d = byDeveloper.get(devKey) || { name: devKey, agent: e.agentName, total: 0, success: 0, failed: 0, cost: 0 }
    d.total++
    if (e.status === 'success') d.success++
    if (e.status === 'failed') d.failed++
    d.cost += e.costUsd
    byDeveloper.set(devKey, d)
  }

  const successRate = total > 0 ? ((success / total) * 100).toFixed(1) : '0.0'

  // 총평 생성
  const summary = generateSummary(label, total, success, failed, running, parseFloat(successRate), totalCost, byProject, byDeveloper)

  // 프로젝트 이름 목록 (헤더 표시용)
  const projectNames = Array.from(byProject.values()).map(p => p.name).filter(Boolean)

  const projectRows = Array.from(byProject.values())
    .sort((a, b) => b.total - a.total)
    .map(p => `
      <tr>
        <td style="padding:8px 12px;border-bottom:1px solid #e5e7eb;">
          <span style="display:inline-block;width:8px;height:8px;border-radius:50%;background:${p.color};margin-right:6px;vertical-align:middle;"></span>
          <strong style="color:#111827;">${esc(p.name || '(이름없음)')}</strong>
        </td>
        <td style="padding:8px 12px;border-bottom:1px solid #e5e7eb;text-align:center;color:#111827;">${p.total}</td>
        <td style="padding:8px 12px;border-bottom:1px solid #e5e7eb;text-align:center;color:#16a34a;font-weight:600;">${p.success}</td>
        <td style="padding:8px 12px;border-bottom:1px solid #e5e7eb;text-align:center;color:#dc2626;font-weight:600;">${p.failed}</td>
        <td style="padding:8px 12px;border-bottom:1px solid #e5e7eb;text-align:right;color:#111827;">$${p.cost.toFixed(2)}</td>
      </tr>
    `).join('')

  const developerRows = Array.from(byDeveloper.values())
    .sort((a, b) => b.total - a.total)
    .map(d => `
      <tr>
        <td style="padding:8px 12px;border-bottom:1px solid #e5e7eb;color:#111827;">
          <strong>${esc(d.name)}</strong>
          <span style="color:#6b7280;font-size:11px;"> (${esc(d.agent)})</span>
        </td>
        <td style="padding:8px 12px;border-bottom:1px solid #e5e7eb;text-align:center;color:#111827;">${d.total}</td>
        <td style="padding:8px 12px;border-bottom:1px solid #e5e7eb;text-align:center;color:#16a34a;font-weight:600;">${d.success}</td>
        <td style="padding:8px 12px;border-bottom:1px solid #e5e7eb;text-align:center;color:#dc2626;font-weight:600;">${d.failed}</td>
        <td style="padding:8px 12px;border-bottom:1px solid #e5e7eb;text-align:right;color:#111827;">$${d.cost.toFixed(2)}</td>
      </tr>
    `).join('')

  return `
<!DOCTYPE html>
<html>
<head><meta charset="utf-8"></head>
<body style="margin:0;padding:0;background:#ffffff;color:#111827;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;">
  <div style="max-width:600px;margin:0 auto;padding:24px;">
    <!-- 헤더 -->
    <div style="text-align:center;margin-bottom:24px;padding-bottom:16px;border-bottom:2px solid #16a34a;">
      <h1 style="color:#16a34a;font-size:22px;margin:0 0 4px;">Spring IVE</h1>
      <h2 style="color:#111827;font-size:16px;margin:0 0 8px;">${label} 보고서</h2>
      ${projectNames.length > 0 ? `<p style="color:#374151;font-size:13px;margin:0 0 4px;font-weight:600;">${projectNames.map(n => esc(n)).join(', ')}</p>` : ''}
      <p style="color:#6b7280;font-size:13px;margin:0;">${periodStart} ~ ${periodEndDisplay}</p>
    </div>

    <!-- 요약 카드 -->
    <div style="background:#f9fafb;border:1px solid #e5e7eb;border-radius:12px;padding:20px;margin-bottom:20px;">
      <table width="100%" cellpadding="0" cellspacing="0">
        <tr>
          <td style="text-align:center;padding:8px;">
            <div style="font-size:28px;font-weight:800;color:#111827;">${total}</div>
            <div style="font-size:11px;color:#6b7280;margin-top:2px;">총 작업</div>
          </td>
          <td style="text-align:center;padding:8px;">
            <div style="font-size:28px;font-weight:800;color:#16a34a;">${success}</div>
            <div style="font-size:11px;color:#6b7280;margin-top:2px;">성공</div>
          </td>
          <td style="text-align:center;padding:8px;">
            <div style="font-size:28px;font-weight:800;color:#dc2626;">${failed}</div>
            <div style="font-size:11px;color:#6b7280;margin-top:2px;">실패</div>
          </td>
          ${running > 0 ? `
          <td style="text-align:center;padding:8px;">
            <div style="font-size:28px;font-weight:800;color:#0891b2;">${running}</div>
            <div style="font-size:11px;color:#6b7280;margin-top:2px;">진행중</div>
          </td>` : ''}
        </tr>
      </table>
      <div style="margin-top:16px;padding-top:16px;border-top:1px solid #e5e7eb;">
        <table width="100%" cellpadding="0" cellspacing="0">
          <tr>
            <td style="text-align:center;padding:4px;">
              <div style="font-size:18px;font-weight:700;color:#0891b2;">${successRate}%</div>
              <div style="font-size:11px;color:#6b7280;">성공률</div>
            </td>
            <td style="text-align:center;padding:4px;">
              <div style="font-size:18px;font-weight:700;color:#d97706;">${formatTokens(totalTokens)}</div>
              <div style="font-size:11px;color:#6b7280;">총 토큰</div>
            </td>
            <td style="text-align:center;padding:4px;">
              <div style="font-size:18px;font-weight:700;color:#ea580c;">$${totalCost.toFixed(2)}</div>
              <div style="font-size:11px;color:#6b7280;">총 비용</div>
            </td>
          </tr>
        </table>
      </div>
    </div>

    ${byProject.size > 0 ? `
    <!-- 프로젝트별 -->
    <div style="background:#f9fafb;border:1px solid #e5e7eb;border-radius:12px;padding:16px;margin-bottom:20px;">
      <h3 style="color:#111827;font-size:14px;margin:0 0 12px;font-weight:700;">프로젝트별 현황</h3>
      <table width="100%" cellpadding="0" cellspacing="0" style="font-size:13px;color:#111827;">
        <thead>
          <tr style="color:#6b7280;font-size:11px;">
            <th style="padding:6px 12px;text-align:left;border-bottom:1px solid #e5e7eb;">프로젝트</th>
            <th style="padding:6px 12px;text-align:center;border-bottom:1px solid #e5e7eb;">전체</th>
            <th style="padding:6px 12px;text-align:center;border-bottom:1px solid #e5e7eb;">성공</th>
            <th style="padding:6px 12px;text-align:center;border-bottom:1px solid #e5e7eb;">실패</th>
            <th style="padding:6px 12px;text-align:right;border-bottom:1px solid #e5e7eb;">비용</th>
          </tr>
        </thead>
        <tbody>${projectRows}</tbody>
      </table>
    </div>
    ` : ''}

    ${byDeveloper.size > 0 ? `
    <!-- 개발자별 -->
    <div style="background:#f9fafb;border:1px solid #e5e7eb;border-radius:12px;padding:16px;margin-bottom:20px;">
      <h3 style="color:#111827;font-size:14px;margin:0 0 12px;font-weight:700;">개발자별 현황</h3>
      <table width="100%" cellpadding="0" cellspacing="0" style="font-size:13px;color:#111827;">
        <thead>
          <tr style="color:#6b7280;font-size:11px;">
            <th style="padding:6px 12px;text-align:left;border-bottom:1px solid #e5e7eb;">개발자</th>
            <th style="padding:6px 12px;text-align:center;border-bottom:1px solid #e5e7eb;">전체</th>
            <th style="padding:6px 12px;text-align:center;border-bottom:1px solid #e5e7eb;">성공</th>
            <th style="padding:6px 12px;text-align:center;border-bottom:1px solid #e5e7eb;">실패</th>
            <th style="padding:6px 12px;text-align:right;border-bottom:1px solid #e5e7eb;">비용</th>
          </tr>
        </thead>
        <tbody>${developerRows}</tbody>
      </table>
    </div>
    ` : ''}

    ${total === 0 ? `
    <div style="background:#f9fafb;border:1px solid #e5e7eb;border-radius:12px;padding:32px;text-align:center;margin-bottom:20px;">
      <p style="color:#6b7280;font-size:14px;margin:0;">해당 기간에 실행된 작업이 없습니다.</p>
    </div>
    ` : ''}

    ${total > 0 ? `
    <!-- 총평 -->
    <div style="background:#f0fdf4;border:1px solid #bbf7d0;border-radius:12px;padding:20px;margin-bottom:20px;">
      <h3 style="color:#14532d;font-size:14px;margin:0 0 12px;font-weight:700;">📋 총평</h3>
      <p style="color:#166534;font-size:13px;line-height:1.8;margin:0;">${summary}</p>
    </div>
    ` : ''}

    <!-- 푸터 -->
    <div style="text-align:center;padding-top:16px;border-top:1px solid #e5e7eb;">
      <p style="color:#9ca3af;font-size:11px;margin:0;">이 메일은 Spring IVE에서 자동 발송되었습니다.</p>
    </div>
  </div>
</body>
</html>`
}

/** 총평 텍스트 생성 */
function generateSummary(
  label: string,
  total: number,
  success: number,
  failed: number,
  running: number,
  successRate: number,
  totalCost: number,
  byProject: Map<string, { name: string; total: number; success: number; failed: number; cost: number }>,
  byDeveloper: Map<string, { name: string; agent: string; total: number; success: number; failed: number; cost: number }>
): string {
  const parts: string[] = []

  // 기본 요약
  parts.push(`이번 ${label} 기간 동안 총 <strong>${total}건</strong>의 작업이 수행되었습니다.`)

  // 성공률 평가
  if (successRate >= 90) {
    parts.push(`성공률 <strong>${successRate}%</strong>로 매우 안정적인 운영 상태입니다.`)
  } else if (successRate >= 70) {
    parts.push(`성공률 <strong>${successRate}%</strong>로 양호한 수준이나, 실패 작업(${failed}건)에 대한 점검이 권장됩니다.`)
  } else if (total > 0) {
    parts.push(`성공률이 <strong>${successRate}%</strong>로 낮은 편입니다. 실패 작업(${failed}건)에 대한 원인 분석이 필요합니다.`)
  }

  // 프로젝트별 하이라이트
  const projects = Array.from(byProject.values()).sort((a, b) => b.total - a.total)
  if (projects.length > 0) {
    const topProject = projects[0]
    parts.push(`가장 활발한 프로젝트는 <strong>${esc(topProject.name)}</strong>(${topProject.total}건)입니다.`)

    const failedProjects = projects.filter(p => p.failed > 0)
    if (failedProjects.length > 0) {
      const failedNames = failedProjects.map(p => `${esc(p.name)}(${p.failed}건)`).join(', ')
      parts.push(`실패가 발생한 프로젝트: ${failedNames}.`)
    }
  }

  // 개발자별 하이라이트
  const developers = Array.from(byDeveloper.values()).sort((a, b) => b.total - a.total)
  if (developers.length > 1) {
    const topDev = developers[0]
    parts.push(`가장 많은 작업을 수행한 개발자는 <strong>${esc(topDev.name)}</strong>(${topDev.total}건)입니다.`)
  }

  // 비용 요약
  if (totalCost > 0) {
    parts.push(`총 비용은 <strong>$${totalCost.toFixed(2)}</strong>이 소요되었습니다.`)
  }

  // 진행중 작업
  if (running > 0) {
    parts.push(`현재 진행 중인 작업이 ${running}건 있습니다.`)
  }

  return parts.join(' ')
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
