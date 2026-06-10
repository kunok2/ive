/**
 * 보고서 진단 엔진
 * 흐름(Flow) 기반 자원 수급 진단 + 주의 카드 생성 + 브리핑 텍스트 생성
 */

// ─── 타입 재수출 ───
export type {
  ReportData, VerifierBacklogRow, ProjectStat, AgentStat, UserStat, VerifierStat,
  DailyTrend, WaitingDay, AgentWaitingDay, Lifecycle, ResolvedIssue,
  HealthLevel, AlertSeverity, FlowMetrics, ResourceDiagnosis,
  AnnotationSeverity, ProjectAnnotationKey, ProjectAnnotation, ProjectFlow,
  AgentAnnotationKey, AgentAnnotation, AgentLoad,
  VerifierAnnotationKey, VerifierAnnotation, VerifierLoad,
  UserAnnotationKey, UserAnnotation,
  I18nMessage, AlertCard, VerifierDiagnosis, DiagnosisResult, TrendForecast,
} from './types'

import type { ReportData, DiagnosisResult, FlowMetrics } from './types'
import {
  getKSTToday, getElapsedDays, healthFromUtil,
  defaultFmtDur, fmtCost,
  computeAgentCapacities, computeProjectFlows,
  computeResourceDiagnosis, computeAgentLoads,
  computeVerifierDiagnosis, computeVerifierLoads,
} from './resource-analysis'
import { generateAlerts, computeRetryCost, computeTrendForecast } from './warning-cards'
import { generateBriefing } from './briefing'

// ─── 메인 진단 함수 ───

export function diagnose(
  data: ReportData,
  prevWeeklyData?: ReportData[],
  formatDur: (min: number) => string = defaultFmtDur,
  formatCost: (n: number) => string = fmtCost,
): DiagnosisResult {
  // 에이전트별 historical capacity 룩업 — data.agentHistoricalCapacity 가 API 에서 채워짐.
  const historicalCapMap = new Map<string, { dailyCap: number; samples: number }>()
  for (const c of data.agentHistoricalCapacity ?? []) {
    historicalCapMap.set(c.agentId, { dailyCap: c.dailyCap, samples: c.samples })
  }
  const historicalCapFn = (agentId: string) => historicalCapMap.get(agentId) ?? { dailyCap: 0, samples: 0 }

  const fmtDur = formatDur
  const { period, summary, prevSummary, byVerifier, lifecycle, prevLifecycle, waitingTrend } = data

  const elapsedDays = getElapsedDays(period.start, period.type)
  const today = getKSTToday()

  // ─── 1. 흐름 지표 ───

  const pastWaiting = waitingTrend.filter(d => d.date <= today)
  const endWaiting = pastWaiting.length > 0 ? pastWaiting[pastWaiting.length - 1].total : 0
  const startProcWaiting = pastWaiting.length > 0 ? pastWaiting[0].totalWaiting : 0
  const endProcWaiting = pastWaiting.length > 0 ? pastWaiting[pastWaiting.length - 1].totalWaiting : 0
  // totalInflow: 표시용(이슈 수). 큐 변화량 합산은 의사결정 지표(가동률) 분모로는 부적절해서 제외.
  const totalInflow = summary.uniqueInflow + (endProcWaiting - startProcWaiting)
  const totalThroughput = summary.verifiedCount
  const dailyInflow = elapsedDays > 0 ? totalInflow / elapsedDays : 0

  // 에이전트 용량 계산 (글로벌 풀) — 직전 30일 historical 윈도우 기반 안정값.
  const { agentCapacities, avgAgentCap } = computeAgentCapacities(data, elapsedDays, today, historicalCapFn)
  const dailyCapacity = agentCapacities.reduce((s, a) => s + a.dailyCap, 0)

  // 가동률 = 일일 처리율 / 일일 처리능력. 큐 변화량(노이즈) 포함하지 않음.
  // 분자/분모 모두 "일 평균" 단위로 통일 → 주/월/년 보고서에서 비교 가능한 0~∞ 비율.
  const dailyThroughput = elapsedDays > 0 ? totalThroughput / elapsedDays : 0
  const utilization = dailyCapacity > 0 ? dailyThroughput / dailyCapacity : 0

  // 신뢰도: 경과일 부족(<3) 또는 capacity 샘플 부족(에이전트 historical 활동일 평균<3)이면 'low'.
  const avgSamples = agentCapacities.length > 0
    ? agentCapacities.reduce((s, a) => s + a.samples, 0) / agentCapacities.length
    : 0
  const utilizationConfidence: 'high' | 'low' = (elapsedDays >= 3 && avgSamples >= 3) ? 'high' : 'low'

  const healthLevel = utilizationConfidence === 'low' ? 'optimal' : healthFromUtil(utilization)

  const costPerTask = summary.totalTasks > 0 ? summary.totalCost / summary.totalTasks : 0
  const prevCostPerTask = prevSummary.totalTasks > 0 ? prevSummary.totalCost / prevSummary.totalTasks : 0

  const flow: FlowMetrics = {
    inflow: totalInflow,
    throughput: totalThroughput,
    currentWaiting: endWaiting,
    dailyInflow,
    dailyCapacity,
    utilization,
    utilizationConfidence,
    healthLevel,
    totalCost: summary.totalCost,
    totalCostAi: summary.totalCostAi ?? 0,
    totalCostHuman: summary.totalCostHuman ?? 0,
    humanMinutes: summary.humanMinutes ?? 0,
    humanMonthlySalary: summary.humanMonthlySalary ?? 0,
    humanMonthlyMinutes: summary.humanMonthlyMinutes ?? 9600,
    costPerTask: Math.round(costPerTask * 100) / 100,
    prevCostPerTask: Math.round(prevCostPerTask * 100) / 100,
    resolutionTimeAvg: lifecycle.totalAvg || 0,
    prevResolutionTimeAvg: prevLifecycle.totalAvg || 0,
  }

  // ─── 2. 프로젝트별 흐름 ───

  const projectFlows = computeProjectFlows(data, today)

  // ─── 3. 자원 진단 (글로벌) ───

  const resource = computeResourceDiagnosis(
    data, agentCapacities, avgAgentCap,
    dailyInflow, dailyCapacity, endWaiting,
  )

  // ─── 4. 에이전트 부하 ───

  const agentLoads = computeAgentLoads(data, agentCapacities, today)

  // ─── 5. 검증자 진단 ───

  const verifier = computeVerifierDiagnosis(data, elapsedDays)
  const verifierLoads = computeVerifierLoads(data, byVerifier, elapsedDays)

  // ─── 6. 재시도 비용 ───

  const { retryCostRatio, retryCostAmount, highRetryProject } = computeRetryCost(data, projectFlows)

  // ─── 7. 추세 예측 ───

  const trendForecast = computeTrendForecast(data, prevWeeklyData, totalInflow, dailyCapacity)

  // ─── 8. 주의 카드 ───

  const alerts = generateAlerts(data, flow, projectFlows, agentLoads, verifier, verifierLoads, fmtDur, formatCost)

  // ─── 9. 브리핑 텍스트 ───

  const briefing = generateBriefing(data, flow, resource, highRetryProject, trendForecast, fmtDur, formatCost)

  return {
    flow, resource, alerts, projects: projectFlows, agents: agentLoads, verifier,
    verifierLoads,
    briefing,
    retryCostRatio,
    retryCostAmount,
    highRetryProject,
    trendForecast,
  }
}
