'use client'

import { useEffect, useState, useCallback, useRef } from 'react'
import { useRouter } from 'next/navigation'
import { DEFAULT_AVATARS } from '@/types'
import AgentAvatar from '@/components/agent/AgentAvatar'

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

interface DailyTrend { date: string; tasks: number; success: number; failed: number; cost: number }

interface ResolvedIssue {
  issueIid: number; issueTitle: string; projectId: string; projectName: string; projectColor: string
  agentName: string; agentAvatar: string; status: 'success' | 'failed'; durationMin: number; cost: number
}

interface ReportData {
  period: { start: string; end: string; type: string }
  summary: Summary
  byProject: ProjectStat[]
  byAgent: AgentGlobal[]
  dailyTrend: DailyTrend[]
  resolvedIssues?: ResolvedIssue[]
}

type IssueFilter = 'all' | 'success' | 'failed'

function formatDuration(min: number): string {
  if (min < 60) return `${min.toFixed(1)}분`
  const h = Math.floor(min / 60)
  const m = Math.round(min % 60)
  return `${h}h ${m}m`
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
  const issueListRef = useRef<HTMLDivElement | null>(null)

  // sessionStorage에서 이전 상태 복원
  const saved = typeof window !== 'undefined' ? loadReportState() : null

  const [type, setType] = useState<ReportType>(() => (saved?.type as ReportType) || 'weekly')
  const [date, setDate] = useState(() => (saved?.date as string) || new Date().toISOString().slice(0, 10))
  const [data, setData] = useState<ReportData | null>(null)
  const [loading, setLoading] = useState(false)
  const [expandedProjects, setExpandedProjects] = useState<Set<string>>(() => new Set((saved?.expandedProjects as string[]) || []))
  const [expandedAgents, setExpandedAgents] = useState<Set<string>>(() => new Set((saved?.expandedAgents as string[]) || []))
  const [issueFilter, setIssueFilter] = useState<IssueFilter>(() => (saved?.issueFilter as IssueFilter) || 'all')
  const [issueProjectFilter, setIssueProjectFilter] = useState<string>(() => (saved?.issueProjectFilter as string) || 'all')
  const [issueKeyword, setIssueKeyword] = useState(() => (saved?.issueKeyword as string) || '')

  // 상태가 변경될 때마다 sessionStorage에 저장
  useEffect(() => {
    saveReportState({
      type, date,
      expandedProjects: [...expandedProjects],
      expandedAgents: [...expandedAgents],
      issueFilter, issueProjectFilter, issueKeyword,
    })
  }, [type, date, expandedProjects, expandedAgents, issueFilter, issueProjectFilter, issueKeyword])

  // 이슈 목록 스크롤 위치 복원
  useEffect(() => {
    if (!data || loading) return
    const savedScroll = sessionStorage.getItem('report-issues-scroll')
    if (savedScroll && issueListRef.current) {
      requestAnimationFrame(() => {
        if (issueListRef.current) issueListRef.current.scrollTop = Number(savedScroll)
      })
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

  useEffect(() => { fetchReport() }, [fetchReport])

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
  }) ?? []

  // 고유 프로젝트 목록 (필터용)
  const uniqueProjects = data?.resolvedIssues
    ? [...new Map(data.resolvedIssues.map(i => [i.projectId, { id: i.projectId, name: i.projectName, color: i.projectColor }])).values()]
    : []

  return (
    <div className="min-h-screen pb-20">
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
              <div className="text-xs font-bold text-ive-text-dim mb-2 uppercase tracking-wider">프로젝트별</div>
              <div className="space-y-2">
                {data.byProject.map(p => (
                  <div key={p.projectId} className="bg-ive-bg-card border border-ive-border-subtle rounded-xl overflow-hidden">
                    <button onClick={() => toggleProject(p.projectId)} className="w-full px-3 py-2.5 flex items-center gap-2 text-left">
                      {p.projectAvatarUrl ? (
                        <img src={p.projectAvatarUrl} alt="" className="w-6 h-6 rounded object-cover shrink-0" />
                      ) : (
                        <div className="w-2.5 h-2.5 rounded-full shrink-0" style={{ backgroundColor: p.projectColor }} />
                      )}
                      <span className="text-sm font-bold text-ive-text flex-1 truncate">{p.projectName}</span>
                      <span className="text-xs text-ive-text-dim">{p.tasks}건</span>
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
                ))}
              </div>
            </section>
          )}

          {/* By Agent */}
          {data.byAgent.length > 0 && (
            <section>
              <div className="text-xs font-bold text-ive-text-dim mb-2 uppercase tracking-wider">작업자별</div>
              <div className="space-y-2">
                {data.byAgent.map(a => (
                  <div key={a.agentId} className="bg-ive-bg-card border border-ive-border-subtle rounded-xl overflow-hidden">
                    <button onClick={() => toggleAgent(a.agentId)} className="w-full px-3 py-2.5 flex items-center gap-2 text-left">
                      <AgentAvatar avatar={a.agentAvatar} size="sm" className="!w-6 !h-6 !text-sm" />
                      <span className="text-sm font-bold text-ive-text flex-1 truncate">{a.agentName}</span>
                      <span className="text-xs text-ive-text-dim">{a.tasks}건</span>
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
                      </div>
                    )}
                  </div>
                ))}
              </div>
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
                    <select
                      value={issueProjectFilter}
                      onChange={e => setIssueProjectFilter(e.target.value)}
                      className="text-xs bg-ive-bg-card border border-ive-border-subtle rounded-lg px-2 py-1 text-ive-text focus:outline-none focus:border-ive-green flex-1 min-w-0"
                    >
                      <option value="all">전체 프로젝트</option>
                      {uniqueProjects.map(p => (
                        <option key={p.id} value={p.id}>{p.name}</option>
                      ))}
                    </select>
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
              </div>

              <div
                ref={issueListRef}
                className="space-y-1.5 max-h-[60vh] overflow-y-auto overscroll-contain pr-0.5"
                style={{ scrollbarWidth: 'thin', scrollbarColor: 'rgba(255,255,255,0.15) transparent' }}
              >
                {filteredIssues.map((issue, i) => (
                  <div
                    key={i}
                    onClick={() => {
                      // 스크롤 위치 저장
                      if (issueListRef.current) {
                        sessionStorage.setItem('report-issues-scroll', String(issueListRef.current.scrollTop))
                      }
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
                          <span>{issue.durationMin}분</span>
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
    </div>
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
