/**
 * 보고서 진단 엔진 — 주의 카드(AlertCard) 생성 함수
 */

import type {
  ReportData, AlertCard, ProjectFlow, AgentLoad,
  VerifierLoad, VerifierDiagnosis, FlowMetrics, I18nMessage,
  TrendForecast,
} from './types'
import { fmtCost, getKSTToday } from './resource-analysis'

// ─── 주의 카드 생성 ───

export function generateAlerts(
  data: ReportData,
  flow: FlowMetrics,
  projectFlows: ProjectFlow[],
  agentLoads: AgentLoad[],
  verifier: VerifierDiagnosis | null,
  verifierLoads: VerifierLoad[],
  fmtDur: (min: number) => string,
): AlertCard[] {
  const { summary, prevSummary, lifecycle, prevLifecycle, waitingTrend, byAgent } = data
  const today = getKSTToday()
  const { costPerTask, prevCostPerTask } = flow
  const totalInflow = flow.inflow
  const endWaiting = flow.currentWaiting

  // 이전 기간 유입 계산
  const prevStartWaiting = data.prevWaitingTrend.length > 0 ? (data.prevWaitingTrend[0].totalWaiting ?? 0) : 0
  const prevEndWaiting = data.prevWaitingTrend.length > 0 ? (data.prevWaitingTrend[data.prevWaitingTrend.length - 1].totalWaiting ?? 0) : 0
  const prevInflow = prevSummary.totalTasks + (prevEndWaiting - prevStartWaiting)

  const alerts: AlertCard[] = []

  // 7-1-b. 방치된 대기 — 기간 내 유입/처리 모두 0인데 대기가 쌓여있음
  if (totalInflow === 0 && flow.throughput === 0 && endWaiting > 0) {
    alerts.push({
      severity: 'critical',
      title: { key: 'alertStaleWaitingTitle' },
      detail: { key: 'alertStaleWaitingDetail', params: { count: endWaiting } },
      action: { key: 'alertStaleWaitingAction' },
      actionTarget: '/agents',
    })
  }

  // 7-2. 적체 — 대기가 3일 연속 의미 있게 증가
  const pastWaitingDays = waitingTrend.filter(d => d.date <= today)
  if (pastWaitingDays.length >= 4) {
    const last4 = pastWaitingDays.slice(-4)
    const deltas = [last4[1].total - last4[0].total, last4[2].total - last4[1].total, last4[3].total - last4[2].total]
    const lastWaiting = last4[3].total
    if (deltas.every(d => d >= 1) && lastWaiting >= 2) {
      alerts.push({
        severity: 'critical',
        title: { key: 'alertUnderThroughputTitle' },
        detail: { key: 'alertUnderThroughputDetail', params: { count: lastWaiting } },
        action: { key: 'alertUnderThroughputAction' },
        actionTarget: '/agents',
      })
    }
  }

  // 7-3. 유입 급증
  if (prevInflow > 0 && totalInflow > prevInflow * 1.5) {
    alerts.push({
      severity: 'warning',
      title: { key: 'alertSurgeInflowTitle' },
      detail: {
        key: 'alertSurgeInflowDetail',
        params: { current: totalInflow, prev: prevInflow, pct: Math.round((totalInflow / prevInflow - 1) * 100) },
      },
      action: { key: 'alertSurgeInflowAction' },
    })
  }

  // 7-4. 자원 유휴
  const idleAgents = agentLoads.filter(a => a.annotation?.key === 'idle' || a.annotation?.key === 'idleReassign')
  if (idleAgents.length > 0 && byAgent.length >= 3) {
    alerts.push({
      severity: 'info',
      title: { key: 'alertIdleResourceTitle' },
      detail: { key: 'alertIdleResourceDetail', params: { total: byAgent.length, idle: idleAgents.length } },
      action: { key: 'alertIdleResourceAction' },
      actionTarget: '/agents',
    })
  }

  // 7-5. 에이전트 편중
  const totalW = endWaiting
  if (totalW >= 3) {
    for (const a of agentLoads) {
      if (a.currentWaiting >= totalW * 0.6 && a.currentWaiting >= 3) {
        alerts.push({
          severity: 'warning',
          title: { key: 'alertAgentOverloadTitle', params: { agent: a.agentName } },
          detail: {
            key: 'alertAgentOverloadDetail',
            params: { total: totalW, waiting: a.currentWaiting, pct: Math.round(a.currentWaiting / totalW * 100) },
          },
          action: { key: 'alertAgentOverloadAction' },
        })
        break
      }
    }
  }

  // 7-6. 비용 급증
  if (costPerTask > 0 && prevCostPerTask > 0 && costPerTask > prevCostPerTask * 1.5) {
    alerts.push({
      severity: 'warning',
      title: { key: 'alertCostSurgeTitle' },
      detail: {
        key: 'alertCostSurgeDetail',
        params: {
          cost: fmtCost(costPerTask),
          prev: fmtCost(prevCostPerTask),
          pct: Math.round((costPerTask / prevCostPerTask - 1) * 100),
        },
      },
      action: { key: 'alertCostSurgeAction' },
    })
  }

  // 7-7. 처리 지연
  if (prevLifecycle.procCount > 0 && lifecycle.procAvg > prevLifecycle.procAvg * 1.5) {
    alerts.push({
      severity: 'warning',
      title: { key: 'alertProcTimeTitle' },
      detail: {
        key: 'alertProcTimeDetail',
        params: {
          avg: fmtDur(lifecycle.procAvg),
          prev: fmtDur(prevLifecycle.procAvg),
          pct: Math.round((lifecycle.procAvg / prevLifecycle.procAvg - 1) * 100),
        },
      },
      action: { key: 'alertProcTimeAction' },
    })
  }

  // 7-8. 검증 병목 (검증 시간 증가 기반)
  if (verifier?.annotation) {
    alerts.push({
      severity: 'warning',
      title: { key: 'alertVerifyBottleneckTitle' },
      detail: verifier.annotation,
      action: { key: 'alertVerifyBottleneckAction' },
    })
  }

  // 7-9. 검증자 개별 병목 (대기 집중 / 장기 미처리)
  const overloadedVerifiers = verifierLoads.filter(v => v.annotation?.key === 'overload')
  if (overloadedVerifiers.length > 0) {
    const v = overloadedVerifiers[0]
    alerts.push({
      severity: 'critical',
      title: { key: 'alertVerifierOverloadTitle', params: { name: v.name } },
      detail: v.verifying > 0
        ? { key: 'alertVerifierOverloadDetailWithVerifying', params: { waiting: v.verifyWaiting, verifying: v.verifying } }
        : { key: 'alertVerifierOverloadDetail', params: { waiting: v.verifyWaiting } },
      action: { key: 'alertVerifierOverloadAction' },
      actionTarget: '/agents',
    })
  }
  const stalledVerifiers = verifierLoads.filter(v => v.annotation?.key === 'delayed')
  if (stalledVerifiers.length > 0 && overloadedVerifiers.length === 0) {
    const v = stalledVerifiers[0]
    alerts.push({
      severity: 'warning',
      title: { key: 'alertVerifierStalledTitle' },
      detail: { key: 'alertVerifierStalledDetail', params: { name: v.name } },
      action: { key: 'alertVerifierStalledAction' },
      actionTarget: '/agents',
    })
  }

  // 7-10. 확인 단계 병목 (확인 시간이 전체 시간의 30% 이상)
  if (lifecycle.confirmCount > 0 && lifecycle.totalAvg > 0) {
    const confirmPct = Math.round((lifecycle.confirmAvg / lifecycle.totalAvg) * 100)
    if (confirmPct >= 30) {
      alerts.push({
        severity: 'warning',
        title: { key: 'alertConfirmBottleneckTitle' },
        detail: { key: 'alertConfirmBottleneckDetail', params: { pct: confirmPct } },
        action: { key: 'alertConfirmBottleneckAction' },
        actionTarget: '/agents',
      })
    }
  }

  return alerts
}

// ─── 재시도 비용 분석 ───

export function computeRetryCost(
  data: ReportData,
  projectFlows: ProjectFlow[],
): { retryCostRatio: number; retryCostAmount: number; highRetryProject: { name: string; rate: number } | null } {
  const { lifecycle, summary } = data
  const retryCostRatio = lifecycle.avgAttempts > 1 ? 1 - 1 / lifecycle.avgAttempts : 0
  const retryCostAmount = Math.round(summary.totalCost * retryCostRatio * 100) / 100
  let highRetryProject: { name: string; rate: number } | null = null
  const maxRetry = projectFlows.reduce((best, p) => p.retryRate > (best?.retryRate ?? 0) ? p : best, null as ProjectFlow | null)
  if (maxRetry && maxRetry.retryRate >= 25) {
    highRetryProject = { name: maxRetry.projectName, rate: maxRetry.retryRate }
  }
  return { retryCostRatio: Math.round(retryCostRatio * 100) / 100, retryCostAmount, highRetryProject }
}

// ─── 추세 예측 ───

export function computeTrendForecast(
  data: ReportData,
  prevWeeklyData: ReportData[] | undefined,
  totalInflow: number,
  dailyCapacity: number,
): TrendForecast | null {
  if (!prevWeeklyData || prevWeeklyData.length < 2 || data.period.type !== 'weekly') return null

  const weeklyInflows: number[] = []
  for (const wd of prevWeeklyData) {
    const wt = wd.waitingTrend || []
    const wStart = wt.length > 0 ? wt[0].total : 0
    const wEnd = wt.length > 0 ? wt[wt.length - 1].total : 0
    weeklyInflows.push(wd.summary.totalTasks + (wEnd - wStart))
  }
  weeklyInflows.push(totalInflow)
  if (weeklyInflows.length < 3) return null

  const recent3 = weeklyInflows.slice(-3)
  const growthRate = recent3[0] > 0 ? ((recent3[2] - recent3[0]) / recent3[0] / 2) : 0
  if (growthRate <= 0.05) return null

  let weeksUntil: number | null = null
  const weeklyCapacity = dailyCapacity * 7
  if (weeklyCapacity > 0) {
    for (let w = 1; w <= 12; w++) {
      const projected = totalInflow * Math.pow(1 + growthRate, w)
      if (projected > weeklyCapacity) { weeksUntil = w; break }
    }
  }
  return {
    weeklyGrowthRate: Math.round(growthRate * 100),
    weeksUntilShortage: weeksUntil,
    message: weeksUntil
      ? { key: 'briefingTrendShortage', params: { weeks: prevWeeklyData.length + 1, weeksUntil } }
      : { key: 'briefingTrendOk' },
  }
}
