'use client'

import { useEffect, useState, useCallback, useMemo } from 'react'
import { useRouter } from 'next/navigation'
import { useTranslations } from 'next-intl'
import PullToRefresh from '@/components/ui/PullToRefresh'
import AgentAvatar from '@/components/agent/AgentAvatar'
import Sparkline from '@/components/ui/Sparkline'
import { DailyTrendChart, FlowCompareChart } from '@/components/reports/ReportCharts'
import { getKSTTodayString, utcISOToKSTDate } from '@/lib/date-utils'
import { diagnose, type ReportData, type DiagnosisResult, type I18nMessage } from '@/lib/report-diagnosis'

// ─── 유틸 ───

function fmtCost(n: number): string { return n.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 }) }

type ReportType = 'weekly' | 'monthly' | 'yearly'

// ─── 메인 컴포넌트 ───

export default function ReportsTab() {
  const router = useRouter()
  const tr = useTranslations('report')

  // ─── 로케일별 포매터 ───

  const fmtDur = useCallback((min: number): string => {
    if (min < 60) return tr('durMin', { value: min.toFixed(1) })
    const h = Math.floor(min / 60), m = Math.round(min % 60)
    return m > 0 ? tr('durHourMin', { h, m }) : tr('durHour', { h })
  }, [tr])

  const diffBadge = useCallback((cur: number, prev: number): string | null => {
    if (prev === 0) return cur > 0 ? tr('newBadge') : null
    const pct = Math.round(((cur - prev) / prev) * 100)
    if (pct === 0) return null
    return `${pct > 0 ? '+' : ''}${pct}%`
  }, [tr])

  const diffColor = useCallback((cur: number, prev: number, invert = false): string => {
    if (prev === 0) return 'text-ive-cyan'
    const pct = ((cur - prev) / prev) * 100
    if (invert) return pct > 0 ? 'text-ive-red' : pct < 0 ? 'text-ive-green' : 'text-ive-text-dim'
    return pct > 0 ? 'text-ive-green' : pct < 0 ? 'text-ive-red' : 'text-ive-text-dim'
  }, [])

  const formatPeriodLabel = useCallback((rtype: ReportType, start: string, end: string): string => {
    const s = new Date(start), e = new Date(end)
    e.setDate(e.getDate() - 1)
    if (rtype === 'weekly') return tr('periodWeeklyLabel', {
      year: s.getFullYear(), month1: s.getMonth() + 1, day1: s.getDate(),
      month2: e.getMonth() + 1, day2: e.getDate(),
    })
    if (rtype === 'monthly') return tr('yearMonth', { year: s.getFullYear(), month: s.getMonth() + 1 })
    return tr('yearUnit', { year: s.getFullYear() })
  }, [tr])

  // i18n key+params를 문자열로 해석. nestedKeys가 있으면 먼저 치환한다.
  const resolveMsg = useCallback((msg: I18nMessage): string => {
    const params: Record<string, string | number> = { ...(msg.params ?? {}) }
    if (msg.nestedKeys) {
      for (const [k, nestedKey] of Object.entries(msg.nestedKeys)) {
        params[k] = tr(nestedKey as never)
      }
    }
    return tr(msg.key as never, params as never)
  }, [tr])

  // dayLabels 배열 — 로케일별로 ko.json/en.json에 정의되어 있음
  const dayLabels = useMemo(() => tr.raw('dayLabels') as string[], [tr])

  const [type, setType] = useState<ReportType>('weekly')
  const [date, setDate] = useState(getKSTTodayString())
  const [data, setData] = useState<ReportData | null>(null)
  const [monthData, setMonthData] = useState<ReportData | null>(null)
  const [yearData, setYearData] = useState<ReportData | null>(null)
  const [prevWeeks, setPrevWeeks] = useState<ReportData[]>([])
  const [loading, setLoading] = useState(false)
  const [diagnosis, setDiagnosis] = useState<DiagnosisResult | null>(null)
  const [expandedProjects, setExpandedProjects] = useState<Set<string>>(new Set())
  const [expandedAgents, setExpandedAgents] = useState<Set<string>>(new Set())
  const [expandedUsers, setExpandedUsers] = useState<Set<string>>(new Set())
  const [expandedVerifiers, setExpandedVerifiers] = useState<Set<string>>(new Set())
  const [showTrend, setShowTrend] = useState(true)
  const [showIssues, setShowIssues] = useState(true)
  const [issueProjectFilter, setIssueProjectFilter] = useState('all')
  const [issueKeyword, setIssueKeyword] = useState('')
  const [issueSort, setIssueSort] = useState<'date' | 'duration' | 'cost'>('date')
  const [issueSortDir, setIssueSortDir] = useState<'desc' | 'asc'>('desc')
  const [visibleCount, setVisibleCount] = useState(20)

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

      // 추세 예측용 이전 2주 데이터
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
        const diag = diagnose(mainData, type === 'weekly' ? [].filter(Boolean) : undefined, fmtDur)
        setDiagnosis(diag)
      }
    } finally { setLoading(false) }
  }, [type, date, fmtDur])

  // 데이터 로드 후 진단 재실행 (prevWeeks 포함)
  useEffect(() => {
    if (data && type === 'weekly' && prevWeeks.length > 0) {
      setDiagnosis(diagnose(data, prevWeeks, fmtDur))
    }
  }, [data, prevWeeks, type, fmtDur])

  useEffect(() => { fetchReport() }, [fetchReport])

  // 무한 스크롤
  useEffect(() => {
    function handleScroll() { if (window.innerHeight + window.scrollY >= document.body.offsetHeight - 200) setVisibleCount(prev => prev + 20) }
    window.addEventListener('scroll', handleScroll, { passive: true })
    return () => window.removeEventListener('scroll', handleScroll)
  }, [])

  function navigate(dir: -1 | 1) {
    const d = new Date(date)
    if (type === 'weekly') d.setDate(d.getDate() + dir * 7)
    else if (type === 'monthly') d.setMonth(d.getMonth() + dir)
    else d.setFullYear(d.getFullYear() + dir)
    setDate(d.toISOString().slice(0, 10))
  }

  function isCurrentPeriod(): boolean {
    if (!data) return false
    const today = getKSTTodayString()
    return today >= data.period.start && today < data.period.end
  }

  const d = diagnosis
  const today = getKSTTodayString()

  // 흐름도용 일별 데이터 계산
  // 유입 = 당일 처음 유입된 고유 이슈 수 (재시도 제외)
  // 처리 = 당일 검증까지 마무리된 고유 이슈 수 (verified_at / rejected_at 기준)
  function computeFlowDays() {
    if (!data) return []
    return data.dailyTrend.map(dt => {
      const label = data.period.type === 'yearly'
        ? tr('monthUnit', { month: parseInt(dt.date.slice(5, 7)) })
        : data.period.type === 'weekly' ? dayLabels[new Date(dt.date).getDay()] : `${new Date(dt.date).getDate()}`
      if (dt.inflow === null || dt.date > today) return { label, inflow: null, throughput: null }
      return { label, inflow: dt.inflow, throughput: dt.verified ?? 0 }
    })
  }

  // 이슈 필터/정렬
  const filteredIssues = data?.resolvedIssues?.filter(issue => {
    if (issueProjectFilter !== 'all' && issue.projectId !== issueProjectFilter) return false
    if (issueKeyword.trim()) {
      const kw = issueKeyword.trim().toLowerCase()
      if (!`#${issue.issueIid} ${issue.issueTitle} ${issue.agentName} ${issue.projectName}`.toLowerCase().includes(kw)) return false
    }
    return true
  })?.sort((a, b) => {
    const dir = issueSortDir === 'desc' ? 1 : -1
    if (issueSort === 'date') return dir * b.startedAt.localeCompare(a.startedAt)
    if (issueSort === 'duration') return dir * (b.durationMin - a.durationMin)
    return dir * (b.cost - a.cost)
  }) ?? []

  const uniqueProjects = data?.resolvedIssues
    ? [...new Map(data.resolvedIssues.map(i => [i.projectId, { id: i.projectId, name: i.projectName, color: i.projectColor }])).values()]
    : []

  // 브리핑 배경 온도
  function briefingBg(): string {
    if (!d) return 'bg-ive-bg-card border-ive-border-subtle'
    if (d.flow.healthLevel === 'overloaded') return 'bg-gradient-to-r from-ive-red/5 to-ive-bg-card border-ive-red/30 border-l-2'
    if (d.flow.healthLevel === 'tight') return 'bg-gradient-to-r from-ive-amber/5 to-ive-bg-card border-ive-amber/30'
    return 'bg-ive-bg-card border-ive-border-subtle'
  }

  return (
    <PullToRefresh onRefresh={fetchReport} className="min-h-screen pb-20">
      {/* Period selector */}
      <div className="sticky top-[57px] z-30 bg-ive-bg-deep border-b border-ive-border-dark">
        <div className="px-4 py-3 max-w-lg mx-auto">
          <div className="flex gap-1 mb-2">
            {(['weekly', 'monthly', 'yearly'] as ReportType[]).map(rt => (
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

      {loading && <div className="flex flex-col items-center justify-center py-10 gap-2 text-ive-text-dim"><i className="fa-solid fa-circle-notch fa-spin" />{tr('loadingCompact')}</div>}

      {data && !loading && d && (
        <main className="px-4 py-4 max-w-lg mx-auto space-y-3">

          {/* ① 진단 브리핑 */}
          <section className={`border rounded-lg p-4 ${briefingBg()}`}>
            <p className="text-sm font-bold text-ive-text leading-relaxed">{d.briefing.map(resolveMsg).join(' ')}</p>
            {/* 다기간 맥락 */}
            <div className="mt-3 pt-3 border-t border-ive-border-dark/50 space-y-1">
              {type !== 'monthly' && monthData && (
                <div className="flex items-center justify-between text-xs">
                  <span className="text-ive-text-dim">{tr('thisMonth')}</span>
                  <span className="text-ive-text font-bold">{tr('countCases', { count: monthData.summary.totalTasks })} · ${fmtCost(monthData.summary.totalCost)}</span>
                </div>
              )}
              {type !== 'yearly' && yearData && (
                <div className="flex items-center justify-between text-xs">
                  <span className="text-ive-text-dim">{tr('thisYear')}</span>
                  <span className="text-ive-text font-bold">{tr('countCases', { count: yearData.summary.totalTasks.toLocaleString() })} · ${fmtCost(yearData.summary.totalCost)}</span>
                </div>
              )}
            </div>
          </section>

          {/* ② 자원 현황 게이지 */}
          {d.flow.dailyCapacity > 0 && (
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
                    {Math.round(d.flow.utilization * 100)}%
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
          )}

          {/* ③ 흐름도 */}
          {(() => {
            const inflowData = computeFlowDays().filter(f => f.inflow !== null).map(f => f.inflow as number)
            const throughputData = computeFlowDays().filter(f => f.throughput !== null).map(f => f.throughput as number)
            const waitingData = data.waitingTrend.filter(w => w.date <= today).map(w => w.total)
            return (
              <section className="bg-ive-bg-card border border-ive-border-subtle rounded-lg p-4">
                <div className="flex items-center justify-between mb-4">
                  {/* 유입 — 단순 카운트(중립) */}
                  <div className="text-center flex-1 w-0">
                    <div className="text-xs text-ive-text-dim mb-1">{tr('flowInflow')}</div>
                    <div className="text-2xl font-bold text-ive-text mb-2">{d.flow.inflow}</div>
                    <div className="h-6 mb-2 px-1"><Sparkline data={inflowData.length > 0 ? inflowData : [0]} width="100%" height={24} color="cyan" /></div>
                    <div className="text-xs text-ive-text-dim">{tr('perDayUnit', { count: d.flow.dailyInflow.toFixed(1) })}</div>
                  </div>
                  <div className="text-ive-text-dim px-2"><i className="fa-solid fa-arrow-right" /></div>
                  {/* 대기열 — 임계 기반 색(주의 신호) */}
                  <div className="text-center flex-1 w-0">
                    <div className="text-xs text-ive-text-dim mb-1">{tr('flowWaiting')}</div>
                    <div className={`text-2xl font-bold mb-2 ${d.flow.currentWaiting >= 8 ? 'text-ive-red' : d.flow.currentWaiting >= 4 ? 'text-ive-amber' : 'text-ive-text'}`}>
                      {d.flow.currentWaiting}
                    </div>
                    <div className="h-6 mb-2 px-1"><Sparkline data={waitingData.length > 0 ? waitingData : [0]} width="100%" height={24} color={d.flow.currentWaiting >= 8 ? 'red' : d.flow.currentWaiting >= 4 ? 'amber' : 'cyan'} /></div>
                    <div className="text-xs text-ive-text-dim opacity-0">0</div>
                  </div>
                  <div className="text-ive-text-dim px-2"><i className="fa-solid fa-arrow-right" /></div>
                  {/* 처리 — 단순 카운트(중립) */}
                  <div className="text-center flex-1 w-0">
                    <div className="text-xs text-ive-text-dim mb-1">{tr('flowThroughput')}</div>
                    <div className="text-2xl font-bold text-ive-text mb-2">{d.flow.throughput}</div>
                    <div className="h-6 mb-2 px-1"><Sparkline data={throughputData.length > 0 ? throughputData : [0]} width="100%" height={24} color="cyan" /></div>
                    <div className="text-xs text-ive-text-dim">{tr('perDayUnit', { count: d.flow.dailyCapacity.toFixed(1) })}</div>
                  </div>
                </div>
                {/* 비용 — AI + 사람 분리 표기 */}
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
                          <span className="opacity-70"> {tr('humanCostDurExpr', { duration: fmtDur(d.flow.humanMinutes), perMin: (d.flow.humanMonthlySalary / 9600).toFixed(2) })}</span>
                        )}
                      </span>
                    </div>
                  )}
                </div>
              </section>
            )
          })()}

          {/* ④ 주의/경고 카드 */}
          {d.alerts.length > 0 && (
            <section className="space-y-2">
              {d.alerts.map((alert, i) => (
                <div key={i} className="bg-ive-bg-card border border-ive-border-subtle rounded-lg p-3">
                  <div className="flex items-center gap-1.5 text-xs font-bold text-ive-text mb-0.5">
                    {alert.severity === 'critical' && <i className="fa-solid fa-circle-exclamation text-ive-red" />}
                    {alert.severity === 'warning' && <i className="fa-solid fa-triangle-exclamation text-ive-amber" />}
                    {alert.severity === 'info' && <i className="fa-solid fa-circle-info text-ive-cyan" />}
                    <span>{resolveMsg(alert.title)}</span>
                  </div>
                  <div className="text-xs text-ive-text-dim mb-1.5">{resolveMsg(alert.detail)}</div>
                  {alert.actionTarget ? (
                    <button onClick={() => router.push(alert.actionTarget!)} className="text-xs font-bold text-ive-green hover:underline">
                      {resolveMsg(alert.action)} →
                    </button>
                  ) : (
                    <div className="text-xs font-bold text-ive-text-muted">{resolveMsg(alert.action)}</div>
                  )}
                </div>
              ))}
            </section>
          )}

          {/* ⑤ 비용 + 재시도 */}
          {d.flow.totalCost > 0 && (
            <section className="bg-ive-bg-card border border-ive-border-subtle rounded-lg p-3 space-y-1.5">
              <div className="flex items-center justify-between">
                <span className="text-xs font-bold text-ive-text">{tr('costTotalCompact', { amount: fmtCost(d.flow.totalCost) })}</span>
                <span className="text-xs text-ive-text-dim">{tr('costPerTaskCompact', { amount: fmtCost(d.flow.costPerTask) })}</span>
                {d.flow.prevCostPerTask > 0 && (() => {
                  const b = diffBadge(d.flow.costPerTask, d.flow.prevCostPerTask)
                  return b ? <span className={`text-xs font-bold ${diffColor(d.flow.costPerTask, d.flow.prevCostPerTask, true)}`}>{b}</span> : null
                })()}
              </div>
              {/* 비용 내역: AI 토큰 + 사람 시간 분리 */}
              {(d.flow.totalCostAi > 0 || d.flow.totalCostHuman > 0) && (
                <div className="space-y-1 bg-ive-bg-deep rounded-lg px-2.5 py-2 border border-ive-border-dark">
                  <div className="flex items-center justify-between text-xs">
                    <span className="text-ive-text-dim"><i className="fa-solid fa-robot mr-1 text-ive-text-muted" />{tr('aiTokenCost')}</span>
                    <span className="font-mono font-bold text-ive-text">${fmtCost(d.flow.totalCostAi)}</span>
                  </div>
                  <div className="flex items-center justify-between text-xs">
                    <span className="text-ive-text-dim"><i className="fa-solid fa-user mr-1 text-ive-text-muted" />{tr('humanTimeCost')}</span>
                    <span className="font-mono font-bold text-ive-text">${fmtCost(d.flow.totalCostHuman)}</span>
                  </div>
                  {d.flow.humanMinutes > 0 && d.flow.humanMonthlySalary > 0 && (
                    <div className="text-[10px] text-ive-text-dim pt-1 border-t border-ive-border-dark/50 mt-1">
                      {tr('salaryBasis', { salary: d.flow.humanMonthlySalary.toLocaleString(), perMin: (d.flow.humanMonthlySalary / 9600).toFixed(2) })}
                      <br />
                      {tr('salaryCalc', { duration: fmtDur(d.flow.humanMinutes), perMin: (d.flow.humanMonthlySalary / 9600).toFixed(2), total: fmtCost(d.flow.totalCostHuman) })}
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
                  {d.highRetryProject && <span className="ml-1">{tr('highRetryProjectLine', { name: d.highRetryProject.name, rate: d.highRetryProject.rate.toFixed(0) })}</span>}
                </div>
              )}
              {/* 일별 비용 스파크라인 */}
              {data.dailyTrend.length >= 2 && (
                <Sparkline data={data.dailyTrend.map(d => d.cost)} width="100%" height={24} color="cyan" />
              )}
            </section>
          )}

          {/* ⑥ 소요 시간 (파이프라인) */}
          {data.lifecycle.procCount > 0 && (
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
                    {/* 라이프사이클 비율 — 측정값이라 단색 시안 + 농도로 단계 구분 */}
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
          )}

          {/* ⑦ 프로젝트별 흐름 */}
          {d.projects.length > 0 && (
            <section>
              <div className="text-xs font-bold text-ive-text-dim mb-2 uppercase tracking-wider">{tr('projectFlowTitle')}</div>
              <div className="space-y-2">
                {d.projects.sort((a, b) => b.throughput - a.throughput).map(p => (
                  <div key={p.projectId} className={`bg-ive-bg-card border border-ive-border-subtle rounded-lg overflow-hidden ${p.healthLevel === 'overloaded' ? 'bg-ive-red/3' : p.healthLevel === 'idle' && p.assignedAgents >= 2 ? 'bg-ive-cyan/3' : ''}`}>
                    <button onClick={() => { const n = new Set(expandedProjects); n.has(p.projectId) ? n.delete(p.projectId) : n.add(p.projectId); setExpandedProjects(n) }}
                      className="w-full px-3 py-2.5 text-left">
                      <div className="flex items-center gap-2">
                        {p.projectAvatarUrl ? (
                          <img src={p.projectAvatarUrl} alt="" className="w-5 h-5 rounded-lg object-cover shrink-0" />
                        ) : (
                          <span className="w-5 h-5 rounded-lg flex items-center justify-center shrink-0 bg-ive-bg-deep">
                            <i className={`fa-brands ${p.projectProvider === 'github' ? 'fa-github' : 'fa-gitlab'} text-xs`} style={{ color: p.projectColor || '#4ade80' }} />
                          </span>
                        )}
                        <span className="text-sm font-bold text-ive-text flex-1 truncate">{p.projectName}</span>
                        <span className="text-xs text-ive-text-dim">{tr('assignedAgentsCount', { count: p.assignedAgents })}</span>
                        <i className={`fa-solid fa-chevron-${expandedProjects.has(p.projectId) ? 'up' : 'down'} text-xs text-ive-text-dim`} />
                      </div>
                      <div className="flex items-center gap-2 mt-1 text-xs">
                        <span className="text-ive-text-muted">{tr('inflowCompact', { count: p.inflow })}</span>
                        <span className="text-ive-text-dim">→</span>
                        <span className="text-ive-text-muted">{tr('throughputCompact', { count: p.throughput })}</span>
                        {p.currentWaiting > 0 && <span className={`font-bold ${p.currentWaiting >= 6 ? 'text-ive-red' : p.currentWaiting >= 3 ? 'text-ive-amber' : 'text-ive-text-muted'}`}>
                          {tr('waitingInProgressCount', { count: p.currentWaiting })}
                        </span>}
                        <span className="text-ive-text-muted ml-auto">${fmtCost(p.cost)}</span>
                      </div>
                      {p.annotation && (() => {
                        const sev = p.annotation.severity
                        const color = sev === 'critical' ? 'text-ive-red' : sev === 'warning' ? 'text-ive-amber' : 'text-ive-cyan'
                        const icon = sev === 'critical' ? 'fa-triangle-exclamation' : sev === 'warning' ? 'fa-circle-exclamation' : 'fa-lightbulb'
                        const msg = tr(`annotation.${p.annotation.key}` as any, p.annotation.params as any)
                        return (
                          <div className={`text-xs mt-1.5 ${color} leading-relaxed`}>
                            <i className={`fa-solid ${icon} mr-1`} />{msg}
                          </div>
                        )
                      })()}
                    </button>
                    {expandedProjects.has(p.projectId) && (
                      <div className="px-3 pb-3 border-t border-ive-border-dark">
                        <div className="grid grid-cols-3 gap-1 mt-2 text-center text-xs">
                          <div>
                            <div className="text-ive-text-dim">{tr('metric.utilization')}</div>
                            {p.utilization < 0 ? (
                              <div className="font-bold text-ive-text-dim">{tr('metric.noAgentAssigned')}</div>
                            ) : (() => {
                              const pct = Math.round(p.utilization * 100)
                              const label = pct >= 100 ? tr('metric.utilOverload')
                                : pct >= 80 ? tr('metric.utilHigh')
                                : pct >= 60 ? tr('metric.utilOk')
                                : pct >= 30 ? tr('metric.utilLow')
                                : tr('metric.utilVeryLow')
                              const cls = pct >= 100 ? 'text-ive-red'
                                : pct >= 80 ? 'text-ive-amber'
                                : pct >= 60 ? 'text-ive-green'
                                : 'text-ive-cyan'
                              return (
                                <>
                                  <div className={`font-bold ${cls}`}>{pct}%</div>
                                  <div className="text-[10px] text-ive-text-dim">{label}</div>
                                </>
                              )
                            })()}
                          </div>
                          <div>
                            <div className="text-ive-text-dim">{tr('metric.costPerTask')}</div>
                            <div className="font-bold text-ive-text">${fmtCost(p.costPerTask)}</div>
                          </div>
                          <div>
                            <div className="text-ive-text-dim">{tr('metric.retryRate')}</div>
                            {(() => {
                              const r = p.retryRate
                              const label = r >= 30 ? tr('metric.retryHigh') : r >= 10 ? tr('metric.retryNormal') : tr('metric.retryLow')
                              const cls = r >= 30 ? 'text-ive-amber' : 'text-ive-text'
                              return (
                                <>
                                  <div className={`font-bold ${cls}`}>{r.toFixed(0)}%</div>
                                  <div className="text-[10px] text-ive-text-dim">{label}</div>
                                </>
                              )
                            })()}
                          </div>
                        </div>
                        {/* 프로젝트별 미니 추이 */}
                        {(() => {
                          const pt = data.projectTrend?.find(t => t.projectId === p.projectId)
                          const pwt = data.waitingTrend?.map(d => d.byProject.find(bp => bp.projectId === p.projectId)?.waiting ?? 0) ?? []
                          if (!pt || pt.daily.length < 2) return null
                          return (
                            <div className="mt-2 bg-ive-bg-deep rounded-lg p-2">
                              <div className="grid grid-cols-3 gap-2">
                                <div className="flex items-center gap-1.5"><span className="text-xs text-ive-text-dim shrink-0">{tr('sparkCount')}</span><Sparkline data={pt.daily.map(d => d.tasks)} width={80} height={20} color="auto" /></div>
                                <div className="flex items-center gap-1.5"><span className="text-xs text-ive-text-dim shrink-0">{tr('sparkCost')}</span><Sparkline data={pt.daily.map(d => d.cost)} width={80} height={20} color="cyan" /></div>
                                <div className="flex items-center gap-1.5"><span className="text-xs text-ive-text-dim shrink-0">{tr('sparkWaiting')}</span><Sparkline data={pwt.length > 0 ? pwt : [0]} width={80} height={20} color="cyan" /></div>
                              </div>
                            </div>
                          )
                        })()}
                      </div>
                    )}
                  </div>
                ))}
              </div>
            </section>
          )}

          {/* ⑧ 에이전트별 부하 */}
          {d.agents.length > 0 && (
            <section>
              <div className="text-xs font-bold text-ive-text-dim mb-2 uppercase tracking-wider">{tr('agentLoadTitle')}</div>
              <div className="space-y-2">
                {d.agents.sort((a, b) => b.tasks - a.tasks).map(a => {
                  const sev = a.annotation?.severity
                  const bgClass = sev === 'critical' ? 'bg-ive-red/3' : sev === 'warning' ? 'bg-ive-amber/3' : sev === 'info' ? 'bg-ive-cyan/3' : ''
                  return (
                  <div key={a.agentId} className={`bg-ive-bg-card border border-ive-border-subtle rounded-lg overflow-hidden ${bgClass}`}>
                    <button onClick={() => { const n = new Set(expandedAgents); n.has(a.agentId) ? n.delete(a.agentId) : n.add(a.agentId); setExpandedAgents(n) }}
                      className="w-full px-3 py-2.5 text-left">
                      <div className="flex items-center gap-2">
                        <AgentAvatar avatar={a.agentAvatar} size="xs" />
                        <span className="text-sm font-bold text-ive-text flex-1 truncate">{a.agentName}</span>
                        {a.assignedProjectName && <span className="text-xs text-ive-text-dim truncate max-w-[80px]">→ {a.assignedProjectName}</span>}
                        <i className={`fa-solid fa-chevron-${expandedAgents.has(a.agentId) ? 'up' : 'down'} text-xs text-ive-text-dim`} />
                      </div>
                      <div className="flex items-center gap-3 mt-1 text-xs">
                        <span className="text-ive-text font-bold">{tr('processedInPeriod', { count: a.tasks })}</span>
                        <span className="text-ive-text-dim">{tr('dailyAvgCapacity', { count: a.dailyCapacity })}</span>
                        {a.currentWaiting > 0 && <span className={`font-bold ${a.currentWaiting >= 6 ? 'text-ive-red' : a.currentWaiting >= 3 ? 'text-ive-amber' : 'text-ive-text-muted'}`}>{tr('waitingCompact', { count: a.currentWaiting })}</span>}
                        {a.successRate > 0 && <span className={`font-bold ${a.successRate < 60 ? 'text-ive-red' : a.successRate < 80 ? 'text-ive-amber' : 'text-ive-green'}`}>{tr('successRateCompact', { rate: a.successRate })}</span>}
                        <span className="text-ive-text-muted ml-auto">${fmtCost(a.cost)}</span>
                      </div>
                      {a.annotation && (() => {
                        const s = a.annotation.severity
                        const color = s === 'critical' ? 'text-ive-red' : s === 'warning' ? 'text-ive-amber' : 'text-ive-cyan'
                        const icon = s === 'critical' ? 'fa-triangle-exclamation' : s === 'warning' ? 'fa-circle-exclamation' : 'fa-lightbulb'
                        const msg = tr(`agentAnnotation.${a.annotation.key}` as any, a.annotation.params as any)
                        return (
                          <div className={`text-xs mt-1.5 leading-relaxed ${color}`}>
                            <i className={`fa-solid ${icon} mr-1`} />{msg}
                          </div>
                        )
                      })()}
                    </button>
                    {expandedAgents.has(a.agentId) && (
                      <div className="px-3 pb-3 border-t border-ive-border-dark">
                        {(() => {
                          const at = data.agentTrend?.find(t => t.agentId === a.agentId)
                          const awt = data.agentWaitingTrend?.map(d => d.byAgent.find(ba => ba.agentId === a.agentId)?.waiting ?? 0) ?? []
                          if (!at || at.daily.length < 2) return null
                          return (
                            <div className="mt-2 bg-ive-bg-deep rounded-lg p-2">
                              <div className="grid grid-cols-3 gap-2">
                                <div className="flex items-center gap-1.5"><span className="text-xs text-ive-text-dim shrink-0">{tr('sparkCount')}</span><Sparkline data={at.daily.map(d => d.tasks)} width={80} height={20} color="auto" /></div>
                                <div className="flex items-center gap-1.5"><span className="text-xs text-ive-text-dim shrink-0">{tr('sparkCost')}</span><Sparkline data={at.daily.map(d => d.cost)} width={80} height={20} color="cyan" /></div>
                                <div className="flex items-center gap-1.5"><span className="text-xs text-ive-text-dim shrink-0">{tr('sparkWaiting')}</span><Sparkline data={awt.length > 0 ? awt : [0]} width={80} height={20} color="cyan" /></div>
                              </div>
                            </div>
                          )
                        })()}
                      </div>
                    )}
                  </div>
                  )
                })}
              </div>
            </section>
          )}

          {/* ⑧-2 검증자별 부하 (Git assignee 기반) */}
          {d.verifierLoads && d.verifierLoads.length > 0 && (
            <section>
              <div className="text-xs font-bold text-ive-text-dim mb-2 uppercase tracking-wider">{tr('verifierLoadTitle')}</div>
              <div className="space-y-2">
                {d.verifierLoads.map(v => {
                  const sev = v.annotation?.severity
                  const bgClass = sev === 'critical' ? 'bg-ive-red/3' : sev === 'warning' ? 'bg-ive-amber/3' : sev === 'info' ? 'bg-ive-cyan/3' : ''
                  const totalBacklog = v.verifyWaiting + v.verifying
                  return (
                    <div key={v.username} className={`bg-ive-bg-card border border-ive-border-subtle rounded-lg overflow-hidden ${bgClass}`}>
                      <button onClick={() => { const n = new Set(expandedVerifiers); n.has(v.username) ? n.delete(v.username) : n.add(v.username); setExpandedVerifiers(n) }}
                        className="w-full px-3 py-2.5 text-left">
                        <div className="flex items-center gap-2">
                          <AgentAvatar avatar={v.avatar} size="xs" />
                          <span className="text-sm font-bold text-ive-text flex-1 truncate">{v.name}</span>
                          <span className="text-xs font-bold text-ive-text-dim">
                            <i className={`fa-brands ${v.provider === 'github' ? 'fa-github' : 'fa-gitlab'} mr-0.5`} />@{v.username}
                          </span>
                          <i className={`fa-solid fa-chevron-${expandedVerifiers.has(v.username) ? 'up' : 'down'} text-xs text-ive-text-dim`} />
                        </div>
                        <div className="flex items-center gap-3 mt-1 text-xs font-bold flex-wrap">
                          <span className="text-ive-green">{tr('approvedCompact', { count: v.approved })}</span>
                          {v.rejected > 0 && <span className="text-ive-red">{tr('rejectedCompact', { count: v.rejected })}</span>}
                          {v.dailyCapacity > 0 && <span className="text-ive-text-dim">{tr('dailyAvgCapacity', { count: v.dailyCapacity })}</span>}
                          {totalBacklog > 0 && (
                            <span className={`${v.verifyWaiting >= 6 ? 'text-ive-red' : v.verifyWaiting >= 3 ? 'text-ive-amber' : 'text-ive-cyan'}`}>
                              <i className="fa-solid fa-clock mr-0.5" />
                              {v.verifying > 0
                                ? tr('waitingAndVerifying', { waiting: v.verifyWaiting, verifying: v.verifying })
                                : tr('waitingOnly', { waiting: v.verifyWaiting })}
                            </span>
                          )}
                          {v.avgVerifyMin > 0 && <span className="text-ive-text-dim ml-auto">{tr('avgVerifyCompact', { duration: fmtDur(v.avgVerifyMin) })}</span>}
                        </div>
                        {v.annotation && (() => {
                          const s = v.annotation.severity
                          const color = s === 'critical' ? 'text-ive-red' : s === 'warning' ? 'text-ive-amber' : 'text-ive-cyan'
                          const icon = s === 'critical' ? 'fa-triangle-exclamation' : s === 'warning' ? 'fa-circle-exclamation' : 'fa-lightbulb'
                          const msg = tr(`verifierAnnotation.${v.annotation.key}` as any, v.annotation.params as any)
                          return (
                            <div className={`text-xs mt-1.5 leading-relaxed ${color}`}>
                              <i className={`fa-solid ${icon} mr-1`} />{msg}
                            </div>
                          )
                        })()}
                      </button>
                      {expandedVerifiers.has(v.username) && (
                        <div className="px-3 pb-3 border-t border-ive-border-dark">
                          <div className="grid grid-cols-4 gap-1 mt-2 text-center text-xs font-bold">
                            <div>
                              <div className="text-ive-text-dim">{tr('verifyWaitHeader')}</div>
                              <div className={`${v.verifyWaiting >= 6 ? 'text-ive-red' : v.verifyWaiting >= 3 ? 'text-ive-amber' : 'text-ive-text'}`}>{tr('countCases', { count: v.verifyWaiting })}</div>
                            </div>
                            <div>
                              <div className="text-ive-text-dim">{tr('verifyingHeader')}</div>
                              <div className="text-ive-text">{tr('countCases', { count: v.verifying })}</div>
                            </div>
                            <div>
                              <div className="text-ive-text-dim">{tr('approvedHeader')}</div>
                              <div className="text-ive-green">{tr('countCases', { count: v.approved })}</div>
                            </div>
                            <div>
                              <div className="text-ive-text-dim">{tr('rejectedHeader')}</div>
                              <div className={`${v.rejected > 0 ? 'text-ive-red' : 'text-ive-text'}`}>{tr('countCases', { count: v.rejected })}</div>
                            </div>
                          </div>
                          <div className="grid grid-cols-2 gap-1 mt-2 text-center text-xs font-bold">
                            <div>
                              <div className="text-ive-text-dim">{tr('avgVerifyHeader')}</div>
                              <div className="text-ive-text">{v.avgVerifyMin > 0 ? fmtDur(v.avgVerifyMin) : '-'}</div>
                            </div>
                            <div>
                              <div className="text-ive-text-dim">{tr('oldestWaitHeader')}</div>
                              <div className={`${v.oldestWaitMin > 60 * 24 ? 'text-ive-red' : v.oldestWaitMin > 60 * 4 ? 'text-ive-amber' : 'text-ive-text'}`}>{v.oldestWaitMin > 0 ? fmtDur(v.oldestWaitMin) : '-'}</div>
                            </div>
                          </div>
                          {v.assignedProjectNames.length > 0 && (
                            <div className="mt-2 flex flex-wrap gap-1">
                              {v.assignedProjectNames.map(pn => (
                                <span key={pn} className="px-2 py-0.5 rounded-lg text-xs font-bold bg-ive-bg-deep border border-ive-border-dark text-ive-text-dim">{pn}</span>
                              ))}
                            </div>
                          )}
                        </div>
                      )}
                    </div>
                  )
                })}
              </div>
            </section>
          )}

          {/* ⑨ 담당자별 검증 현황 */}
          {data.byUser && data.byUser.length > 0 && (
            <section>
              <div className="text-xs font-bold text-ive-text-dim mb-2 uppercase tracking-wider">{tr('userVerifyTitle')}</div>
              <div className="space-y-2">
                {data.byUser.sort((a, b) => (b.verifyWaiting - a.verifyWaiting) || (b.verifyTasks - a.verifyTasks) || (b.tasks - a.tasks)).map(u => {
                  const hasVerify = u.verifyTasks > 0 || u.verifyWaiting > 0
                  const prev = data.prevByUser?.find(p => p.userId === u.userId)
                  const approvalRate = u.verifyApproved + u.verifyRejected > 0 ? Math.round(u.verifyApproved / (u.verifyApproved + u.verifyRejected) * 100) : null
                  const sev = u.annotation?.severity
                  const bgClass = sev === 'critical' ? 'bg-ive-red/3' : sev === 'warning' ? 'bg-ive-amber/3' : sev === 'info' ? 'bg-ive-cyan/3' : ''
                  return (
                    <div key={u.userId} className={`bg-ive-bg-card border border-ive-border-subtle rounded-lg overflow-hidden ${bgClass}`}>
                      <button onClick={() => { const n = new Set(expandedUsers); n.has(u.userId) ? n.delete(u.userId) : n.add(u.userId); setExpandedUsers(n) }}
                        className="w-full px-3 py-2.5 text-left">
                        <div className="flex items-center gap-2">
                          {u.userAvatar === 'photo' && u.userId ? (
                            <img src={`/api/auth/avatar/image?id=${u.userId}`} alt="" className="w-5 h-5 rounded-lg object-cover shrink-0 border border-ive-border" />
                          ) : u.userAvatar ? (
                            <AgentAvatar avatar={u.userAvatar} size="xs" />
                          ) : (
                            <div className="w-5 h-5 rounded-lg bg-ive-bg-deep border border-ive-border flex items-center justify-center shrink-0"><i className="fa-solid fa-user text-xs text-ive-text-dim" /></div>
                          )}
                          <span className="text-sm font-bold text-ive-text flex-1 truncate">{u.userName}</span>
                          {u.verifyWaiting > 0 && <span className={`text-xs font-bold ${u.verifyWaiting >= 5 ? 'text-ive-red' : u.verifyWaiting >= 3 ? 'text-ive-amber' : 'text-ive-cyan'}`}><i className="fa-solid fa-clock mr-0.5" />{tr('waitingCompact', { count: u.verifyWaiting })}</span>}
                          <span className="text-sm font-bold text-ive-text">{tr('processingCompact', { count: u.tasks })}</span>
                          {prev != null && (() => { const b = diffBadge(u.tasks, prev.tasks); return b ? <span className={`text-xs font-bold ${diffColor(u.tasks, prev.tasks)}`}>{b}</span> : null })()}
                          <i className={`fa-solid fa-chevron-${expandedUsers.has(u.userId) ? 'up' : 'down'} text-xs text-ive-text-dim`} />
                        </div>
                        <div className="flex items-center gap-3 mt-1.5 text-xs text-ive-text-dim flex-wrap">
                          {hasVerify ? (<>
                            <span><span className="text-ive-green font-bold">{tr('approvedHeader')}</span> {u.verifyApproved}</span>
                            {u.verifyRejected > 0 && <span><span className="text-ive-red font-bold">{tr('rejectedHeader')}</span> {u.verifyRejected}</span>}
                            {u.avgVerifyMin > 0 && <span><span className="text-ive-text-dim font-bold">{tr('avgVerifyLabel2')}</span> {fmtDur(u.avgVerifyMin)}</span>}
                            {approvalRate != null && <span className={`font-bold ${approvalRate >= 80 ? 'text-ive-green' : approvalRate >= 50 ? 'text-ive-amber' : 'text-ive-red'}`}>{tr('approvalRatePct', { rate: approvalRate })}</span>}
                          </>) : (<>
                            <span>{tr('successFailedInline', { success: u.success, failed: u.failed })}</span>
                            {u.avgDurationMin > 0 && <span>{tr('avgProcessInline', { duration: fmtDur(u.avgDurationMin) })}</span>}
                          </>)}
                        </div>
                        {u.annotation && (() => {
                          const s = u.annotation.severity
                          const color = s === 'critical' ? 'text-ive-red' : s === 'warning' ? 'text-ive-amber' : 'text-ive-cyan'
                          const icon = s === 'critical' ? 'fa-triangle-exclamation' : s === 'warning' ? 'fa-circle-exclamation' : 'fa-lightbulb'
                          const msg = tr(`userAnnotation.${u.annotation.key}` as any, u.annotation.params as any)
                          return (
                            <div className={`text-xs mt-1.5 leading-relaxed ${color}`}>
                              <i className={`fa-solid ${icon} mr-1`} />{msg}
                            </div>
                          )
                        })()}
                      </button>
                      {expandedUsers.has(u.userId) && (
                        <div className="px-3 pb-3 border-t border-ive-border-dark">
                          {hasVerify ? (<>
                            {/* 검증 상세 */}
                            <div className="grid grid-cols-4 gap-1 mt-2 text-center text-xs">
                              <div><div className="text-ive-text-dim">{tr('verifyHeader')}</div><div className="font-bold text-ive-text">{tr('countCases', { count: u.verifyTasks })}</div></div>
                              <div><div className="text-ive-text-dim">{tr('approvedHeader')}</div><div className="font-bold text-ive-green">{tr('countCases', { count: u.verifyApproved })}</div></div>
                              <div><div className="text-ive-text-dim">{tr('rejectedHeader')}</div><div className={`font-bold ${u.verifyRejected > 0 ? 'text-ive-red' : 'text-ive-text'}`}>{tr('countCases', { count: u.verifyRejected })}</div></div>
                              <div><div className="text-ive-text-dim">{tr('waitingNowHeader')}</div><div className={`font-bold ${u.verifyWaiting >= 5 ? 'text-ive-red' : u.verifyWaiting >= 3 ? 'text-ive-amber' : 'text-ive-text'}`}>{tr('countCases', { count: u.verifyWaiting })}</div></div>
                            </div>
                            <div className="grid grid-cols-3 gap-1 mt-2 text-center text-xs">
                              <div><div className="text-ive-text-dim">{tr('verifyTimeHeader')}</div><div className="font-bold text-ive-text">{u.avgVerifyMin > 0 ? fmtDur(u.avgVerifyMin) : '-'}</div></div>
                              <div><div className="text-ive-text-dim">{tr('verifyWaitHeader2')}</div><div className={`font-bold ${u.verifyAvgWaitMin > 60 ? 'text-ive-red' : u.verifyAvgWaitMin > 30 ? 'text-ive-amber' : 'text-ive-text'}`}>{u.verifyAvgWaitMin > 0 ? fmtDur(u.verifyAvgWaitMin) : '-'}</div></div>
                              <div><div className="text-ive-text-dim">{tr('assignedIssuesHeader')}</div><div className="font-bold text-ive-text">{tr('countCases', { count: u.tasks })}</div></div>
                            </div>
                          </>) : (<>
                            {/* 검증 데이터 없을 때 — 이슈 배정 상세 */}
                            <div className="grid grid-cols-3 gap-1 mt-2 text-center text-xs">
                              <div><div className="text-ive-text-dim">{tr('successHeader')}</div><div className="font-bold text-ive-green">{tr('countCases', { count: u.success })}</div></div>
                              <div><div className="text-ive-text-dim">{tr('failedHeader')}</div><div className={`font-bold ${u.failed > 0 ? 'text-ive-red' : 'text-ive-text'}`}>{tr('countCases', { count: u.failed })}</div></div>
                              <div><div className="text-ive-text-dim">{tr('issuesHeader')}</div><div className="font-bold text-ive-text">{tr('countCases', { count: u.issueCount })}</div></div>
                            </div>
                            {u.avgWaitMin > 0 && (
                              <div className="mt-2 text-center text-xs">
                                <span className="text-ive-text-dim">{tr('issueWaitAvgLabel')}</span>
                                <span className="font-bold text-ive-text">{fmtDur(u.avgWaitMin)}</span>
                              </div>
                            )}
                          </>)}
                          {/* 추이 스파크라인 */}
                          {(() => {
                            const ut = data.userTrend?.find(t => t.userId === u.userId)
                            if (!ut || ut.daily.length < 2) return null
                            const hasVerifyData = ut.daily.some(d => (d.verified ?? 0) > 0)
                            return (
                              <div className="mt-2 bg-ive-bg-deep rounded-lg p-2">
                                <div className={`grid ${hasVerifyData ? 'grid-cols-2' : 'grid-cols-1'} gap-2`}>
                                  <div className="flex items-center gap-1.5"><span className="text-xs text-ive-text-dim shrink-0">{tr('sparkIssue')}</span><Sparkline data={ut.daily.map(d => d.tasks ?? 0)} width={80} height={20} color="auto" /></div>
                                  {hasVerifyData && <div className="flex items-center gap-1.5"><span className="text-xs text-ive-text-dim shrink-0">{tr('sparkVerify')}</span><Sparkline data={ut.daily.map(d => d.verified ?? 0)} width={80} height={20} color="cyan" /></div>}
                                </div>
                              </div>
                            )
                          })()}
                        </div>
                      )}
                    </div>
                  )
                })}
              </div>
            </section>
          )}

          {/* ⑩ 추이 차트 (접이식) */}
          {data.dailyTrend.length > 0 && (
            <section>
              <button onClick={() => setShowTrend(!showTrend)} className="w-full flex items-center gap-2 text-xs font-bold text-ive-text-dim uppercase tracking-wider py-2">
                <i className={`fa-solid fa-chevron-${showTrend ? 'down' : 'right'} text-xs`} />
                {tr('trendChartToggle')}
              </button>
              {showTrend && (
                <div className="space-y-2">
                  <FlowCompareChart data={computeFlowDays()} type={type} />
                  <DailyTrendChart data={data.dailyTrend} prevData={data.prevDailyTrend} type={type} />
                </div>
              )}
            </section>
          )}

          {/* ⑪ 이슈 목록 (접이식) */}
          {data.resolvedIssues && data.resolvedIssues.length > 0 && (
            <section>
              <button onClick={() => { setShowIssues(!showIssues); setVisibleCount(20) }} className="w-full flex items-center gap-2 text-xs font-bold text-ive-text-dim uppercase tracking-wider py-2">
                <i className={`fa-solid fa-chevron-${showIssues ? 'down' : 'right'} text-xs`} />
                {tr('resolvedIssues', { count: data.resolvedIssues.length })}
              </button>
              {showIssues && (
                <div className="space-y-2">
                  {/* 필터 */}
                  <div className="flex items-center gap-2">
                    <select value={issueProjectFilter} onChange={e => setIssueProjectFilter(e.target.value)} className="bg-ive-bg-input border border-ive-border rounded-lg px-2 py-1 text-xs text-ive-text">
                      <option value="all">{tr('allFilter')}</option>
                      {uniqueProjects.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
                    </select>
                    <input value={issueKeyword} onChange={e => setIssueKeyword(e.target.value)} placeholder={tr('searchShort')} className="flex-1 bg-ive-bg-input border border-ive-border rounded-lg px-2 py-1 text-xs text-ive-text placeholder:text-ive-text-dim" />
                  </div>
                  {/* 정렬 */}
                  <div className="flex gap-1">
                    {([['date', tr('sortDate')], ['duration', tr('sortDuration')], ['cost', tr('sortCost')]] as const).map(([key, label]) => (
                      <button key={key} onClick={() => { if (issueSort === key) setIssueSortDir(d => d === 'desc' ? 'asc' : 'desc'); else { setIssueSort(key); setIssueSortDir('desc') } }}
                        className={`px-2 py-1 text-xs font-bold rounded-lg ${issueSort === key ? 'bg-ive-cyan/20 text-ive-cyan' : 'text-ive-text-dim'}`}>
                        {label} {issueSort === key && (issueSortDir === 'desc' ? '↓' : '↑')}
                      </button>
                    ))}
                  </div>
                  {/* 목록 */}
                  <div className="space-y-1">
                    {filteredIssues.slice(0, visibleCount).map((issue, i) => (
                      <div
                        key={i}
                        onClick={() => router.push(`/issues/${issue.projectId}/${issue.issueIid}`)}
                        className="bg-ive-bg-card border border-ive-border-subtle rounded-lg px-3 py-2.5 space-y-1 cursor-pointer hover:border-ive-cyan/40 active:scale-[0.99] transition-all"
                      >
                        {/* 1행: #ID + 제목 */}
                        <div className="flex items-center gap-2 text-xs">
                          <span className="text-ive-text-dim shrink-0">#{issue.issueIid}</span>
                          <span className="text-ive-text font-bold flex-1 truncate">{issue.issueTitle}</span>
                          {issue.status === 'failed' && <i className="fa-solid fa-circle-xmark text-ive-red shrink-0" title={tr('failedIconTitle')} />}
                        </div>

                        {/* 2행: 프로젝트 · 처리일자 · 총시간 · 비용 · 회차 */}
                        <div className="flex items-center gap-2 text-xs text-ive-text-dim">
                          <span className="inline-flex items-center gap-1 min-w-0 flex-1" title={issue.projectName}>
                            <span
                              className="w-4 h-4 rounded flex items-center justify-center shrink-0"
                              style={{ backgroundColor: `${issue.projectColor || '#22d3ee'}20` }}
                            >
                              <i
                                className={`fa-brands ${issue.projectProvider === 'github' ? 'fa-github' : 'fa-gitlab'} text-[9px]`}
                                style={{ color: issue.projectColor || '#22d3ee' }}
                              />
                            </span>
                            <span className="truncate">{issue.projectName}</span>
                          </span>
                          {(() => {
                            const kstDate = utcISOToKSTDate(issue.resolvedAt)
                            const [, mm, dd] = kstDate.split('-')
                            return (
                              <span
                                className="font-mono font-bold text-ive-text-muted shrink-0"
                                title={tr('resolvedAtTooltip', { date: new Date(issue.resolvedAt).toLocaleString() })}
                              >
                                {parseInt(mm)}/{parseInt(dd)}
                              </span>
                            )
                          })()}
                          <span
                            className="inline-flex items-center gap-1 font-mono font-bold text-ive-text shrink-0"
                            title={
                              issue.waitMin == null
                                ? tr('totalTimeTooltipSimple', { total: fmtDur(issue.totalMin) })
                                : issue.verifyMin != null
                                  ? tr('totalTimeTooltipWithVerify', { total: fmtDur(issue.totalMin), wait: fmtDur(issue.waitMin), work: fmtDur(issue.durationMin), verify: fmtDur(issue.verifyMin) })
                                  : tr('totalTimeTooltipWithBreakdown', { total: fmtDur(issue.totalMin), wait: fmtDur(issue.waitMin), work: fmtDur(issue.durationMin) })
                            }
                          >
                            <i className="fa-solid fa-clock text-ive-text-dim" />
                            {fmtDur(issue.totalMin)}
                          </span>
                          <span className="font-mono text-ive-text-muted shrink-0">${fmtCost(issue.cost)}</span>
                          {issue.attempts > 1 && (
                            <span className="text-ive-text-dim font-bold shrink-0" title={tr('attemptTooltip', { current: issue.attemptNo, total: issue.attempts })}>
                              {tr('attemptDisplay', { current: issue.attemptNo, total: issue.attempts })}
                            </span>
                          )}
                        </div>

                        {/* 3행: 처리 내용 — 에이전트(작업시간) → 검증자(검증시간) */}
                        <div className="flex items-center justify-center gap-1.5 text-xs text-ive-text-dim pt-1 border-t border-ive-border-dark/40">
                          <span className="inline-flex items-center gap-1 min-w-0" title={tr('agentWorkTooltip', { name: issue.agentName, duration: fmtDur(issue.durationMin) })}>
                            <AgentAvatar avatar={issue.agentAvatar} size="xs" />
                            <span className="truncate max-w-[160px] text-ive-text-muted">
                              {issue.agentName}<span className="text-ive-text-dim font-mono">({fmtDur(issue.durationMin)})</span>
                            </span>
                          </span>
                          {issue.verifierName && (
                            <>
                              <i className="fa-solid fa-arrow-right text-[9px] text-ive-text-dim/60 shrink-0" />
                              <span className="inline-flex items-center gap-1 min-w-0" title={issue.verifyMin != null ? tr('verifierWithTimeTooltip', { name: issue.verifierName, duration: fmtDur(issue.verifyMin) }) : tr('verifierSimpleTooltip', { name: issue.verifierName })}>
                                <AgentAvatar avatar={issue.verifierAvatar || 'av-01'} userId={issue.verifierUserId} size="xs" />
                                <span className="truncate max-w-[160px] text-ive-text-muted">
                                  {issue.verifierName}
                                  {issue.verifyMin != null && <span className="text-ive-text-dim font-mono">({fmtDur(issue.verifyMin)})</span>}
                                </span>
                              </span>
                            </>
                          )}
                        </div>
                      </div>
                    ))}
                    {filteredIssues.length > visibleCount && (
                      <div className="text-center text-xs text-ive-text-dim py-2">{tr('moreItems', { count: filteredIssues.length - visibleCount })}</div>
                    )}
                    {filteredIssues.length === 0 && <div className="text-center text-xs text-ive-text-dim py-4">{tr('noMatchFilter')}</div>}
                  </div>
                </div>
              )}
            </section>
          )}

          {/* 데이터 없음 */}
          {data.summary.totalTasks === 0 && d.flow.inflow === 0 && (
            <div className="text-center py-10">
              <i className="fa-solid fa-chart-simple text-ive-text-dim text-2xl mb-2" />
              <p className="text-sm text-ive-text-dim">{tr('noWorkInPeriod')}</p>
            </div>
          )}
        </main>
      )}

    </PullToRefresh>
  )
}
