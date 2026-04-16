'use client'

import { useEffect, useState, useCallback, useMemo } from 'react'
import { useRouter } from 'next/navigation'
import { useTranslations } from 'next-intl'
import PullToRefresh from '@/components/ui/PullToRefresh'
import BriefingSection from '@/components/tabs/reports/BriefingSection'
import UtilizationGauge from '@/components/tabs/reports/UtilizationGauge'
import FlowPipeline from '@/components/tabs/reports/FlowPipeline'
import AlertCards from '@/components/tabs/reports/AlertCards'
import CostBreakdown from '@/components/tabs/reports/CostBreakdown'
import LifecycleSection from '@/components/tabs/reports/LifecycleSection'
import ProjectFlowSection from '@/components/tabs/reports/ProjectFlowSection'
import AgentLoadSection from '@/components/tabs/reports/AgentLoadSection'
import VerifierLoadSection from '@/components/tabs/reports/VerifierLoadSection'
import UserVerifySection from '@/components/tabs/reports/UserVerifySection'
import DailyTrendSection from '@/components/tabs/reports/DailyTrendSection'
import IssueListSection from '@/components/tabs/reports/IssueListSection'
import { FlowCompareChart, DailyTrendChart } from '@/components/reports/ReportCharts'
import { diagnose, type ReportData, type DiagnosisResult, type I18nMessage } from '@/lib/report-diagnosis'
import { getKSTTodayString } from '@/lib/date-utils'
import type { ReportHelpers } from '@/components/tabs/reports/types'

export type { ReportData, DiagnosisResult }

export default function ReportsTab() {
  const router = useRouter()
  const tr = useTranslations('report')

  // ─── Helpers ───
  const helpers = useMemo<ReportHelpers>(() => ({
    fmtCost: (n: number) => n.toLocaleString(undefined, { maximumFractionDigits: 0 }),
    fmtDur: (min: number) => {
      if (min < 60) return tr('durMin', { value: Math.round(min) })
      const h = Math.floor(min / 60), m = Math.round(min % 60)
      return m > 0 ? tr('durHourMin', { h, m }) : tr('durHour', { h })
    },
    diffBadge: (cur: number, prev: number) => {
      if (prev === 0) return cur > 0 ? tr('newBadge') : null
      const pct = Math.round(((cur - prev) / prev) * 100)
      if (pct === 0) return null
      return `${pct > 0 ? '+' : ''}${pct.toLocaleString()}%`
    },
    diffColor: (cur: number, prev: number, invert = false) => {
      if (prev === 0) return 'text-ive-cyan'
      const pct = ((cur - prev) / prev) * 100
      if (invert) return pct > 0 ? 'text-ive-red' : pct < 0 ? 'text-ive-green' : 'text-ive-text-dim'
      return pct > 0 ? 'text-ive-green' : pct < 0 ? 'text-ive-red' : 'text-ive-text-dim'
    },
    resolveMsg: (msg: I18nMessage) => {
      const params: Record<string, string | number> = { ...(msg.params ?? {}) }
      if (msg.nestedKeys) {
        for (const [k, nestedKey] of Object.entries(msg.nestedKeys)) {
          params[k] = tr(nestedKey as never)
        }
      }
      return tr(msg.key as never, params as never)
    },
  }), [tr])

  // ─── Period helpers ───
  const formatPeriodLabel = useCallback((rtype: 'weekly' | 'monthly' | 'yearly', start: string, end: string) => {
    const s = new Date(start), e = new Date(end)
    e.setDate(e.getDate() - 1)
    if (rtype === 'weekly') return tr('periodWeeklyLabel', {
      year: s.getFullYear(), month1: s.getMonth() + 1, day1: s.getDate(),
      month2: e.getMonth() + 1, day2: e.getDate(),
    })
    if (rtype === 'monthly') return tr('yearMonth', { year: s.getFullYear(), month: s.getMonth() + 1 })
    return tr('yearUnit', { year: s.getFullYear() })
  }, [tr])

  const briefingBg = (d: DiagnosisResult | null) => {
    if (!d) return 'bg-ive-bg-card border-ive-border-subtle'
    if (d.flow.healthLevel === 'overloaded') return 'bg-gradient-to-r from-ive-red/5 to-ive-bg-card border-ive-red/30 border-l-2'
    if (d.flow.healthLevel === 'tight') return 'bg-gradient-to-r from-ive-amber/5 to-ive-bg-card border-ive-amber/30'
    return 'bg-ive-bg-card border-ive-border-subtle'
  }

  const dayLabels = useMemo(() => tr.raw('dayLabels') as string[], [tr])

  // ─── State ───
  const [type, setType] = useState<'weekly' | 'monthly' | 'yearly'>('weekly')
  const [date, setDate] = useState(getKSTTodayString())
  const [data, setData] = useState<ReportData | null>(null)
  const [monthData, setMonthData] = useState<ReportData | null>(null)
  const [yearData, setYearData] = useState<ReportData | null>(null)
  const [prevWeeks, setPrevWeeks] = useState<ReportData[]>([])
  const [loading, setLoading] = useState(false)
  const [diagnosis, setDiagnosis] = useState<DiagnosisResult | null>(null)
  const [showTrend, setShowTrend] = useState(true)

  // ─── Flow data ───
  const today = getKSTTodayString()

  const computeFlowDays = useCallback(() => {
    if (!data) return []
    return data.dailyTrend.map(dt => {
      const label = data.period.type === 'yearly'
        ? tr('monthUnit', { month: parseInt(dt.date.slice(5, 7)) })
        : data.period.type === 'weekly' ? dayLabels[new Date(dt.date).getDay()] : `${new Date(dt.date).getDate()}`
      if (dt.inflow === null || dt.date > today) return { label, inflow: null, throughput: null }
      return { label, inflow: dt.inflow, throughput: dt.verified ?? 0 }
    })
  }, [data, dayLabels, today, tr])

  const computePrevFlowDays = useCallback(() => {
    if (!data?.prevDailyTrend) return []
    return data.prevDailyTrend.map(dt => {
      const label = data.period.type === 'yearly'
        ? tr('monthUnit', { month: parseInt(dt.date.slice(5, 7)) })
        : data.period.type === 'weekly' ? dayLabels[new Date(dt.date).getDay()] : `${new Date(dt.date).getDate()}`
      return { label, prevInflow: dt.inflow ?? 0, prevThroughput: dt.verified ?? 0 }
    })
  }, [data, dayLabels, tr])

  // ─── Data fetch ───
  const fetchReport = useCallback(async () => {
    setLoading(true)
    try {
      const [mainRes, monthRes, yearRes] = await Promise.all([
        fetch(`/api/reports?type=${type}&date=${date}`),
        fetch(`/api/reports?type=monthly&date=${date}`),
        fetch(`/api/reports?type=yearly&date=${date}`),
      ])
      const mainData: ReportData = mainRes.ok ? await mainRes.json() : null
      const mData: ReportData = monthRes.ok ? await monthRes.json() : null
      const yData: ReportData = yearRes.ok ? await yearRes.json() : null
      setData(mainData)
      setMonthData(type !== 'monthly' ? mData : mainData)
      setYearData(type !== 'yearly' ? yData : mainData)

      if (type === 'weekly') {
        const d1 = new Date(date); d1.setDate(d1.getDate() - 7)
        const d2 = new Date(date); d2.setDate(d2.getDate() - 14)
        const [pw1, pw2] = await Promise.all([
          fetch(`/api/reports?type=weekly&date=${d1.toISOString().slice(0, 10)}`).then(r => r.ok ? r.json() : null),
          fetch(`/api/reports?type=weekly&date=${d2.toISOString().slice(0, 10)}`).then(r => r.ok ? r.json() : null),
        ])
        setPrevWeeks([pw2, pw1].filter(Boolean))
      } else {
        setPrevWeeks([])
      }

      if (mainData) {
        const diag = diagnose(mainData, type === 'weekly' ? [].filter(Boolean) : undefined, helpers.fmtDur)
        setDiagnosis(diag)
      }
    } finally { setLoading(false) }
  }, [type, date, helpers])

  useEffect(() => {
    if (data && type === 'weekly' && prevWeeks.length > 0) {
      setDiagnosis(diagnose(data, prevWeeks, helpers.fmtDur))
    }
  }, [data, prevWeeks, type, helpers])

  useEffect(() => { fetchReport() }, [fetchReport])

  // ─── Navigation ───
  function navigate(dir: -1 | 1) {
    const d = new Date(date)
    if (type === 'weekly') d.setDate(d.getDate() + dir * 7)
    else if (type === 'monthly') d.setMonth(d.getMonth() + dir)
    else d.setFullYear(d.getFullYear() + dir)
    setDate(d.toISOString().slice(0, 10))
  }

  function isCurrentPeriod(): boolean {
    if (!data) return false
    const today2 = getKSTTodayString()
    return today2 >= data.period.start && today2 < data.period.end
  }

  // ─── Flow chart data ───
  const inflowData = computeFlowDays().filter(f => f.inflow !== null).map(f => f.inflow as number)
  const throughputData = computeFlowDays().filter(f => f.throughput !== null).map(f => f.throughput as number)

  return (
    <PullToRefresh onRefresh={fetchReport} className="w-full flex-1 flex flex-col max-w-lg mx-auto px-4 overflow-hidden">
      {/* Period selector */}
      <div className="shrink-0 pt-4 pb-2">
        <div data-tour="reports-period">
          <div className="flex gap-1 mb-2">
            {(['weekly', 'monthly', 'yearly'] as const).map(rt => (
              <button key={rt} onClick={() => setType(rt)} className={`flex-1 py-1.5 text-xs font-bold rounded-lg transition-all ${type === rt ? 'bg-ive-green text-ive-bg-deep' : 'bg-ive-bg-card text-ive-text-dim'}`}>
                {tr(rt)}
              </button>
            ))}
          </div>
          <div className="flex items-center justify-between">
            <button onClick={() => navigate(-1)} className="w-8 h-8 flex items-center justify-center text-ive-text-dim hover:text-ive-text"><i className="fa-solid fa-chevron-left" /></button>
            <div className="flex items-center gap-2">
              <span className="text-sm font-bold text-ive-text">{data ? formatPeriodLabel(type, data.period.start, data.period.end) : '...'}</span>
              {!isCurrentPeriod() && (
                <button onClick={() => setDate(getKSTTodayString())} className="px-2 py-0.5 text-xs font-bold rounded-lg bg-ive-cyan/20 text-ive-cyan hover:bg-ive-cyan/30 transition-colors">{tr('today')}</button>
              )}
            </div>
            <button onClick={() => navigate(1)} className="w-8 h-8 flex items-center justify-center text-ive-text-dim hover:text-ive-text"><i className="fa-solid fa-chevron-right" /></button>
          </div>
        </div>
      </div>

      <div className="flex-1 min-h-0 overflow-y-auto">
        <div className="pb-20">
          {loading && <div className="flex flex-col items-center justify-center py-10 gap-3 text-ive-text-dim"><i className="fa-solid fa-circle-notch fa-spin text-2xl" />{tr('loadingCompact')}</div>}

          {data && !loading && diagnosis && (
            <main className="space-y-3">

              {/* ① 진단 브리핑 */}
              <BriefingSection
                d={diagnosis}
                type={type}
                monthData={monthData}
                yearData={yearData}
                helpers={helpers}
                briefingBg={briefingBg(diagnosis)}
              />

              {/* ② 자원 현황 게이지 */}
              {diagnosis.flow.dailyCapacity > 0 && (
                <UtilizationGauge d={diagnosis} helpers={helpers} />
              )}

              {/* ③ 흐름도 */}
              <FlowPipeline
                d={diagnosis}
                inflowData={inflowData}
                throughputData={throughputData}
                waitingData={data?.waitingTrend ? data.waitingTrend.filter(w => w.date <= today).map(w => w.total) : []}
                helpers={helpers}
              />

              {/* ③-2 추이 그래프 */}
              {data.dailyTrend.length > 0 && (
                <div className="space-y-2">
                  <div className="text-xs font-bold text-ive-text-dim uppercase tracking-wider">{tr('trendChartToggle')}</div>
                  <FlowCompareChart data={computeFlowDays()} prevData={computePrevFlowDays()} type={type} />
                  <DailyTrendChart data={data.dailyTrend} prevData={data.prevDailyTrend} type={type} />
                </div>
              )}

              {/* ④ 주의/경고 카드 */}
              {diagnosis.alerts.length > 0 && (
                <AlertCards d={diagnosis} helpers={helpers} />
              )}

              {/* ⑤ 비용 + 재시도 */}
              {diagnosis.flow.totalCost > 0 && (
                <CostBreakdown d={diagnosis} data={data} helpers={helpers} />
              )}

              {/* ⑥ 소요 시간 (파이프라인) */}
              {data.lifecycle.procCount > 0 && (
                <LifecycleSection d={diagnosis} data={data} helpers={helpers} />
              )}

              {/* ⑦ 프로젝트별 흐름 */}
              {diagnosis.projects.length > 0 && (
                <ProjectFlowSection d={diagnosis} data={data} helpers={helpers} />
              )}

              {/* ⑧ 에이전트별 부하 */}
              {diagnosis.agents.length > 0 && (
                <AgentLoadSection d={diagnosis} data={data} helpers={helpers} />
              )}

              {/* ⑧-2 검증자별 부하 */}
              {diagnosis.verifierLoads && diagnosis.verifierLoads.length > 0 && (
                <VerifierLoadSection d={diagnosis} helpers={helpers} />
              )}

              {/* ⑨ 담당자별 검증 현황 */}
              {data.byUser && data.byUser.length > 0 && (
                <UserVerifySection data={data} helpers={helpers} />
              )}

              {/* ⑩ 일별 현황 */}
              {data.dailyTrend.length > 0 && (
                <DailyTrendSection
                  data={data}
                  type={type}
                  today={today}
                />
              )}

              {/* ⑪ 이슈 목록 */}
              {data.resolvedIssues && data.resolvedIssues.length > 0 && (
                <IssueListSection data={data} helpers={helpers} />
              )}

              {/* 데이터 없음 */}
              {data.summary.totalTasks === 0 && diagnosis.flow.inflow === 0 && (
                <div className="text-center py-10">
                  <i className="fa-solid fa-chart-simple text-ive-text-dim text-2xl mb-2" />
                  <p className="text-sm text-ive-text-dim">{tr('noWorkInPeriod')}</p>
                </div>
              )}
            </main>
          )}
        </div>
      </div>
    </PullToRefresh>
  )
}
