'use client'

import { useTranslations } from 'next-intl'
import type { ReportData, DiagnosisResult, ReportHelpers } from './types'

interface LifecycleSectionProps {
  d: DiagnosisResult
  data: ReportData
  helpers: ReportHelpers
}

export default function LifecycleSection({ d, data, helpers }: LifecycleSectionProps) {
  const tr = useTranslations('report')
  const { fmtDur, diffBadge, diffColor, resolveMsg } = helpers

  if (data.lifecycle.procCount <= 0) return null

  return (
    <section className="bg-ive-bg-card border border-ive-border-subtle rounded-lg p-4 space-y-3">
      {/* 체감 해결시간 */}
      {data.lifecycle.totalAvg > 0 && (
        <div className="text-xs font-bold text-ive-text">
          {tr('avgResolveTime', { duration: fmtDur(data.lifecycle.totalAvg) })}
          {data.prevLifecycle.totalAvg > 0 && <span className="text-ive-text-dim font-bold ml-1">{tr('prevLifecycleSuffix', { duration: fmtDur(data.prevLifecycle.totalAvg) })}</span>}
        </div>
      )}

      {/* 인사이트 문장 */}
      {data.lifecycle.totalAvg > 0 && (() => {
        const waitPct = Math.round((data.lifecycle.waitAvg / data.lifecycle.totalAvg) * 100)
        const procPct = Math.round((data.lifecycle.procAvg / data.lifecycle.totalAvg) * 100)
        const verifyPct = data.lifecycle.verifyCount > 0 ? Math.round((data.lifecycle.verifyAvg / data.lifecycle.totalAvg) * 100) : 0
        let insight = tr('insightEven')
        if (waitPct >= 50) insight = tr('insightWait', { pct: waitPct })
        else if (procPct >= 60) insight = tr('insightProc', { pct: procPct })
        else if (verifyPct >= 40) insight = tr('insightVerify', { pct: verifyPct })
        return <div className="text-xs text-ive-text-dim">{insight}</div>
      })()}

      {/* 단계별 */}
      <div className={`grid gap-2 ${data.lifecycle.verifyCount > 0 ? 'grid-cols-3' : 'grid-cols-2'}`}>
        {data.lifecycle.waitCount > 0 && (
          <div className="text-center">
            <div className="text-xs text-ive-text-dim">{tr('stageWait')}</div>
            <div className="text-sm font-bold text-ive-text">{fmtDur(data.lifecycle.waitAvg)}</div>
            {data.prevLifecycle.waitAvg > 0 && (() => {
              const b = diffBadge(data.lifecycle.waitAvg, data.prevLifecycle.waitAvg)
              return b ? <div className={`text-xs font-bold ${diffColor(data.lifecycle.waitAvg, data.prevLifecycle.waitAvg, true)}`}>{b}</div> : null
            })()}
          </div>
        )}
        <div className="text-center">
          <div className="text-xs text-ive-text-dim">{tr('stageProc')}</div>
          <div className="text-sm font-bold text-ive-text">{fmtDur(data.lifecycle.procAvg)}</div>
          {data.prevLifecycle.procAvg > 0 && (() => {
            const b = diffBadge(data.lifecycle.procAvg, data.prevLifecycle.procAvg)
            return b ? <div className={`text-xs font-bold ${diffColor(data.lifecycle.procAvg, data.prevLifecycle.procAvg, true)}`}>{b}</div> : null
          })()}
        </div>
        {data.lifecycle.verifyCount > 0 && (
          <div className="text-center">
            <div className="text-xs text-ive-text-dim">{tr('stageVerify')}</div>
            <div className="text-sm font-bold text-ive-text">{fmtDur(data.lifecycle.verifyAvg)}</div>
            {data.prevLifecycle.verifyAvg > 0 && (() => {
              const b = diffBadge(data.lifecycle.verifyAvg, data.prevLifecycle.verifyAvg)
              return b ? <div className={`text-xs font-bold ${diffColor(data.lifecycle.verifyAvg, data.prevLifecycle.verifyAvg, true)}`}>{b}</div> : null
            })()}
          </div>
        )}
      </div>

      {/* 비율 바 */}
      {data.lifecycle.totalAvg > 0 && (() => {
        const waitPct = Math.round((data.lifecycle.waitAvg / data.lifecycle.totalAvg) * 100)
        const procPct = Math.round((data.lifecycle.procAvg / data.lifecycle.totalAvg) * 100)
        const verifyPct = data.lifecycle.verifyCount > 0 ? Math.round((data.lifecycle.verifyAvg / data.lifecycle.totalAvg) * 100) : 0
        return (
          <div>
            <div className="flex h-2 rounded-full overflow-hidden bg-ive-bg-deep">
              {waitPct > 0 && <div className="bg-ive-cyan/30" style={{ width: `${waitPct}%` }} />}
              <div className="bg-ive-cyan/60" style={{ width: `${procPct}%` }} />
              {verifyPct > 0 && <div className="bg-ive-cyan/90" style={{ width: `${verifyPct}%` }} />}
            </div>
            <div className="flex justify-between mt-1 text-xs text-ive-text-dim">
              {waitPct > 0 && <span>{tr('waitPct', { pct: waitPct })}</span>}
              <span>{tr('procPct', { pct: procPct })}</span>
              {verifyPct > 0 && <span>{tr('verifyPct', { pct: verifyPct })}</span>}
            </div>
          </div>
        )
      })()}

      <div className="text-xs text-ive-text-dim text-center">
        {tr('retryIssueSummary', { count: data.lifecycle.avgAttempts.toFixed(1), issues: data.lifecycle.uniqueIssues })}
      </div>

      {/* 검증자 진단 */}
      {d.verifier && (
        <div className="pt-2 border-t border-ive-border-dark/50">
          <div className="flex items-center justify-between text-xs">
            <span className="text-ive-text-dim">{tr('verifierResourceLine', { count: d.verifier.verifierCount, capacity: d.verifier.dailyVerifyCapacity })}</span>
            <span className={`font-bold ${d.verifier.verifyUtilization >= 0.9 ? 'text-ive-red' : 'text-ive-text-dim'}`}>{tr('utilizationPctLabel', { pct: Math.round(d.verifier.verifyUtilization * 100) })}</span>
          </div>
          {d.verifier.annotation && <div className="text-xs text-ive-amber mt-0.5">{resolveMsg(d.verifier.annotation)}</div>}
        </div>
      )}
    </section>
  )
}
