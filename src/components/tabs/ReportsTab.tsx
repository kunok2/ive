'use client'

import { useEffect, useState, useCallback, useRef } from 'react'
import { useRouter } from 'next/navigation'
import { DEFAULT_AVATARS } from '@/types'
import PullToRefresh from '@/components/ui/PullToRefresh'
import AgentAvatar from '@/components/agent/AgentAvatar'
import Sparkline from '@/components/ui/Sparkline'
import { DailyTrendChart, CompareTable } from '@/components/reports/ReportCharts'
import { getKSTTodayString } from '@/lib/date-utils'

const REPORT_STATE_KEY = 'ive-report-state'

function saveReportState(state: Record<string, unknown>) {
  try { sessionStorage.setItem(REPORT_STATE_KEY, JSON.stringify(state)) } catch { /* ignore */ }
}

function loadReportState(): Record<string, unknown> | null {
  try {
    const raw = sessionStorage.getItem(REPORT_STATE_KEY)
    return raw ? JSON.parse(raw) : null
  } catch { return null }
}

type ReportType = 'weekly' | 'monthly' | 'yearly'

interface Summary {
  totalTasks: number; successCount: number; failedCount: number; runningCount: number
  successRate: number; totalDurationMin: number; avgDurationMin: number
  totalInputTokens: number; totalOutputTokens: number; totalCost: number
}

interface AgentStat {
  agentId: string; agentName: string; agentAvatar: string; cliName: string
  tasks: number; success: number; failed: number
  durationMin: number; avgDurationMin: number
  inputTokens: number; outputTokens: number; cost: number; avgTurns: number
}

interface ProjectStat {
  projectId: string; projectName: string; projectColor: string; projectAvatarUrl: string; projectProvider: string
  tasks: number; success: number; failed: number
  totalDurationMin: number; avgDurationMin: number
  inputTokens: number; outputTokens: number; cost: number
  byAgent: AgentStat[]
}

interface AgentGlobal {
  agentId: string; agentName: string; agentAvatar: string; cliName: string
  tasks: number; success: number; failed: number
  totalDurationMin: number; avgDurationMin: number
  inputTokens: number; outputTokens: number; cost: number; avgTurns: number
}

interface DailyTrend { date: string; tasks: number; success: number; failed: number; cost: number; waitAvg: number | null; procAvg: number | null }

interface TrendDaily { date: string; tasks: number; cost: number }

interface ProjectTrend {
  projectId: string; projectName: string; projectColor: string
  daily: TrendDaily[]
}

interface AgentTrend {
  agentId: string; agentName: string; agentAvatar: string
  daily: TrendDaily[]
}

interface ResolvedIssue {
  issueIid: number; issueTitle: string; projectId: string; projectName: string; projectColor: string
  agentName: string; agentAvatar: string; status: 'success' | 'failed'; startedAt: string; durationMin: number; cost: number
  waitMin: number | null; turns: number; attempts: number; attemptNo: number
}

interface Lifecycle {
  waitAvg: number; waitMax: number; waitCount: number
  procAvg: number; procMax: number; procCount: number
  totalAvg: number; totalMax: number; totalCount: number
  avgAttempts: number; retryRate: number; uniqueIssues: number
}

interface PrevSummary {
  totalTasks: number; successCount: number; failedCount: number
  successRate: number; totalDurationMin: number; avgDurationMin: number; totalCost: number
}
interface PrevLifecycle {
  waitAvg: number; waitCount: number
  procAvg: number; procCount: number
  totalAvg: number; totalCount: number
}
interface PrevByItem { tasks: number; cost: number }
interface PrevDaily { date: string; tasks: number; cost: number; waitAvg?: number | null; procAvg?: number | null }

interface ReportData {
  period: { start: string; end: string; type: string }
  prevPeriod: { start: string; end: string }
  summary: Summary
  prevSummary: PrevSummary
  prevByProject: (PrevByItem & { projectId: string; projectName: string })[]
  prevByAgent: (PrevByItem & { agentId: string; agentName: string })[]
  prevDailyTrend: PrevDaily[]
  prevLifecycle: PrevLifecycle
  byProject: ProjectStat[]
  byAgent: AgentGlobal[]
  dailyTrend: DailyTrend[]
  projectTrend: ProjectTrend[]
  agentTrend: AgentTrend[]
  resolvedIssues?: ResolvedIssue[]
  lifecycle: Lifecycle
  insights: string[]
}

type SectionSortKey = 'tasks' | 'cost'
type SectionSortDir = 'desc' | 'asc'

type IssueFilter = 'all' | 'success' | 'failed'
type IssueSortKey = 'date' | 'iid' | 'wait' | 'duration' | 'cost'
type IssueSortDir = 'desc' | 'asc'

const SORT_KEY = 'ive-report-sort'
const SORT_DIR_KEY = 'ive-report-sort-dir'
const PROJ_SORT_KEY = 'ive-report-proj-sort'
const PROJ_SORT_DIR = 'ive-report-proj-sort-dir'
const AGENT_SORT_KEY = 'ive-report-agent-sort'
const AGENT_SORT_DIR = 'ive-report-agent-sort-dir'

function formatDuration(min: number): string {
  if (min < 60) return `${min.toFixed(1)}분`
  const h = Math.floor(min / 60)
  const m = Math.round(min % 60)
  return `${h}시간 ${m}분`
}

function formatCost(n: number): string {
  return n.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })
}

function formatTokens(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}K`
  return String(n)
}

function formatDate(dateStr: string): string {
  const d = new Date(dateStr)
  return `${d.getMonth() + 1}.${d.getDate()}`
}

function formatPeriodLabel(type: ReportType, start: string, end: string): string {
  const s = new Date(start)
  const e = new Date(end)
  e.setDate(e.getDate() - 1)
  if (type === 'weekly') {
    return `${s.getFullYear()}.${formatDate(start)} ~ ${formatDate(e.toISOString().slice(0, 10))}`
  }
  if (type === 'monthly') {
    return `${s.getFullYear()}년 ${s.getMonth() + 1}월`
  }
  return `${s.getFullYear()}년`
}

const DAY_LABELS = ['일', '월', '화', '수', '목', '금', '토']

/** 퍼센트 변동 (이전 대비). 이전값 0이면 비교 불가 */
function diffPct(cur: number, prev: number): number | null {
  if (prev === 0) return null
  return Math.round(((cur - prev) / prev) * 100)
}
/** 포인트 차이 (성공률 등 % 단위 비교용) */
function diffPt(cur: number, prev: number): number | null {
  if (prev === 0 && cur === 0) return null
  return Math.round((cur - prev) * 10) / 10
}

export default function ReportsTab() {
  const router = useRouter()

  // sessionStorage에서 이전 상태 복원
  const saved = typeof window !== 'undefined' ? loadReportState() : null

  const [type, setType] = useState<ReportType>(() => (saved?.type as ReportType) || 'weekly')
  const [date, setDate] = useState(() => (saved?.date as string) || getKSTTodayString())
  const [data, setData] = useState<ReportData | null>(null)
  const [loading, setLoading] = useState(false)
  const [expandedProjects, setExpandedProjects] = useState<Set<string>>(() => new Set((saved?.expandedProjects as string[]) || []))
  const [expandedAgents, setExpandedAgents] = useState<Set<string>>(() => new Set((saved?.expandedAgents as string[]) || []))
  const [projectSortKey, setProjectSortKey] = useState<SectionSortKey>(() => {
    if (typeof window === 'undefined') return 'tasks'
    return (localStorage.getItem(PROJ_SORT_KEY) as SectionSortKey) || 'tasks'
  })
  const [projectSortDir, setProjectSortDir] = useState<SectionSortDir>(() => {
    if (typeof window === 'undefined') return 'desc'
    return (localStorage.getItem(PROJ_SORT_DIR) as SectionSortDir) || 'desc'
  })
  const [agentSortKey, setAgentSortKey] = useState<SectionSortKey>(() => {
    if (typeof window === 'undefined') return 'tasks'
    return (localStorage.getItem(AGENT_SORT_KEY) as SectionSortKey) || 'tasks'
  })
  const [agentSortDir, setAgentSortDir] = useState<SectionSortDir>(() => {
    if (typeof window === 'undefined') return 'desc'
    return (localStorage.getItem(AGENT_SORT_DIR) as SectionSortDir) || 'desc'
  })
  const [issueFilter, setIssueFilter] = useState<IssueFilter>(() => (saved?.issueFilter as IssueFilter) || 'all')
  const [issueProjectFilter, setIssueProjectFilter] = useState<string>(() => (saved?.issueProjectFilter as string) || 'all')
  const [issueKeyword, setIssueKeyword] = useState(() => (saved?.issueKeyword as string) || '')
  const [visibleCount, setVisibleCount] = useState(20)
  const [showInsights, setShowInsights] = useState(false)

  const [issueSort, setIssueSort] = useState<IssueSortKey>(() => {
    if (typeof window === 'undefined') return 'date'
    return (localStorage.getItem(SORT_KEY) as IssueSortKey) || 'date'
  })
  const [issueSortDir, setIssueSortDir] = useState<IssueSortDir>(() => {
    if (typeof window === 'undefined') return 'desc'
    return (localStorage.getItem(SORT_DIR_KEY) as IssueSortDir) || 'desc'
  })

  // 필터/정렬 변경 시 표시 건수 리셋
  useEffect(() => { setVisibleCount(20) }, [issueFilter, issueProjectFilter, issueKeyword, issueSort, issueSortDir])

  // 무한 스크롤: 하단 도달 시 추가 로드
  useEffect(() => {
    function handleScroll() {
      if (window.innerHeight + window.scrollY >= document.body.offsetHeight - 200) {
        setVisibleCount(prev => prev + 20)
      }
    }
    window.addEventListener('scroll', handleScroll, { passive: true })
    return () => window.removeEventListener('scroll', handleScroll)
  }, [])

  // 상태가 변경될 때마다 sessionStorage에 저장
  useEffect(() => {
    saveReportState({
      type, date,
      expandedProjects: [...expandedProjects],
      expandedAgents: [...expandedAgents],
      issueFilter, issueProjectFilter, issueKeyword,
    })
  }, [type, date, expandedProjects, expandedAgents, issueFilter, issueProjectFilter, issueKeyword])

  // 페이지 스크롤 위치 복원
  useEffect(() => {
    if (!data || loading) return
    const savedScroll = sessionStorage.getItem('report-issues-scroll')
    if (savedScroll) {
      requestAnimationFrame(() => { window.scrollTo(0, Number(savedScroll)) })
      sessionStorage.removeItem('report-issues-scroll')
    }
  }, [data, loading])

  const fetchReport = useCallback(async () => {
    setLoading(true)
    try {
      const res = await fetch(`/api/reports?type=${type}&date=${date}`)
      if (res.ok) setData(await res.json())
    } finally { setLoading(false) }
  }, [type, date])

  // 탭 진입 시 항상 조회 + type/date 변경 시 재조회
  const initialFetchDone = useRef(false)
  useEffect(() => {
    fetchReport()
    initialFetchDone.current = true
  }, [fetchReport])
  useEffect(() => {
    if (!initialFetchDone.current) fetchReport()
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  function navigate(dir: -1 | 1) {
    const d = new Date(date)
    if (type === 'weekly') d.setDate(d.getDate() + dir * 7)
    else if (type === 'monthly') d.setMonth(d.getMonth() + dir)
    else d.setFullYear(d.getFullYear() + dir)
    setDate(d.toISOString().slice(0, 10))
  }

  function goToToday() {
    setDate(getKSTTodayString())
  }

  function isCurrentPeriod(): boolean {
    if (!data) return false
    const today = getKSTTodayString()
    return today >= data.period.start && today < data.period.end
  }

  function toggleProject(id: string) {
    setExpandedProjects(prev => { const next = new Set(prev); next.has(id) ? next.delete(id) : next.add(id); return next })
  }

  function toggleAgent(id: string) {
    setExpandedAgents(prev => { const next = new Set(prev); next.has(id) ? next.delete(id) : next.add(id); return next })
  }

  function toggleSectionSort(
    currentKey: SectionSortKey, currentDir: SectionSortDir,
    setKey: (k: SectionSortKey) => void, setDir: (d: SectionSortDir) => void,
    key: SectionSortKey, lsKey: string, lsDir: string,
  ) {
    if (currentKey === key) {
      const next = currentDir === 'desc' ? 'asc' : 'desc'
      setDir(next)
      localStorage.setItem(lsDir, next)
    } else {
      setKey(key); setDir('desc')
      localStorage.setItem(lsKey, key)
      localStorage.setItem(lsDir, 'desc')
    }
  }

  function sortedProjects() {
    if (!data) return []
    return [...data.byProject].sort((a, b) => {
      const v = projectSortKey === 'cost' ? a.cost - b.cost : a.tasks - b.tasks
      return projectSortDir === 'desc' ? -v : v
    })
  }

  function sortedAgents() {
    if (!data) return []
    return [...data.byAgent].sort((a, b) => {
      const v = agentSortKey === 'cost' ? a.cost - b.cost : a.tasks - b.tasks
      return agentSortDir === 'desc' ? -v : v
    })
  }

  function changeSort(key: IssueSortKey) {
    if (issueSort === key) {
      const newDir = issueSortDir === 'desc' ? 'asc' : 'desc'
      setIssueSortDir(newDir)
      localStorage.setItem(SORT_DIR_KEY, newDir)
    } else {
      setIssueSort(key)
      setIssueSortDir('desc')
      localStorage.setItem(SORT_KEY, key)
      localStorage.setItem(SORT_DIR_KEY, 'desc')
    }
  }

  // 필터된 이슈
  const filteredIssues = data?.resolvedIssues?.filter(issue => {
    if (issueFilter !== 'all' && issue.status !== issueFilter) return false
    if (issueProjectFilter !== 'all' && issue.projectId !== issueProjectFilter) return false
    if (issueKeyword.trim()) {
      const kw = issueKeyword.trim().toLowerCase()
      const text = `#${issue.issueIid} ${issue.issueTitle} ${issue.agentName} ${issue.projectName}`.toLowerCase()
      if (!text.includes(kw)) return false
    }
    return true
  })?.sort((a, b) => {
    const dir = issueSortDir === 'desc' ? 1 : -1
    switch (issueSort) {
      case 'date': return dir * b.startedAt.localeCompare(a.startedAt)
      case 'iid': return dir * (b.issueIid - a.issueIid)
      case 'wait': return dir * ((b.waitMin ?? 0) - (a.waitMin ?? 0))
      case 'duration': return dir * (b.durationMin - a.durationMin)
      case 'cost': return dir * (b.cost - a.cost)
      default: return 0
    }
  }) ?? []

  // 고유 프로젝트 목록 (필터용)
  const uniqueProjects = data?.resolvedIssues
    ? [...new Map(data.resolvedIssues.map(i => [i.projectId, { id: i.projectId, name: i.projectName, color: i.projectColor }])).values()]
    : []

  return (
    <PullToRefresh onRefresh={fetchReport} className="min-h-screen pb-20">
      {/* Period selector */}
      <div className="sticky top-[57px] z-30 bg-ive-bg-deep border-b border-ive-border-dark">
        <div className="px-4 py-3 max-w-lg mx-auto">
          <div className="flex gap-1 mb-2">
            {(['weekly', 'monthly', 'yearly'] as ReportType[]).map(t => (
              <button
                key={t}
                onClick={() => setType(t)}
                className={`flex-1 py-1.5 text-xs font-bold rounded-lg transition-all ${
                  type === t ? 'bg-ive-green text-ive-bg-deep' : 'bg-ive-bg-card text-ive-text-dim'
                }`}
              >
                {t === 'weekly' ? '주간' : t === 'monthly' ? '월간' : '연간'}
              </button>
            ))}
          </div>
          <div className="flex items-center justify-between">
            <button onClick={() => navigate(-1)} className="w-8 h-8 flex items-center justify-center text-ive-text-dim hover:text-ive-text">
              <i className="fa-solid fa-chevron-left" />
            </button>
            <div className="flex items-center gap-2">
              <span className="text-sm font-bold text-ive-text">
                {data ? formatPeriodLabel(type, data.period.start, data.period.end) : '...'}
              </span>
              {!isCurrentPeriod() && (
                <button
                  onClick={goToToday}
                  className="px-2 py-0.5 text-[11px] font-bold rounded-md bg-ive-green/20 text-ive-green hover:bg-ive-green/30 transition-colors"
                >
                  오늘
                </button>
              )}
            </div>
            <button onClick={() => navigate(1)} className="w-8 h-8 flex items-center justify-center text-ive-text-dim hover:text-ive-text">
              <i className="fa-solid fa-chevron-right" />
            </button>
          </div>
        </div>
      </div>

      {loading && (
        <div className="text-center py-10 text-ive-text-dim">
          <i className="fa-solid fa-circle-notch fa-spin mr-1" />불러오는 중...
        </div>
      )}

      {data && !loading && (
        <main className="px-4 py-4 max-w-lg mx-auto space-y-4">
          {/* 총평 */}
          {(() => {
            const s = data.summary, ps = data.prevSummary, lc = data.lifecycle, plc = data.prevLifecycle
            const periodLabel = type === 'weekly' ? '이번 주' : type === 'monthly' ? '이번 달' : '올해'
            const prevLabel = type === 'weekly' ? '지난주' : type === 'monthly' ? '지난달' : '작년'
            const lines: { icon: string; color: string; text: string }[] = []

            // 작업량 변화
            if (ps.totalTasks > 0) {
              const taskPct = Math.round(((s.totalTasks - ps.totalTasks) / ps.totalTasks) * 100)
              if (Math.abs(taskPct) >= 5) {
                lines.push({
                  icon: taskPct > 0 ? 'fa-arrow-trend-up' : 'fa-arrow-trend-down',
                  color: taskPct > 0 ? 'text-ive-green' : 'text-ive-red',
                  text: `${periodLabel} 작업량이 ${prevLabel} 대비 ${Math.abs(taskPct).toLocaleString()}% ${taskPct > 0 ? '증가' : '감소'}했습니다.`,
                })
              } else {
                lines.push({ icon: 'fa-equals', color: 'text-ive-text-dim', text: `${periodLabel} 작업량은 ${prevLabel}과 비슷한 수준입니다.` })
              }
            } else if (s.totalTasks > 0) {
              lines.push({ icon: 'fa-sparkles', color: 'text-ive-cyan', text: `${prevLabel}에는 실행이 없었으나 ${periodLabel}에 ${s.totalTasks.toLocaleString()}건이 처리되었습니다.` })
            }

            // 비용 변화
            if (ps.totalCost > 0) {
              const costPct = Math.round(((s.totalCost - ps.totalCost) / ps.totalCost) * 100)
              if (Math.abs(costPct) >= 10) {
                lines.push({
                  icon: costPct > 0 ? 'fa-arrow-trend-up' : 'fa-arrow-trend-down',
                  color: costPct > 0 ? 'text-ive-red' : 'text-ive-green',
                  text: `비용이 ${prevLabel} 대비 ${Math.abs(costPct).toLocaleString()}% ${costPct > 0 ? '증가' : '절감'}되었습니다. ($${formatCost(ps.totalCost)} → $${formatCost(s.totalCost)})`,
                })
              }
            }

            // 성공률 변화
            if (ps.totalTasks > 0 && s.totalTasks > 0) {
              const srDiff = s.successRate - ps.successRate
              if (Math.abs(srDiff) >= 3) {
                lines.push({
                  icon: srDiff > 0 ? 'fa-circle-check' : 'fa-circle-exclamation',
                  color: srDiff > 0 ? 'text-ive-green' : 'text-ive-red',
                  text: `성공률이 ${prevLabel} ${ps.successRate.toFixed(0)}%에서 ${s.successRate.toFixed(0)}%로 ${srDiff > 0 ? '개선' : '하락'}했습니다.`,
                })
              }
            }

            // 대기시간 변화
            if (plc.waitCount > 0 && lc.waitCount > 0 && plc.waitAvg > 0) {
              const wPct = Math.round(((lc.waitAvg - plc.waitAvg) / plc.waitAvg) * 100)
              if (Math.abs(wPct) >= 15) {
                lines.push({
                  icon: wPct > 0 ? 'fa-clock' : 'fa-bolt',
                  color: wPct > 0 ? 'text-ive-red' : 'text-ive-green',
                  text: `평균 대기시간이 ${prevLabel} 대비 ${Math.abs(wPct).toLocaleString()}% ${wPct > 0 ? '늘어났습니다' : '단축되었습니다'}. (${formatDuration(plc.waitAvg)} → ${formatDuration(lc.waitAvg)})`,
                })
              }
            }

            // 수행시간 변화
            if (plc.procCount > 0 && lc.procCount > 0 && plc.procAvg > 0) {
              const pPct = Math.round(((lc.procAvg - plc.procAvg) / plc.procAvg) * 100)
              if (Math.abs(pPct) >= 15) {
                lines.push({
                  icon: pPct > 0 ? 'fa-hourglass-half' : 'fa-forward-fast',
                  color: pPct > 0 ? 'text-ive-red' : 'text-ive-green',
                  text: `평균 수행시간이 ${prevLabel} 대비 ${Math.abs(pPct).toLocaleString()}% ${pPct > 0 ? '늘어났습니다' : '단축되었습니다'}.`,
                })
              }
            }

            if (lines.length === 0 && s.totalTasks === 0) return null
            if (lines.length === 0) {
              lines.push({ icon: 'fa-check', color: 'text-ive-green', text: `${periodLabel}은 ${prevLabel}과 비교하여 전반적으로 안정적인 수준입니다.` })
            }

            return (
              <section className="bg-gradient-to-r from-ive-bg-card to-ive-bg-deep border border-ive-border-subtle rounded-xl p-3">
                <div className="flex items-center gap-1.5 mb-2">
                  <i className="fa-solid fa-comment-dots text-ive-amber text-sm" />
                  <span className="text-xs font-bold text-ive-text">총평</span>
                  <span className="text-[10px] text-ive-text-dim">vs {prevLabel}</span>
                </div>
                <div className="space-y-1.5">
                  {lines.map((l, i) => (
                    <div key={i} className="flex items-start gap-2">
                      <i className={`fa-solid ${l.icon} ${l.color} text-xs mt-0.5 w-4 text-center shrink-0`} />
                      <span className="text-xs text-ive-text leading-relaxed">{l.text}</span>
                    </div>
                  ))}
                </div>
              </section>
            )
          })()}

          {/* Summary Cards */}
          <section>
            <div className="text-xs font-bold text-ive-text-dim mb-2 uppercase tracking-wider">전체 요약</div>
            <div className="grid grid-cols-3 gap-2">
              <SummaryCard label="작업" value={`${data.summary.totalTasks.toLocaleString()}건`} sub={`성공 ${data.summary.successCount.toLocaleString()}`} color="text-ive-green" diff={diffPct(data.summary.totalTasks, data.prevSummary.totalTasks)} />
              <SummaryCard label="성공률" value={`${data.summary.successRate.toFixed(1)}%`} sub={`실패 ${data.summary.failedCount.toLocaleString()}`} color="text-ive-cyan" diff={diffPt(data.summary.successRate, data.prevSummary.successRate)} />
              <SummaryCard label="비용" value={`$${formatCost(data.summary.totalCost)}`} sub={(() => { const d = data.summary.totalCost - data.prevSummary.totalCost; if (data.prevSummary.totalCost === 0 && data.summary.totalCost === 0) return ''; if (data.prevSummary.totalCost === 0) return '신규'; return `${d >= 0 ? '+' : '-'}$${formatCost(Math.abs(d))}` })()} color="text-ive-amber" diff={diffPct(data.summary.totalCost, data.prevSummary.totalCost)} invertColor />
            </div>
            <div className="mt-2 grid grid-cols-2 gap-2">
              <SummaryCard label="총 소요시간" value={formatDuration(data.summary.totalDurationMin)} sub={(() => { const d = data.summary.totalDurationMin - data.prevSummary.totalDurationMin; if (data.prevSummary.totalDurationMin === 0 && data.summary.totalDurationMin === 0) return ''; if (data.prevSummary.totalDurationMin === 0) return '신규'; return `${d >= 0 ? '+' : '-'}${formatDuration(Math.abs(d))}` })()} color="text-ive-text" diff={diffPct(data.summary.totalDurationMin, data.prevSummary.totalDurationMin)} invertColor />
              <SummaryCard label="평균 소요시간" value={formatDuration(data.summary.avgDurationMin)} sub={(() => { const d = data.summary.avgDurationMin - data.prevSummary.avgDurationMin; if (data.prevSummary.avgDurationMin === 0 && data.summary.avgDurationMin === 0) return ''; if (data.prevSummary.avgDurationMin === 0) return '신규'; return `${d >= 0 ? '+' : '-'}${formatDuration(Math.abs(d))}` })()} color="text-ive-text" diff={diffPct(data.summary.avgDurationMin, data.prevSummary.avgDurationMin)} invertColor />
            </div>
          </section>

          {/* Lifecycle */}
          {data.lifecycle.procCount > 0 && (
            <section>
              <div className="text-xs font-bold text-ive-text-dim mb-2 uppercase tracking-wider">이슈 생애주기</div>
              <div className="bg-ive-bg-card border border-ive-border-subtle rounded-xl p-3 space-y-3">
                {/* 단계별 평균/최대 + 이전 비교 */}
                {(() => {
                  const hasWait = data.lifecycle.waitCount > 0
                  const hasTotal = data.lifecycle.totalCount > 0
                  const cols = 1 + (hasWait ? 1 : 0) + (hasTotal ? 1 : 0)
                  const prev = data.prevLifecycle
                  const waitDiff = diffPct(data.lifecycle.waitAvg, prev.waitAvg)
                  const procDiff = diffPct(data.lifecycle.procAvg, prev.procAvg)
                  const totalDiff = diffPct(data.lifecycle.totalAvg, prev.totalAvg)
                  const DiffBadge = ({ diff, isNew }: { diff: number | null; isNew?: boolean }) => {
                    if (isNew) return <span className="text-[9px] font-bold px-1 py-0.5 rounded text-ive-cyan bg-ive-cyan/10">NEW</span>
                    if (diff == null) return null
                    const color = diff > 0 ? 'text-ive-red bg-ive-red/10' : diff < 0 ? 'text-ive-green bg-ive-green/10' : 'text-ive-text-dim bg-white/5'
                    return <span className={`text-[9px] font-bold px-1 py-0.5 rounded ${color}`}>{diff > 0 ? '+' : ''}{diff.toLocaleString()}%</span>
                  }
                  return (
                    <div className={`grid gap-2 ${cols === 3 ? 'grid-cols-3' : cols === 2 ? 'grid-cols-2' : 'grid-cols-1'}`}>
                      {hasWait && (
                        <div className="text-center">
                          <div className="text-[10px] text-ive-text-dim">생성→배정</div>
                          <div className="text-sm font-extrabold text-ive-cyan">{formatDuration(data.lifecycle.waitAvg)}</div>
                          <div className="text-[10px] text-ive-text-dim">최대 {formatDuration(data.lifecycle.waitMax)}</div>
                          <div className="mt-0.5">
                            <DiffBadge diff={waitDiff} isNew={waitDiff == null && data.lifecycle.waitCount > 0 && prev.waitCount === 0} />
                            {prev.waitCount > 0 && <div className="text-[9px] text-ive-text-dim mt-0.5">이전 {formatDuration(prev.waitAvg)}</div>}
                          </div>
                        </div>
                      )}
                      <div className="text-center">
                        <div className="text-[10px] text-ive-text-dim">처리시간</div>
                        <div className="text-sm font-extrabold text-ive-green">{formatDuration(data.lifecycle.procAvg)}</div>
                        <div className="text-[10px] text-ive-text-dim">최대 {formatDuration(data.lifecycle.procMax)}</div>
                        <div className="mt-0.5">
                          <DiffBadge diff={procDiff} isNew={procDiff == null && data.lifecycle.procCount > 0 && prev.procCount === 0} />
                          {prev.procCount > 0 && <div className="text-[9px] text-ive-text-dim mt-0.5">이전 {formatDuration(prev.procAvg)}</div>}
                        </div>
                      </div>
                      {hasTotal && (
                        <div className="text-center">
                          <div className="text-[10px] text-ive-text-dim">총 소요</div>
                          <div className="text-sm font-extrabold text-ive-text">{formatDuration(data.lifecycle.totalAvg)}</div>
                          <div className="text-[10px] text-ive-text-dim">최대 {formatDuration(data.lifecycle.totalMax)}</div>
                          <div className="mt-0.5">
                            <DiffBadge diff={totalDiff} isNew={totalDiff == null && data.lifecycle.totalCount > 0 && prev.totalCount === 0} />
                            {prev.totalCount > 0 && <div className="text-[9px] text-ive-text-dim mt-0.5">이전 {formatDuration(prev.totalAvg)}</div>}
                          </div>
                        </div>
                      )}
                    </div>
                  )
                })()}
                {/* 비율 바 */}
                {data.lifecycle.waitCount > 0 && data.lifecycle.totalAvg > 0 && (() => {
                  const waitPct = Math.round((data.lifecycle.waitAvg / data.lifecycle.totalAvg) * 100)
                  const procPct = Math.round((data.lifecycle.procAvg / data.lifecycle.totalAvg) * 100)
                  const otherPct = Math.max(0, 100 - waitPct - procPct)
                  return (
                    <div>
                      <div className="flex h-2.5 rounded-full overflow-hidden bg-ive-bg-deep">
                        <div className="bg-ive-cyan/60" style={{ width: `${waitPct}%` }} />
                        <div className="bg-ive-green/60" style={{ width: `${procPct}%` }} />
                        {otherPct > 0 && <div className="bg-ive-amber/40" style={{ width: `${otherPct}%` }} />}
                      </div>
                      <div className="flex justify-between mt-1 text-[9px] text-ive-text-dim">
                        <span>대기 {waitPct}%</span>
                        <span>처리 {procPct}%</span>
                        {otherPct > 0 && <span>기타 {otherPct}%</span>}
                      </div>
                    </div>
                  )
                })()}
                {/* 재시도 */}
                <div className="flex justify-center gap-4 text-[10px] text-ive-text-dim">
                  <span>이슈 {data.lifecycle.uniqueIssues.toLocaleString()}건</span>
                  <span>평균 {data.lifecycle.avgAttempts.toFixed(1)}회 시도</span>
                  <span>재시도율 {data.lifecycle.retryRate.toFixed(1)}%</span>
                </div>
              </div>
            </section>
          )}

          {/* 대기시간/수행시간 평균 트렌드 */}
          {data.dailyTrend.length >= 2 && (data.dailyTrend.some(d => d.waitAvg !== null) || data.dailyTrend.some(d => d.procAvg !== null)) && (
            <section>
              <div className="text-xs font-bold text-ive-text-dim mb-2 uppercase tracking-wider">
                대기/수행시간 평균 트렌드
              </div>
              <div className="bg-ive-bg-card border border-ive-border-subtle rounded-xl p-3 space-y-3">
                {data.dailyTrend.some(d => d.waitAvg !== null) && (() => {
                  const waitData = data.dailyTrend.map(d => d.tasks === null ? null : (d.waitAvg ?? 0))
                  const validWait = waitData.filter((v): v is number => v !== null)
                  const firstAvg = validWait.slice(0, Math.floor(validWait.length / 2))
                  const secondAvg = validWait.slice(Math.floor(validWait.length / 2))
                  const avg1 = firstAvg.length > 0 ? firstAvg.reduce((a, b) => a + b, 0) / firstAvg.length : 0
                  const avg2 = secondAvg.length > 0 ? secondAvg.reduce((a, b) => a + b, 0) / secondAvg.length : 0
                  const trendDir = avg2 > avg1 * 1.1 ? 'up' : avg2 < avg1 * 0.9 ? 'down' : 'flat'
                  const prevDiff = diffPct(data.lifecycle.waitAvg, data.prevLifecycle.waitAvg)
                  return (
                    <div className="flex items-center gap-3">
                      <div className="flex-1">
                        <div className="flex items-center gap-2 mb-1">
                          <span className="text-xs font-bold text-ive-cyan">대기시간</span>
                          <span className={`text-[10px] font-bold ${trendDir === 'up' ? 'text-ive-red' : trendDir === 'down' ? 'text-ive-green' : 'text-ive-text-dim'}`}>
                            {trendDir === 'up' ? '증가 ↑' : trendDir === 'down' ? '감소 ↓' : '안정 →'}
                          </span>
                          {prevDiff != null && (
                            <span className={`text-[10px] font-bold px-1.5 py-0.5 rounded ${prevDiff > 0 ? 'text-ive-red bg-ive-red/10' : prevDiff < 0 ? 'text-ive-green bg-ive-green/10' : 'text-ive-text-dim bg-white/5'}`}>
                              vs 이전 {prevDiff > 0 ? '+' : ''}{prevDiff.toLocaleString()}%
                            </span>
                          )}
                          {prevDiff == null && data.lifecycle.waitCount > 0 && data.prevLifecycle.waitCount === 0 && (
                            <span className="text-[10px] font-bold px-1.5 py-0.5 rounded text-ive-cyan bg-ive-cyan/10">NEW</span>
                          )}
                        </div>
                        <div className="flex items-center gap-2">
                          <div className="flex-1 min-w-0">
                            <Sparkline data={waitData} bgData={data.prevDailyTrend.map(d => d.waitAvg ?? null)} width="100%" height={24} color={trendDir === 'up' ? 'red' : trendDir === 'down' ? 'green' : 'cyan'} />
                          </div>
                          <div className="text-right shrink-0">
                            <div className="text-xs font-bold text-ive-text">{formatDuration(validWait[validWait.length - 1] ?? 0)}</div>
                            <div className="text-[10px] text-ive-text-dim">최근</div>
                          </div>
                          <div className="text-right shrink-0 ml-1">
                            <div className="text-xs font-bold text-ive-text-dim">{data.prevLifecycle.waitCount > 0 ? formatDuration(data.prevLifecycle.waitAvg) : '-'}</div>
                            <div className="text-[10px] text-ive-text-dim">이전 평균</div>
                          </div>
                        </div>
                      </div>
                    </div>
                  )
                })()}
                {data.dailyTrend.some(d => d.procAvg !== null) && (() => {
                  const procData = data.dailyTrend.map(d => d.tasks === null ? null : (d.procAvg ?? 0))
                  const validProc = procData.filter((v): v is number => v !== null)
                  const firstAvg = validProc.slice(0, Math.floor(validProc.length / 2))
                  const secondAvg = validProc.slice(Math.floor(validProc.length / 2))
                  const avg1 = firstAvg.length > 0 ? firstAvg.reduce((a, b) => a + b, 0) / firstAvg.length : 0
                  const avg2 = secondAvg.length > 0 ? secondAvg.reduce((a, b) => a + b, 0) / secondAvg.length : 0
                  const trendDir = avg2 > avg1 * 1.1 ? 'up' : avg2 < avg1 * 0.9 ? 'down' : 'flat'
                  const prevDiff = diffPct(data.lifecycle.procAvg, data.prevLifecycle.procAvg)
                  return (
                    <div className="flex items-center gap-3">
                      <div className="flex-1">
                        <div className="flex items-center gap-2 mb-1">
                          <span className="text-xs font-bold text-ive-green">수행시간</span>
                          <span className={`text-[10px] font-bold ${trendDir === 'up' ? 'text-ive-red' : trendDir === 'down' ? 'text-ive-green' : 'text-ive-text-dim'}`}>
                            {trendDir === 'up' ? '증가 ↑' : trendDir === 'down' ? '감소 ↓' : '안정 →'}
                          </span>
                          {prevDiff != null && (
                            <span className={`text-[10px] font-bold px-1.5 py-0.5 rounded ${prevDiff > 0 ? 'text-ive-red bg-ive-red/10' : prevDiff < 0 ? 'text-ive-green bg-ive-green/10' : 'text-ive-text-dim bg-white/5'}`}>
                              vs 이전 {prevDiff > 0 ? '+' : ''}{prevDiff.toLocaleString()}%
                            </span>
                          )}
                          {prevDiff == null && data.lifecycle.procCount > 0 && data.prevLifecycle.procCount === 0 && (
                            <span className="text-[10px] font-bold px-1.5 py-0.5 rounded text-ive-cyan bg-ive-cyan/10">NEW</span>
                          )}
                        </div>
                        <div className="flex items-center gap-2">
                          <div className="flex-1 min-w-0">
                            <Sparkline data={procData} bgData={data.prevDailyTrend.map(d => d.procAvg ?? null)} width="100%" height={24} color={trendDir === 'up' ? 'red' : trendDir === 'down' ? 'green' : 'green'} />
                          </div>
                          <div className="text-right shrink-0">
                            <div className="text-xs font-bold text-ive-text">{formatDuration(validProc[validProc.length - 1] ?? 0)}</div>
                            <div className="text-[10px] text-ive-text-dim">최근</div>
                          </div>
                          <div className="text-right shrink-0 ml-1">
                            <div className="text-xs font-bold text-ive-text-dim">{data.prevLifecycle.procCount > 0 ? formatDuration(data.prevLifecycle.procAvg) : '-'}</div>
                            <div className="text-[10px] text-ive-text-dim">이전 평균</div>
                          </div>
                        </div>
                      </div>
                    </div>
                  )
                })()}
              </div>
            </section>
          )}

          {/* 일별 종합 트렌드 (건수 바 + 비용 라인 + 이전 기간) */}
          {data.dailyTrend.length > 0 && (
            <section>
              <div className="text-xs font-bold text-ive-text-dim mb-2 uppercase tracking-wider">
                {type === 'yearly' ? '월별' : '일별'} 추이
              </div>
              <DailyTrendChart data={data.dailyTrend} prevData={data.prevDailyTrend} type={type} />
            </section>
          )}

          {/* 프로젝트별 비교 */}
          {data.byProject.length > 0 && (
            <section>
              <CompareTable
                title="프로젝트별"
                icon="fa-folder"
                data={data.byProject.map(p => {
                  const prev = data.prevByProject?.find(pp => pp.projectId === p.projectId)
                  return { name: p.projectName, color: p.projectColor, avatarUrl: p.projectAvatarUrl, provider: p.projectProvider, tasks: p.tasks, cost: p.cost, prevTasks: prev?.tasks ?? 0, prevCost: prev?.cost ?? 0 }
                })}
              />
            </section>
          )}

          {/* 작업자별 비교 */}
          {data.byAgent.length > 0 && (
            <section>
              <CompareTable
                title="작업자별"
                icon="fa-robot"
                data={data.byAgent.map(a => {
                  const prev = data.prevByAgent?.find(pa => pa.agentId === a.agentId)
                  return { name: a.agentName, color: '', avatar: a.agentAvatar, tasks: a.tasks, cost: a.cost, prevTasks: prev?.tasks ?? 0, prevCost: prev?.cost ?? 0 }
                })}
              />
            </section>
          )}

          {/* By Project */}
          {data.byProject.length > 0 && (
            <section>
              <div className="flex items-center justify-between mb-2">
                <div className="text-xs font-bold text-ive-text-dim uppercase tracking-wider">프로젝트별</div>
                <SortButtons sortKey={projectSortKey} sortDir={projectSortDir} onToggle={(k) => toggleSectionSort(projectSortKey, projectSortDir, setProjectSortKey, setProjectSortDir, k, PROJ_SORT_KEY, PROJ_SORT_DIR)} />
              </div>
              <div className="space-y-2">
                {sortedProjects().map(p => {
                  const pt = data.projectTrend?.find(t => t.projectId === p.projectId)
                  const prev = data.prevByProject?.find(pp => pp.projectId === p.projectId)
                  const taskDiff = diffPct(p.tasks, prev?.tasks ?? 0)
                  const costDiff = diffPct(p.cost, prev?.cost ?? 0)
                  return (
                  <div key={p.projectId} className="bg-ive-bg-card border border-ive-border-subtle rounded-xl overflow-hidden">
                    <button onClick={() => toggleProject(p.projectId)} className="w-full px-3 py-2.5 flex items-center gap-2 text-left">
                      {p.projectAvatarUrl ? (
                        <img src={p.projectAvatarUrl} alt="" className="w-6 h-6 rounded-md object-cover shrink-0" style={{ outline: `2px solid ${p.projectColor || '#4ade80'}50`, outlineOffset: '1px' }} />
                      ) : (
                        <span className="w-6 h-6 rounded-md flex items-center justify-center shrink-0 bg-ive-bg-deep" style={{ outline: `1.5px solid ${p.projectColor || '#4ade80'}40`, outlineOffset: '0.5px' }}>
                          <i className={`fa-brands ${p.projectProvider === 'github' ? 'fa-github' : 'fa-gitlab'} text-sm`} style={{ color: p.projectColor || '#4ade80' }} />
                        </span>
                      )}
                      <span className="text-sm font-bold text-ive-text flex-1 truncate">{p.projectName}</span>
                      <span className="text-xs text-ive-text-dim">{p.tasks.toLocaleString()}건</span>
                      {taskDiff != null && <span className={`text-[10px] font-bold ${taskDiff > 0 ? 'text-ive-green' : taskDiff < 0 ? 'text-ive-red' : 'text-ive-text-dim'}`}>{taskDiff > 0 ? '+' : ''}{taskDiff.toLocaleString()}%</span>}
                      <span className="text-xs text-ive-amber">${formatCost(p.cost)}</span>
                      {costDiff != null && <span className={`text-[10px] font-bold ${costDiff > 0 ? 'text-ive-red' : costDiff < 0 ? 'text-ive-green' : 'text-ive-text-dim'}`}>{costDiff > 0 ? '+' : ''}{costDiff.toLocaleString()}%</span>}
                      <i className={`fa-solid fa-chevron-${expandedProjects.has(p.projectId) ? 'up' : 'down'} text-xs text-ive-text-dim`} />
                    </button>
                    {expandedProjects.has(p.projectId) && (
                      <div className="px-3 pb-3 border-t border-ive-border-dark">
                        <div className="grid grid-cols-3 gap-1 mt-2 text-center">
                          <MiniStat label="성공" value={p.success.toLocaleString()} color="text-ive-green" />
                          <MiniStat label="실패" value={p.failed.toLocaleString()} color="text-ive-red" />
                          <MiniStat label="비용" value={`$${formatCost(p.cost)}`} color="text-ive-amber" />
                        </div>
                        <div className="grid grid-cols-2 gap-1 mt-1 text-center">
                          <MiniStat label="총시간" value={formatDuration(p.totalDurationMin)} color="text-ive-text-muted" />
                          <MiniStat label="평균" value={formatDuration(p.avgDurationMin)} color="text-ive-text-muted" />
                        </div>
                        <div className="text-xs text-ive-text-dim mt-1 text-center">
                          입력 {formatTokens(p.inputTokens)} / 출력 {formatTokens(p.outputTokens)} 토큰
                        </div>
                        {/* 프로젝트별 건수/비용 추이 */}
                        {pt && pt.daily.length >= 2 && (
                          <div className="mt-2 bg-ive-bg-deep rounded-lg p-2">
                            <div className="text-[10px] font-bold text-ive-text-dim mb-1.5">건수/비용 추이</div>
                            <div className="grid grid-cols-2 gap-2">
                              <div className="flex items-center gap-1.5">
                                <span className="text-[10px] text-ive-text-dim shrink-0">건수</span>
                                <Sparkline data={pt.daily.map(d => d.tasks)} width={100} height={20} color="auto" />
                              </div>
                              <div className="flex items-center gap-1.5">
                                <span className="text-[10px] text-ive-text-dim shrink-0">비용</span>
                                <Sparkline data={pt.daily.map(d => d.cost)} width={100} height={20} color="amber" />
                              </div>
                            </div>
                          </div>
                        )}
                        {p.byAgent.length > 0 && (
                          <div className="mt-2 space-y-1">
                            <div className="text-xs font-bold text-ive-text-dim">작업자</div>
                            {p.byAgent.map(a => (
                              <div key={a.agentId} className="flex items-center gap-2 bg-ive-bg-deep rounded-lg px-2 py-1.5">
                                <AgentAvatar avatar={a.agentAvatar} size="sm" className="!w-5 !h-5 !text-xs" />
                                <span className="text-xs font-bold text-ive-text flex-1 truncate">{a.agentName}</span>
                                <span className="text-xs text-ive-green">{a.success.toLocaleString()}<span className="text-ive-text-dim">/{a.tasks.toLocaleString()}</span></span>
                                <span className="text-xs text-ive-amber">${formatCost(a.cost)}</span>
                              </div>
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

          {/* By Agent */}
          {data.byAgent.length > 0 && (
            <section>
              <div className="flex items-center justify-between mb-2">
                <div className="text-xs font-bold text-ive-text-dim uppercase tracking-wider">작업자별</div>
                <SortButtons sortKey={agentSortKey} sortDir={agentSortDir} onToggle={(k) => toggleSectionSort(agentSortKey, agentSortDir, setAgentSortKey, setAgentSortDir, k, AGENT_SORT_KEY, AGENT_SORT_DIR)} />
              </div>
              <div className="space-y-2">
                {sortedAgents().map(a => {
                  const at = data.agentTrend?.find(t => t.agentId === a.agentId)
                  const prev = data.prevByAgent?.find(pa => pa.agentId === a.agentId)
                  const taskDiff = diffPct(a.tasks, prev?.tasks ?? 0)
                  const costDiff = diffPct(a.cost, prev?.cost ?? 0)
                  return (
                  <div key={a.agentId} className="bg-ive-bg-card border border-ive-border-subtle rounded-xl overflow-hidden">
                    <button onClick={() => toggleAgent(a.agentId)} className="w-full px-3 py-2.5 flex items-center gap-2 text-left">
                      <AgentAvatar avatar={a.agentAvatar} size="sm" className="!w-6 !h-6 !text-sm" />
                      <span className="text-sm font-bold text-ive-text flex-1 truncate">{a.agentName}</span>
                      <span className="text-xs text-ive-text-dim">{a.tasks.toLocaleString()}건</span>
                      {taskDiff != null && <span className={`text-[10px] font-bold ${taskDiff > 0 ? 'text-ive-green' : taskDiff < 0 ? 'text-ive-red' : 'text-ive-text-dim'}`}>{taskDiff > 0 ? '+' : ''}{taskDiff.toLocaleString()}%</span>}
                      <span className="text-xs text-ive-amber">${formatCost(a.cost)}</span>
                      {costDiff != null && <span className={`text-[10px] font-bold ${costDiff > 0 ? 'text-ive-red' : costDiff < 0 ? 'text-ive-green' : 'text-ive-text-dim'}`}>{costDiff > 0 ? '+' : ''}{costDiff.toLocaleString()}%</span>}
                      <i className={`fa-solid fa-chevron-${expandedAgents.has(a.agentId) ? 'up' : 'down'} text-xs text-ive-text-dim`} />
                    </button>
                    {expandedAgents.has(a.agentId) && (
                      <div className="px-3 pb-3 border-t border-ive-border-dark">
                        <div className="grid grid-cols-3 gap-1 mt-2 text-center">
                          <MiniStat label="성공" value={a.success.toLocaleString()} color="text-ive-green" />
                          <MiniStat label="실패" value={a.failed.toLocaleString()} color="text-ive-red" />
                          <MiniStat label="비용" value={`$${formatCost(a.cost)}`} color="text-ive-amber" />
                        </div>
                        <div className="grid grid-cols-3 gap-1 mt-1 text-center">
                          <MiniStat label="총시간" value={formatDuration(a.totalDurationMin)} color="text-ive-text-muted" />
                          <MiniStat label="평균" value={formatDuration(a.avgDurationMin)} color="text-ive-text-muted" />
                          <MiniStat label="평균턴" value={a.avgTurns.toFixed(1)} color="text-ive-text-muted" />
                        </div>
                        <div className="text-xs text-ive-text-dim mt-1 text-center">
                          입력 {formatTokens(a.inputTokens)} / 출력 {formatTokens(a.outputTokens)} 토큰
                        </div>
                        {/* 작업자별 건수/비용 추이 */}
                        {at && at.daily.length >= 2 && (
                          <div className="mt-2 bg-ive-bg-deep rounded-lg p-2">
                            <div className="text-[10px] font-bold text-ive-text-dim mb-1.5">건수/비용 추이</div>
                            <div className="grid grid-cols-2 gap-2">
                              <div className="flex items-center gap-1.5">
                                <span className="text-[10px] text-ive-text-dim shrink-0">건수</span>
                                <Sparkline data={at.daily.map(d => d.tasks)} width={100} height={20} color="auto" />
                              </div>
                              <div className="flex items-center gap-1.5">
                                <span className="text-[10px] text-ive-text-dim shrink-0">비용</span>
                                <Sparkline data={at.daily.map(d => d.cost)} width={100} height={20} color="amber" />
                              </div>
                            </div>
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

          {/* 추이 분석 */}
          {data.insights && data.insights.length > 0 && (
            <section>
              <button
                onClick={() => setShowInsights(v => !v)}
                className="w-full flex items-center justify-between bg-ive-bg-card border border-ive-border-subtle rounded-xl px-3 py-2.5 hover:border-ive-cyan/30 transition-all"
              >
                <div className="flex items-center gap-2">
                  <i className="fa-solid fa-lightbulb text-ive-amber text-sm" />
                  <span className="text-xs font-bold text-ive-text">추이 분석</span>
                  <span className="text-[10px] text-ive-text-dim">{data.insights.length}건</span>
                </div>
                <i className={`fa-solid fa-chevron-${showInsights ? 'up' : 'down'} text-xs text-ive-text-dim`} />
              </button>
              {showInsights && (
                <div className="mt-2 bg-ive-bg-card border border-ive-border-subtle rounded-xl p-3 space-y-2">
                  {data.insights.map((insight, i) => (
                    <div key={i} className="flex items-start gap-2">
                      <i className={`fa-solid ${
                        insight.includes('증가') || insight.includes('늘어나') || insight.includes('급증') ? 'fa-arrow-trend-up text-ive-red'
                        : insight.includes('감소') || insight.includes('줄어들') || insight.includes('급감') ? 'fa-arrow-trend-down text-ive-green'
                        : insight.includes('개선') ? 'fa-arrow-trend-up text-ive-green'
                        : insight.includes('하락') ? 'fa-arrow-trend-down text-ive-red'
                        : 'fa-minus text-ive-text-dim'
                      } text-xs mt-0.5`} />
                      <span className="text-xs text-ive-text">{insight}</span>
                    </div>
                  ))}
                </div>
              )}
            </section>
          )}

          {/* Resolved Issues */}
          {data.resolvedIssues && data.resolvedIssues.length > 0 && (
            <section>
              <div className="text-xs font-bold text-ive-text-dim mb-2 uppercase tracking-wider">
                처리된 이슈 ({data.resolvedIssues.length.toLocaleString()}건)
              </div>

              {/* 필터 바 */}
              <div className="space-y-2 mb-2">
                <div className="flex gap-2">
                  {/* 상태 필터 */}
                  <div className="flex gap-1">
                    {([['all', '전체'], ['success', '성공'], ['failed', '실패']] as [IssueFilter, string][]).map(([val, label]) => (
                      <button
                        key={val}
                        onClick={() => setIssueFilter(val)}
                        className={`px-2 py-1 text-xs font-bold rounded-lg transition-all ${
                          issueFilter === val
                            ? val === 'success' ? 'bg-ive-green/20 text-ive-green' : val === 'failed' ? 'bg-ive-red/20 text-ive-red' : 'bg-ive-cyan/20 text-ive-cyan'
                            : 'text-ive-text-dim hover:bg-ive-bg-card'
                        }`}
                      >
                        {label}
                      </button>
                    ))}
                  </div>

                  {/* 프로젝트 필터 */}
                  {uniqueProjects.length > 1 && (
                    <CustomSelect
                      value={issueProjectFilter}
                      onChange={setIssueProjectFilter}
                      options={[
                        { value: 'all', label: '전체 프로젝트' },
                        ...uniqueProjects.map(p => ({ value: p.id, label: p.name, color: p.color })),
                      ]}
                    />
                  )}
                </div>

                {/* 키워드 검색 */}
                <div className="relative">
                  <i className="fa-solid fa-search absolute left-2.5 top-1/2 -translate-y-1/2 text-xs text-ive-text-dim" />
                  <input
                    type="text"
                    value={issueKeyword}
                    onChange={e => setIssueKeyword(e.target.value)}
                    placeholder="이슈 검색 (번호, 제목, 작업자...)"
                    className="w-full text-xs bg-ive-bg-card border border-ive-border-subtle rounded-lg pl-7 pr-7 py-1.5 text-ive-text placeholder-ive-text-dim focus:outline-none focus:border-ive-green/50"
                  />
                  {issueKeyword && (
                    <button
                      onClick={() => setIssueKeyword('')}
                      className="absolute right-2 top-1/2 -translate-y-1/2 text-xs text-ive-text-dim hover:text-ive-text"
                    >
                      <i className="fa-solid fa-xmark" />
                    </button>
                  )}
                </div>

                {/* 정렬 */}
                <div className="flex items-center gap-1">
                  <span className="text-[10px] text-ive-text-dim mr-0.5">정렬</span>
                  {([['date', '일자'], ['iid', '번호'], ['wait', '대기'], ['duration', '시간'], ['cost', '비용']] as [IssueSortKey, string][]).map(([key, label]) => (
                    <button
                      key={key}
                      onClick={() => changeSort(key)}
                      className={`px-1.5 py-0.5 text-[10px] font-bold rounded transition-all flex items-center gap-0.5 ${
                        issueSort === key ? 'bg-ive-green/20 text-ive-green' : 'text-ive-text-dim hover:bg-ive-bg-card'
                      }`}
                    >
                      {label}
                      {issueSort === key && (
                        <i className={`fa-solid fa-sort-${issueSortDir === 'desc' ? 'down' : 'up'} text-[8px]`} />
                      )}
                    </button>
                  ))}
                </div>
              </div>

              <div className="space-y-1.5">
                {filteredIssues.slice(0, visibleCount).map((issue, i) => (
                  <div
                    key={i}
                    onClick={() => {
                      sessionStorage.setItem('report-issues-scroll', String(window.scrollY))
                      router.push(`/issues/${issue.projectId}/${issue.issueIid}`)
                    }}
                    className="bg-ive-bg-card border border-ive-border-subtle rounded-xl px-3 py-2 cursor-pointer hover:border-ive-green/30 active:scale-[0.99] transition-all"
                  >
                    <div className="flex items-start gap-2">
                      <i className={`fa-solid ${issue.status === 'success' ? 'fa-check-circle text-ive-green' : 'fa-times-circle text-ive-red'} text-sm mt-0.5`} />
                      <div className="flex-1 min-w-0">
                        <div className="text-sm font-bold text-ive-text truncate">
                          #{issue.issueIid} {issue.issueTitle}
                        </div>
                        <div className="flex items-center gap-2 mt-0.5 text-xs text-ive-text-dim">
                          <span className="flex items-center gap-1">
                            <span className="w-1.5 h-1.5 rounded-full inline-block" style={{ backgroundColor: issue.projectColor }} />
                            {issue.projectName}
                          </span>
                          <span className="flex items-center gap-1">
                            <AgentAvatar avatar={issue.agentAvatar} size="sm" className="!w-3.5 !h-3.5 !text-[8px]" />
                            {issue.agentName}
                          </span>
                          {issue.waitMin != null && (
                            <span className="text-ive-cyan">대기 {formatDuration(issue.waitMin)}</span>
                          )}
                          <span>{formatDuration(issue.durationMin)}</span>
                          <span className="text-ive-amber">${formatCost(issue.cost)}</span>
                          {issue.turns > 0 && (
                            <span className="text-ive-text-dim">{issue.turns.toLocaleString()}턴</span>
                          )}
                          {issue.attempts > 1 && (
                            <span className="text-ive-red">{issue.attemptNo}/{issue.attempts}회</span>
                          )}
                        </div>
                      </div>
                      <i className="fa-solid fa-chevron-right text-xs text-ive-text-dim mt-1 shrink-0" />
                    </div>
                  </div>
                ))}
                {filteredIssues.length === 0 && (
                  <div className="text-center text-xs text-ive-text-dim py-4">
                    필터 조건에 맞는 이슈가 없습니다.
                  </div>
                )}
                {visibleCount < filteredIssues.length && (
                  <div className="text-center text-xs text-ive-text-dim py-3">
                    <i className="fa-solid fa-circle-notch fa-spin mr-1" />
                    {(filteredIssues.length - visibleCount).toLocaleString()}건 더 있음
                  </div>
                )}
              </div>
            </section>
          )}

          {/* Empty state */}
          {data.summary.totalTasks === 0 && (
            <div className="text-center py-16 text-ive-text-dim">
              <i className="fa-solid fa-chart-bar text-3xl mb-3 block opacity-30" />
              <p className="text-sm">해당 기간에 실행된 작업이 없습니다.</p>
            </div>
          )}
        </main>
      )}
    </PullToRefresh>
  )
}

function SummaryCard({ label, value, sub, color, diff, invertColor }: {
  label: string; value: string; sub: string; color: string
  diff?: number | null; invertColor?: boolean
}) {
  const diffColor = diff == null ? '' : invertColor
    ? (diff > 0 ? 'text-ive-red' : diff < 0 ? 'text-ive-green' : 'text-ive-text-dim')
    : (diff > 0 ? 'text-ive-green' : diff < 0 ? 'text-ive-red' : 'text-ive-text-dim')
  const subColor = !sub || sub === '신규' ? 'text-ive-cyan' : !invertColor ? 'text-ive-text-dim'
    : sub.startsWith('+') ? 'text-ive-red' : sub.startsWith('-') ? 'text-ive-green' : 'text-ive-text-dim'
  return (
    <div className="bg-ive-bg-card border border-ive-border-subtle rounded-xl px-3 py-2 text-center">
      <div className="text-xs text-ive-text-dim">{label}</div>
      <div className={`text-lg font-extrabold ${color}`}>{value}</div>
      <div className="flex items-center justify-center gap-1">
        {sub && <span className={`text-[10px] font-bold ${subColor}`}>{sub}</span>}
        {diff != null && (
          <span className={`text-[10px] font-bold ${diffColor}`}>
            {diff > 0 ? '+' : ''}{diff.toLocaleString()}%
          </span>
        )}
      </div>
    </div>
  )
}

function MiniStat({ label, value, color }: { label: string; value: string | number; color: string }) {
  return (
    <div>
      <div className="text-[10px] text-ive-text-dim">{label}</div>
      <div className={`text-xs font-bold ${color}`}>{value}</div>
    </div>
  )
}

function CustomSelect({ value, onChange, options }: {
  value: string
  onChange: (v: string) => void
  options: { value: string; label: string; color?: string }[]
}) {
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!open) return
    function handleClick(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener('mousedown', handleClick)
    return () => document.removeEventListener('mousedown', handleClick)
  }, [open])

  const selected = options.find(o => o.value === value)

  return (
    <div ref={ref} className="relative flex-1 min-w-0">
      <button
        type="button"
        onClick={() => setOpen(!open)}
        className="w-full text-xs bg-ive-bg-card border border-ive-border-subtle rounded-lg px-2 py-1 text-left text-ive-text flex items-center gap-1.5 focus:outline-none focus:border-ive-green"
      >
        {selected?.color && (
          <span className="w-1.5 h-1.5 rounded-full shrink-0" style={{ backgroundColor: selected.color }} />
        )}
        <span className="flex-1 truncate">{selected?.label ?? ''}</span>
        <i className={`fa-solid fa-chevron-down text-[8px] text-ive-text-dim transition-transform ${open ? 'rotate-180' : ''}`} />
      </button>
      {open && (
        <div className="absolute top-full left-0 right-0 mt-1 bg-ive-bg-card border border-ive-border-subtle rounded-lg shadow-xl z-50 max-h-48 overflow-y-auto">
          {options.map(o => (
            <button
              key={o.value}
              onClick={() => { onChange(o.value); setOpen(false) }}
              className={`w-full text-left px-2 py-1.5 text-xs flex items-center gap-1.5 transition-colors ${
                value === o.value ? 'bg-ive-green/15 text-ive-green' : 'text-ive-text hover:bg-ive-bg-deep'
              }`}
            >
              {o.color && (
                <span className="w-1.5 h-1.5 rounded-full shrink-0" style={{ backgroundColor: o.color }} />
              )}
              <span className="truncate">{o.label}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  )
}

function SortButtons({ sortKey, sortDir, onToggle }: {
  sortKey: SectionSortKey; sortDir: SectionSortDir
  onToggle: (key: SectionSortKey) => void
}) {
  return (
    <div className="flex items-center gap-1">
      {([['tasks', '건수'], ['cost', '비용']] as [SectionSortKey, string][]).map(([key, label]) => (
        <button
          key={key}
          onClick={() => onToggle(key)}
          className={`px-1.5 py-0.5 text-[10px] font-bold rounded transition-all flex items-center gap-0.5 ${
            sortKey === key ? 'bg-ive-green/20 text-ive-green' : 'text-ive-text-dim hover:bg-ive-bg-card'
          }`}
        >
          {label}
          {sortKey === key && (
            <i className={`fa-solid fa-sort-${sortDir === 'desc' ? 'down' : 'up'} text-[8px]`} />
          )}
        </button>
      ))}
    </div>
  )
}
