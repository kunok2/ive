/**
 * 보고서 진단 엔진 — 브리핑 텍스트 생성 함수
 */

import type {
  ReportData, FlowMetrics, ResourceDiagnosis, HealthLevel,
  I18nMessage, TrendForecast,
} from './types'
import { fmtCost } from './resource-analysis'

export function generateBriefing(
  data: ReportData,
  flow: FlowMetrics,
  resource: ResourceDiagnosis,
  highRetryProject: { name: string; rate: number } | null,
  trendForecast: TrendForecast | null,
  fmtDur: (min: number) => string,
  formatCost: (n: number) => string = fmtCost,
): I18nMessage[] {
  const { summary, lifecycle, prevLifecycle } = data
  const { costPerTask, prevCostPerTask, utilization, healthLevel } = flow
  const { scenario, gap } = resource
  const totalInflow = flow.inflow

  const briefingLines: I18nMessage[] = []

  // 흐름 상태
  if (summary.totalTasks === 0 && totalInflow === 0) {
    if (flow.currentWaiting > 0) {
      briefingLines.push({ key: 'briefingNoFlow', params: { waiting: flow.currentWaiting } })
    } else {
      briefingLines.push({ key: 'briefingNoInflow' })
    }
  } else {
    // 신뢰도 낮으면 가동률 라인 생략 — 노이즈가 의사결정 오도하지 않게.
    if (flow.utilizationConfidence === 'high') {
      const utilPct = Math.round(utilization * 100)
      const levelKeyMap: Record<HealthLevel, string> = {
        overloaded: 'levelOverloaded',
        tight: 'levelTight',
        optimal: 'levelOptimal',
        relaxed: 'levelRelaxed',
        idle: 'levelIdle',
      }
      briefingLines.push({
        key: 'briefingUtilLevel',
        params: { pct: utilPct },
        nestedKeys: { level: levelKeyMap[healthLevel] },
      })
    }
    briefingLines.push({
      key: 'briefingFlowSummary',
      params: {
        inflow: totalInflow.toLocaleString(),
        executions: summary.totalTasks.toLocaleString(),
        completed: flow.throughput.toLocaleString(),
        cost: formatCost(summary.totalCost),
      },
    })
  }

  // 체감 해결시간
  if (lifecycle.totalAvg > 0) {
    if (prevLifecycle.totalAvg > 0) {
      briefingLines.push({
        key: 'briefingAvgResolveWithPrev',
        params: { duration: fmtDur(lifecycle.totalAvg), prev: fmtDur(prevLifecycle.totalAvg) },
      })
    } else {
      briefingLines.push({
        key: 'briefingAvgResolve',
        params: { duration: fmtDur(lifecycle.totalAvg) },
      })
    }
  }

  // 자원 진단 처방 (글로벌 에이전트 풀 기준)
  if (scenario === 'shortage' && gap < 0) {
    briefingLines.push({ key: 'briefingShortage', params: { total: Math.abs(gap) } })
  } else if (scenario === 'surplus' && gap > 0) {
    briefingLines.push({ key: 'briefingSurplus', params: { count: gap } })
  }

  // 비용 이상
  if (costPerTask > 0 && prevCostPerTask > 0 && costPerTask > prevCostPerTask * 1.3) {
    briefingLines.push({
      key: 'briefingCostUp',
      params: { cost: formatCost(costPerTask), pct: Math.round((costPerTask / prevCostPerTask - 1) * 100).toLocaleString() },
    })
  }
  // 실제 비용 감소 경로: 재시도율이 높으면 품질 개선이 토큰 비용을 줄입니다
  if (highRetryProject && highRetryProject.rate >= 40) {
    briefingLines.push({
      key: 'briefingHighRetry',
      params: { name: highRetryProject.name, pct: Math.round(highRetryProject.rate) },
    })
  }

  // 추세 예측
  if (trendForecast) briefingLines.push(trendForecast.message)

  return briefingLines
}
