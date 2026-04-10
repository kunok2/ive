'use client'

import { useEffect, useState, useCallback, useRef } from 'react'
import { useRouter } from 'next/navigation'
import PullToRefresh from '@/components/ui/PullToRefresh'
import AgentAvatar from '@/components/agent/AgentAvatar'
import Sparkline from '@/components/ui/Sparkline'
import { DailyTrendChart, FlowCompareChart } from '@/components/reports/ReportCharts'
import { getKSTTodayString } from '@/lib/date-utils'
import { diagnose, type ReportData, type DiagnosisResult, type HealthLevel, type AlertSeverity } from '@/lib/report-diagnosis'

// ─── 유틸 ───

function fmtCost(n: number): string { return n.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 }) }
function fmtDur(min: number): string {
  if (min < 60) return `${min.toFixed(1)}분`
  const h = Math.floor(min / 60), m = Math.round(min % 60)
  return m > 0 ? `${h}시간 ${m}분` : `${h}시간`
}
function fmtPct(n: number): string { return `${Math.round(n * 100)}%` }
function diffBadge(cur: number, prev: number, invert = false): string | null {
  if (prev === 0) return cur > 0 ? '신규' : null
  const pct = Math.round(((cur - prev) / prev) * 100)
  if (pct === 0) return null
  return `${pct > 0 ? '+' : ''}${pct}%`
}
function diffColor(cur: number, prev: number, invert = false): string {
  if (prev === 0) return 'text-ive-cyan'
  const pct = ((cur - prev) / prev) * 100
  if (invert) return pct > 0 ? 'text-ive-red' : pct < 0 ? 'text-ive-green' : 'text-ive-text-dim'
  return pct > 0 ? 'text-ive-green' : pct < 0 ? 'text-ive-red' : 'text-ive-text-dim'
}

type ReportType = 'weekly' | 'monthly' | 'yearly'

function formatPeriodLabel(type: ReportType, start: string, end: string): string {
  const s = new Date(start), e = new Date(end)
  e.setDate(e.getDate() - 1)
  if (type === 'weekly') return `${s.getFullYear()}.${s.getMonth() + 1}.${s.getDate()} ~ ${e.getMonth() + 1}.${e.getDate()}`
  if (type === 'monthly') return `${s.getFullYear()}년 ${s.getMonth() + 1}월`
  return `${s.getFullYear()}년`
}

const DAY_LABELS = ['일', '월', '화', '수', '목', '금', '토']

// ─── 메인 컴포넌트 ───

export default function ReportsTab() {
  const router = useRouter()
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
  const [showTrend, setShowTrend] = useState(false)
  const [showIssues, setShowIssues] = useState(false)
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
        const diag = diagnose(mainData, type === 'weekly' ? [].filter(Boolean) : undefined)
        setDiagnosis(diag)
      }
    } finally { setLoading(false) }
  }, [type, date])

  // 데이터 로드 후 진단 재실행 (prevWeeks 포함)
  useEffect(() => {
    if (data && type === 'weekly' && prevWeeks.length > 0) {
      setDiagnosis(diagnose(data, prevWeeks))
    }
  }, [data, prevWeeks, type])

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
        ? `${parseInt(dt.date.slice(5, 7))}월`
        : data.period.type === 'weekly' ? DAY_LABELS[new Date(dt.date).getDay()] : `${new Date(dt.date).getDate()}`
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
                {rt === 'weekly' ? '주간' : rt === 'monthly' ? '월간' : '연간'}
              </button>
            ))}
          </div>
          <div className="flex items-center justify-between">
            <button onClick={() => navigate(-1)} className="w-8 h-8 flex items-center justify-center text-ive-text-dim hover:text-ive-text"><i className="fa-solid fa-chevron-left" /></button>
            <div className="flex items-center gap-2">
              <span className="text-sm font-bold text-ive-text">{data ? formatPeriodLabel(type, data.period.start, data.period.end) : '...'}</span>
              {!isCurrentPeriod() && (
                <button onClick={() => setDate(getKSTTodayString())} className="px-2 py-0.5 text-xs font-bold rounded-lg bg-ive-green/20 text-ive-green hover:bg-ive-green/30 transition-colors">오늘</button>
              )}
            </div>
            <button onClick={() => navigate(1)} className="w-8 h-8 flex items-center justify-center text-ive-text-dim hover:text-ive-text"><i className="fa-solid fa-chevron-right" /></button>
          </div>
        </div>
      </div>

      {loading && <div className="text-center py-10 text-ive-text-dim"><i className="fa-solid fa-circle-notch fa-spin mr-1" />로딩 중...</div>}

      {data && !loading && d && (
        <main className="px-4 py-4 max-w-lg mx-auto space-y-3">

          {/* ① 진단 브리핑 */}
          <section className={`border rounded-lg p-4 ${briefingBg()}`}>
            <p className="text-sm font-bold text-ive-text leading-relaxed">{d.briefing}</p>
            {/* 다기간 맥락 */}
            <div className="mt-3 pt-3 border-t border-ive-border-dark/50 space-y-1">
              {type !== 'monthly' && monthData && (
                <div className="flex items-center justify-between text-xs">
                  <span className="text-ive-text-dim">이번 달</span>
                  <span className="text-ive-text font-bold">{monthData.summary.totalTasks}건 · ${fmtCost(monthData.summary.totalCost)}</span>
                </div>
              )}
              {type !== 'yearly' && yearData && (
                <div className="flex items-center justify-between text-xs">
                  <span className="text-ive-text-dim">올해</span>
                  <span className="text-ive-text font-bold">{yearData.summary.totalTasks.toLocaleString()}건 · ${fmtCost(yearData.summary.totalCost)}</span>
                </div>
              )}
            </div>
          </section>

          {/* ② 자원 현황 게이지 */}
          {d.flow.dailyCapacity > 0 && (
            <section className="bg-ive-bg-card border border-ive-border-subtle rounded-lg p-4 space-y-3">
              <div>
                <div className="text-sm font-bold text-ive-text flex items-center gap-1.5 mb-1">
                  <i className="fa-solid fa-gauge-high text-ive-text-dim" /> 가동률 (Utilization)
                </div>
                <p className="text-[11px] text-ive-text-dim leading-relaxed">
                  일일 유입량 대비 에이전트들의 처리 여력을 나타냅니다. 게이지 안의 진한 청록색 구간(50~75%)은 자원의 낭비나 작업 지연이 발생하지 않는 가장 이상적인 상태를 의미합니다.
                </p>
              </div>
              {/* 게이지 바 */}
              <div>
                <div className="flex w-full text-[10px] text-ive-text-dim mb-1">
                  <div className="flex justify-center" style={{ width: '25%' }}>유휴</div>
                  <div className="flex justify-center" style={{ width: '25%' }}>여유</div>
                  <div className="flex justify-center" style={{ width: '25%' }}>적정</div>
                  <div className="flex justify-center" style={{ width: '15%' }}>빠듯</div>
                  <div className="flex justify-end overflow-visible whitespace-nowrap" style={{ width: '10%' }}>과부하</div>
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
                <div className="flex justify-between"><span className="text-ive-text-dim">에이전트</span><span className="text-ive-text font-bold">{d.resource.currentAgents}대</span></div>
                <div className="flex justify-between"><span className="text-ive-text-dim">처리능력</span><span className="text-ive-text font-bold">{d.flow.dailyCapacity.toFixed(1)}건/일</span></div>
                <div className="flex justify-between"><span className="text-ive-text-dim">유입</span><span className="text-ive-text font-bold">{d.flow.dailyInflow.toFixed(1)}건/일</span></div>
                <div className="flex justify-between"><span className="text-ive-text-dim">대기</span><span className={`font-bold ${d.flow.currentWaiting >= 5 ? 'text-ive-red' : 'text-ive-text'}`}>{d.flow.currentWaiting}건</span></div>
              </div>

              {/* 진단 결과 */}
              {d.resource.gap !== 0 && (
                <div className={`text-xs font-bold p-2 rounded-lg ${d.resource.gap < 0 ? 'bg-ive-red/10 text-ive-red' : 'bg-ive-cyan/10 text-ive-cyan'}`}>
                  현재 {d.resource.currentAgents}대 → 적정 {d.resource.optimalAgents}대 ({d.resource.gap > 0 ? `${d.resource.gap}대 과잉` : `${Math.abs(d.resource.gap)}대 부족`})
                  {d.resource.queueDrainDays != null && d.resource.queueDrainDays > 0 && <span className="ml-2">· 대기 해소 {d.resource.queueDrainDays}일</span>}
                  {d.resource.queueDrainDays === null && <span className="ml-2">· 대기 해소 불가</span>}
                </div>
              )}

              {/* 재배치/충원/감축 안 */}
              {d.resource.scenario === 'rebalance' && d.resource.rebalancePlan.length > 0 && (
                <div className="bg-ive-bg-deep rounded-lg p-3 space-y-2">
                  <div className="text-xs font-bold text-ive-amber"><i className="fa-solid fa-shuffle mr-1" />재배치 안</div>
                  {d.resource.rebalancePlan.map((r, i) => (
                    <div key={i} className="text-xs text-ive-text">
                      <span className="font-bold">{r.agentName}</span>: {r.fromProjectName} → {r.toProjectName}
                      <div className="text-ive-text-dim mt-0.5">결과: {r.fromProjectName} {r.resultFromUtil}% · {r.toProjectName} {r.resultToUtil}%</div>
                    </div>
                  ))}
                </div>
              )}
              {d.resource.scenario === 'shortage' && d.resource.shortagePlan.length > 0 && (
                <div className="bg-ive-bg-deep rounded-lg p-3 space-y-1">
                  <div className="text-xs font-bold text-ive-red"><i className="fa-solid fa-plus-circle mr-1" />충원 필요</div>
                  {d.resource.shortagePlan.map((s, i) => (
                    <div key={i} className="text-xs text-ive-text">
                      {s.projectName}: +{s.needed}대 (가동률 {s.currentUtil}% → {s.targetUtil}%)
                      {s.urgencyDays && <span className="text-ive-red ml-1">· {s.urgencyDays}일 내</span>}
                    </div>
                  ))}
                </div>
              )}
              {d.resource.scenario === 'surplus' && d.resource.surplusPlan.length > 0 && (
                <div className="bg-ive-bg-deep rounded-lg p-3 space-y-1">
                  <div className="text-xs font-bold text-ive-cyan"><i className="fa-solid fa-minus-circle mr-1" />감축 가능</div>
                  {d.resource.surplusPlan.map((s, i) => (
                    <div key={i} className="text-xs text-ive-text">
                      {s.agentName} ({s.projectName}) · 월 ~${fmtCost(s.savingsPerMonth)} 절감
                    </div>
                  ))}
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
                  {/* 유입 */}
                  <div className="text-center flex-1 w-0">
                    <div className="text-xs text-ive-text-dim mb-1">유입</div>
                    <div className="text-2xl font-bold text-ive-cyan mb-2">{d.flow.inflow}</div>
                    <div className="h-6 mb-2 px-1"><Sparkline data={inflowData.length > 0 ? inflowData : [0]} width="100%" height={24} color="cyan" /></div>
                    <div className="text-xs text-ive-text-dim">{d.flow.dailyInflow.toFixed(1)}건/일</div>
                  </div>
                  <div className="text-ive-text-dim px-2"><i className="fa-solid fa-arrow-right" /></div>
                  {/* 대기열 */}
                  <div className="text-center flex-1 w-0">
                    <div className="text-xs text-ive-text-dim mb-1">대기</div>
                    <div className={`text-2xl font-bold mb-2 ${d.flow.currentWaiting >= 8 ? 'text-ive-red' : d.flow.currentWaiting >= 4 ? 'text-ive-amber' : 'text-ive-text'}`}>
                      {d.flow.currentWaiting}
                    </div>
                    <div className="h-6 mb-2 px-1"><Sparkline data={waitingData.length > 0 ? waitingData : [0]} width="100%" height={24} color={d.flow.currentWaiting >= 8 ? 'red' : d.flow.currentWaiting >= 4 ? 'amber' : 'auto'} /></div>
                    <div className="text-xs text-ive-text-dim opacity-0">0</div>
                  </div>
                  <div className="text-ive-text-dim px-2"><i className="fa-solid fa-arrow-right" /></div>
                  {/* 처리 */}
                  <div className="text-center flex-1 w-0">
                    <div className="text-xs text-ive-text-dim mb-1">처리</div>
                    <div className="text-2xl font-bold text-ive-green mb-2">{d.flow.throughput}</div>
                    <div className="h-6 mb-2 px-1"><Sparkline data={throughputData.length > 0 ? throughputData : [0]} width="100%" height={24} color="green" /></div>
                    <div className="text-xs text-ive-text-dim">{d.flow.dailyCapacity.toFixed(1)}건/일</div>
                  </div>
                </div>
                {/* 비용 */}
                <div className="flex items-center justify-center gap-3 text-xs bg-ive-bg-deep rounded-lg py-2">
                  <span className="text-ive-text font-bold">비용 ${fmtCost(d.flow.totalCost)}</span>
                  <span className="text-ive-text-dim">건당 ${fmtCost(d.flow.costPerTask)}</span>
                  {d.flow.prevCostPerTask > 0 && (() => {
                    const b = diffBadge(d.flow.costPerTask, d.flow.prevCostPerTask)
                    return b ? <span className={`font-bold ${diffColor(d.flow.costPerTask, d.flow.prevCostPerTask, true)}`}>{b}</span> : null
                  })()}
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
                    <span>{alert.title}</span>
                  </div>
                  <div className="text-xs text-ive-text-dim mb-1.5">{alert.detail}</div>
                  {alert.actionTarget ? (
                    <button onClick={() => router.push(alert.actionTarget!)} className="text-xs font-bold text-ive-green hover:underline">
                      {alert.action} →
                    </button>
                  ) : (
                    <div className="text-xs font-bold text-ive-text-muted">{alert.action}</div>
                  )}
                </div>
              ))}
            </section>
          )}

          {/* ⑤ 비용 + 재시도 */}
          {d.flow.totalCost > 0 && (
            <section className="bg-ive-bg-card border border-ive-border-subtle rounded-lg p-3 space-y-1.5">
              <div className="flex items-center justify-between">
                <span className="text-xs font-bold text-ive-text">비용 ${fmtCost(d.flow.totalCost)}</span>
                <span className="text-xs text-ive-text-dim">건당 ${fmtCost(d.flow.costPerTask)}</span>
                {d.flow.prevCostPerTask > 0 && (() => {
                  const b = diffBadge(d.flow.costPerTask, d.flow.prevCostPerTask)
                  return b ? <span className={`text-xs font-bold ${diffColor(d.flow.costPerTask, d.flow.prevCostPerTask, true)}`}>{b}</span> : null
                })()}
              </div>
              {d.retryCostRatio > 0.05 && (
                <div className="text-xs text-ive-text-dim">
                  재시도 비용 ~${fmtCost(d.retryCostAmount)} ({Math.round(d.retryCostRatio * 100)}%)
                  {d.highRetryProject && <span className="ml-1">· {d.highRetryProject.name} 재시도율 {d.highRetryProject.rate.toFixed(0)}%</span>}
                </div>
              )}
              {/* 일별 비용 스파크라인 */}
              {data.dailyTrend.length >= 2 && (
                <Sparkline data={data.dailyTrend.map(d => d.cost)} width="100%" height={24} color="amber" />
              )}
            </section>
          )}

          {/* ⑥ 소요 시간 (파이프라인) */}
          {data.lifecycle.procCount > 0 && (
            <section className="bg-ive-bg-card border border-ive-border-subtle rounded-lg p-4 space-y-3">
              {/* 체감 해결시간 */}
              {data.lifecycle.totalAvg > 0 && (
                <div className="text-xs font-bold text-ive-text">
                  이슈 해결까지 평균 {fmtDur(data.lifecycle.totalAvg)}
                  {data.prevLifecycle.totalAvg > 0 && <span className="text-ive-text-dim font-bold ml-1">(전기 {fmtDur(data.prevLifecycle.totalAvg)})</span>}
                </div>
              )}

              {/* 인사이트 문장 */}
              {data.lifecycle.totalAvg > 0 && (() => {
                const waitPct = Math.round((data.lifecycle.waitAvg / data.lifecycle.totalAvg) * 100)
                const procPct = Math.round((data.lifecycle.procAvg / data.lifecycle.totalAvg) * 100)
                const verifyPct = data.lifecycle.verifyCount > 0 ? Math.round((data.lifecycle.verifyAvg / data.lifecycle.totalAvg) * 100) : 0
                let insight = '각 단계가 고르게 분포되어 있습니다'
                if (waitPct >= 50) insight = `대기에서 전체 시간의 ${waitPct}%가 소요됩니다`
                else if (procPct >= 60) insight = `수행 단계에 시간이 집중됩니다 (${procPct}%)`
                else if (verifyPct >= 40) insight = `검증이 병목입니다 (${verifyPct}%)`
                return <div className="text-xs text-ive-text-dim">{insight}</div>
              })()}

              {/* 단계별 */}
              <div className={`grid gap-2 ${data.lifecycle.verifyCount > 0 ? 'grid-cols-3' : 'grid-cols-2'}`}>
                {data.lifecycle.waitCount > 0 && (
                  <div className="text-center">
                    <div className="text-xs text-ive-text-dim">대기</div>
                    <div className="text-sm font-bold text-ive-cyan">{fmtDur(data.lifecycle.waitAvg)}</div>
                    {data.prevLifecycle.waitAvg > 0 && (() => {
                      const b = diffBadge(data.lifecycle.waitAvg, data.prevLifecycle.waitAvg)
                      return b ? <div className={`text-xs font-bold ${diffColor(data.lifecycle.waitAvg, data.prevLifecycle.waitAvg, true)}`}>{b}</div> : null
                    })()}
                  </div>
                )}
                <div className="text-center">
                  <div className="text-xs text-ive-text-dim">수행</div>
                  <div className="text-sm font-bold text-emerald-400">{fmtDur(data.lifecycle.procAvg)}</div>
                  {data.prevLifecycle.procAvg > 0 && (() => {
                    const b = diffBadge(data.lifecycle.procAvg, data.prevLifecycle.procAvg)
                    return b ? <div className={`text-xs font-bold ${diffColor(data.lifecycle.procAvg, data.prevLifecycle.procAvg, true)}`}>{b}</div> : null
                  })()}
                </div>
                {data.lifecycle.verifyCount > 0 && (
                  <div className="text-center">
                    <div className="text-xs text-ive-text-dim">검증</div>
                    <div className="text-sm font-bold text-orange-400">{fmtDur(data.lifecycle.verifyAvg)}</div>
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
                      {waitPct > 0 && <div className="bg-ive-cyan/60" style={{ width: `${waitPct}%` }} />}
                      <div className="bg-emerald-400/60" style={{ width: `${procPct}%` }} />
                      {verifyPct > 0 && <div className="bg-orange-400/60" style={{ width: `${verifyPct}%` }} />}
                    </div>
                    <div className="flex justify-between mt-1 text-xs text-ive-text-dim">
                      {waitPct > 0 && <span>대기 {waitPct}%</span>}
                      <span>수행 {procPct}%</span>
                      {verifyPct > 0 && <span>검증 {verifyPct}%</span>}
                    </div>
                  </div>
                )
              })()}

              <div className="text-xs text-ive-text-dim text-center">
                재시도 평균 {data.lifecycle.avgAttempts.toFixed(1)}회 · 이슈 {data.lifecycle.uniqueIssues}건
              </div>

              {/* 검증자 진단 */}
              {d.verifier && (
                <div className="pt-2 border-t border-ive-border-dark/50">
                  <div className="flex items-center justify-between text-xs">
                    <span className="text-ive-text-dim">검증자 {d.verifier.verifierCount}명 · {d.verifier.dailyVerifyCapacity}건/일</span>
                    <span className={`font-bold ${d.verifier.verifyUtilization >= 0.9 ? 'text-ive-red' : 'text-ive-text-dim'}`}>가동률 {Math.round(d.verifier.verifyUtilization * 100)}%</span>
                  </div>
                  {d.verifier.annotation && <div className="text-xs text-ive-amber mt-0.5">{d.verifier.annotation}</div>}
                </div>
              )}
            </section>
          )}

          {/* ⑦ 프로젝트별 흐름 */}
          {d.projects.length > 0 && (
            <section>
              <div className="text-xs font-bold text-ive-text-dim mb-2 uppercase tracking-wider">프로젝트별 흐름</div>
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
                        <span className="text-xs text-ive-text-dim">{p.assignedAgents}대</span>
                        <i className={`fa-solid fa-chevron-${expandedProjects.has(p.projectId) ? 'up' : 'down'} text-xs text-ive-text-dim`} />
                      </div>
                      <div className="flex items-center gap-2 mt-1 text-xs">
                        <span className="text-ive-cyan">유입 {p.inflow}</span>
                        <span className="text-ive-text-dim">→</span>
                        <span className="text-ive-green">처리 {p.throughput}</span>
                        {p.currentWaiting > 0 && <span className={`font-bold ${p.currentWaiting >= 6 ? 'text-ive-red' : p.currentWaiting >= 3 ? 'text-ive-amber' : 'text-ive-cyan'}`}>
                          대기 중 {p.currentWaiting}
                        </span>}
                        <span className="text-ive-amber ml-auto">${fmtCost(p.cost)}</span>
                      </div>
                      {p.annotation && <div className="text-xs text-ive-amber mt-1">· {p.annotation}</div>}
                    </button>
                    {expandedProjects.has(p.projectId) && (
                      <div className="px-3 pb-3 border-t border-ive-border-dark">
                        <div className="grid grid-cols-3 gap-1 mt-2 text-center text-xs">
                          <div><div className="text-ive-text-dim">가동률</div><div className={`font-bold ${p.healthLevel === 'overloaded' ? 'text-ive-red' : p.healthLevel === 'idle' ? 'text-ive-cyan' : 'text-ive-text'}`}>{Math.round(p.utilization * 100)}%</div></div>
                          <div><div className="text-ive-text-dim">건당 비용</div><div className="font-bold text-ive-amber">${fmtCost(p.costPerTask)}</div></div>
                          <div><div className="text-ive-text-dim">재시도율</div><div className="font-bold text-ive-text">{p.retryRate.toFixed(0)}%</div></div>
                        </div>
                        {/* 프로젝트별 미니 추이 */}
                        {(() => {
                          const pt = data.projectTrend?.find(t => t.projectId === p.projectId)
                          const pwt = data.waitingTrend?.map(d => d.byProject.find(bp => bp.projectId === p.projectId)?.waiting ?? 0) ?? []
                          if (!pt || pt.daily.length < 2) return null
                          return (
                            <div className="mt-2 bg-ive-bg-deep rounded-lg p-2">
                              <div className="grid grid-cols-3 gap-2">
                                <div className="flex items-center gap-1.5"><span className="text-xs text-ive-text-dim shrink-0">건수</span><Sparkline data={pt.daily.map(d => d.tasks)} width={80} height={20} color="auto" /></div>
                                <div className="flex items-center gap-1.5"><span className="text-xs text-ive-text-dim shrink-0">비용</span><Sparkline data={pt.daily.map(d => d.cost)} width={80} height={20} color="amber" /></div>
                                <div className="flex items-center gap-1.5"><span className="text-xs text-ive-text-dim shrink-0">대기</span><Sparkline data={pwt.length > 0 ? pwt : [0]} width={80} height={20} color="cyan" /></div>
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

          {/* ⑧ 개발자별 부하 */}
          {d.agents.length > 0 && (
            <section>
              <div className="text-xs font-bold text-ive-text-dim mb-2 uppercase tracking-wider">개발자별 부하</div>
              <div className="space-y-2">
                {d.agents.sort((a, b) => b.tasks - a.tasks).map(a => (
                  <div key={a.agentId} className={`bg-ive-bg-card border border-ive-border-subtle rounded-lg overflow-hidden ${a.annotation?.includes('과부하') ? 'bg-ive-red/3' : a.annotation?.includes('유휴') ? 'bg-ive-cyan/3' : ''}`}>
                    <button onClick={() => { const n = new Set(expandedAgents); n.has(a.agentId) ? n.delete(a.agentId) : n.add(a.agentId); setExpandedAgents(n) }}
                      className="w-full px-3 py-2.5 text-left">
                      <div className="flex items-center gap-2">
                        <AgentAvatar avatar={a.agentAvatar} size="sm" className="!w-5 !h-5 !text-xs" />
                        <span className="text-sm font-bold text-ive-text flex-1 truncate">{a.agentName}</span>
                        {a.assignedProjectName && <span className="text-xs text-ive-text-dim truncate max-w-[80px]">→ {a.assignedProjectName}</span>}
                        <i className={`fa-solid fa-chevron-${expandedAgents.has(a.agentId) ? 'up' : 'down'} text-xs text-ive-text-dim`} />
                      </div>
                      <div className="flex items-center gap-3 mt-1 text-xs">
                        <span className="text-ive-text font-bold">{a.tasks}건</span>
                        <span className="text-ive-text-dim">{a.dailyCapacity}건/일</span>
                        {a.currentWaiting > 0 && <span className={`font-bold ${a.currentWaiting >= 6 ? 'text-ive-red' : a.currentWaiting >= 3 ? 'text-ive-amber' : 'text-ive-cyan'}`}>대기 중 {a.currentWaiting}</span>}
                        <span className="text-ive-amber ml-auto">${fmtCost(a.cost)}</span>
                      </div>
                      {a.annotation && <div className="text-xs text-ive-amber mt-1">· {a.annotation}</div>}
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
                                <div className="flex items-center gap-1.5"><span className="text-xs text-ive-text-dim shrink-0">건수</span><Sparkline data={at.daily.map(d => d.tasks)} width={80} height={20} color="auto" /></div>
                                <div className="flex items-center gap-1.5"><span className="text-xs text-ive-text-dim shrink-0">비용</span><Sparkline data={at.daily.map(d => d.cost)} width={80} height={20} color="amber" /></div>
                                <div className="flex items-center gap-1.5"><span className="text-xs text-ive-text-dim shrink-0">대기</span><Sparkline data={awt.length > 0 ? awt : [0]} width={80} height={20} color="cyan" /></div>
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

          {/* ⑨ 담당자별 검증 현황 */}
          {data.byUser && data.byUser.length > 0 && (
            <section>
              <div className="text-xs font-bold text-ive-text-dim mb-2 uppercase tracking-wider">담당자별 검증 현황</div>
              <div className="space-y-2">
                {data.byUser.sort((a, b) => (b.verifyWaiting - a.verifyWaiting) || (b.verifyTasks - a.verifyTasks) || (b.tasks - a.tasks)).map(u => {
                  const hasVerify = u.verifyTasks > 0 || u.verifyWaiting > 0
                  const prev = data.prevByUser?.find(p => p.userId === u.userId)
                  const approvalRate = u.verifyApproved + u.verifyRejected > 0 ? Math.round(u.verifyApproved / (u.verifyApproved + u.verifyRejected) * 100) : null
                  return (
                    <div key={u.userId} className={`bg-ive-bg-card border border-ive-border-subtle rounded-lg overflow-hidden ${u.verifyWaiting >= 5 ? 'bg-ive-red/3' : u.verifyWaiting >= 3 ? 'bg-ive-amber/3' : ''}`}>
                      <button onClick={() => { const n = new Set(expandedUsers); n.has(u.userId) ? n.delete(u.userId) : n.add(u.userId); setExpandedUsers(n) }}
                        className="w-full px-3 py-2.5 text-left">
                        <div className="flex items-center gap-2">
                          <AgentAvatar avatar={u.userAvatar} size="sm" className="!w-5 !h-5 !text-xs" />
                          <span className="text-sm font-bold text-ive-text flex-1 truncate">{u.userName}</span>
                          {u.verifyWaiting > 0 && <span className={`text-xs font-bold ${u.verifyWaiting >= 5 ? 'text-ive-red' : u.verifyWaiting >= 3 ? 'text-ive-amber' : 'text-ive-cyan'}`}><i className="fa-solid fa-clock mr-0.5" />대기 {u.verifyWaiting}</span>}
                          <span className="text-sm font-bold text-ive-text">{u.tasks}건</span>
                          {prev != null && (() => { const b = diffBadge(u.tasks, prev.tasks); return b ? <span className={`text-xs font-bold ${diffColor(u.tasks, prev.tasks)}`}>{b}</span> : null })()}
                          <i className={`fa-solid fa-chevron-${expandedUsers.has(u.userId) ? 'up' : 'down'} text-xs text-ive-text-dim`} />
                        </div>
                        <div className="flex items-center gap-3 mt-1.5 text-xs text-ive-text-dim flex-wrap">
                          {hasVerify ? (<>
                            <span><span className="text-ive-green font-bold">승인</span> {u.verifyApproved}</span>
                            {u.verifyRejected > 0 && <span><span className="text-ive-red font-bold">반려</span> {u.verifyRejected}</span>}
                            {u.avgVerifyMin > 0 && <span><span className="text-ive-text-dim font-bold">검증</span> {fmtDur(u.avgVerifyMin)}</span>}
                            {approvalRate != null && <span className={`font-bold ${approvalRate >= 80 ? 'text-ive-green' : approvalRate >= 50 ? 'text-ive-amber' : 'text-ive-red'}`}>{approvalRate}%</span>}
                          </>) : (<>
                            <span>성공 {u.success} / 실패 {u.failed}</span>
                            {u.avgDurationMin > 0 && <span>평균 {fmtDur(u.avgDurationMin)}</span>}
                          </>)}
                          <span className="ml-auto text-ive-amber">${fmtCost(u.cost)}</span>
                        </div>
                      </button>
                      {expandedUsers.has(u.userId) && (
                        <div className="px-3 pb-3 border-t border-ive-border-dark">
                          {hasVerify ? (<>
                            {/* 검증 상세 */}
                            <div className="grid grid-cols-4 gap-1 mt-2 text-center text-xs">
                              <div><div className="text-ive-text-dim">검증</div><div className="font-bold text-ive-text">{u.verifyTasks}건</div></div>
                              <div><div className="text-ive-text-dim">승인</div><div className="font-bold text-ive-green">{u.verifyApproved}건</div></div>
                              <div><div className="text-ive-text-dim">반려</div><div className={`font-bold ${u.verifyRejected > 0 ? 'text-ive-red' : 'text-ive-text'}`}>{u.verifyRejected}건</div></div>
                              <div><div className="text-ive-text-dim">대기중</div><div className={`font-bold ${u.verifyWaiting >= 5 ? 'text-ive-red' : u.verifyWaiting >= 3 ? 'text-ive-amber' : 'text-ive-text'}`}>{u.verifyWaiting}건</div></div>
                            </div>
                            <div className="grid grid-cols-3 gap-1 mt-2 text-center text-xs">
                              <div><div className="text-ive-text-dim">검증시간</div><div className="font-bold text-ive-text">{u.avgVerifyMin > 0 ? fmtDur(u.avgVerifyMin) : '-'}</div></div>
                              <div><div className="text-ive-text-dim">검증대기</div><div className={`font-bold ${u.verifyAvgWaitMin > 60 ? 'text-ive-red' : u.verifyAvgWaitMin > 30 ? 'text-ive-amber' : 'text-ive-text'}`}>{u.verifyAvgWaitMin > 0 ? fmtDur(u.verifyAvgWaitMin) : '-'}</div></div>
                              <div><div className="text-ive-text-dim">배정이슈</div><div className="font-bold text-ive-text">{u.tasks}건</div></div>
                            </div>
                          </>) : (<>
                            {/* 검증 데이터 없을 때 — 이슈 배정 상세 */}
                            <div className="grid grid-cols-3 gap-1 mt-2 text-center text-xs">
                              <div><div className="text-ive-text-dim">성공</div><div className="font-bold text-ive-green">{u.success}건</div></div>
                              <div><div className="text-ive-text-dim">실패</div><div className={`font-bold ${u.failed > 0 ? 'text-ive-red' : 'text-ive-text'}`}>{u.failed}건</div></div>
                              <div><div className="text-ive-text-dim">이슈</div><div className="font-bold text-ive-text">{u.issueCount}건</div></div>
                            </div>
                            {u.avgWaitMin > 0 && (
                              <div className="mt-2 text-center text-xs">
                                <span className="text-ive-text-dim">이슈 배정 → 처리 대기 평균 </span>
                                <span className="font-bold text-ive-cyan">{fmtDur(u.avgWaitMin)}</span>
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
                                <div className={`grid ${hasVerifyData ? 'grid-cols-3' : 'grid-cols-2'} gap-2`}>
                                  <div className="flex items-center gap-1.5"><span className="text-xs text-ive-text-dim shrink-0">이슈</span><Sparkline data={ut.daily.map(d => d.tasks ?? 0)} width={80} height={20} color="auto" /></div>
                                  {hasVerifyData && <div className="flex items-center gap-1.5"><span className="text-xs text-ive-text-dim shrink-0">검증</span><Sparkline data={ut.daily.map(d => d.verified ?? 0)} width={80} height={20} color="green" /></div>}
                                  <div className="flex items-center gap-1.5"><span className="text-xs text-ive-text-dim shrink-0">비용</span><Sparkline data={ut.daily.map(d => d.cost ?? 0)} width={80} height={20} color="amber" /></div>
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
                추이 차트
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
                처리된 이슈 ({data.resolvedIssues.length}건)
              </button>
              {showIssues && (
                <div className="space-y-2">
                  {/* 필터 */}
                  <div className="flex items-center gap-2">
                    <select value={issueProjectFilter} onChange={e => setIssueProjectFilter(e.target.value)} className="bg-ive-bg-input border border-ive-border rounded-lg px-2 py-1 text-xs text-ive-text">
                      <option value="all">전체</option>
                      {uniqueProjects.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
                    </select>
                    <input value={issueKeyword} onChange={e => setIssueKeyword(e.target.value)} placeholder="검색..." className="flex-1 bg-ive-bg-input border border-ive-border rounded-lg px-2 py-1 text-xs text-ive-text placeholder:text-ive-text-dim" />
                  </div>
                  {/* 정렬 */}
                  <div className="flex gap-1">
                    {([['date', '일자'], ['duration', '시간'], ['cost', '비용']] as const).map(([key, label]) => (
                      <button key={key} onClick={() => { if (issueSort === key) setIssueSortDir(d => d === 'desc' ? 'asc' : 'desc'); else { setIssueSort(key); setIssueSortDir('desc') } }}
                        className={`px-2 py-1 text-xs font-bold rounded-lg ${issueSort === key ? 'bg-ive-green/20 text-ive-green' : 'text-ive-text-dim'}`}>
                        {label} {issueSort === key && (issueSortDir === 'desc' ? '↓' : '↑')}
                      </button>
                    ))}
                  </div>
                  {/* 목록 */}
                  <div className="space-y-1">
                    {filteredIssues.slice(0, visibleCount).map((issue, i) => (
                      <div key={i} className="bg-ive-bg-card border border-ive-border-subtle rounded-lg px-3 py-2">
                        <div className="flex items-center gap-2 text-xs">
                          <span className="text-ive-text-dim">#{issue.issueIid}</span>
                          <span className="text-ive-text font-bold flex-1 truncate">{issue.issueTitle}</span>
                        </div>
                        <div className="flex items-center gap-2 mt-1 text-xs text-ive-text-dim">
                          <span style={{ color: issue.projectColor }}>{issue.projectName}</span>
                          <span>{issue.agentName}</span>
                          {issue.waitMin != null && <span><i className="fa-solid fa-clock mr-0.5" />{fmtDur(issue.waitMin)}</span>}
                          <span className="ml-auto">{fmtDur(issue.durationMin)}</span>
                          <span className="text-ive-amber">${fmtCost(issue.cost)}</span>
                          {issue.attempts > 1 && <span className="text-ive-red">{issue.attempts}회</span>}
                        </div>
                      </div>
                    ))}
                    {filteredIssues.length > visibleCount && (
                      <div className="text-center text-xs text-ive-text-dim py-2">{filteredIssues.length - visibleCount}건 더 있음</div>
                    )}
                    {filteredIssues.length === 0 && <div className="text-center text-xs text-ive-text-dim py-4">조건에 맞는 이슈가 없습니다.</div>}
                  </div>
                </div>
              )}
            </section>
          )}

          {/* 데이터 없음 */}
          {data.summary.totalTasks === 0 && d.flow.inflow === 0 && (
            <div className="text-center py-10">
              <i className="fa-solid fa-chart-simple text-ive-text-dim text-2xl mb-2" />
              <p className="text-sm text-ive-text-dim">해당 기간에 처리된 작업이 없습니다.</p>
            </div>
          )}
        </main>
      )}
    </PullToRefresh>
  )
}
