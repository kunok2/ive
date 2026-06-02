'use client'

import { useTranslations, useLocale } from 'next-intl'
import Sparkline from '@/components/ui/Sparkline'
import { formatMoney } from '@/lib/currency'
import type { ReportData, DiagnosisResult, ReportHelpers } from './types'

interface CostBreakdownProps {
  d: DiagnosisResult
  data: ReportData
  helpers: ReportHelpers
}

export default function CostBreakdown({ d, data, helpers }: CostBreakdownProps) {
  const tr = useTranslations('report')
  const locale = useLocale()
  const { fmtCost, fmtDur, diffBadge, diffColor, cur } = helpers

  if (d.flow.totalCost <= 0) return null

  return (
    <section className="bg-ive-bg-card border border-ive-border-subtle rounded-lg p-3 space-y-1.5">
      <div className="flex items-center justify-between">
        <span className="text-xs font-bold text-ive-text">{tr('costTotalCompact', { amount: fmtCost(d.flow.totalCost) })}</span>
        <span className="text-xs text-ive-text-dim">{tr('costPerTaskCompact', { amount: fmtCost(d.flow.costPerTask) })}</span>
        {d.flow.prevCostPerTask > 0 && (() => {
          const b = diffBadge(d.flow.costPerTask, d.flow.prevCostPerTask)
          return b ? <span className={`text-xs font-bold ${diffColor(d.flow.costPerTask, d.flow.prevCostPerTask, true)}`}>{b}</span> : null
        })()}
      </div>
      {/* 적용 환율 안내 — USD 외 통화로 환산해 표시할 때만 노출 */}
      {cur.code !== 'USD' && (
        <div className="text-[10px] text-ive-text-dim">
          <i className="fa-solid fa-money-bill-transfer mr-1" />
          {tr('exchangeRateBadge', {
            rate: cur.rate.toLocaleString(locale, { maximumFractionDigits: cur.rate >= 100 ? 0 : 4 }),
            code: cur.code,
          })}
          {cur.source === 'manual'
            ? <span className="ml-1">· {tr('exchangeRateManualTag')}</span>
            : cur.updatedAt
              ? <span className="ml-1">· {tr('exchangeRateAtTag', { at: new Date(cur.updatedAt).toLocaleDateString() })}</span>
              : null}
        </div>
      )}
      {/* 비용 내역: AI 토큰 + 사람 시간 분리 */}
      {(d.flow.totalCostAi > 0 || d.flow.totalCostHuman > 0) && (
        <div className="space-y-1 bg-ive-bg-deep rounded-lg px-2.5 py-2 border border-ive-border-dark">
          <div className="flex items-center justify-between text-xs">
            <span className="text-ive-text-dim"><i className="fa-solid fa-robot mr-1 text-ive-text-muted" />{tr('aiTokenCost')}</span>
            <span className="font-mono font-bold text-ive-text">{fmtCost(d.flow.totalCostAi)}</span>
          </div>
          <div className="flex items-center justify-between text-xs">
            <span className="text-ive-text-dim"><i className="fa-solid fa-user mr-1 text-ive-text-muted" />{tr('humanTimeCost')}</span>
            <span className="font-mono font-bold text-ive-text">{fmtCost(d.flow.totalCostHuman)}</span>
          </div>
          {d.flow.humanMinutes > 0 && d.flow.humanMonthlySalary > 0 && (
            <div className="text-[10px] text-ive-text-dim pt-1 border-t border-ive-border-dark/50 mt-1">
              {tr('salaryBasis', { salary: fmtCost(d.flow.humanMonthlySalary), hours: Math.round(d.flow.humanMonthlyMinutes / 60), perMin: formatMoney(d.flow.humanMonthlySalary / d.flow.humanMonthlyMinutes, cur.code, cur.rate, locale) })}
              <br />
              {tr('salaryCalc', { duration: fmtDur(d.flow.humanMinutes), perMin: formatMoney(d.flow.humanMonthlySalary / d.flow.humanMonthlyMinutes, cur.code, cur.rate, locale), total: fmtCost(d.flow.totalCostHuman) })}
            </div>
          )}
          {d.flow.humanMonthlySalary === 0 && (
            <div className="text-[10px] text-ive-text-dim pt-1 border-t border-ive-border-dark/50 mt-1">
              {tr('noHumanSalary')}
            </div>
          )}
        </div>
      )}
      {d.retryCostRatio > 0.05 && (
        <div className="text-xs text-ive-text-dim">
          {tr('retryCostLine', { amount: fmtCost(d.retryCostAmount), pct: Math.round(d.retryCostRatio * 100) })}
          {d.highRetryProject && <span className="ml-1">{tr('highRetryProjectLine', { name: d.highRetryProject.name, rate: Math.round(d.highRetryProject.rate) })}</span>}
        </div>
      )}
      {/* 일별 비용 스파크라인 */}
      {data.dailyTrend.length >= 2 && (
        <Sparkline data={data.dailyTrend.map(d => d.cost)} width="100%" height={24} color="cyan" />
      )}
    </section>
  )
}
