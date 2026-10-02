'use client'

/**
 * 보고서 탭 — 보고서 모델(/api/reports/v2)을 그린다. 숫자는 서버의 보고서 모델에서만 계산한다(메일과 같은 값).
 *
 * 주간(개발팀장): 지금 안고 있는 일 → 지금 손쓸 것 → 어디에 → 누구 손에 → 사람 시간이 쓰인 곳 → 끝낸 일 → 지난 기간 비교 → 투입과 비용 → 완료 목록
 * 월간·연간(경영진): 위 요약 + 산출 추이 · 사람 시간 비중 추이 · 살펴볼 위험 · 작업 결과 평가
 */
import { useEffect, useState, useCallback, useMemo } from 'react'
import { useTranslations, useLocale } from 'next-intl'
import { formatMoney, type ResolvedCurrency } from '@/lib/currency'
import { formatDateMedium } from '@/lib/format-date'
import { useDialog } from '@/components/ui/ConfirmDialog'
import PullToRefresh from '@/components/ui/PullToRefresh'
import { ErrorBoundary } from '@/components/ui/ErrorBoundary'
import { getKSTTodayString } from '@/lib/date-utils'
import type { ReportModel } from '@/lib/report-model/types'
import {
  HeldCard, ActionCards, WhereSection, PeopleSection, ProjectsSection, DoneSection, CostSection, CompletedList, Card, SectionTitle,
} from '@/components/report/sections'
import { TrendCompare, HeldCompare } from '@/components/report/charts'
import { MonthsSection, ShareTrendSection, RiskSection, EvaluationSection } from '@/components/report/monthly'
import type { Tr } from '@/components/report/format'

const USD_CURRENCY: ResolvedCurrency = { code: 'USD', rate: 1, source: 'usd', updatedAt: null }
type ReportType = 'weekly' | 'monthly' | 'yearly'

function shiftDate(day: string, type: ReportType, dir: -1 | 1): string {
  const d = new Date(`${day}T00:00:00Z`)
  if (type === 'weekly') d.setUTCDate(d.getUTCDate() + dir * 7)
  else if (type === 'monthly') { d.setUTCDate(1); d.setUTCMonth(d.getUTCMonth() + dir) }
  else d.setUTCFullYear(d.getUTCFullYear() + dir)
  return d.toISOString().slice(0, 10)
}

export default function ReportsTab() {
  const trOld = useTranslations('report')
  const trV = useTranslations('reportV2')
  const tr: Tr = useCallback((k, p) => trV(k as never, p as never), [trV])
  const { confirm } = useDialog()
  const locale = useLocale()

  const [cur, setCur] = useState<ResolvedCurrency>(USD_CURRENCY)
  useEffect(() => {
    fetch('/api/settings/currency').then(r => (r.ok ? r.json() : null)).then(d => { if (d?.code) setCur(d) }).catch(() => {})
  }, [])
  const fmtMoney = useCallback((usd: number) => formatMoney(usd, cur.code, cur.rate, locale), [cur, locale])

  const [type, setType] = useState<ReportType>('weekly')
  const [date, setDate] = useState(getKSTTodayString())
  const [model, setModel] = useState<ReportModel | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)
  const [regenerating, setRegenerating] = useState(false)

  const fetchReport = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const res = await fetch(`/api/reports/v2?type=${type}&date=${date}`)
      if (!res.ok) throw new Error((await res.json().catch(() => null))?.error || `HTTP ${res.status}`)
      setModel(await res.json())
    } catch (e) {
      setError((e as Error).message)
      setModel(null)
    } finally { setLoading(false) }
  }, [type, date])

  useEffect(() => { fetchReport() }, [fetchReport])

  const regenerate = useCallback(async () => {
    const ok = await confirm({ title: trOld('regenerateTitle'), message: trOld('regenerateMessage'), confirmText: trOld('regenerateConfirm'), variant: 'warning' })
    if (!ok) return
    setRegenerating(true)
    try {
      await fetch(`/api/reports/v2?type=${type}&date=${date}`, { method: 'DELETE' }).catch(() => null)
      await fetchReport()
    } finally { setRegenerating(false) }
  }, [confirm, trOld, type, date, fetchReport])

  const dayLabels = useMemo(() => trOld.raw('dayLabels') as string[], [trOld])

  const periodLabel = (m: ReportModel) => {
    const s = new Date(`${m.period.start}T00:00:00Z`)
    const e = new Date(`${m.period.end}T00:00:00Z`); e.setUTCDate(e.getUTCDate() - 1)
    if (m.type === 'weekly') return trOld('periodWeeklyLabel', { year: s.getUTCFullYear(), month1: s.getUTCMonth() + 1, day1: s.getUTCDate(), month2: e.getUTCMonth() + 1, day2: e.getUTCDate() })
    if (m.type === 'monthly') return trOld('yearMonth', { year: s.getUTCFullYear(), month: s.getUTCMonth() + 1 })
    return trOld('yearUnit', { year: s.getUTCFullYear() })
  }
  const prevLabel = tr(`prev.${type}`)

  return (
    <PullToRefresh onRefresh={fetchReport} className="w-full flex-1 flex flex-col max-w-lg mx-auto px-4 overflow-hidden">
      <div className="shrink-0 pt-4 pb-2" data-tour="reports-period">
        <div className="flex gap-1 mb-2">
          {(['weekly', 'monthly', 'yearly'] as const).map(rt => (
            <button key={rt} onClick={() => setType(rt)} className={`flex-1 min-h-11 text-sm font-bold rounded-lg transition-all ${type === rt ? 'bg-ive-green text-ive-bg-deep' : 'bg-ive-bg-card text-ive-text-secondary'}`}>
              {trOld(rt)}
            </button>
          ))}
        </div>
        <div className="flex items-center justify-between">
          <button aria-label={tr('prevPeriod')} onClick={() => setDate(d => shiftDate(d, type, -1))} className="w-11 h-11 flex items-center justify-center rounded-lg text-ive-text-secondary hover:text-ive-text"><i className="fa-solid fa-chevron-left" /></button>
          <div className="flex items-center gap-2">
            <span className="text-sm font-bold text-ive-text">{model ? periodLabel(model) : '...'}</span>
            {model && !model.isCurrent && (
              <button onClick={() => setDate(getKSTTodayString())} className="px-2 py-0.5 text-xs font-bold rounded-lg bg-ive-cyan/20 text-ive-cyan hover:bg-ive-cyan/30">{trOld('today')}</button>
            )}
            {model?.snapshotAt && (
              <>
                <span title={trOld('snapshotHint', { at: formatDateMedium(model.snapshotAt, locale) })} className="px-2 py-0.5 text-xs font-bold rounded-lg bg-white/5 text-ive-text-secondary border border-ive-border-subtle">
                  <i className="fa-solid fa-lock mr-1 opacity-70" />{trOld('snapshotBadge')}
                </span>
                <button onClick={regenerate} disabled={regenerating} title={trOld('regenerateTitle')} aria-label={trOld('regenerateTitle')} className="w-8 h-8 flex items-center justify-center rounded-lg text-ive-text-secondary hover:text-ive-text hover:bg-white/5 disabled:opacity-40">
                  <i className={`fa-solid fa-rotate ${regenerating ? 'fa-spin' : ''}`} />
                </button>
              </>
            )}
          </div>
          <button aria-label={tr('nextPeriod')} onClick={() => setDate(d => shiftDate(d, type, 1))} className="w-11 h-11 flex items-center justify-center rounded-lg text-ive-text-secondary hover:text-ive-text"><i className="fa-solid fa-chevron-right" /></button>
        </div>
      </div>

      <div className="flex-1 min-h-0 overflow-y-auto">
        <div className="pb-20">
          {loading && <div className="flex flex-col items-center justify-center py-10 gap-3 text-ive-text-secondary"><i className="fa-solid fa-circle-notch fa-spin text-2xl" />{trOld('loadingCompact')}</div>}
          {!loading && error && (
            <div className="bg-ive-bg-card border border-ive-border-subtle rounded-lg p-4 text-sm font-bold text-ive-text flex flex-col gap-2">
              <span><i className="fa-solid fa-circle-xmark text-ive-red mr-1.5" />{tr('loadFailed')}</span>
              <span className="text-xs text-ive-text-secondary break-all">{error}</span>
              <button onClick={fetchReport} className="self-start px-3 py-2 rounded-lg bg-white/5 border border-ive-border-subtle text-sm font-bold text-ive-text-muted">{tr('retry')}</button>
            </div>
          )}
          {!loading && model && (
            <main className="flex flex-col gap-3">
              <ErrorBoundary label="보유"><HeldCard held={model.held} tr={tr} prevLabel={prevLabel} tracking={model.heldTrackingSince} /></ErrorBoundary>
              {model.actions && <ErrorBoundary label="손쓸 것"><ActionCards actions={model.actions} tr={tr} /></ErrorBoundary>}
              {model.type !== 'weekly' && model.risks && <ErrorBoundary label="위험"><RiskSection risks={model.risks} tr={tr} /></ErrorBoundary>}
              <ErrorBoundary label="어디에"><WhereSection held={model.held} tr={tr} /></ErrorBoundary>
              <ErrorBoundary label="누구 손에"><PeopleSection held={model.held} tr={tr} /></ErrorBoundary>
              {model.type !== 'weekly' && model.months && <ErrorBoundary label="산출 추이"><MonthsSection months={model.months} tr={tr} /></ErrorBoundary>}
              <ErrorBoundary label="프로젝트"><ProjectsSection projects={model.projects} cost={model.cost} tr={tr} prevLabel={prevLabel} /></ErrorBoundary>
              {model.type !== 'weekly' && model.months && <ErrorBoundary label="비중 추이"><ShareTrendSection months={model.months} tr={tr} /></ErrorBoundary>}
              <ErrorBoundary label="끝낸 일"><DoneSection done={model.done} tr={tr} prevLabel={prevLabel} /></ErrorBoundary>
              <ErrorBoundary label="비교">
                <Card>
                  <SectionTitle>{tr('compareTitle', { label: prevLabel })}</SectionTitle>
                  <TrendCompare trend={model.trend} type={model.type} tr={tr} dayLabels={dayLabels} prevLabel={prevLabel} />
                  <div className="pt-1"><SectionTitle>{tr('heldCompareTitle', { label: prevLabel })}</SectionTitle></div>
                  <HeldCompare trend={model.trend} type={model.type} tr={tr} dayLabels={dayLabels} prevLabel={prevLabel} />
                  {model.trend.held.every(v => v == null) && <span className="text-xs font-bold text-ive-text-muted">{tr('heldTrendNoRecord')}</span>}
                </Card>
              </ErrorBoundary>
              <ErrorBoundary label="비용"><CostSection cost={model.cost} tr={tr} fmtMoney={fmtMoney} prevLabel={prevLabel} /></ErrorBoundary>
              {model.type !== 'weekly' && model.evaluation && <ErrorBoundary label="평가"><EvaluationSection ev={model.evaluation} tr={tr} /></ErrorBoundary>}
              <ErrorBoundary label="완료 목록"><CompletedList items={model.completedList} tr={tr} /></ErrorBoundary>
              {model.done.total === 0 && model.held.inflow === 0 && (model.held.end ?? 0) === 0 && (
                <div className="text-center py-6 text-sm font-bold text-ive-text-secondary">{trOld('noWorkInPeriod')}</div>
              )}
            </main>
          )}
        </div>
      </div>
    </PullToRefresh>
  )
}
