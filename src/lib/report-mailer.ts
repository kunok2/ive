import { ReportSchedule, ReportSendLog, ReportType } from '@/types'
import { getGlobalExecutionsInRange, ReportExecution, createReportSendLog, hasAlreadySent, getDailyWaitingTrend } from './db'
import { createTransporter, getFromAddress } from './mail'
import { getKSTTodayString } from './date-utils'

const REPORT_TYPE_LABELS: Record<ReportType, string> = {
  weekly: '주간',
  monthly: '월간',
  yearly: '연간',
}

const PREV_PERIOD_LABELS: Record<ReportType, string> = {
  weekly: '전주',
  monthly: '전월',
  yearly: '전년',
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

/** 이전 기간 계산 (전주/전월/전년) */
export function calculatePreviousPeriod(reportType: ReportType, currentStart: string, currentEnd: string): { start: string; end: string } {
  const [sy, sm, sd] = currentStart.split('-').map(Number)
  const [ey, em, ed] = currentEnd.split('-').map(Number)
  const startDate = new Date(sy, sm - 1, sd)
  const endDate = new Date(ey, em - 1, ed)
  const diffMs = endDate.getTime() - startDate.getTime()
  const diffDays = Math.round(diffMs / 86400000)

  switch (reportType) {
    case 'weekly': {
      const prevStart = new Date(startDate)
      prevStart.setDate(prevStart.getDate() - 7)
      const prevEnd = new Date(endDate)
      prevEnd.setDate(prevEnd.getDate() - 7)
      return { start: fmt(prevStart), end: fmt(prevEnd) }
    }
    case 'monthly': {
      const prevStartMonth = sm - 1 === 0 ? 12 : sm - 1
      const prevStartYear = sm - 1 === 0 ? sy - 1 : sy
      const prevEndMonth = em - 1 === 0 ? 12 : em - 1
      const prevEndYear = em - 1 === 0 ? ey - 1 : ey
      return {
        start: `${prevStartYear}-${pad(prevStartMonth)}-${pad(sd)}`,
        end: `${prevEndYear}-${pad(prevEndMonth)}-${pad(ed)}`,
      }
    }
    case 'yearly': {
      return {
        start: `${sy - 1}-${pad(sm)}-${pad(sd)}`,
        end: `${ey - 1}-${pad(em)}-${pad(ed)}`,
      }
    }
  }
}

function pad(n: number): string { return n.toString().padStart(2, '0') }
function fmt(d: Date): string { return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}` }

/** 보고서 HTML 생성 */
export function generateReportHtml(reportType: ReportType, periodStart: string, periodEnd: string, executions: ReportExecution[], prevExecutions?: ReportExecution[]): string {
  const label = REPORT_TYPE_LABELS[reportType]
  const prevLabel = PREV_PERIOD_LABELS[reportType]
  const periodEndDisplay = new Date(new Date(periodEnd).getTime() - 86400000).toISOString().slice(0, 10)

  // 통계 집계
  const total = executions.length
  const success = executions.filter(e => e.status === 'success').length
  const failed = executions.filter(e => e.status === 'failed').length
  const running = executions.filter(e => e.status === 'running').length
  const totalTokens = executions.reduce((s, e) => s + e.inputTokens + e.outputTokens, 0)
  const totalCost = executions.reduce((s, e) => s + e.costUsd, 0)

  // 전 기간 통계 집계
  const prev = prevExecutions || []
  const prevTotal = prev.length
  const prevSuccess = prev.filter(e => e.status === 'success').length
  const prevFailed = prev.filter(e => e.status === 'failed').length
  const prevTotalTokens = prev.reduce((s, e) => s + e.inputTokens + e.outputTokens, 0)
  const prevTotalCost = prev.reduce((s, e) => s + e.costUsd, 0)
  const hasPrev = prevExecutions !== undefined

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

  // 전 기간 프로젝트별 집계
  const prevByProject = new Map<string, { total: number; success: number; failed: number; cost: number; tokens: number }>()
  for (const e of prev) {
    const p = prevByProject.get(e.projectId) || { total: 0, success: 0, failed: 0, cost: 0, tokens: 0 }
    p.total++
    if (e.status === 'success') p.success++
    if (e.status === 'failed') p.failed++
    p.cost += e.costUsd
    p.tokens += e.inputTokens + e.outputTokens
    prevByProject.set(e.projectId, p)
  }

  // 개발자(에이전트)별 집계 - agentId 기준
  const byAgent = new Map<string, { name: string; cli: string; total: number; success: number; failed: number; cost: number }>()
  for (const e of executions) {
    const a = byAgent.get(e.agentId) || { name: e.agentName, cli: e.cliName, total: 0, success: 0, failed: 0, cost: 0 }
    a.total++
    if (e.status === 'success') a.success++
    if (e.status === 'failed') a.failed++
    a.cost += e.costUsd
    byAgent.set(e.agentId, a)
  }

  // 전 기간 개발자(에이전트)별 집계
  const prevByAgent = new Map<string, { total: number; success: number; failed: number; cost: number }>()
  for (const e of prev) {
    const a = prevByAgent.get(e.agentId) || { total: 0, success: 0, failed: 0, cost: 0 }
    a.total++
    if (e.status === 'success') a.success++
    if (e.status === 'failed') a.failed++
    a.cost += e.costUsd
    prevByAgent.set(e.agentId, a)
  }

  // 사용자별 집계 (이슈 생성건수 포함)
  const byUser = new Map<string, { name: string; total: number; success: number; failed: number; cost: number; issueCount: number; projectCount: number }>()
  for (const e of executions) {
    const uid = e.developerUserId || e.developerName || e.agentName
    const u = byUser.get(uid) || { name: e.developerName || e.agentName, total: 0, success: 0, failed: 0, cost: 0, issueCount: 0, projectCount: 0 }
    u.total++
    if (e.status === 'success') u.success++
    if (e.status === 'failed') u.failed++
    u.cost += e.costUsd
    byUser.set(uid, u)
  }
  // 사용자별 이슈 수, 프로젝트 수 계산
  for (const [uid] of byUser) {
    const userExecs = executions.filter(e => (e.developerUserId || e.developerName || e.agentName) === uid)
    byUser.get(uid)!.issueCount = new Set(userExecs.map(e => `${e.projectId}:${e.issueIid}`)).size
    byUser.get(uid)!.projectCount = new Set(userExecs.map(e => e.projectId)).size
  }

  // 전 기간 사용자별 집계
  const prevByUser = new Map<string, { total: number; cost: number; issueCount: number }>()
  for (const e of prev) {
    const uid = e.developerUserId || e.developerName || e.agentName
    const u = prevByUser.get(uid) || { total: 0, cost: 0, issueCount: 0 }
    u.total++
    u.cost += e.costUsd
    prevByUser.set(uid, u)
  }
  for (const [uid] of prevByUser) {
    const userExecs = prev.filter(e => (e.developerUserId || e.developerName || e.agentName) === uid)
    prevByUser.get(uid)!.issueCount = new Set(userExecs.map(e => `${e.projectId}:${e.issueIid}`)).size
  }

  const successRate = total > 0 ? ((success / total) * 100).toFixed(1) : '0.0'
  const prevSuccessRate = prevTotal > 0 ? ((prevSuccess / prevTotal) * 100).toFixed(1) : '0.0'

  // 총평 생성
  const summary = generateSummary(label, total, success, failed, running, parseFloat(successRate), totalCost, byProject, byAgent, byUser, hasPrev ? { prevTotal, prevSuccess, prevFailed, prevSuccessRate: parseFloat(prevSuccessRate), prevTotalCost } : undefined)

  // 프로젝트 이름 목록 (헤더 표시용)
  const projectNames = Array.from(byProject.values()).map(p => p.name).filter(Boolean)

  const projectRows = Array.from(byProject.entries())
    .sort((a, b) => b[1].total - a[1].total)
    .map(([pid, p]) => {
      const pp = prevByProject.get(pid)
      return `
      <tr>
        <td style="padding:8px 12px;border-bottom:1px solid #e5e7eb;">
          <span style="display:inline-block;width:8px;height:8px;border-radius:50%;background:${p.color};margin-right:6px;vertical-align:middle;"></span>
          <strong style="color:#111827;">${esc(p.name || '(이름없음)')}</strong>
        </td>
        <td style="padding:8px 12px;border-bottom:1px solid #e5e7eb;text-align:center;color:#111827;">${p.total}${hasPrev && pp ? ` <span style="font-size:10px;">${changeIndicator(p.total, pp.total)}</span>` : ''}</td>
        <td style="padding:8px 12px;border-bottom:1px solid #e5e7eb;text-align:center;color:#16a34a;font-weight:600;">${p.success}${hasPrev && pp ? ` <span style="font-size:10px;">${changeIndicator(p.success, pp.success)}</span>` : ''}</td>
        <td style="padding:8px 12px;border-bottom:1px solid #e5e7eb;text-align:center;color:#dc2626;font-weight:600;">${p.failed}${hasPrev && pp ? ` <span style="font-size:10px;">${changeIndicator(p.failed, pp.failed, true)}</span>` : ''}</td>
        <td style="padding:8px 12px;border-bottom:1px solid #e5e7eb;text-align:right;color:#111827;">$${p.cost.toFixed(2)}${hasPrev && pp ? ` <span style="font-size:10px;">${changeIndicator(p.cost, pp.cost, true)}</span>` : ''}</td>
      </tr>
    `}).join('')

  const agentRows = Array.from(byAgent.entries())
    .sort((a, b) => b[1].total - a[1].total)
    .map(([agentId, a]) => {
      const pa = prevByAgent.get(agentId)
      return `
      <tr>
        <td style="padding:8px 12px;border-bottom:1px solid #e5e7eb;color:#111827;">
          <strong>${esc(a.name)}</strong>
          <span style="color:#6b7280;font-size:11px;"> (${esc(a.cli)})</span>
        </td>
        <td style="padding:8px 12px;border-bottom:1px solid #e5e7eb;text-align:center;color:#111827;">${a.total}${hasPrev && pa ? ` <span style="font-size:10px;">${changeIndicator(a.total, pa.total)}</span>` : ''}</td>
        <td style="padding:8px 12px;border-bottom:1px solid #e5e7eb;text-align:center;color:#16a34a;font-weight:600;">${a.success}${hasPrev && pa ? ` <span style="font-size:10px;">${changeIndicator(a.success, pa.success)}</span>` : ''}</td>
        <td style="padding:8px 12px;border-bottom:1px solid #e5e7eb;text-align:center;color:#dc2626;font-weight:600;">${a.failed}${hasPrev && pa ? ` <span style="font-size:10px;">${changeIndicator(a.failed, pa.failed, true)}</span>` : ''}</td>
        <td style="padding:8px 12px;border-bottom:1px solid #e5e7eb;text-align:right;color:#111827;">$${a.cost.toFixed(2)}${hasPrev && pa ? ` <span style="font-size:10px;">${changeIndicator(a.cost, pa.cost, true)}</span>` : ''}</td>
      </tr>
    `}).join('')

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
            ${hasPrev ? `<div style="font-size:11px;margin-top:4px;">${changeIndicator(total, prevTotal)}</div>` : ''}
          </td>
          <td style="text-align:center;padding:8px;">
            <div style="font-size:28px;font-weight:800;color:#16a34a;">${success}</div>
            <div style="font-size:11px;color:#6b7280;margin-top:2px;">성공</div>
            ${hasPrev ? `<div style="font-size:11px;margin-top:4px;">${changeIndicator(success, prevSuccess)}</div>` : ''}
          </td>
          <td style="text-align:center;padding:8px;">
            <div style="font-size:28px;font-weight:800;color:#dc2626;">${failed}</div>
            <div style="font-size:11px;color:#6b7280;margin-top:2px;">실패</div>
            ${hasPrev ? `<div style="font-size:11px;margin-top:4px;">${changeIndicator(failed, prevFailed, true)}</div>` : ''}
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
              ${hasPrev ? `<div style="font-size:11px;margin-top:4px;">${changeIndicatorRate(parseFloat(successRate), parseFloat(prevSuccessRate))}</div>` : ''}
            </td>
            <td style="text-align:center;padding:4px;">
              <div style="font-size:18px;font-weight:700;color:#d97706;">${formatTokens(totalTokens)}</div>
              <div style="font-size:11px;color:#6b7280;">총 토큰</div>
              ${hasPrev ? `<div style="font-size:11px;margin-top:4px;">${changeIndicator(totalTokens, prevTotalTokens)}</div>` : ''}
            </td>
            <td style="text-align:center;padding:4px;">
              <div style="font-size:18px;font-weight:700;color:#ea580c;">$${totalCost.toFixed(2)}</div>
              <div style="font-size:11px;color:#6b7280;">총 비용</div>
              ${hasPrev ? `<div style="font-size:11px;margin-top:4px;">${changeIndicator(totalCost, prevTotalCost, true)}</div>` : ''}
            </td>
          </tr>
        </table>
      </div>
    </div>

    ${total > 0 ? `
    <!-- 총평 -->
    <div style="background:#f0fdf4;border:1px solid #bbf7d0;border-radius:12px;padding:20px;margin-bottom:20px;">
      <h3 style="color:#14532d;font-size:14px;margin:0 0 12px;font-weight:700;">📋 총평</h3>
      <p style="color:#166534;font-size:13px;line-height:1.8;margin:0;">${summary}</p>
    </div>
    ` : ''}

    ${hasPrev ? `
    <!-- 전 기간 비교 요약 -->
    <div style="background:#eff6ff;border:1px solid #bfdbfe;border-radius:12px;padding:16px;margin-bottom:20px;">
      <h3 style="color:#1e40af;font-size:14px;margin:0 0 12px;font-weight:700;">📊 ${prevLabel} 대비 비교</h3>
      <table width="100%" cellpadding="0" cellspacing="0" style="font-size:13px;">
        <thead>
          <tr style="color:#6b7280;font-size:11px;">
            <th style="padding:6px 8px;text-align:left;border-bottom:1px solid #bfdbfe;">항목</th>
            <th style="padding:6px 8px;text-align:center;border-bottom:1px solid #bfdbfe;">${prevLabel}</th>
            <th style="padding:6px 8px;text-align:center;border-bottom:1px solid #bfdbfe;">이번 ${label}</th>
            <th style="padding:6px 8px;text-align:center;border-bottom:1px solid #bfdbfe;">증감</th>
            <th style="padding:6px 8px;text-align:center;border-bottom:1px solid #bfdbfe;">증감율</th>
          </tr>
        </thead>
        <tbody>
          <tr>
            <td style="padding:8px;border-bottom:1px solid #dbeafe;color:#111827;font-weight:600;">총 작업</td>
            <td style="padding:8px;border-bottom:1px solid #dbeafe;text-align:center;color:#6b7280;">${prevTotal}</td>
            <td style="padding:8px;border-bottom:1px solid #dbeafe;text-align:center;color:#111827;font-weight:600;">${total}</td>
            <td style="padding:8px;border-bottom:1px solid #dbeafe;text-align:center;">${diffBadge(total - prevTotal)}</td>
            <td style="padding:8px;border-bottom:1px solid #dbeafe;text-align:center;">${changeRateBadge(total, prevTotal)}</td>
          </tr>
          <tr>
            <td style="padding:8px;border-bottom:1px solid #dbeafe;color:#111827;font-weight:600;">성공</td>
            <td style="padding:8px;border-bottom:1px solid #dbeafe;text-align:center;color:#6b7280;">${prevSuccess}</td>
            <td style="padding:8px;border-bottom:1px solid #dbeafe;text-align:center;color:#16a34a;font-weight:600;">${success}</td>
            <td style="padding:8px;border-bottom:1px solid #dbeafe;text-align:center;">${diffBadge(success - prevSuccess)}</td>
            <td style="padding:8px;border-bottom:1px solid #dbeafe;text-align:center;">${changeRateBadge(success, prevSuccess)}</td>
          </tr>
          <tr>
            <td style="padding:8px;border-bottom:1px solid #dbeafe;color:#111827;font-weight:600;">실패</td>
            <td style="padding:8px;border-bottom:1px solid #dbeafe;text-align:center;color:#6b7280;">${prevFailed}</td>
            <td style="padding:8px;border-bottom:1px solid #dbeafe;text-align:center;color:#dc2626;font-weight:600;">${failed}</td>
            <td style="padding:8px;border-bottom:1px solid #dbeafe;text-align:center;">${diffBadge(failed - prevFailed, true)}</td>
            <td style="padding:8px;border-bottom:1px solid #dbeafe;text-align:center;">${changeRateBadge(failed, prevFailed, true)}</td>
          </tr>
          <tr>
            <td style="padding:8px;border-bottom:1px solid #dbeafe;color:#111827;font-weight:600;">성공률</td>
            <td style="padding:8px;border-bottom:1px solid #dbeafe;text-align:center;color:#6b7280;">${prevSuccessRate}%</td>
            <td style="padding:8px;border-bottom:1px solid #dbeafe;text-align:center;color:#0891b2;font-weight:600;">${successRate}%</td>
            <td style="padding:8px;border-bottom:1px solid #dbeafe;text-align:center;">${diffBadge(parseFloat(successRate) - parseFloat(prevSuccessRate), false, 'pp')}</td>
            <td style="padding:8px;border-bottom:1px solid #dbeafe;text-align:center;color:#6b7280;">-</td>
          </tr>
          <tr>
            <td style="padding:8px;border-bottom:1px solid #dbeafe;color:#111827;font-weight:600;">총 토큰</td>
            <td style="padding:8px;border-bottom:1px solid #dbeafe;text-align:center;color:#6b7280;">${formatTokens(prevTotalTokens)}</td>
            <td style="padding:8px;border-bottom:1px solid #dbeafe;text-align:center;color:#d97706;font-weight:600;">${formatTokens(totalTokens)}</td>
            <td style="padding:8px;border-bottom:1px solid #dbeafe;text-align:center;">${diffBadge(totalTokens - prevTotalTokens, false, 'token')}</td>
            <td style="padding:8px;border-bottom:1px solid #dbeafe;text-align:center;">${changeRateBadge(totalTokens, prevTotalTokens)}</td>
          </tr>
          <tr>
            <td style="padding:8px;color:#111827;font-weight:600;">총 비용</td>
            <td style="padding:8px;text-align:center;color:#6b7280;">$${prevTotalCost.toFixed(2)}</td>
            <td style="padding:8px;text-align:center;color:#ea580c;font-weight:600;">$${totalCost.toFixed(2)}</td>
            <td style="padding:8px;text-align:center;">${diffBadge(totalCost - prevTotalCost, true, '$')}</td>
            <td style="padding:8px;text-align:center;">${changeRateBadge(totalCost, prevTotalCost, true)}</td>
          </tr>
        </tbody>
      </table>
    </div>
    ` : ''}

    ${(() => {
      // 대기 건수 추이 테이블
      const waitingData = getDailyWaitingTrend(periodStart, periodEnd)
      const prevWaitingData = prevExecutions ? getDailyWaitingTrend(
        calculatePreviousPeriod(reportType, periodStart, periodEnd).start,
        calculatePreviousPeriod(reportType, periodStart, periodEnd).end
      ) : null
      const hasWaitingData = waitingData.daily.some(d => d.total > 0)
      if (!hasWaitingData) return ''

      // 모든 프로젝트 추출
      const allProjects = new Map<string, { name: string; color: string }>()
      for (const d of waitingData.daily) {
        for (const p of d.byProject) {
          if (!allProjects.has(p.projectId)) {
            allProjects.set(p.projectId, { name: p.projectName, color: p.projectColor })
          }
        }
      }
      const projectList = Array.from(allProjects.entries())

      // 기간 평균
      const avgTotal = waitingData.daily.length > 0 ? Math.round(waitingData.daily.reduce((s, d) => s + d.total, 0) / waitingData.daily.length * 10) / 10 : 0
      const prevAvgTotal = prevWaitingData && prevWaitingData.daily.length > 0 ? Math.round(prevWaitingData.daily.reduce((s, d) => s + d.total, 0) / prevWaitingData.daily.length * 10) / 10 : 0
      const latestTotal = waitingData.daily.length > 0 ? waitingData.daily[waitingData.daily.length - 1].total : 0

      const waitingRows = waitingData.daily.map(d => {
        const projCells = projectList.map(([pid, info]) => {
          const found = d.byProject.find(p => p.projectId === pid)
          const val = found?.waiting ?? 0
          return `<td style="padding:6px 8px;border-bottom:1px solid #e5e7eb;text-align:center;color:${val > 0 ? info.color : '#9ca3af'};font-weight:${val > 0 ? '600' : '400'};">${val}</td>`
        }).join('')
        return `<tr>
          <td style="padding:6px 8px;border-bottom:1px solid #e5e7eb;color:#6b7280;font-size:12px;">${d.date.slice(5)}</td>
          <td style="padding:6px 8px;border-bottom:1px solid #e5e7eb;text-align:center;color:#111827;font-weight:700;">${d.total}</td>
          ${projCells}
        </tr>`
      }).join('')

      const projHeaders = projectList.map(([, info]) =>
        `<th style="padding:6px 8px;text-align:center;border-bottom:1px solid #e5e7eb;"><span style="display:inline-block;width:6px;height:6px;border-radius:50%;background:${info.color};margin-right:3px;vertical-align:middle;"></span>${esc(info.name)}</th>`
      ).join('')

      return `
    <!-- 대기 건수 추이 -->
    <div style="background:#fef3c7;border:1px solid #fbbf24;border-radius:12px;padding:16px;margin-bottom:20px;">
      <h3 style="color:#92400e;font-size:14px;margin:0 0 8px;font-weight:700;">⏳ 대기 건수 추이</h3>
      <div style="margin-bottom:12px;">
        <table cellpadding="0" cellspacing="0" style="font-size:13px;">
          <tr>
            <td style="padding:2px 12px 2px 0;color:#92400e;font-weight:600;">현재 대기</td>
            <td style="padding:2px 0;color:#111827;font-weight:800;font-size:18px;">${latestTotal}건</td>
          </tr>
          <tr>
            <td style="padding:2px 12px 2px 0;color:#92400e;font-weight:600;">기간 평균</td>
            <td style="padding:2px 0;color:#111827;font-weight:700;">${avgTotal}건 ${hasPrev && prevAvgTotal > 0 ? changeIndicator(avgTotal, prevAvgTotal, true) : ''}</td>
          </tr>
        </table>
      </div>
      <div style="overflow-x:auto;">
        <table width="100%" cellpadding="0" cellspacing="0" style="font-size:12px;color:#111827;">
          <thead>
            <tr style="color:#6b7280;font-size:11px;">
              <th style="padding:6px 8px;text-align:left;border-bottom:1px solid #e5e7eb;">날짜</th>
              <th style="padding:6px 8px;text-align:center;border-bottom:1px solid #e5e7eb;">전체</th>
              ${projHeaders}
            </tr>
          </thead>
          <tbody>${waitingRows}</tbody>
        </table>
      </div>
    </div>`
    })()}

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

    ${byAgent.size > 0 ? `
    <!-- 개발자(에이전트)별 -->
    <div style="background:#f9fafb;border:1px solid #e5e7eb;border-radius:12px;padding:16px;margin-bottom:20px;">
      <h3 style="color:#111827;font-size:14px;margin:0 0 12px;font-weight:700;">개발자(에이전트)별 현황</h3>
      <table width="100%" cellpadding="0" cellspacing="0" style="font-size:13px;color:#111827;">
        <thead>
          <tr style="color:#6b7280;font-size:11px;">
            <th style="padding:6px 12px;text-align:left;border-bottom:1px solid #e5e7eb;">에이전트</th>
            <th style="padding:6px 12px;text-align:center;border-bottom:1px solid #e5e7eb;">전체</th>
            <th style="padding:6px 12px;text-align:center;border-bottom:1px solid #e5e7eb;">성공</th>
            <th style="padding:6px 12px;text-align:center;border-bottom:1px solid #e5e7eb;">실패</th>
            <th style="padding:6px 12px;text-align:right;border-bottom:1px solid #e5e7eb;">비용</th>
          </tr>
        </thead>
        <tbody>${agentRows}</tbody>
      </table>
    </div>
    ` : ''}

    ${byUser.size > 0 ? `
    <!-- 사용자별 -->
    <div style="background:#f9fafb;border:1px solid #e5e7eb;border-radius:12px;padding:16px;margin-bottom:20px;">
      <h3 style="color:#111827;font-size:14px;margin:0 0 12px;font-weight:700;">사용자별 현황</h3>
      <table width="100%" cellpadding="0" cellspacing="0" style="font-size:13px;color:#111827;">
        <thead>
          <tr style="color:#6b7280;font-size:11px;">
            <th style="padding:6px 12px;text-align:left;border-bottom:1px solid #e5e7eb;">사용자</th>
            <th style="padding:6px 12px;text-align:center;border-bottom:1px solid #e5e7eb;">이슈 수</th>
            <th style="padding:6px 12px;text-align:center;border-bottom:1px solid #e5e7eb;">작업</th>
            <th style="padding:6px 12px;text-align:center;border-bottom:1px solid #e5e7eb;">성공</th>
            <th style="padding:6px 12px;text-align:center;border-bottom:1px solid #e5e7eb;">실패</th>
            <th style="padding:6px 12px;text-align:center;border-bottom:1px solid #e5e7eb;">프로젝트</th>
            <th style="padding:6px 12px;text-align:right;border-bottom:1px solid #e5e7eb;">비용</th>
          </tr>
        </thead>
        <tbody>${Array.from(byUser.entries())
          .sort((a, b) => b[1].total - a[1].total)
          .map(([uid, u]) => {
            const pu = prevByUser.get(uid)
            return `
          <tr>
            <td style="padding:8px 12px;border-bottom:1px solid #e5e7eb;color:#111827;"><strong>${esc(u.name)}</strong></td>
            <td style="padding:8px 12px;border-bottom:1px solid #e5e7eb;text-align:center;color:#0891b2;font-weight:600;">${u.issueCount}${hasPrev && pu ? ` <span style="font-size:10px;">${changeIndicator(u.issueCount, pu.issueCount)}</span>` : ''}</td>
            <td style="padding:8px 12px;border-bottom:1px solid #e5e7eb;text-align:center;color:#111827;">${u.total}${hasPrev && pu ? ` <span style="font-size:10px;">${changeIndicator(u.total, pu.total)}</span>` : ''}</td>
            <td style="padding:8px 12px;border-bottom:1px solid #e5e7eb;text-align:center;color:#16a34a;font-weight:600;">${u.success}</td>
            <td style="padding:8px 12px;border-bottom:1px solid #e5e7eb;text-align:center;color:#dc2626;font-weight:600;">${u.failed}</td>
            <td style="padding:8px 12px;border-bottom:1px solid #e5e7eb;text-align:center;color:#6b7280;">${u.projectCount}</td>
            <td style="padding:8px 12px;border-bottom:1px solid #e5e7eb;text-align:right;color:#111827;">$${u.cost.toFixed(2)}${hasPrev && pu ? ` <span style="font-size:10px;">${changeIndicator(u.cost, pu.cost, true)}</span>` : ''}</td>
          </tr>`
          }).join('')}
        </tbody>
      </table>
    </div>
    ` : ''}

    ${total === 0 ? `
    <div style="background:#f9fafb;border:1px solid #e5e7eb;border-radius:12px;padding:32px;text-align:center;margin-bottom:20px;">
      <p style="color:#6b7280;font-size:14px;margin:0;">해당 기간에 실행된 작업이 없습니다.</p>
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
  byAgent: Map<string, { name: string; cli: string; total: number; success: number; failed: number; cost: number }>,
  byUser: Map<string, { name: string; total: number; success: number; failed: number; cost: number; issueCount: number; projectCount: number }>,
  prevData?: { prevTotal: number; prevSuccess: number; prevFailed: number; prevSuccessRate: number; prevTotalCost: number }
): string {
  const parts: string[] = []

  // 기본 요약
  if (prevData) {
    const totalChangeRate = calcChangeRate(total, prevData.prevTotal)
    parts.push(`이번 ${label} 기간 동안 총 <strong>${total}건</strong>의 작업이 수행되었습니다 (전 기간 대비 ${totalChangeRate}).`)
  } else {
    parts.push(`이번 ${label} 기간 동안 총 <strong>${total}건</strong>의 작업이 수행되었습니다.`)
  }

  // 성공률 평가
  if (successRate >= 90) {
    const rateNote = prevData ? ` (전 기간 ${prevData.prevSuccessRate}%)` : ''
    parts.push(`성공률 <strong>${successRate}%</strong>로 매우 안정적인 운영 상태입니다${rateNote}.`)
  } else if (successRate >= 70) {
    const rateNote = prevData ? ` (전 기간 ${prevData.prevSuccessRate}%)` : ''
    parts.push(`성공률 <strong>${successRate}%</strong>로 양호한 수준이나, 실패 작업(${failed}건)에 대한 점검이 권장됩니다${rateNote}.`)
  } else if (total > 0) {
    const rateNote = prevData ? ` (전 기간 ${prevData.prevSuccessRate}%)` : ''
    parts.push(`성공률이 <strong>${successRate}%</strong>로 낮은 편입니다. 실패 작업(${failed}건)에 대한 원인 분석이 필요합니다${rateNote}.`)
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

  // 개발자(에이전트)별 하이라이트
  const agents = Array.from(byAgent.values()).sort((a, b) => b.total - a.total)
  if (agents.length > 1) {
    const topAgent = agents[0]
    parts.push(`가장 많은 작업을 수행한 에이전트는 <strong>${esc(topAgent.name)}</strong>(${topAgent.total}건)입니다.`)
  }

  // 사용자별 하이라이트
  const users = Array.from(byUser.values()).sort((a, b) => b.total - a.total)
  if (users.length > 1) {
    const topUser = users[0]
    parts.push(`가장 많은 작업을 요청한 사용자는 <strong>${esc(topUser.name)}</strong>(${topUser.total}건)입니다.`)
  }

  // 비용 요약
  if (totalCost > 0) {
    if (prevData && prevData.prevTotalCost > 0) {
      const costChangeRate = calcChangeRate(totalCost, prevData.prevTotalCost)
      parts.push(`총 비용은 <strong>$${totalCost.toFixed(2)}</strong>이 소요되었습니다 (전 기간 $${prevData.prevTotalCost.toFixed(2)}, ${costChangeRate}).`)
    } else {
      parts.push(`총 비용은 <strong>$${totalCost.toFixed(2)}</strong>이 소요되었습니다.`)
    }
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

/** 증감 표시 (인라인 배지) - invertColor: true이면 증가가 빨간색(비용/실패 등) */
function changeIndicator(current: number, previous: number, invertColor?: boolean): string {
  const diff = current - previous
  if (diff === 0) return '<span style="color:#6b7280;">-</span>'
  const isUp = diff > 0
  const arrow = isUp ? '▲' : '▼'
  const color = invertColor ? (isUp ? '#dc2626' : '#16a34a') : (isUp ? '#16a34a' : '#dc2626')
  const rate = previous > 0 ? ((Math.abs(diff) / previous) * 100).toFixed(1) + '%' : 'NEW'
  const absDiff = Math.abs(diff)
  const diffStr = absDiff % 1 === 0 ? absDiff.toString() : absDiff.toFixed(2)
  return `<span style="color:${color};font-weight:600;">${arrow}${diffStr} (${rate})</span>`
}

/** 성공률 등 %p 단위 증감 표시 */
function changeIndicatorRate(current: number, previous: number): string {
  const diff = current - previous
  if (Math.abs(diff) < 0.05) return '<span style="color:#6b7280;">-</span>'
  const isUp = diff > 0
  const arrow = isUp ? '▲' : '▼'
  const color = isUp ? '#16a34a' : '#dc2626'
  return `<span style="color:${color};font-weight:600;">${arrow}${Math.abs(diff).toFixed(1)}%p</span>`
}

/** 증감 배지 (비교 테이블용) */
function diffBadge(diff: number, invertColor?: boolean, unit?: string): string {
  if (Math.abs(diff) < 0.005) return '<span style="color:#6b7280;">-</span>'
  const isUp = diff > 0
  const arrow = isUp ? '▲' : '▼'
  const color = invertColor ? (isUp ? '#dc2626' : '#16a34a') : (isUp ? '#16a34a' : '#dc2626')
  let valStr: string
  if (unit === '$') {
    valStr = '$' + Math.abs(diff).toFixed(2)
  } else if (unit === 'token') {
    valStr = formatTokens(Math.abs(Math.round(diff)))
  } else if (unit === 'pp') {
    valStr = Math.abs(diff).toFixed(1) + '%p'
  } else {
    valStr = Math.abs(diff) % 1 === 0 ? Math.abs(diff).toString() : Math.abs(diff).toFixed(2)
  }
  return `<span style="color:${color};font-weight:600;">${arrow} ${valStr}</span>`
}

/** 증감율 배지 (비교 테이블용) */
function changeRateBadge(current: number, previous: number, invertColor?: boolean): string {
  if (previous === 0 && current === 0) return '<span style="color:#6b7280;">-</span>'
  if (previous === 0) return `<span style="color:${invertColor ? '#dc2626' : '#16a34a'};font-weight:600;">NEW</span>`
  const rate = ((current - previous) / previous) * 100
  if (Math.abs(rate) < 0.05) return '<span style="color:#6b7280;">0.0%</span>'
  const isUp = rate > 0
  const color = invertColor ? (isUp ? '#dc2626' : '#16a34a') : (isUp ? '#16a34a' : '#dc2626')
  return `<span style="color:${color};font-weight:600;">${isUp ? '+' : ''}${rate.toFixed(1)}%</span>`
}

/** 증감율 텍스트 (총평용) */
function calcChangeRate(current: number, previous: number): string {
  if (previous === 0 && current === 0) return '변동 없음'
  if (previous === 0) return '신규'
  const rate = ((current - previous) / previous) * 100
  if (Math.abs(rate) < 0.05) return '변동 없음'
  const sign = rate > 0 ? '+' : ''
  return `${sign}${rate.toFixed(1)}%`
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

  // 전 기간 데이터 조회
  const prevPeriod = calculatePreviousPeriod(schedule.reportType, periodStart, periodEnd)
  const prevExecutions = getGlobalExecutionsInRange(prevPeriod.start, prevPeriod.end)

  const html = generateReportHtml(schedule.reportType, periodStart, periodEnd, executions, prevExecutions)

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
