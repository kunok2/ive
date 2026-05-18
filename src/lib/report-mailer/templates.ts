import { ReportType } from '@/types'
import { ReportExecution, getDailyWaitingTrend, getGlobalIssuesStartedInRange, getGlobalIssuesCompletedInRange } from '../db'
import { getHumanMonthlySalary, resolveExecutionCostBreakdown } from '../token-pricing'
import { REPORT_TYPE_LABELS, PREV_PERIOD_LABELS, calculatePreviousPeriod } from './schedule'

/** 소요시간 포매팅 */
function fmtDuration(min: number): string {
  if (min < 1) return '1분 미만'
  if (min < 60) return `${Math.round(min)}분`
  const h = Math.floor(min / 60), m = Math.round(min % 60)
  return m > 0 ? `${h}시간 ${m}분` : `${h}시간`
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

/** 총평/브리핑 텍스트 생성 */
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
  prevData?: { prevTotal: number; prevSuccess: number; prevFailed: number; prevSuccessRate: number; prevTotalCost: number },
  flowData?: { uniqueInflow: number; verifiedCount: number; currentWaiting: number; totalCostAi: number; totalCostHuman: number; dailyInflow: number; dailyCapacity: number }
): string {
  const parts: string[] = []

  // 기본 요약 — 유입/실행/마무리 단위 명확화
  if (flowData && flowData.uniqueInflow > 0) {
    const inflowStr = `유입 <strong>${flowData.uniqueInflow}건</strong>`
    const executionStr = `<strong>${total}번의 실행</strong>`
    const completedStr = `<strong>${flowData.verifiedCount}건</strong>을 마무리`
    if (prevData) {
      const totalChangeRate = calcChangeRate(total, prevData.prevTotal)
      parts.push(`이번 ${label} 기간 동안 ${inflowStr}이 들어와 ${executionStr}으로 ${completedStr}했습니다 (실행 전 기간 대비 ${totalChangeRate}).`)
    } else {
      parts.push(`이번 ${label} 기간 동안 ${inflowStr}이 들어와 ${executionStr}으로 ${completedStr}했습니다.`)
    }
    if (flowData.currentWaiting > 0) {
      const waitingNote = flowData.currentWaiting >= 5
        ? `현재 <strong style="color:#dc2626;">${flowData.currentWaiting}건</strong>이 대기 중으로 주의가 필요합니다.`
        : `현재 ${flowData.currentWaiting}건이 대기 중입니다.`
      parts.push(waitingNote)
    }
  } else {
    if (prevData) {
      const totalChangeRate = calcChangeRate(total, prevData.prevTotal)
      parts.push(`이번 ${label} 기간 동안 총 <strong>${total}건</strong>의 작업이 수행되었습니다 (전 기간 대비 ${totalChangeRate}).`)
    } else {
      parts.push(`이번 ${label} 기간 동안 총 <strong>${total}건</strong>의 작업이 수행되었습니다.`)
    }
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

  // 에이전트 하이라이트
  const agents = Array.from(byAgent.values()).sort((a, b) => b.total - a.total)
  if (agents.length > 1) {
    parts.push(`가장 많은 작업을 수행한 에이전트는 <strong>${esc(agents[0].name)}</strong>(${agents[0].total}건)입니다.`)
  }

  // 사용자 하이라이트
  const users = Array.from(byUser.values()).sort((a, b) => b.total - a.total)
  if (users.length > 1) {
    parts.push(`가장 많은 작업을 요청한 사용자는 <strong>${esc(users[0].name)}</strong>(${users[0].total}건)입니다.`)
  }

  // 비용 요약 — AI/사람 분리 강조
  if (totalCost > 0) {
    if (flowData && flowData.totalCostHuman > 0) {
      const aiStr = `AI $${flowData.totalCostAi.toFixed(2)}`
      const humanStr = `사람 $${flowData.totalCostHuman.toFixed(2)}`
      if (prevData && prevData.prevTotalCost > 0) {
        const costChangeRate = calcChangeRate(totalCost, prevData.prevTotalCost)
        parts.push(`총 비용은 <strong>$${totalCost.toFixed(2)}</strong> (${aiStr} + ${humanStr})이 소요되었습니다 (전 기간 $${prevData.prevTotalCost.toFixed(2)}, ${costChangeRate}).`)
      } else {
        parts.push(`총 비용은 <strong>$${totalCost.toFixed(2)}</strong> (${aiStr} + ${humanStr})이 소요되었습니다.`)
      }
    } else {
      if (prevData && prevData.prevTotalCost > 0) {
        const costChangeRate = calcChangeRate(totalCost, prevData.prevTotalCost)
        parts.push(`총 비용은 <strong>$${totalCost.toFixed(2)}</strong>이 소요되었습니다 (전 기간 $${prevData.prevTotalCost.toFixed(2)}, ${costChangeRate}).`)
      } else {
        parts.push(`총 비용은 <strong>$${totalCost.toFixed(2)}</strong>이 소요되었습니다.`)
      }
    }
  }

  // 진행중 작업
  if (running > 0) {
    parts.push(`현재 진행 중인 작업이 ${running}건 있습니다.`)
  }

  return parts.join(' ')
}

/** 보고서 HTML 생성 */
export function generateReportHtml(reportType: ReportType, periodStart: string, periodEnd: string, executions: ReportExecution[], prevExecutions?: ReportExecution[]): string {
  const label = REPORT_TYPE_LABELS[reportType]
  const prevLabel = PREV_PERIOD_LABELS[reportType]
  const periodEndDisplay = new Date(new Date(periodEnd).getTime() - 86400000).toISOString().slice(0, 10)
  const humanSalary = getHumanMonthlySalary()

  // 기간 일수 계산
  const periodDays = Math.max(1, Math.round(
    (new Date(periodEnd).getTime() - new Date(periodStart).getTime()) / 86400000
  ))

  // ─── 기본 통계 집계 ───
  const total = executions.length
  const success = executions.filter(e => e.status === 'success').length
  const failed = executions.filter(e => e.status === 'failed').length
  const running = executions.filter(e => e.status === 'running' || e.status === 'assigned').length
  const totalTokens = executions.reduce((s, e) => s + e.inputTokens + e.outputTokens, 0)
  const totalCacheReadTokens = executions.reduce((s, e) => s + (e.cacheReadInputTokens ?? 0), 0)

  // ─── AI/사람 비용 분리 ───
  let totalCostAi = 0, totalCostHuman = 0
  for (const e of executions) {
    const bd = resolveExecutionCostBreakdown(e, humanSalary)
    totalCostAi += bd.ai
    totalCostHuman += bd.human
  }
  const totalCost = totalCostAi + totalCostHuman
  const costPerTask = total > 0 ? totalCost / total : 0

  // 사람 총 작업시간 (user 타입 exec 합산)
  const totalHumanMin = executions.filter(e => e.assigneeType === 'user')
    .reduce((s, e) => {
      const effEnd = e.endedAt || e.startedAt
      return s + Math.max(0, (new Date(effEnd).getTime() - new Date(e.startedAt).getTime()) / 60000)
    }, 0)

  // ─── 유입/유출 흐름 계산 ───
  // 유입: 이슈가 처음 시작된 시각이 기간 내인 이슈 (이슈 단위 1회).
  //   주 경계: W1 시작 → W2 retry된 이슈는 W1 유입에만 잡힘.
  // 유출: 이슈가 done 에 도달한 시각(=COALESCE(confirmed_at, max(verified_at)))이 기간 내인 이슈.
  //   검증/확인은 중간 단계, rejected 는 완료 아님.
  //   주 경계: W1 시작 → W2 완료된 이슈는 W2 유출에만 잡힘.
  const uniqueInflow = getGlobalIssuesStartedInRange(periodStart, periodEnd).size
  const verifiedCount = getGlobalIssuesCompletedInRange(periodStart, periodEnd).size
  const dailyInflow = uniqueInflow / periodDays
  const dailyCapacity = total / periodDays

  // 대기 현황 (waitingTrend 마지막 값) — 메일 보고서는 글로벌(getGlobalExecutionsInRange와 동일 스코프)
  const waitingTrendData = getDailyWaitingTrend(null, periodStart, periodEnd)
  const latestWaitingDay = waitingTrendData.daily.length > 0
    ? waitingTrendData.daily[waitingTrendData.daily.length - 1]
    : null
  const currentWaiting = latestWaitingDay?.total ?? 0

  // ─── 소요 시간 파이프라인 ───
  // 대기 시간: issueCreatedAt → startedAt (첫 번째 시도만)
  const waitTimes: number[] = []
  const procTimes: number[] = []
  const verifyTimes: number[] = []

  // 이슈별 첫 번째 실행만 대기시간 계산
  const firstExecByIssue = new Map<string, ReportExecution>()
  for (const e of executions) {
    const key = `${e.projectId}:${e.issueIid}`
    const existing = firstExecByIssue.get(key)
    if (!existing || e.startedAt < existing.startedAt) {
      firstExecByIssue.set(key, e)
    }
  }
  for (const e of firstExecByIssue.values()) {
    if (e.issueCreatedAt) {
      const w = (new Date(e.startedAt).getTime() - new Date(e.issueCreatedAt).getTime()) / 60000
      if (w >= 0 && w < 43200) waitTimes.push(w) // 최대 30일
    }
  }

  // 처리 시간: startedAt → endedAt
  for (const e of executions) {
    if (e.assigneeType !== 'user') {
      const effEnd = e.endedAt || e.startedAt
      const p = (new Date(effEnd).getTime() - new Date(e.startedAt).getTime()) / 60000
      if (p >= 0 && p < 1440) procTimes.push(p) // 최대 24시간
    }
  }

  // 검증 시간: verifyStartedAt → verifiedAt or rejectedAt
  for (const e of executions) {
    const finishedAt = e.verifiedAt || e.rejectedAt
    if (e.verifyStartedAt && finishedAt) {
      const v = (new Date(finishedAt).getTime() - new Date(e.verifyStartedAt).getTime()) / 60000
      if (v >= 0 && v < 10080) verifyTimes.push(v) // 최대 7일
    }
  }

  // 확인 시간: confirmStartedAt → confirmedAt
  const confirmTimes: number[] = []
  for (const e of executions) {
    if (e.confirmStartedAt && e.confirmedAt) {
      const c = (new Date(e.confirmedAt).getTime() - new Date(e.confirmStartedAt).getTime()) / 60000
      if (c >= 0 && c < 10080) confirmTimes.push(c) // 최대 7일
    }
  }

  const avg = (arr: number[]) => arr.length > 0 ? arr.reduce((s, v) => s + v, 0) / arr.length : 0
  const waitAvg = avg(waitTimes)
  const procAvg = avg(procTimes)
  const verifyAvg = avg(verifyTimes)
  const confirmAvg = avg(confirmTimes)
  const totalAvg = waitAvg + procAvg + verifyAvg + confirmAvg

  // ─── 전 기간 통계 집계 ───
  const prev = prevExecutions || []
  const prevTotal = prev.length
  const prevSuccess = prev.filter(e => e.status === 'success').length
  const prevFailed = prev.filter(e => e.status === 'failed').length
  const prevTotalTokens = prev.reduce((s, e) => s + e.inputTokens + e.outputTokens, 0)
  let prevTotalCost = 0
  for (const e of prev) {
    const bd = resolveExecutionCostBreakdown(e, humanSalary)
    prevTotalCost += bd.ai + bd.human
  }
  const prevCostPerTask = prevTotal > 0 ? prevTotalCost / prevTotal : 0
  const hasPrev = prevExecutions !== undefined

  // 전 기간 처리 시간
  const prevProcTimes: number[] = []
  for (const e of prev) {
    if (e.assigneeType !== 'user') {
      const effEnd = e.endedAt || e.startedAt
      const p = (new Date(effEnd).getTime() - new Date(e.startedAt).getTime()) / 60000
      if (p >= 0 && p < 1440) prevProcTimes.push(p)
    }
  }
  const prevProcAvg = avg(prevProcTimes)

  // 전 기간 유입/유출 계산 — 현재 기간과 동일 정의 (이슈 단위, 시작/완료 시각 기준).
  const prevPeriod = calculatePreviousPeriod(reportType, periodStart, periodEnd)
  const prevUniqueInflow = hasPrev
    ? getGlobalIssuesStartedInRange(prevPeriod.start, prevPeriod.end).size
    : 0
  const prevVerifiedCount = hasPrev
    ? getGlobalIssuesCompletedInRange(prevPeriod.start, prevPeriod.end).size
    : 0
  const prevCurrentWaiting = 0

  // ─── 프로젝트별 집계 ───
  const byProject = new Map<string, { name: string; color: string; total: number; success: number; failed: number; cost: number; tokens: number; uniqueIssues: number }>()
  for (const e of executions) {
    const p = byProject.get(e.projectId) || { name: e.projectName, color: e.projectColor, total: 0, success: 0, failed: 0, cost: 0, tokens: 0, uniqueIssues: 0 }
    p.total++
    if (e.status === 'success') p.success++
    if (e.status === 'failed') p.failed++
    const bd = resolveExecutionCostBreakdown(e, humanSalary)
    p.cost += bd.ai + bd.human
    p.tokens += e.inputTokens + e.outputTokens
    byProject.set(e.projectId, p)
  }
  // 고유 이슈 수 계산
  for (const [pid] of byProject) {
    const pExecs = executions.filter(e => e.projectId === pid)
    byProject.get(pid)!.uniqueIssues = new Set(pExecs.map(e => e.issueIid)).size
  }

  // 전 기간 프로젝트별 집계
  const prevByProject = new Map<string, { total: number; success: number; failed: number; cost: number }>()
  for (const e of prev) {
    const p = prevByProject.get(e.projectId) || { total: 0, success: 0, failed: 0, cost: 0 }
    p.total++
    if (e.status === 'success') p.success++
    if (e.status === 'failed') p.failed++
    const bd = resolveExecutionCostBreakdown(e, humanSalary)
    p.cost += bd.ai + bd.human
    prevByProject.set(e.projectId, p)
  }

  // ─── 에이전트별 집계 ───
  const byAgent = new Map<string, { name: string; cli: string; total: number; success: number; failed: number; cost: number; avgDurationMin: number; _durAcc: number; _durCnt: number }>()
  for (const e of executions) {
    if (!e.agentId || e.assigneeType === 'user') continue
    const a = byAgent.get(e.agentId) || { name: e.agentName, cli: e.cliName, total: 0, success: 0, failed: 0, cost: 0, avgDurationMin: 0, _durAcc: 0, _durCnt: 0 }
    a.total++
    if (e.status === 'success') a.success++
    if (e.status === 'failed') a.failed++
    const bd = resolveExecutionCostBreakdown(e, humanSalary)
    a.cost += bd.ai + bd.human
    const effEnd = e.endedAt || e.startedAt
    const dur = (new Date(effEnd).getTime() - new Date(e.startedAt).getTime()) / 60000
    if (dur >= 0) { a._durAcc += dur; a._durCnt++ }
    byAgent.set(e.agentId, a)
  }
  for (const a of byAgent.values()) {
    a.avgDurationMin = a._durCnt > 0 ? a._durAcc / a._durCnt : 0
  }

  // 전 기간 에이전트별 집계
  const prevByAgent = new Map<string, { total: number; success: number; failed: number; cost: number }>()
  for (const e of prev) {
    if (!e.agentId || e.assigneeType === 'user') continue
    const a = prevByAgent.get(e.agentId) || { total: 0, success: 0, failed: 0, cost: 0 }
    a.total++
    if (e.status === 'success') a.success++
    if (e.status === 'failed') a.failed++
    const bd = resolveExecutionCostBreakdown(e, humanSalary)
    a.cost += bd.ai + bd.human
    prevByAgent.set(e.agentId, a)
  }

  // ─── 검증자별 집계 ───
  const byVerifier = new Map<string, { username: string; name: string; approved: number; rejected: number; avgVerifyMin: number; _verifyMinAcc: number; _verifyMinCnt: number }>()
  for (const e of executions) {
    if (!e.verifierUsername) continue
    const v = byVerifier.get(e.verifierUsername) || {
      username: e.verifierUsername,
      name: e.verifierName || e.verifierUsername,
      approved: 0,
      rejected: 0,
      avgVerifyMin: 0,
      _verifyMinAcc: 0,
      _verifyMinCnt: 0,
    }
    if (e.verifiedAt) v.approved++
    if (e.rejectedAt && !e.verifiedAt) v.rejected++
    if (e.verifiedAt && e.verifyStartedAt) {
      const mins = (new Date(e.verifiedAt).getTime() - new Date(e.verifyStartedAt).getTime()) / 60000
      if (mins >= 0) { v._verifyMinAcc += mins; v._verifyMinCnt++ }
    }
    byVerifier.set(e.verifierUsername, v)
  }
  for (const v of byVerifier.values()) {
    v.avgVerifyMin = v._verifyMinCnt > 0 ? v._verifyMinAcc / v._verifyMinCnt : 0
  }

  // ─── 담당자별 집계 ─── (이메일 보고서의 "사용자별 현황" 섹션)
  // 사람이 직접 처리한 작업(assigneeType='user')만 집계.
  // 에이전트가 처리한 작업은 위쪽 byAgent에서 별도로 집계됨 — 여기서 합치지 않는다.
  // userName을 정규화 키로 사용해, 같은 사람이 userId 형식 차이로 중복 표시되는 문제를 방지.
  const userKey = (e: typeof executions[number]) => (e.userName || e.userId || '').trim()

  const byUser = new Map<string, { name: string; total: number; success: number; failed: number; cost: number; issueCount: number; projectCount: number }>()
  for (const e of executions) {
    if (e.assigneeType !== 'user') continue
    const uid = userKey(e)
    if (!uid) continue
    const u = byUser.get(uid) || { name: e.userName || uid, total: 0, success: 0, failed: 0, cost: 0, issueCount: 0, projectCount: 0 }
    u.total++
    if (e.status === 'success') u.success++
    if (e.status === 'failed') u.failed++
    const bd = resolveExecutionCostBreakdown(e, humanSalary)
    u.cost += bd.ai + bd.human
    byUser.set(uid, u)
  }
  for (const [uid] of byUser) {
    const userExecs = executions.filter(e => e.assigneeType === 'user' && userKey(e) === uid)
    byUser.get(uid)!.issueCount = new Set(userExecs.map(e => `${e.projectId}:${e.issueIid}`)).size
    byUser.get(uid)!.projectCount = new Set(userExecs.map(e => e.projectId)).size
  }

  const prevByUser = new Map<string, { total: number; cost: number; issueCount: number }>()
  for (const e of prev) {
    if (e.assigneeType !== 'user') continue
    const uid = userKey(e)
    if (!uid) continue
    const u = prevByUser.get(uid) || { total: 0, cost: 0, issueCount: 0 }
    u.total++
    const bd = resolveExecutionCostBreakdown(e, humanSalary)
    u.cost += bd.ai + bd.human
    prevByUser.set(uid, u)
  }
  for (const [uid] of prevByUser) {
    const userExecs = prev.filter(e => e.assigneeType === 'user' && userKey(e) === uid)
    prevByUser.get(uid)!.issueCount = new Set(userExecs.map(e => `${e.projectId}:${e.issueIid}`)).size
  }

  // ─── 최종 지표 계산 ───
  const successRate = total > 0 ? ((success / total) * 100).toFixed(1) : '0.0'
  const prevSuccessRate = prevTotal > 0 ? ((prevSuccess / prevTotal) * 100).toFixed(1) : '0.0'

  // 총평 생성
  const summary = generateSummary(
    label, total, success, failed, running, parseFloat(successRate), totalCost,
    byProject, byAgent, byUser,
    hasPrev ? { prevTotal, prevSuccess, prevFailed, prevSuccessRate: parseFloat(prevSuccessRate), prevTotalCost } : undefined,
    { uniqueInflow, verifiedCount, currentWaiting, totalCostAi, totalCostHuman, dailyInflow, dailyCapacity }
  )

  // 프로젝트 이름 목록 (헤더 표시용)
  const projectNames = Array.from(byProject.values()).map(p => p.name).filter(Boolean)

  // ─── 처리된 작업 목록 (상위 10건, 비용 순) ───
  const resolvedIssueMap = new Map<string, { issueIid: number; issueTitle: string; projectName: string; projectColor: string; agentName: string; cost: number; durationMin: number; status: string }>()
  for (const e of executions.filter(e => e.status === 'success' || e.status === 'failed')) {
    const key = `${e.projectId}:${e.issueIid}`
    const existing = resolvedIssueMap.get(key)
    const dur = e.endedAt ? (new Date(e.endedAt).getTime() - new Date(e.startedAt).getTime()) / 60000 : 0
    const bd = resolveExecutionCostBreakdown(e, humanSalary)
    const c = bd.ai + bd.human
    if (!existing || c > existing.cost) {
      resolvedIssueMap.set(key, { issueIid: e.issueIid, issueTitle: e.issueTitle || `#${e.issueIid}`, projectName: e.projectName, projectColor: e.projectColor, agentName: e.agentName, cost: c, durationMin: dur, status: e.status })
    }
  }
  const topIssues = Array.from(resolvedIssueMap.values()).sort((a, b) => b.cost - a.cost).slice(0, 10)

  // ─── 대기 건수 추이 (재사용) ───
  const waitingTrend = waitingTrendData
  const prevWaitingData = prevExecutions ? getDailyWaitingTrend(
    null,
    prevPeriod.start,
    prevPeriod.end
  ) : null

  // 전 기간 대기수 계산 (HTML 섹션에서 사용)
  const prevCurrentWaitingCalc = prevWaitingData && prevWaitingData.daily && prevWaitingData.daily.length > 0 ? prevWaitingData.daily[prevWaitingData.daily.length - 1]?.total ?? 0 : 0

  // ─── HTML 조립 ───
  return `
<!DOCTYPE html>
<html>
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>
<body style="margin:0;padding:0;background:#f3f4f6;color:#111827;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;">
  <div style="max-width:620px;margin:0 auto;padding:20px 16px;">

    <!-- ① 헤더 -->
    <div style="background:#111827;border-radius:12px;padding:24px;margin-bottom:16px;text-align:center;">
      <div style="font-size:11px;color:#4ade80;font-weight:700;letter-spacing:0.1em;text-transform:uppercase;margin-bottom:6px;">Springware IVE</div>
      <div style="font-size:20px;font-weight:800;color:#ffffff;margin-bottom:4px;">${label} 보고서</div>
      ${projectNames.length > 0 ? `<div style="font-size:12px;color:#9ca3af;margin-bottom:2px;">${projectNames.map(n => esc(n)).join(' · ')}</div>` : ''}
      <div style="font-size:12px;color:#6b7280;">${periodStart} ~ ${periodEndDisplay}</div>
    </div>

    <!-- ② 브리핑 -->
    ${total > 0 ? `
    <div style="background:#f0fdf4;border:1px solid #bbf7d0;border-radius:12px;padding:16px;margin-bottom:16px;">
      <div style="font-size:11px;color:#16a34a;font-weight:700;margin-bottom:8px;">📋 브리핑</div>
      <div style="font-size:13px;color:#166534;line-height:1.7;">${summary}</div>
    </div>
    ` : ''}

    <!-- ③ 흐름 현황 -->
    <div style="background:#ffffff;border:1px solid #e5e7eb;border-radius:12px;padding:20px;margin-bottom:16px;">
      <div style="font-size:12px;font-weight:700;color:#374151;margin-bottom:16px;">흐름 현황</div>
      <!-- 유입 → 대기 → 마무리 -->
      <table width="100%" cellpadding="0" cellspacing="0" style="margin-bottom:16px;">
        <tr>
          <td style="text-align:center;padding:4px;">
            <div style="font-size:11px;color:#6b7280;margin-bottom:4px;">유입</div>
            <div style="font-size:28px;font-weight:800;color:#111827;">${uniqueInflow}</div>
            <div style="font-size:10px;color:#9ca3af;margin-top:2px;">일평균 ${dailyInflow.toFixed(1)}건</div>
          </td>
          <td style="text-align:center;color:#9ca3af;font-size:16px;padding:0 4px;">→</td>
          <td style="text-align:center;padding:4px;">
            <div style="font-size:11px;color:#6b7280;margin-bottom:4px;">대기</div>
            <div style="font-size:28px;font-weight:800;color:${currentWaiting >= 8 ? '#dc2626' : currentWaiting >= 4 ? '#d97706' : '#111827'};">${currentWaiting}</div>
            <div style="font-size:10px;color:#9ca3af;margin-top:2px;">현재 대기중</div>
          </td>
          <td style="text-align:center;color:#9ca3af;font-size:16px;padding:0 4px;">→</td>
          <td style="text-align:center;padding:4px;">
            <div style="font-size:11px;color:#6b7280;margin-bottom:4px;">마무리</div>
            <div style="font-size:28px;font-weight:800;color:#111827;">${verifiedCount}</div>
            <div style="font-size:10px;color:#9ca3af;margin-top:2px;">일평균 ${(verifiedCount / periodDays).toFixed(1)}건 · 실행 ${total}회</div>
          </td>
        </tr>
      </table>
      <!-- 작업/검증 -->
      <div style="background:#f9fafb;border-radius:8px;padding:12px;margin-bottom:12px;">
        <table width="100%" cellpadding="0" cellspacing="0">
          <tr>
            <td style="text-align:center;padding:4px 8px;">
              <div style="font-size:20px;font-weight:800;color:#16a34a;">${uniqueInflow}</div>
              <div style="font-size:10px;color:#6b7280;">유입</div>
              ${hasPrev ? `<div style="font-size:10px;margin-top:2px;">${changeIndicator(uniqueInflow, prevUniqueInflow)}</div>` : ''}
            </td>
            <td style="text-align:center;padding:4px 8px;">
              <div style="font-size:20px;font-weight:800;color:#0891b2;">${verifiedCount}</div>
              <div style="font-size:10px;color:#6b7280;">검증완료</div>
              ${hasPrev ? `<div style="font-size:10px;margin-top:2px;">${changeIndicator(verifiedCount, prevVerifiedCount)}</div>` : ''}
            </td>
            <td style="text-align:center;padding:4px 8px;">
              <div style="font-size:20px;font-weight:800;color:${currentWaiting > 0 ? '#d97706' : '#6b7280'};">${currentWaiting}</div>
              <div style="font-size:10px;color:#6b7280;">대기중</div>
              ${hasPrev ? `<div style="font-size:10px;margin-top:2px;">${changeIndicator(currentWaiting, prevCurrentWaitingCalc, true)}</div>` : ''}
            </td>
            <td style="text-align:center;padding:4px 8px;">
              <div style="font-size:20px;font-weight:800;color:#d97706;">${formatTokens(totalTokens)}</div>
              <div style="font-size:10px;color:#6b7280;">토큰${totalCacheReadTokens > 0 && totalTokens > 0 ? ` (${Math.round(totalCacheReadTokens / totalTokens * 100)}%)` : ''}</div>
              ${hasPrev ? `<div style="font-size:10px;margin-top:2px;">${changeIndicator(totalTokens, prevTotalTokens)}</div>` : ''}
            </td>
          </tr>
        </table>
      </div>
      <!-- 비용 분리 -->
      <div style="background:#111827;border-radius:8px;padding:12px;">
        <table width="100%" cellpadding="0" cellspacing="0">
          <tr>
            <td style="text-align:center;padding:4px 8px;">
              <div style="font-size:16px;font-weight:800;color:#ffffff;">$${totalCost.toFixed(2)}</div>
              <div style="font-size:10px;color:#9ca3af;">총 비용</div>
              ${hasPrev ? `<div style="font-size:10px;margin-top:2px;">${changeIndicator(totalCost, prevTotalCost, true)}</div>` : ''}
            </td>
            <td style="text-align:center;padding:4px 8px;">
              <div style="font-size:14px;font-weight:700;color:#4ade80;">$${totalCostAi.toFixed(2)}</div>
              <div style="font-size:10px;color:#6b7280;">AI 토큰</div>
            </td>
            ${totalCostHuman > 0 ? `
            <td style="text-align:center;padding:4px 8px;">
              <div style="font-size:14px;font-weight:700;color:#93c5fd;">$${totalCostHuman.toFixed(2)}</div>
              <div style="font-size:10px;color:#6b7280;">사람 시간${totalHumanMin > 0 ? ` (${fmtDuration(totalHumanMin)})` : ''}</div>
            </td>` : ''}
            <td style="text-align:center;padding:4px 8px;">
              <div style="font-size:14px;font-weight:700;color:#f59e0b;">$${costPerTask.toFixed(2)}</div>
              <div style="font-size:10px;color:#6b7280;">건당 비용${hasPrev && prevCostPerTask > 0 ? ` ${changeIndicator(costPerTask, prevCostPerTask, true)}` : ''}</div>
            </td>
          </tr>
        </table>
      </div>
    </div>

    <!-- ④ 소요 시간 파이프라인 -->
    ${procAvg > 0 || confirmAvg > 0 ? `
    <div style="background:#ffffff;border:1px solid #e5e7eb;border-radius:12px;padding:20px;margin-bottom:16px;">
      <div style="font-size:12px;font-weight:700;color:#374151;margin-bottom:12px;">소요 시간 파이프라인</div>
      ${totalAvg > 0 ? `<div style="font-size:13px;color:#111827;margin-bottom:12px;">평균 해결 시간 <strong>${fmtDuration(totalAvg)}</strong>${hasPrev && prevProcAvg > 0 ? ` <span style="font-size:11px;">${changeIndicator(procAvg, prevProcAvg, true)}</span>` : ''}</div>` : ''}
      <table width="100%" cellpadding="0" cellspacing="0" style="margin-bottom:12px;">
        <tr>
          ${waitAvg > 0 ? `
          <td style="text-align:center;padding:4px 8px;">
            <div style="font-size:10px;color:#6b7280;margin-bottom:2px;">대기</div>
            <div style="font-size:15px;font-weight:700;color:#111827;">${fmtDuration(waitAvg)}</div>
          </td>
          <td style="text-align:center;color:#9ca3af;font-size:12px;">→</td>
          ` : ''}
          <td style="text-align:center;padding:4px 8px;">
            <div style="font-size:10px;color:#6b7280;margin-bottom:2px;">처리</div>
            <div style="font-size:15px;font-weight:700;color:#111827;">${fmtDuration(procAvg)}</div>
          </td>
          ${verifyAvg > 0 ? `
          <td style="text-align:center;color:#9ca3af;font-size:12px;">→</td>
          <td style="text-align:center;padding:4px 8px;">
            <div style="font-size:10px;color:#6b7280;margin-bottom:2px;">검증</div>
            <div style="font-size:15px;font-weight:700;color:#111827;">${fmtDuration(verifyAvg)}</div>
          </td>` : ''}
          ${confirmAvg > 0 ? `
          <td style="text-align:center;color:#9ca3af;font-size:12px;">→</td>
          <td style="text-align:center;padding:4px 8px;">
            <div style="font-size:10px;color:#6b7280;margin-bottom:2px;">확인</div>
            <div style="font-size:15px;font-weight:700;color:#111827;">${fmtDuration(confirmAvg)}</div>
          </td>` : ''}
        </tr>
      </table>
      ${totalAvg > 0 ? (() => {
        const waitPct = Math.round((waitAvg / totalAvg) * 100)
        const procPct = Math.round((procAvg / totalAvg) * 100)
        const verifyPct = verifyAvg > 0 ? Math.round((verifyAvg / totalAvg) * 100) : 0
        const confirmPct = confirmAvg > 0 ? Math.round((confirmAvg / totalAvg) * 100) : 0
        return `
      <div style="height:8px;border-radius:4px;overflow:hidden;background:#f3f4f6;display:flex;">
        ${waitPct > 0 ? `<div style="width:${waitPct}%;background:#d1fae5;"></div>` : ''}
        <div style="width:${procPct}%;background:#4ade80;"></div>
        ${verifyPct > 0 ? `<div style="width:${verifyPct}%;background:#16a34a;"></div>` : ''}
        ${confirmPct > 0 ? `<div style="width:${confirmPct}%;background:#6366f1;"></div>` : ''}
      </div>
      <div style="display:flex;margin-top:4px;font-size:10px;color:#6b7280;gap:12px;">
        ${waitPct > 0 ? `<span>대기 ${waitPct}%</span>` : ''}
        <span>처리 ${procPct}%</span>
        ${verifyPct > 0 ? `<span>검증 ${verifyPct}%</span>` : ''}
        ${confirmPct > 0 ? `<span>확인 ${confirmPct}%</span>` : ''}
      </div>`
      })() : ''}
    </div>
    ` : ''}

    <!-- ⑤ 전 기간 비교 -->
    ${hasPrev ? `
    <div style="background:#ffffff;border:1px solid #e5e7eb;border-radius:12px;padding:16px;margin-bottom:16px;">
      <div style="font-size:12px;font-weight:700;color:#374151;margin-bottom:12px;">📊 ${prevLabel} 대비 비교</div>
      <table width="100%" cellpadding="0" cellspacing="0" style="font-size:12px;">
        <thead>
          <tr style="color:#9ca3af;font-size:10px;border-bottom:1px solid #f3f4f6;">
            <th style="padding:6px 8px;text-align:left;font-weight:600;">항목</th>
            <th style="padding:6px 8px;text-align:center;font-weight:600;">${prevLabel}</th>
            <th style="padding:6px 8px;text-align:center;font-weight:600;">이번 ${label}</th>
            <th style="padding:6px 8px;text-align:center;font-weight:600;">증감</th>
            <th style="padding:6px 8px;text-align:center;font-weight:600;">증감율</th>
          </tr>
        </thead>
        <tbody>
          <tr style="border-bottom:1px solid #f9fafb;">
            <td style="padding:7px 8px;color:#374151;font-weight:600;">작업수</td>
            <td style="padding:7px 8px;text-align:center;color:#9ca3af;">${prevTotal}</td>
            <td style="padding:7px 8px;text-align:center;color:#111827;font-weight:700;">${total}</td>
            <td style="padding:7px 8px;text-align:center;">${diffBadge(total - prevTotal)}</td>
            <td style="padding:7px 8px;text-align:center;">${changeRateBadge(total, prevTotal)}</td>
          </tr>
          <tr style="border-bottom:1px solid #f9fafb;">
            <td style="padding:7px 8px;color:#374151;font-weight:600;">성공률</td>
            <td style="padding:7px 8px;text-align:center;color:#9ca3af;">${prevSuccessRate}%</td>
            <td style="padding:7px 8px;text-align:center;color:#16a34a;font-weight:700;">${successRate}%</td>
            <td style="padding:7px 8px;text-align:center;">${diffBadge(parseFloat(successRate) - parseFloat(prevSuccessRate), false, 'pp')}</td>
            <td style="padding:7px 8px;text-align:center;color:#9ca3af;">-</td>
          </tr>
          <tr style="border-bottom:1px solid #f9fafb;">
            <td style="padding:7px 8px;color:#374151;font-weight:600;">총 비용</td>
            <td style="padding:7px 8px;text-align:center;color:#9ca3af;">$${prevTotalCost.toFixed(2)}</td>
            <td style="padding:7px 8px;text-align:center;color:#ea580c;font-weight:700;">$${totalCost.toFixed(2)}</td>
            <td style="padding:7px 8px;text-align:center;">${diffBadge(totalCost - prevTotalCost, true, '$')}</td>
            <td style="padding:7px 8px;text-align:center;">${changeRateBadge(totalCost, prevTotalCost, true)}</td>
          </tr>
          <tr style="border-bottom:1px solid #f9fafb;">
            <td style="padding:7px 8px;color:#374151;font-weight:600;">건당 비용</td>
            <td style="padding:7px 8px;text-align:center;color:#9ca3af;">$${prevCostPerTask.toFixed(2)}</td>
            <td style="padding:7px 8px;text-align:center;color:#f59e0b;font-weight:700;">$${costPerTask.toFixed(2)}</td>
            <td style="padding:7px 8px;text-align:center;">${diffBadge(costPerTask - prevCostPerTask, true, '$')}</td>
            <td style="padding:7px 8px;text-align:center;">${changeRateBadge(costPerTask, prevCostPerTask, true)}</td>
          </tr>
          ${hasPrev && prevProcAvg > 0 && procAvg > 0 ? `
          <tr>
            <td style="padding:7px 8px;color:#374151;font-weight:600;">처리 시간</td>
            <td style="padding:7px 8px;text-align:center;color:#9ca3af;">${fmtDuration(prevProcAvg)}</td>
            <td style="padding:7px 8px;text-align:center;color:#111827;font-weight:700;">${fmtDuration(procAvg)}</td>
            <td style="padding:7px 8px;text-align:center;">${changeIndicator(procAvg, prevProcAvg, true)}</td>
            <td style="padding:7px 8px;text-align:center;">${changeRateBadge(procAvg, prevProcAvg, true)}</td>
          </tr>` : ''}
        </tbody>
      </table>
    </div>
    ` : ''}

    <!-- ⑥ 대기 건수 추이 -->
    ${(() => {
      const hasWaitingData = waitingTrend.daily.some(d => d.total > 0)
      if (!hasWaitingData) return ''

      const avgTotal = waitingTrend.daily.length > 0 ? Math.round(waitingTrend.daily.reduce((s, d) => s + d.total, 0) / waitingTrend.daily.length * 10) / 10 : 0
      const prevAvgTotal = prevWaitingData && prevWaitingData.daily.length > 0 ? Math.round(prevWaitingData.daily.reduce((s, d) => s + d.total, 0) / prevWaitingData.daily.length * 10) / 10 : 0

      const allProjects = new Map<string, { name: string; color: string }>()
      for (const d of waitingTrend.daily) {
        for (const p of d.byProject) {
          if (!allProjects.has(p.projectId)) allProjects.set(p.projectId, { name: p.projectName, color: p.projectColor })
        }
      }
      const projectList = Array.from(allProjects.entries())
      const projHeaders = projectList.map(([, info]) =>
        `<th style="padding:5px 6px;text-align:center;font-size:10px;color:#6b7280;font-weight:600;"><span style="display:inline-block;width:5px;height:5px;border-radius:50%;background:${info.color};margin-right:2px;vertical-align:middle;"></span>${esc(info.name)}</th>`
      ).join('')
      const waitingRows = waitingTrend.daily.map(d => {
        const projCells = projectList.map(([pid, info]) => {
          const found = d.byProject.find(p => p.projectId === pid)
          const val = found?.waiting ?? 0
          return `<td style="padding:5px 6px;border-top:1px solid #f3f4f6;text-align:center;color:${val > 0 ? info.color : '#9ca3af'};font-weight:${val > 0 ? '700' : '400'};font-size:12px;">${val}</td>`
        }).join('')
        return `<tr>
          <td style="padding:5px 6px;border-top:1px solid #f3f4f6;color:#6b7280;font-size:11px;">${d.date.slice(5)}</td>
          <td style="padding:5px 6px;border-top:1px solid #f3f4f6;text-align:center;font-weight:700;font-size:12px;color:${d.total >= 5 ? '#dc2626' : d.total >= 3 ? '#d97706' : '#111827'};">${d.total}</td>
          ${projCells}
        </tr>`
      }).join('')

      return `
    <div style="background:#fffbeb;border:1px solid #fbbf24;border-radius:12px;padding:16px;margin-bottom:16px;">
      <div style="font-size:12px;font-weight:700;color:#92400e;margin-bottom:8px;">⏳ 대기 건수 추이</div>
      <table cellpadding="0" cellspacing="0" style="font-size:12px;margin-bottom:10px;">
        <tr>
          <td style="padding:2px 10px 2px 0;color:#92400e;font-weight:600;font-size:11px;">현재 대기</td>
          <td style="color:#111827;font-weight:800;font-size:16px;">${currentWaiting}건</td>
        </tr>
        <tr>
          <td style="padding:2px 10px 2px 0;color:#92400e;font-weight:600;font-size:11px;">기간 평균</td>
          <td style="color:#111827;font-weight:700;font-size:13px;">${avgTotal}건 ${hasPrev && prevAvgTotal > 0 ? changeIndicator(avgTotal, prevAvgTotal, true) : ''}</td>
        </tr>
      </table>
      <div style="overflow-x:auto;">
        <table width="100%" cellpadding="0" cellspacing="0" style="font-size:12px;color:#111827;min-width:300px;">
          <thead>
            <tr style="background:#fef3c7;">
              <th style="padding:5px 6px;text-align:left;font-size:10px;color:#6b7280;font-weight:600;">날짜</th>
              <th style="padding:5px 6px;text-align:center;font-size:10px;color:#6b7280;font-weight:600;">전체</th>
              ${projHeaders}
            </tr>
          </thead>
          <tbody>${waitingRows}</tbody>
        </table>
      </div>
    </div>`
    })()}

    <!-- ⑦ 프로젝트별 현황 -->
    ${byProject.size > 0 ? `
    <div style="background:#ffffff;border:1px solid #e5e7eb;border-radius:12px;padding:16px;margin-bottom:16px;">
      <div style="font-size:12px;font-weight:700;color:#374151;margin-bottom:12px;">프로젝트별 현황</div>
      <table width="100%" cellpadding="0" cellspacing="0" style="font-size:12px;color:#111827;">
        <thead>
          <tr style="color:#9ca3af;font-size:10px;">
            <th style="padding:5px 8px;text-align:left;font-weight:600;">프로젝트</th>
            <th style="padding:5px 8px;text-align:center;font-weight:600;">실행</th>
            <th style="padding:5px 8px;text-align:right;font-weight:600;">비용</th>
          </tr>
        </thead>
        <tbody>
          ${Array.from(byProject.entries()).sort((a, b) => b[1].total - a[1].total).map(([pid, p]) => {
            const pp = prevByProject.get(pid)
            return `<tr style="border-top:1px solid #f9fafb;">
              <td style="padding:7px 8px;color:#111827;">
                <span style="display:inline-block;width:7px;height:7px;border-radius:50%;background:${p.color};margin-right:5px;vertical-align:middle;"></span>
                <strong style="font-size:12px;">${esc(p.name || '(이름없음)')}</strong>
              </td>
              <td style="padding:7px 8px;text-align:center;font-size:12px;color:#111827;">${p.total}${hasPrev && pp ? `<br><span style="font-size:10px;">${changeIndicator(p.total, pp.total)}</span>` : ''}</td>
              <td style="padding:7px 8px;text-align:right;font-size:12px;color:#111827;">$${p.cost.toFixed(2)}${hasPrev && pp ? `<br><span style="font-size:10px;">${changeIndicator(p.cost, pp.cost, true)}</span>` : ''}</td>
            </tr>`
          }).join('')}
        </tbody>
      </table>
    </div>
    ` : ''}

    <!-- ⑧ 에이전트별 현황 -->
    ${byAgent.size > 0 ? `
    <div style="background:#ffffff;border:1px solid #e5e7eb;border-radius:12px;padding:16px;margin-bottom:16px;">
      <div style="font-size:12px;font-weight:700;color:#374151;margin-bottom:12px;">에이전트별 현황</div>
      <table width="100%" cellpadding="0" cellspacing="0" style="font-size:12px;color:#111827;">
        <thead>
          <tr style="color:#9ca3af;font-size:10px;">
            <th style="padding:5px 8px;text-align:left;font-weight:600;">에이전트</th>
            <th style="padding:5px 8px;text-align:center;font-weight:600;">작업</th>
            <th style="padding:5px 8px;text-align:center;font-weight:600;">성공</th>
            <th style="padding:5px 8px;text-align:center;font-weight:600;">실패</th>
            <th style="padding:5px 8px;text-align:center;font-weight:600;">평균 시간</th>
            <th style="padding:5px 8px;text-align:right;font-weight:600;">비용</th>
          </tr>
        </thead>
        <tbody>
          ${Array.from(byAgent.entries()).sort((a, b) => b[1].total - a[1].total).map(([agentId, a]) => {
            const pa = prevByAgent.get(agentId)
            return `<tr style="border-top:1px solid #f9fafb;">
              <td style="padding:7px 8px;"><strong style="font-size:12px;">${esc(a.name)}</strong><span style="color:#9ca3af;font-size:10px;"> ${esc(a.cli)}</span></td>
              <td style="padding:7px 8px;text-align:center;">${a.total}${hasPrev && pa ? `<br><span style="font-size:10px;">${changeIndicator(a.total, pa.total)}</span>` : ''}</td>
              <td style="padding:7px 8px;text-align:center;color:#16a34a;font-weight:700;">${a.success}</td>
              <td style="padding:7px 8px;text-align:center;color:#dc2626;font-weight:700;">${a.failed}</td>
              <td style="padding:7px 8px;text-align:center;color:#6b7280;">${a.avgDurationMin > 0 ? fmtDuration(a.avgDurationMin) : '-'}</td>
              <td style="padding:7px 8px;text-align:right;">$${a.cost.toFixed(2)}${hasPrev && pa ? `<br><span style="font-size:10px;">${changeIndicator(a.cost, pa.cost, true)}</span>` : ''}</td>
            </tr>`
          }).join('')}
        </tbody>
      </table>
    </div>
    ` : ''}

    <!-- ⑨ 검증자별 현황 -->
    ${byVerifier.size > 0 ? `
    <div style="background:#ffffff;border:1px solid #e5e7eb;border-radius:12px;padding:16px;margin-bottom:16px;">
      <div style="font-size:12px;font-weight:700;color:#374151;margin-bottom:12px;">검증자별 현황</div>
      <table width="100%" cellpadding="0" cellspacing="0" style="font-size:12px;color:#111827;">
        <thead>
          <tr style="color:#9ca3af;font-size:10px;">
            <th style="padding:5px 8px;text-align:left;font-weight:600;">검증자</th>
            <th style="padding:5px 8px;text-align:center;font-weight:600;">승인</th>
            <th style="padding:5px 8px;text-align:center;font-weight:600;">반려</th>
            <th style="padding:5px 8px;text-align:right;font-weight:600;">평균 검증시간</th>
          </tr>
        </thead>
        <tbody>
          ${Array.from(byVerifier.values()).sort((a, b) => (b.approved + b.rejected) - (a.approved + a.rejected)).map(v => `
            <tr style="border-top:1px solid #f9fafb;">
              <td style="padding:7px 8px;"><strong>${esc(v.name)}</strong><span style="color:#9ca3af;font-size:10px;"> @${esc(v.username)}</span></td>
              <td style="padding:7px 8px;text-align:center;color:#16a34a;font-weight:700;">${v.approved}</td>
              <td style="padding:7px 8px;text-align:center;color:#dc2626;font-weight:700;">${v.rejected}</td>
              <td style="padding:7px 8px;text-align:right;color:#6b7280;">${v.avgVerifyMin > 0 ? fmtDuration(v.avgVerifyMin) : '-'}</td>
            </tr>`).join('')}
        </tbody>
      </table>
    </div>
    ` : ''}

    <!-- ⑩ 사용자별 현황 -->
    ${byUser.size > 0 ? `
    <div style="background:#ffffff;border:1px solid #e5e7eb;border-radius:12px;padding:16px;margin-bottom:16px;">
      <div style="font-size:12px;font-weight:700;color:#374151;margin-bottom:12px;">사용자별 현황</div>
      <table width="100%" cellpadding="0" cellspacing="0" style="font-size:12px;color:#111827;">
        <thead>
          <tr style="color:#9ca3af;font-size:10px;">
            <th style="padding:5px 8px;text-align:left;font-weight:600;">사용자</th>
            <th style="padding:5px 8px;text-align:center;font-weight:600;">작업</th>
            <th style="padding:5px 8px;text-align:center;font-weight:600;">성공</th>
            <th style="padding:5px 8px;text-align:center;font-weight:600;">실패</th>
            <th style="padding:5px 8px;text-align:right;font-weight:600;">비용</th>
          </tr>
        </thead>
        <tbody>
          ${Array.from(byUser.entries()).sort((a, b) => b[1].total - a[1].total).map(([uid, u]) => {
            const pu = prevByUser.get(uid)
            return `<tr style="border-top:1px solid #f9fafb;">
              <td style="padding:7px 8px;"><strong>${esc(u.name)}</strong></td>
              <td style="padding:7px 8px;text-align:center;">${u.total}${hasPrev && pu ? `<br><span style="font-size:10px;">${changeIndicator(u.total, pu.total)}</span>` : ''}</td>
              <td style="padding:7px 8px;text-align:center;color:#16a34a;font-weight:700;">${u.success}</td>
              <td style="padding:7px 8px;text-align:center;color:#dc2626;font-weight:700;">${u.failed}</td>
              <td style="padding:7px 8px;text-align:right;">$${u.cost.toFixed(2)}${hasPrev && pu ? `<br><span style="font-size:10px;">${changeIndicator(u.cost, pu.cost, true)}</span>` : ''}</td>
            </tr>`
          }).join('')}
        </tbody>
      </table>
    </div>
    ` : ''}

    <!-- ⑪ 처리된 작업 목록 (상위 10건) -->
    ${topIssues.length > 0 ? `
    <div style="background:#ffffff;border:1px solid #e5e7eb;border-radius:12px;padding:16px;margin-bottom:16px;">
      <div style="font-size:12px;font-weight:700;color:#374151;margin-bottom:12px;">처리된 작업 (비용 상위 ${topIssues.length}건)</div>
      ${topIssues.map(issue => `
        <div style="padding:8px 0;border-top:1px solid #f3f4f6;">
          <div style="display:flex;align-items:flex-start;justify-content:space-between;gap:8px;">
            <div style="flex:1;min-width:0;">
              <div style="font-size:12px;color:#111827;font-weight:600;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">#${issue.issueIid} ${esc(issue.issueTitle)}</div>
              <div style="font-size:10px;color:#9ca3af;margin-top:2px;">
                <span style="display:inline-block;width:5px;height:5px;border-radius:50%;background:${issue.projectColor};margin-right:3px;vertical-align:middle;"></span>
                ${esc(issue.projectName)} · ${esc(issue.agentName)} · ${fmtDuration(issue.durationMin)}
              </div>
            </div>
            <div style="text-align:right;white-space:nowrap;">
              <div style="font-size:12px;font-weight:700;color:${issue.status === 'success' ? '#16a34a' : '#dc2626'};">$${issue.cost.toFixed(2)}</div>
              <div style="font-size:10px;color:#9ca3af;">${issue.status === 'success' ? '✓ 성공' : '✗ 실패'}</div>
            </div>
          </div>
        </div>
      `).join('')}
    </div>
    ` : ''}

    ${total === 0 ? `
    <div style="background:#ffffff;border:1px solid #e5e7eb;border-radius:12px;padding:32px;text-align:center;margin-bottom:16px;">
      <div style="font-size:32px;margin-bottom:8px;">📭</div>
      <p style="color:#6b7280;font-size:14px;margin:0;">해당 기간에 실행된 작업이 없습니다.</p>
    </div>
    ` : ''}

    <!-- 푸터 -->
    <div style="text-align:center;padding:12px;">
      <p style="color:#9ca3af;font-size:10px;margin:0;">이 메일은 Springware IVE에서 자동 발송되었습니다.</p>
    </div>

  </div>
</body>
</html>`
}
