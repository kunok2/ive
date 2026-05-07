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
  getPeriodDays, getKSTToday, getElapsedDays, healthFromUtil,
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
): DiagnosisResult {
  const fmtDur = formatDur
  const { period, summary, prevSummary, byAgent, byVerifier, lifecycle, prevLifecycle, waitingTrend } = data

  const periodDays = getPeriodDays(period.start, period.end, period.type)
  const elapsedDays = getElapsedDays(period.start, period.type)
  const today = getKSTToday()

  // ─── 1. 흐름 지표 ───

  const pastWaiting = waitingTrend.filter(d => d.date <= today)
  const startWaiting = pastWaiting.length > 0 ? pastWaiting[0].total : 0
  const endWaiting = pastWaiting.length > 0 ? pastWaiting[pastWaiting.length - 1].total : 0
  const startProcWaiting = pastWaiting.length > 0 ? pastWaiting[0].totalWaiting : 0
  const endProcWaiting = pastWaiting.length > 0 ? pastWaiting[pastWaiting.length - 1].totalWaiting : 0
  const totalInflow = summary.uniqueInflow + (endProcWaiting - startProcWaiting)
  const totalThroughput = summary.verifiedCount
  const dailyInflow = elapsedDays > 0 ? totalInflow / elapsedDays : 0

  // 에이전트 용량 계산 (글로벌 풀)
  const { agentCapacities, avgAgentCap } = computeAgentCapacities(data, elapsedDays, today)
  const dailyCapacity = agentCapacities.reduce((s, a) => s + a.dailyCap, 0)
  const utilization = dailyCapacity > 0 ? dailyInflow / dailyCapacity : (dailyInflow > 0 ? Infinity : 0)
  const healthLevel = healthFromUtil(utilization)

  const costPerTask = summary.totalTasks > 0 ? summary.totalCost / summary.totalTasks : 0
  const prevCostPerTask = prevSummary.totalTasks > 0 ? prevSummary.totalCost / prevSummary.totalTasks : 0

  const flow: FlowMetrics = {
    inflow: totalInflow,
    throughput: totalThroughput,
    currentWaiting: endWaiting,
    dailyInflow,
    dailyCapacity,
    utilization,
    healthLevel,
    totalCost: summary.totalCost,
    totalCostAi: summary.totalCostAi ?? 0,
    totalCostHuman: summary.totalCostHuman ?? 0,
    humanMinutes: summary.humanMinutes ?? 0,
    humanMonthlySalary: summary.humanMonthlySalary ?? 0,
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

  const alerts = generateAlerts(data, flow, projectFlows, agentLoads, verifier, verifierLoads, fmtDur)

  // ─── 9. 브리핑 텍스트 ───

  const briefing = generateBriefing(data, flow, resource, highRetryProject, trendForecast, fmtDur)

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
