'use client'

import { useTranslations } from 'next-intl'
import type { ReportType, ReportData, DiagnosisResult, ReportHelpers } from './types'

interface BriefingSectionProps {
  d: DiagnosisResult
  type: ReportType
  monthData: ReportData | null
  yearData: ReportData | null
  helpers: ReportHelpers
  briefingBg: string
}

export default function BriefingSection({ d, type, monthData, yearData, helpers, briefingBg }: BriefingSectionProps) {
  const tr = useTranslations('report')
  const { fmtCost, resolveMsg } = helpers

  return (
    <section className={`border rounded-lg p-4 ${briefingBg}`}>
      <p className="text-sm font-bold text-ive-text leading-relaxed">{d.briefing.map(resolveMsg).join(' ')}</p>
      {/* 다기간 맥락 */}
      <div className="mt-3 pt-3 border-t border-ive-border-dark/50 space-y-1">
        {type !== 'monthly' && monthData && (
          <div className="flex items-center justify-between text-xs">
            <span className="text-ive-text-dim">{tr('thisMonth')}</span>
            <span className="text-ive-text font-bold">{tr('countCases', { count: monthData.summary.totalTasks })} · {fmtCost(monthData.summary.totalCost)}</span>
          </div>
        )}
        {type !== 'yearly' && yearData && (
          <div className="flex items-center justify-between text-xs">
            <span className="text-ive-text-dim">{tr('thisYear')}</span>
            <span className="text-ive-text font-bold">{tr('countCases', { count: yearData.summary.totalTasks.toLocaleString() })} · {fmtCost(yearData.summary.totalCost)}</span>
          </div>
        )}
      </div>
    </section>
  )
}
