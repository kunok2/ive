'use client'

import { useTranslations } from 'next-intl'
import Sparkline from '@/components/ui/Sparkline'
import type { DiagnosisResult, ReportHelpers } from './types'

interface FlowPipelineProps {
  d: DiagnosisResult
  inflowData: number[]
  throughputData: number[]
  waitingData: number[]
  helpers: ReportHelpers
}

export default function FlowPipeline({ d, inflowData, throughputData, waitingData, helpers }: FlowPipelineProps) {
  const tr = useTranslations('report')
  const { fmtCost, fmtDur, diffBadge, diffColor } = helpers

  return (
    <section className="bg-ive-bg-card border border-ive-border-subtle rounded-lg p-4">
      <div className="flex items-center justify-between mb-4">
        {/* 유입 */}
        <div className="text-center flex-1 w-0">
          <div className="text-xs text-ive-text-dim mb-1">{tr('flowInflow')}</div>
          <div className="text-2xl font-bold text-ive-text mb-2">{d.flow.inflow.toLocaleString()}</div>
          <div className="h-6 mb-2 px-1"><Sparkline data={inflowData.length > 0 ? inflowData : [0]} width="100%" height={24} color="cyan" /></div>
          <div className="text-xs text-ive-text-dim">{tr('perDayUnit', { count: Math.round(d.flow.dailyInflow) })}</div>
        </div>
        <div className="text-ive-text-dim px-2"><i className="fa-solid fa-arrow-right" /></div>
        {/* 대기열 */}
        <div className="text-center flex-1 w-0">
          <div className="text-xs text-ive-text-dim mb-1">{tr('flowWaiting')}</div>
          <div className={`text-2xl font-bold mb-2 ${d.flow.currentWaiting >= 8 ? 'text-ive-red' : d.flow.currentWaiting >= 4 ? 'text-ive-amber' : 'text-ive-text'}`}>
            {d.flow.currentWaiting}
          </div>
          <div className="h-6 mb-2 px-1"><Sparkline data={waitingData.length > 0 ? waitingData : [0]} width="100%" height={24} color={d.flow.currentWaiting >= 8 ? 'red' : d.flow.currentWaiting >= 4 ? 'amber' : 'cyan'} /></div>
          <div className="text-xs text-ive-text-dim opacity-0">0</div>
        </div>
        <div className="text-ive-text-dim px-2"><i className="fa-solid fa-arrow-right" /></div>
        {/* 처리 */}
        <div className="text-center flex-1 w-0">
          <div className="text-xs text-ive-text-dim mb-1">{tr('flowThroughput')}</div>
          <div className="text-2xl font-bold text-ive-text mb-2">{d.flow.throughput.toLocaleString()}</div>
          <div className="h-6 mb-2 px-1"><Sparkline data={throughputData.length > 0 ? throughputData : [0]} width="100%" height={24} color="cyan" /></div>
          <div className="text-xs text-ive-text-dim">{tr('perDayUnit', { count: Math.round(d.flow.dailyCapacity) })}</div>
        </div>
      </div>
      {/* 비용 */}
      <div className="flex flex-col items-center gap-1 bg-ive-bg-deep rounded-lg py-2">
        <div className="flex items-center gap-3 text-xs">
          <span className="text-ive-text font-bold">{tr('costTotalCompact', { amount: fmtCost(d.flow.totalCost) })}</span>
          <span className="text-ive-text-dim">{tr('costPerTaskCompact', { amount: fmtCost(d.flow.costPerTask) })}</span>
          {d.flow.prevCostPerTask > 0 && (() => {
            const b = diffBadge(d.flow.costPerTask, d.flow.prevCostPerTask)
            return b ? <span className={`text-xs font-bold ${diffColor(d.flow.costPerTask, d.flow.prevCostPerTask, true)}`}>{b}</span> : null
          })()}
        </div>
        {(d.flow.totalCostAi > 0 || d.flow.totalCostHuman > 0) && (
          <div className="flex items-center gap-2 text-[10px] text-ive-text-dim">
            <span><i className="fa-solid fa-robot mr-0.5 text-ive-text-muted" />{tr('aiCostCompact', { amount: fmtCost(d.flow.totalCostAi) })}</span>
            <span>+</span>
            <span>
              <i className="fa-solid fa-user mr-0.5 text-ive-text-muted" />{tr('humanCostCompact', { amount: fmtCost(d.flow.totalCostHuman) })}
              {d.flow.humanMinutes > 0 && (
                <span className="opacity-70"> {tr('humanCostDurExpr', { duration: fmtDur(d.flow.humanMinutes), perMin: Math.round(d.flow.humanMonthlySalary / 9600) })}</span>
              )}
            </span>
          </div>
        )}
      </div>
    </section>
  )
}
