'use client'

import { useEffect, useState, useCallback, useRef } from 'react'
import { useRouter } from 'next/navigation'
import { DEFAULT_AVATARS } from '@/types'
import PullToRefresh from '@/components/ui/PullToRefresh'
import AgentAvatar from '@/components/agent/AgentAvatar'
import Sparkline from '@/components/ui/Sparkline'

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
  projectId: string; projectName: string; projectColor: string; projectAvatarUrl: string
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
  waitMin: number | null
}

interface Lifecycle {
  waitAvg: number; waitMax: number; waitCount: number
  procAvg: number; procMax: number; procCount: number
  totalAvg: number; totalMax: number; totalCount: number
  avgAttempts: number; retryRate: number; uniqueIssues: number
}

interface ReportData {
  period: { start: string; end: string; type: string }
  summary: Summary
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

export default function ReportsTab() {
  const router = useRouter()

  // sessionStorage에서 이전 상태 복원
  const saved = typeof window !== 'undefined' ? loadReportState() : null

  const [type, setType] = useState<ReportType>(() => (saved?.type as ReportType) || 'weekly')
  const [date, setDate] = useState(() => (saved?.date as string) || new Date().toISOString().slice(0, 10))
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
            <span className="text-sm font-bold text-ive-text">
              {data ? formatPeriodLabel(type, data.period.start, data.period.end) : '...'}
            </span>
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
          {/* Summary Cards */}
          <section>
            <div className="text-xs font-bold text-ive-text-dim mb-2 uppercase tracking-wider">전체 요약</div>
            <div className="grid grid-cols-3 gap-2">
              <SummaryCard label="작업" value={`${data.summary.totalTasks}건`} sub={`성공 ${data.summary.successCount}`} color="text-ive-green" />
              <SummaryCard label="성공률" value={`${data.summary.successRate}%`} sub={`실패 ${data.summary.failedCount}`} color="text-ive-cyan" />
              <SummaryCard label="비용" value={`$${data.summary.totalCost.toFixed(2)}`} sub={`${formatTokens(data.summary.totalInputTokens + data.summary.totalOutputTokens)} tok`} color="text-ive-amber" />
            </div>
            <div className="mt-2 grid grid-cols-2 gap-2">
              <SummaryCard label="총 소요시간" value={formatDuration(data.summary.totalDurationMin)} sub="" color="text-ive-text" />
              <SummaryCard label="평균 소요시간" value={formatDuration(data.summary.avgDurationMin)} sub="" color="text-ive-text" />
            </div>
          </section>

          {/* Lifecycle */}
          {data.lifecycle.procCount > 0 && (
            <section>
              <div className="text-xs font-bold text-ive-text-dim mb-2 uppercase tracking-wider">이슈 생애주기</div>
              <div className="bg-ive-bg-card border border-ive-border-subtle rounded-xl p-3 space-y-3">
                {/* 단계별 평균/최대 */}
                {(() => {
                  const hasWait = data.lifecycle.waitCount > 0
                  const hasTotal = data.lifecycle.totalCount > 0
                  const cols = 1 + (hasWait ? 1 : 0) + (hasTotal ? 1 : 0)
                  return (
                    <div className={`grid gap-2 ${cols === 3 ? 'grid-cols-3' : cols === 2 ? 'grid-cols-2' : 'grid-cols-1'}`}>
                      {hasWait && (
                        <div className="text-center">
                          <div className="text-[10px] text-ive-text-dim">생성→배정</div>
                          <div className="text-sm font-extrabold text-ive-cyan">{formatDuration(data.lifecycle.waitAvg)}</div>
                          <div className="text-[10px] text-ive-text-dim">최대 {formatDuration(data.lifecycle.waitMax)}</div>
                        </div>
                      )}
                      <div className="text-center">
                        <div className="text-[10px] text-ive-text-dim">처리시간</div>
                        <div className="text-sm font-extrabold text-ive-green">{formatDuration(data.lifecycle.procAvg)}</div>
                        <div className="text-[10px] text-ive-text-dim">최대 {formatDuration(data.lifecycle.procMax)}</div>
                      </div>
                      {hasTotal && (
                        <div className="text-center">
                          <div className="text-[10px] text-ive-text-dim">총 소요</div>
                          <div className="text-sm font-extrabold text-ive-text">{formatDuration(data.lifecycle.totalAvg)}</div>
                          <div className="text-[10px] text-ive-text-dim">최대 {formatDuration(data.lifecycle.totalMax)}</div>
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
                  <span>이슈 {data.lifecycle.uniqueIssues}건</span>
                  <span>평균 {data.lifecycle.avgAttempts}회 시도</span>
                  <span>재시도율 {data.lifecycle.retryRate}%</span>
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
                  const waitData = data.dailyTrend.map(d => d.waitAvg ?? 0)
                  const firstAvg = waitData.slice(0, Math.floor(waitData.length / 2))
                  const secondAvg = waitData.slice(Math.floor(waitData.length / 2))
                  const avg1 = firstAvg.reduce((a, b) => a + b, 0) / firstAvg.length
                  const avg2 = secondAvg.reduce((a, b) => a + b, 0) / secondAvg.length
                  const trendDir = avg2 > avg1 * 1.1 ? 'up' : avg2 < avg1 * 0.9 ? 'down' : 'flat'
                  return (
                    <div className="flex items-center gap-3">
                      <div className="flex-1">
                        <div className="flex items-center gap-2 mb-1">
                          <span className="text-xs font-bold text-ive-cyan">대기시간</span>
                          <span className={`text-[10px] font-bold ${trendDir === 'up' ? 'text-ive-red' : trendDir === 'down' ? 'text-ive-green' : 'text-ive-text-dim'}`}>
                            {trendDir === 'up' ? '증가 ↑' : trendDir === 'down' ? '감소 ↓' : '안정 →'}
                          </span>
                        </div>
                        <div className="flex items-center gap-2">
                          <Sparkline data={waitData} width={120} height={24} color={trendDir === 'up' ? 'red' : trendDir === 'down' ? 'green' : 'cyan'} />
                          <div className="text-right">
                            <div className="text-xs font-bold text-ive-text">{formatDuration(waitData[waitData.length - 1])}</div>
                            <div className="text-[10px] text-ive-text-dim">최근</div>
                          </div>
                        </div>
                      </div>
                    </div>
                  )
                })()}
                {data.dailyTrend.some(d => d.procAvg !== null) && (() => {
                  const procData = data.dailyTrend.map(d => d.procAvg ?? 0)
                  const firstAvg = procData.slice(0, Math.floor(procData.length / 2))
                  const secondAvg = procData.slice(Math.floor(procData.length / 2))
                  const avg1 = firstAvg.reduce((a, b) => a + b, 0) / firstAvg.length
                  const avg2 = secondAvg.reduce((a, b) => a + b, 0) / secondAvg.length
                  const trendDir = avg2 > avg1 * 1.1 ? 'up' : avg2 < avg1 * 0.9 ? 'down' : 'flat'
                  return (
                    <div className="flex items-center gap-3">
                      <div className="flex-1">
                        <div className="flex items-center gap-2 mb-1">
                          <span className="text-xs font-bold text-ive-green">수행시간</span>
                          <span className={`text-[10px] font-bold ${trendDir === 'up' ? 'text-ive-red' : trendDir === 'down' ? 'text-ive-green' : 'text-ive-text-dim'}`}>
                            {trendDir === 'up' ? '증가 ↑' : trendDir === 'down' ? '감소 ↓' : '안정 →'}
                          </span>
                        </div>
                        <div className="flex items-center gap-2">
                          <Sparkline data={procData} width={120} height={24} color={trendDir === 'up' ? 'red' : trendDir === 'down' ? 'green' : 'green'} />
                          <div className="text-right">
                            <div className="text-xs font-bold text-ive-text">{formatDuration(procData[procData.length - 1])}</div>
                            <div className="text-[10px] text-ive-text-dim">최근</div>
                          </div>
                        </div>
                      </div>
                    </div>
                  )
                })()}
              </div>
            </section>
          )}

          {/* Daily Trend */}
          {data.dailyTrend.length > 0 && (
            <section>
              <div className="text-xs font-bold text-ive-text-dim mb-2 uppercase tracking-wider">
                {type === 'yearly' ? '월별' : '일별'} 추이
              </div>
              <div className="bg-ive-bg-card border border-ive-border-subtle rounded-xl p-3">
                {data.dailyTrend.map(d => {
                  const maxTasks = Math.max(...data.dailyTrend.map(x => x.tasks), 1)
                  const dt = new Date(d.date)
                  const label = type === 'yearly'
                    ? `${dt.getMonth() + 1}월`
                    : type === 'weekly'
                      ? DAY_LABELS[dt.getDay()]
                      : `${dt.getDate()}`
                  return (
                    <div key={d.date} className="flex items-center gap-2 py-0.5">
                      <span className="text-xs text-ive-text-dim w-6 text-right shrink-0">{label}</span>
                      <div className="flex-1 h-4 bg-ive-bg-deep rounded overflow-hidden relative">
                        {d.success > 0 && (
                          <div className="absolute left-0 top-0 h-full bg-ive-green/60 rounded-l" style={{ width: `${(d.success / maxTasks) * 100}%` }} />
                        )}
                        {d.failed > 0 && (
                          <div className="absolute top-0 h-full bg-ive-red/60" style={{ left: `${(d.success / maxTasks) * 100}%`, width: `${(d.failed / maxTasks) * 100}%` }} />
                        )}
                      </div>
                      <span className="text-xs font-bold text-ive-text w-6 text-right shrink-0">{d.tasks}</span>
                    </div>
                  )
                })}
              </div>
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
                  return (
                  <div key={p.projectId} className="bg-ive-bg-card border border-ive-border-subtle rounded-xl overflow-hidden">
                    <button onClick={() => toggleProject(p.projectId)} className="w-full px-3 py-2.5 flex items-center gap-2 text-left">
                      {p.projectAvatarUrl ? (
                        <img src={p.projectAvatarUrl} alt="" className="w-6 h-6 rounded object-cover shrink-0" />
                      ) : (
                        <div className="w-2.5 h-2.5 rounded-full shrink-0" style={{ backgroundColor: p.projectColor }} />
                      )}
                      <span className="text-sm font-bold text-ive-text flex-1 truncate">{p.projectName}</span>
                      <span className="text-xs text-ive-text-dim">{p.tasks}건</span>
                      <span className="text-xs text-ive-amber">${p.cost.toFixed(2)}</span>
                      <i className={`fa-solid fa-chevron-${expandedProjects.has(p.projectId) ? 'up' : 'down'} text-xs text-ive-text-dim`} />
                    </button>
                    {expandedProjects.has(p.projectId) && (
                      <div className="px-3 pb-3 border-t border-ive-border-dark">
                        <div className="grid grid-cols-3 gap-1 mt-2 text-center">
                          <MiniStat label="성공" value={p.success} color="text-ive-green" />
                          <MiniStat label="실패" value={p.failed} color="text-ive-red" />
                          <MiniStat label="비용" value={`$${p.cost.toFixed(2)}`} color="text-ive-amber" />
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
                            <div className="flex items-center gap-4">
                              <div className="flex items-center gap-1.5">
                                <span className="text-[10px] text-ive-text-dim">건수</span>
                                <Sparkline data={pt.daily.map(d => d.tasks)} width={60} height={18} color="auto" />
                              </div>
                              <div className="flex items-center gap-1.5">
                                <span className="text-[10px] text-ive-text-dim">비용</span>
                                <Sparkline data={pt.daily.map(d => d.cost)} width={60} height={18} color="amber" />
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
                                <span className="text-xs text-ive-green">{a.success}<span className="text-ive-text-dim">/{a.tasks}</span></span>
                                <span className="text-xs text-ive-amber">${a.cost.toFixed(2)}</span>
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
                  return (
                  <div key={a.agentId} className="bg-ive-bg-card border border-ive-border-subtle rounded-xl overflow-hidden">
                    <button onClick={() => toggleAgent(a.agentId)} className="w-full px-3 py-2.5 flex items-center gap-2 text-left">
                      <AgentAvatar avatar={a.agentAvatar} size="sm" className="!w-6 !h-6 !text-sm" />
                      <span className="text-sm font-bold text-ive-text flex-1 truncate">{a.agentName}</span>
                      <span className="text-xs text-ive-text-dim">{a.tasks}건</span>
                      <span className="text-xs text-ive-amber">${a.cost.toFixed(2)}</span>
                      <i className={`fa-solid fa-chevron-${expandedAgents.has(a.agentId) ? 'up' : 'down'} text-xs text-ive-text-dim`} />
                    </button>
                    {expandedAgents.has(a.agentId) && (
                      <div className="px-3 pb-3 border-t border-ive-border-dark">
                        <div className="grid grid-cols-3 gap-1 mt-2 text-center">
                          <MiniStat label="성공" value={a.success} color="text-ive-green" />
                          <MiniStat label="실패" value={a.failed} color="text-ive-red" />
                          <MiniStat label="비용" value={`$${a.cost.toFixed(2)}`} color="text-ive-amber" />
                        </div>
                        <div className="grid grid-cols-3 gap-1 mt-1 text-center">
                          <MiniStat label="총시간" value={formatDuration(a.totalDurationMin)} color="text-ive-text-muted" />
                          <MiniStat label="평균" value={formatDuration(a.avgDurationMin)} color="text-ive-text-muted" />
                          <MiniStat label="평균턴" value={a.avgTurns} color="text-ive-text-muted" />
                        </div>
                        <div className="text-xs text-ive-text-dim mt-1 text-center">
                          입력 {formatTokens(a.inputTokens)} / 출력 {formatTokens(a.outputTokens)} 토큰
                        </div>
                        {/* 작업자별 건수/비용 추이 */}
                        {at && at.daily.length >= 2 && (
                          <div className="mt-2 bg-ive-bg-deep rounded-lg p-2">
                            <div className="text-[10px] font-bold text-ive-text-dim mb-1.5">건수/비용 추이</div>
                            <div className="flex items-center gap-4">
                              <div className="flex items-center gap-1.5">
                                <span className="text-[10px] text-ive-text-dim">건수</span>
                                <Sparkline data={at.daily.map(d => d.tasks)} width={60} height={18} color="auto" />
                              </div>
                              <div className="flex items-center gap-1.5">
                                <span className="text-[10px] text-ive-text-dim">비용</span>
                                <Sparkline data={at.daily.map(d => d.cost)} width={60} height={18} color="amber" />
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
                처리된 이슈 ({data.resolvedIssues.length}건)
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
                          <span className="text-ive-amber">${issue.cost.toFixed(2)}</span>
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
                    {filteredIssues.length - visibleCount}건 더 있음
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

function SummaryCard({ label, value, sub, color }: { label: string; value: string; sub: string; color: string }) {
  return (
    <div className="bg-ive-bg-card border border-ive-border-subtle rounded-xl px-3 py-2 text-center">
      <div className="text-xs text-ive-text-dim">{label}</div>
      <div className={`text-lg font-extrabold ${color}`}>{value}</div>
      {sub && <div className="text-xs text-ive-text-dim">{sub}</div>}
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
