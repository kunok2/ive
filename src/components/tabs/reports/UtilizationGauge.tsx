'use client'

import { useTranslations } from 'next-intl'
import type { DiagnosisResult, ReportHelpers } from './types'

interface UtilizationGaugeProps {
  d: DiagnosisResult
  helpers: ReportHelpers
}

export default function UtilizationGauge({ d, helpers }: UtilizationGaugeProps) {
  const tr = useTranslations('report')
  const { fmtDur } = helpers

  if (d.flow.dailyCapacity <= 0) return null

  return (
    <section className="bg-ive-bg-card border border-ive-border-subtle rounded-lg p-4 space-y-3">
      <div>
        <div className="text-sm font-bold text-ive-text flex items-center gap-1.5 mb-1">
          <i className="fa-solid fa-gauge-high text-ive-text-dim" /> {tr('utilizationTitle')}
        </div>
        <p className="text-[11px] text-ive-text-dim leading-relaxed">
          {tr('utilizationDesc')}
        </p>
      </div>
      {/* 게이지 바 */}
      <div>
        <div className="flex w-full text-[10px] text-ive-text-dim mb-1">
          <div className="flex justify-center" style={{ width: '25%' }}>{tr('gaugeIdle')}</div>
          <div className="flex justify-center" style={{ width: '25%' }}>{tr('gaugeRoom')}</div>
          <div className="flex justify-center" style={{ width: '25%' }}>{tr('gaugeOptimalShort')}</div>
          <div className="flex justify-center" style={{ width: '15%' }}>{tr('gaugeTight')}</div>
          <div className="flex justify-end overflow-visible whitespace-nowrap" style={{ width: '10%' }}>{tr('gaugeOverloadShort')}</div>
        </div>
        <div className="relative h-3 rounded-full bg-ive-bg-deep overflow-hidden">
          {/* 적정 구간 하이라이트 */}
          <div className="absolute h-full bg-ive-green/10" style={{ left: '50%', width: '25%' }} />
          {/* 현재 위치 */}
          <div className="absolute top-0 h-full w-1 rounded-full bg-ive-text transition-all"
            style={{ left: `${Math.min(Math.round(d.flow.utilization * 100), 110)}%` }} />
          {/* 구간 구분선 */}
          {[25, 50, 75, 90].map(v => <div key={v} className="absolute top-0 h-full w-px bg-ive-border-dark" style={{ left: `${v}%` }} />)}
        </div>
        <div className="text-center mt-1">
          <span className={`text-lg font-bold ${d.flow.healthLevel === 'overloaded' ? 'text-ive-red' : d.flow.healthLevel === 'tight' ? 'text-ive-amber' : d.flow.healthLevel === 'idle' ? 'text-ive-cyan' : 'text-ive-green'}`}>
            {Math.round(d.flow.utilization * 100).toLocaleString()}%
          </span>
        </div>
      </div>

      {/* 핵심 수치 */}
      <div className="grid grid-cols-2 gap-2 text-xs">
        <div className="flex justify-between"><span className="text-ive-text-dim">{tr('agentsLabel')}</span><span className="text-ive-text font-bold">{tr('agentCountUnit', { count: d.resource.currentAgents })}</span></div>
        <div className="flex justify-between"><span className="text-ive-text-dim">{tr('capacityLabel')}</span><span className="text-ive-text font-bold">{tr('perDayUnit', { count: d.flow.dailyCapacity.toFixed(1) })}</span></div>
        <div className="flex justify-between"><span className="text-ive-text-dim">{tr('inflowLabel2')}</span><span className="text-ive-text font-bold">{tr('perDayUnit', { count: d.flow.dailyInflow.toFixed(1) })}</span></div>
        <div className="flex justify-between"><span className="text-ive-text-dim">{tr('waitingLabel2')}</span><span className={`font-bold ${d.flow.currentWaiting >= 5 ? 'text-ive-red' : 'text-ive-text'}`}>{tr('countCases', { count: d.flow.currentWaiting })}</span></div>
      </div>

      {/* 진단 결과 */}
      {d.resource.gap !== 0 && (
        <div className={`text-xs font-bold p-2 rounded-lg ${d.resource.gap < 0 ? 'bg-ive-red/10 text-ive-red' : 'bg-ive-cyan/10 text-ive-cyan'}`}>
          {tr('currentToOptimal', { current: d.resource.currentAgents, optimal: d.resource.optimalAgents })}
          {' ('}
          {d.resource.gap > 0 ? tr('surplusGap', { count: d.resource.gap }) : tr('shortageGap', { count: Math.abs(d.resource.gap) })}
          {')'}
          {d.resource.queueDrainDays != null && d.resource.queueDrainDays > 0 && <span className="ml-2">{tr('queueDrainSuffix', { days: d.resource.queueDrainDays })}</span>}
          {d.resource.queueDrainDays === null && <span className="ml-2">{tr('queueDrainImpossible')}</span>}
        </div>
      )}

      {/* 재배치/충원/감축 안 */}
      {d.resource.scenario === 'rebalance' && d.resource.rebalancePlan.length > 0 && (
        <div className="bg-ive-bg-deep rounded-lg p-3 space-y-2">
          <div className="text-xs font-bold text-ive-amber"><i className="fa-solid fa-shuffle mr-1" />{tr('rebalanceTitle')}</div>
          {d.resource.rebalancePlan.map((r, i) => (
            <div key={i} className="text-xs text-ive-text">
              <span className="font-bold">{r.agentName}</span>: {r.fromProjectName} → {r.toProjectName}
              <div className="text-ive-text-dim mt-0.5">{tr('rebalanceResult', { from: r.fromProjectName, fromPct: r.resultFromUtil, to: r.toProjectName, toPct: r.resultToUtil })}</div>
            </div>
          ))}
        </div>
      )}
      {d.resource.scenario === 'shortage' && d.resource.shortagePlan.length > 0 && (
        <div className="bg-ive-bg-deep rounded-lg p-3 space-y-1">
          <div className="text-xs font-bold text-ive-red"><i className="fa-solid fa-plus-circle mr-1" />{tr('shortageTitle')}</div>
          {d.resource.shortagePlan.map((s, i) => (
            <div key={i} className="text-xs text-ive-text">
              {tr('shortageLine', { project: s.projectName, needed: s.needed, cur: s.currentUtil, target: s.targetUtil })}
              {s.urgencyDays && <span className="text-ive-red ml-1">{tr('urgencyDaysSuffix', { days: s.urgencyDays })}</span>}
            </div>
          ))}
        </div>
      )}
      {d.resource.scenario === 'surplus' && d.resource.surplusPlan.length > 0 && (
        <div className="bg-ive-bg-deep rounded-lg p-3 space-y-1">
          <div className="text-xs font-bold text-ive-cyan"><i className="fa-solid fa-arrows-left-right mr-1" />{tr('surplusTitle')}</div>
          {d.resource.surplusPlan.map((s, i) => (
            <div key={i} className="text-xs text-ive-text">
              {tr('surplusLine', { agent: s.agentName, project: s.projectName, capacity: s.agentCapacity })}
            </div>
          ))}
          <div className="text-[10px] text-ive-text-dim pt-1 border-t border-ive-border-dark/50 mt-1">
            {tr('surplusWarning')}
          </div>
        </div>
      )}
    </section>
  )
}
