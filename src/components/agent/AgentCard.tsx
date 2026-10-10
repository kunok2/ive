'use client'

import { STAGE_TONE } from '@/lib/active-work'
import { useState, useEffect, useCallback, useRef } from 'react'
import { Agent, CliName, TaskExecution, StatSnapshot, isAgentAvailableNow } from '@/types'
import { useStore } from '@/lib/store'
import { getKSTTodayStartISO } from '@/lib/date-utils'
import Sparkline from '@/components/ui/Sparkline'
import ExecutionList from '@/components/execution/ExecutionList'
import ExecutionStats from '@/components/execution/ExecutionStats'
import AgentAvatar, { AvatarSelector } from '@/components/agent/AgentAvatar'
import type { ToolCategory } from '@/lib/tool-activity'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import { useTranslations } from 'next-intl'
import { useKillExecution } from '@/lib/use-kill-execution'

interface AssignedProject {
  id: string
  name: string
  color: string
  provider: string
}

interface Props {
  agent: Agent
  onDelete?: (id: string) => void
  compact?: boolean
  assignedProjects?: AssignedProject[]
  onRemove?: (id: string) => void
  /** 개발자 탭 프로젝트 필터 — 있으면 통계·대기열·실행 목록을 이 프로젝트 것만. 추이(스파크라인)는 에이전트 단위 기록이라 비운다 */
  projectIds?: string[]
}

interface AgentStats {
  running: number
  completed: number
  failed: number
  totalTokens: number
  totalCost: number
  yesterdayCompleted: number
  tasksPerHour: number
  avgDurationSec: number
  avgTokensPerTask: number
  avgCostPerTask: number
  successRate: number
  avgTurnsPerTask: number
}

// CLI는 메타데이터(라벨)일 뿐 의미 신호가 아니므로 색을 부여하지 않음.
// 구분이 필요하면 아이콘 형태로만.
const cliConfig: Record<CliName, { label: string; icon: string; color: string; desc: string }> = {
  claude: { label: 'Claude Code', icon: 'fa-solid fa-atom', color: 'text-ive-text-muted', desc: 'Anthropic' },
  agy: { label: 'Antigravity CLI', icon: 'fa-brands fa-google', color: 'text-ive-text-muted', desc: 'Google' },
  gemini: { label: 'Gemini CLI', icon: 'fa-brands fa-google', color: 'text-ive-text-muted', desc: 'Google (레거시)' },
  codex: { label: 'Codex CLI', icon: 'fa-solid fa-brain', color: 'text-ive-text-muted', desc: 'OpenAI' },
  opencode: { label: 'OpenCode', icon: 'fa-solid fa-terminal', color: 'text-ive-text-muted', desc: 'sst.dev' },
}

// ISO 시각 → datetime-local 입력값(YYYY-MM-DDTHH:mm, 로컬시간). 없거나 잘못되면 빈 문자열.
function isoToLocalInput(iso?: string | null): string {
  if (!iso) return ''
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return ''
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`
}

// ISO 시각 → 배지용 짧은 표기(MM/DD HH:mm, 로컬시간).
function formatPausedUntil(iso: string): string {
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return ''
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${pad(d.getMonth() + 1)}/${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`
}

export default function AgentCard({ agent, onDelete, compact, assignedProjects, onRemove, projectIds }: Props) {
  const projectsKey = projectIds?.length ? projectIds.join(',') : ''
  const pq = projectsKey ? `projects=${encodeURIComponent(projectsKey)}` : ''
  const { state, refreshAgents, updateAgent } = useStore()
  const t = useTranslations('agent')
  const tc = useTranslations('common')
  const ta = useTranslations('automation')
  const statusConfig = {
    available: { label: t('statusAvailable'), dot: 'bg-ive-green' },
    busy: { label: t('statusBusy'), dot: 'bg-ive-amber' },
    offline: { label: t('statusOffline'), dot: 'bg-ive-text-dim' },
  }
  const cli = cliConfig[agent.cliName]
  const status = statusConfig[agent.status]

  // ── 사용여부(휴가) 상태 ──
  const onVacation = !isAgentAvailableNow(agent)
  const vacationLabel = agent.enabled === false
    ? t('vacationIndefinite')
    : agent.pausedUntil
      ? t('vacationUntil', { time: formatPausedUntil(agent.pausedUntil) })
      : ''

  // 사용 ↔ 휴가(무기한) 토글. 휴가 중이면 즉시 복귀(예약도 해제).
  const toggleVacation = async () => {
    if (onVacation) await updateAgent({ ...agent, enabled: true, pausedUntil: null })
    else await updateAgent({ ...agent, enabled: false, pausedUntil: null })
  }

  // 헤더에서 바로 복귀시각을 고치는 인라인 에디터.
  // 날짜는 사용자가 고르고(type=date — 부분입력 함정 없음), 시간은 기본값이 채워진 상태로 둔다(type=time).
  const [vacEditing, setVacEditing] = useState(false)
  const [vacDate, setVacDate] = useState('')   // YYYY-MM-DD
  const [vacTime, setVacTime] = useState('')   // HH:mm
  const openVacEditor = () => {
    const existing = isoToLocalInput(agent.pausedUntil)
    if (existing) {
      const [d, t] = existing.split('T')
      setVacDate(d); setVacTime(t)
    } else {
      // 기본값: 내일 날짜 + 00:00
      const tomorrow = isoToLocalInput(new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString()).split('T')[0]
      setVacDate(tomorrow); setVacTime('00:00')
    }
    setVacEditing(v => !v)
  }
  // 날짜가 있으면 기간제 휴가(자동 복귀), 비우면 무기한 휴가. 시간은 비면 09:00로 보정.
  const saveVacation = async () => {
    const pu = vacDate ? new Date(`${vacDate}T${vacTime || '00:00'}`).toISOString() : null
    await updateAgent({ ...agent, pausedUntil: pu, enabled: pu ? true : false })
    setVacEditing(false)
  }
  const resumeAgent = async () => {
    await updateAgent({ ...agent, enabled: true, pausedUntil: null })
    setVacEditing(false)
  }

  const [collapsed, setCollapsed] = useState(() => {
    if (typeof window === 'undefined') return true
    return sessionStorage.getItem(`ac-collapsed-${agent.id}`) !== 'false'
  })
  const toggleCollapsed = () => {
    setCollapsed(prev => {
      const next = !prev
      sessionStorage.setItem(`ac-collapsed-${agent.id}`, String(next))
      return next
    })
  }
  const [editing, setEditing] = useState(false)
  const [editName, setEditName] = useState(agent.name)
  const [editAvatar, setEditAvatar] = useState(agent.avatar)
  const [editModel, setEditModel] = useState(agent.modelName || '')
  const [editPausedUntil, setEditPausedUntil] = useState(isoToLocalInput(agent.pausedUntil))
  const [editCliModels, setEditCliModels] = useState<string[]>([])
  const [testing, setTesting] = useState(false)
  const [testResult, setTestResult] = useState<{ success: boolean; message: string } | null>(null)
  const [showInterview, setShowInterview] = useState(false)
  const [chatHistory, setChatHistory] = useState<{ role: 'user' | 'agent'; text: string }[]>([])
  const [chatInput, setChatInput] = useState('')
  const [chatLoading, setChatLoading] = useState(false)
  const chatInputRef = useRef<HTMLTextAreaElement>(null)
  const [expandedPanel, _setExpandedPanel] = useState<'running' | 'done' | 'failed' | 'stats' | 'pending' | null>(() => {
    if (typeof window === 'undefined') return null
    const saved = sessionStorage.getItem(`ac-panel-${agent.id}`)
    return (['running', 'done', 'failed', 'stats', 'pending'].includes(saved ?? '')) ? saved as any : null
  })
  const setExpandedPanel = (v: 'running' | 'done' | 'failed' | 'stats' | 'pending' | null) => {
    _setExpandedPanel(v)
    if (v) sessionStorage.setItem(`ac-panel-${agent.id}`, v)
    else sessionStorage.removeItem(`ac-panel-${agent.id}`)
  }
  const [stats, setStats] = useState<AgentStats | null>(null)
  const [snapshots, setSnapshots] = useState<StatSnapshot[]>([])
  const [executions, setExecutions] = useState<TaskExecution[]>([])
  const [killing, setKilling] = useState<string | null>(null)
  const [toolBadge, setToolBadge] = useState<ToolCategory | null>(null)
  const [pendingQueue, setPendingQueue] = useState<{ count: number; issues: { projectId: string; projectName: string; issueIid: number }[] }>({ count: 0, issues: [] })

  // 에이전트가 busy 상태일 때 도구 활동 폴링
  useEffect(() => {
    if (compact || agent.status !== 'busy') { setToolBadge(null); return }
    let active = true
    const poll = async () => {
      try {
        const res = await fetch('/api/activities')
        if (res.ok && active) {
          const list = await res.json()
          const mine = list.find((a: any) => a.agentId === agent.id)
          setToolBadge(mine?.category ?? null)
        }
      } catch { /* ignore */ }
    }
    poll()
    const timer = setInterval(poll, 2000)
    return () => { active = false; clearInterval(timer) }
  }, [agent.id, agent.status, compact])

  const fetchStats = useCallback(async () => {
    try {
      const [statsRes, snapRes, queueRes] = await Promise.all([
        fetch(`/api/agents/${agent.id}/stats${pq ? `?${pq}` : ''}`),
        // 추이는 에이전트 단위로만 쌓인다 — 프로젝트를 고르면 나눌 수 없으므로 받지 않는다(빈 추이)
        pq ? null : fetch(`/api/agents/${agent.id}/snapshots?mode=daily_avg`),
        fetch(`/api/agents/${agent.id}/queue${pq ? `?${pq}` : ''}`),
      ])
      if (statsRes.ok) setStats(await statsRes.json())
      if (!snapRes) setSnapshots([])
      else if (snapRes.ok) setSnapshots(await snapRes.json())
      if (queueRes.ok) setPendingQueue(await queueRes.json())
    } catch { /* ignore */ }
  }, [agent.id, pq])

  // 통계·추이·대기열은 카드를 펼쳤을 때만 — 접힌 헤더는 이 값을 쓰지 않는다(에이전트가 많으면 카드마다 10초 폴링이 쌓인다)
  useEffect(() => {
    if (compact || collapsed) return
    fetchStats()
    const timer = setInterval(fetchStats, 10000)
    const onVisible = () => { if (document.visibilityState === 'visible') fetchStats() }
    document.addEventListener('visibilitychange', onVisible)
    return () => { clearInterval(timer); document.removeEventListener('visibilitychange', onVisible) }
  }, [fetchStats, compact, collapsed])

  useEffect(() => {
    if (!expandedPanel || expandedPanel === 'stats' || expandedPanel === 'pending') return
    const fetchExecs = async () => {
      try {
        const res = await fetch(`/api/agents/${agent.id}/executions${pq ? `?${pq}` : ''}`)
        if (res.ok) setExecutions(await res.json())
      } catch { /* ignore */ }
    }
    fetchExecs()
    const timer = setInterval(fetchExecs, 5000)
    return () => clearInterval(timer)
  }, [expandedPanel, agent.id, pq])

  async function handleTest() {
    setTesting(true)
    setTestResult(null)
    try {
      const res = await fetch(`/api/agents/${agent.id}/test`, { method: 'POST' })
      const data = await res.json()
      if (data.success) {
        setTestResult({ success: true, message: data.version || t('normalOperation') })
        refreshAgents()
      } else {
        setTestResult({ success: false, message: data.error || t('connectionFailed') })
      }
    } catch {
      setTestResult({ success: false, message: tc('networkError') })
    } finally {
      setTesting(false)
    }
  }

  async function handleInterview() {
    if (!chatInput.trim() || chatLoading) return
    const question = chatInput.trim()
    setChatInput('')
    setChatHistory(prev => [...prev, { role: 'user', text: question }])
    setChatLoading(true)
    try {
      const res = await fetch(`/api/agents/${agent.id}/interview`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ question }),
      })
      const data = await res.json()
      if (res.ok) {
        setChatHistory(prev => [...prev, { role: 'agent', text: data.answer }])
      } else {
        setChatHistory(prev => [...prev, { role: 'agent', text: `⚠ ${data.error || t('responseFailed')}` }])
      }
    } catch {
      setChatHistory(prev => [...prev, { role: 'agent', text: `⚠ ${tc('networkError')}` }])
    } finally {
      setChatLoading(false)
    }
  }

  useEffect(() => {
    if (!chatLoading && showInterview) {
      chatInputRef.current?.focus()
    }
  }, [chatLoading, showInterview])

  const killExecution = useKillExecution()
  const handleKill = async (id: string) => {
    try {
      if (!await killExecution(id, () => setKilling(id))) return
      const res = await fetch(`/api/agents/${agent.id}/executions${pq ? `?${pq}` : ''}`)
      if (res.ok) setExecutions(await res.json())
      fetchStats()
    } finally { setKilling(null) }
  }

  if (compact) {
    return (
      <div className="flex items-center gap-3 bg-ive-bg-card rounded-lg p-3 border border-ive-border-subtle">
        <AgentAvatar avatar={agent.avatar} size="sm" />
        <div className="flex-1 min-w-0">
          <div className="text-base font-bold text-ive-text truncate">{agent.name}</div>
          <div className="text-sm text-ive-text-muted truncate">{cli.label}{agent.modelName ? ` · ${agent.modelName}` : ''}</div>
        </div>
        <div className="flex items-center gap-1.5 shrink-0 whitespace-nowrap">
          {onVacation ? (
            <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-lg text-xs font-bold bg-ive-amber/15 text-ive-amber">
              <i className="fa-solid fa-power-off" />{vacationLabel}
            </span>
          ) : (<>
            <div className={`w-2 h-2 rounded-full shrink-0 ${status.dot}`} />
            <span className="text-sm text-ive-text-muted">{status.label}</span>
          </>)}
          {onRemove && (
            <button
              onClick={(e) => { e.stopPropagation(); onRemove(agent.id) }}
              className="ml-1 w-6 h-6 rounded-lg bg-ive-bg-deep border border-ive-red/20 text-ive-red/40 hover:bg-ive-red/10 hover:text-ive-red hover:border-ive-red/40 flex items-center justify-center transition-all"
              title={t('unassign')}
            >
              <i className="fa-solid fa-xmark text-xs" />
            </button>
          )}
        </div>
      </div>
    )
  }

  const runningCount = stats?.running ?? 0
  const completedCount = stats?.completed ?? 0
  const failedCount = stats?.failed ?? 0
  const totalDone = completedCount + failedCount
  const yesterdayDiff = stats ? totalDone - stats.yesterdayCompleted : 0

  const runningExecs = executions.filter(e => e.status === 'running')
  const doneExecs = executions.filter(e => e.status === 'success')
  const failedExecs = executions.filter(e => e.status === 'failed')
  const todayStartISO = getKSTTodayStartISO()
  const todayDoneExecs = doneExecs.filter(e => e.startedAt >= todayStartISO)
  const todayFailedExecs = failedExecs.filter(e => e.startedAt >= todayStartISO)

  return (
    <div className={`bg-ive-bg-card rounded-lg border overflow-hidden transition-colors duration-200 ${expandedPanel ? 'border-ive-cyan/30' : 'border-ive-border-subtle'}`}>
      {/* 헤더 — 클릭으로 접��/펼치기 */}
      <div
        data-tour="agent-card-header"
        onClick={toggleCollapsed}
        className={`p-3 flex items-start justify-between gap-2 cursor-pointer active:bg-white/[0.02] transition-colors ${collapsed ? '' : 'border-b border-ive-border-dark'}`}
      >
        {/* 머리줄 — 1줄 이름(공간 우선)·상태, 2줄 CLI·모델, 3줄 역할 배지. 사람 카드(VerifierCard)와 같은 구조 */}
        <div className="flex items-start gap-2.5 min-w-0 flex-1">
          <AgentAvatar avatar={agent.avatar} size="md" toolBadge={toolBadge} />
          <div className="min-w-0 flex-1">
            {/* 1줄: 이름 + 상태·사용/휴가 토글·펼침(동작 확인·삭제는 펼친 카드 아래 버튼줄) — 아래 줄들은 카드 폭을 다 쓴다 */}
            <div className="flex items-center gap-2 min-w-0 h-7">
              <span className="text-base font-bold text-ive-text truncate leading-tight">{agent.name}</span>
              <div className="ml-auto flex items-center gap-2 shrink-0">
                {!onVacation && (
                  <span className="inline-flex items-center gap-1.5 text-xs font-bold text-ive-text-muted">
                    <span className={`w-2 h-2 rounded-full shrink-0 ${status.dot}`} />{status.label}
                  </span>
                )}
                <div onClick={e => e.stopPropagation()}>
                  <button
                    onClick={toggleVacation}
                    aria-label={onVacation ? t('resumeAgent') : t('pauseAgent')}
                    className={`w-7 h-7 rounded-lg border flex items-center justify-center transition-all ${
                      onVacation
                        ? 'bg-ive-amber/10 border-ive-amber/30 text-ive-amber hover:bg-ive-amber/20'
                        : 'bg-ive-bg-deep border-ive-border-dark text-ive-text-dim hover:text-ive-green hover:border-ive-green/30'
                    }`}
                    title={onVacation ? t('resumeAgent') : t('pauseAgent')}
                  >
                    <i className={`fa-solid ${onVacation ? 'fa-play' : 'fa-power-off'} text-xs`} />
                  </button>
                </div>
                <i className={`fa-solid fa-chevron-down text-xs text-ive-text-dim transition-transform duration-200 ${collapsed ? '' : 'rotate-180'}`} />
              </div>
            </div>
            <div className="text-sm text-ive-text-muted truncate">{cli.label} · {agent.modelName || cli.desc}</div>
            <div className="flex flex-wrap items-center gap-1 mt-1.5">
              <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded-lg text-xs font-bold bg-white/5 text-ive-text-secondary border border-ive-border-subtle">
                <i className="fa-solid fa-bolt" />{t('workerBadge')}
              </span>
              {/* 역할 명부에서 맡은 역할 — 단계색(처리·검증·확인), 뒤 숫자는 그 역할의 대기·진행 건수 */}
              {([
                { key: 'process', icon: 'fa-gears', n: agent.roleSummary?.roles.process || 0, backlog: 0 },
                { key: 'verify', icon: 'fa-user-check', n: agent.roleSummary?.roles.verify || 0, backlog: (agent.roleSummary?.verifyWaiting || 0) + (agent.roleSummary?.verifying || 0) },
                { key: 'confirm', icon: 'fa-circle-check', n: agent.roleSummary?.roles.confirm || 0, backlog: (agent.roleSummary?.confirmWaiting || 0) + (agent.roleSummary?.confirming || 0) },
              ]).filter(r => r.n > 0).map(r => (
                <span key={r.key} className={`inline-flex items-center gap-1 px-1.5 py-0.5 rounded-lg text-xs font-bold ${STAGE_TONE[r.key as 'process' | 'verify' | 'confirm'].chip}`}>
                  <i className={`fa-solid ${r.icon}`} />{ta(`role_${r.key}`)}{r.backlog > 0 ? ` ${r.backlog}` : ''}
                </span>
              ))}
            </div>
            {/* 맡은 프로젝트 줄은 늘 둔다 — 사람 카드와 높이가 같게(없으면 「미배정」) */}
            {collapsed && (
              <div className="text-xs text-ive-text-dim mt-1 truncate">
                {assignedProjects && assignedProjects.length > 0 ? assignedProjects.map(p => p.name).join(', ') : t('notAssigned')}
              </div>
            )}
            {/* 휴가 배지 — 누르면 복귀 시각을 바로 고친다 */}
            {onVacation && !vacEditing && (
              <button
                onClick={e => { e.stopPropagation(); openVacEditor() }}
                className="mt-1 inline-flex items-center gap-1 rounded-lg px-2 py-0.5 text-xs font-bold bg-ive-amber/15 text-ive-amber hover:bg-ive-amber/25 transition-colors max-w-full"
                title={t('editPausedUntil')}
              >
                <i className="fa-solid fa-power-off shrink-0" />
                <span className="truncate">{vacationLabel}</span>
                <i className="fa-solid fa-pen text-[10px] opacity-70 shrink-0" />
              </button>
            )}
          </div>
        </div>
      </div>

      {/* 휴가 복귀시각 인라인 에디터 — 배지 클릭 시 헤더에서 바로 수정 */}
      {vacEditing && (
        <div className="px-3 py-2.5 border-b border-ive-border-dark bg-ive-amber/5 space-y-2" onClick={e => e.stopPropagation()}>
          <label className="flex items-center gap-1 text-xs font-bold text-ive-amber">
            <i className="fa-solid fa-power-off" />{t('pausedUntilLabel')}
          </label>
          <div className="flex gap-1.5">
            <input
              type="date"
              value={vacDate}
              onChange={e => setVacDate(e.target.value)}
              className="flex-1 min-w-0 bg-ive-bg-input border border-ive-border rounded-lg px-3 py-2 text-base text-ive-text focus:outline-none focus:border-ive-amber"
            />
            <input
              type="time"
              value={vacTime}
              onChange={e => setVacTime(e.target.value)}
              className="flex-1 min-w-0 bg-ive-bg-input border border-ive-border rounded-lg px-3 py-2 text-base text-ive-text focus:outline-none focus:border-ive-amber"
            />
          </div>
          <button
            onClick={saveVacation}
            className="w-full text-sm font-bold text-ive-amber border border-ive-amber/40 py-2 rounded-lg hover:bg-ive-amber/10 transition-colors"
          >
            <i className="fa-solid fa-check mr-1" />{tc('save')}
          </button>
          <div className="flex items-center justify-between">
            <span className="text-xs text-ive-text-dim">{vacDate ? t('vacationUntilHint') : t('vacationIndefiniteHint')}</span>
            <button
              onClick={resumeAgent}
              className="text-xs font-bold text-ive-green hover:underline whitespace-nowrap"
            >
              <i className="fa-solid fa-play mr-1" />{t('resumeAgent')}
            </button>
          </div>
        </div>
      )}

      {/* 동작 확인 결과 — 접힌 상태에서도 표시 */}
      {collapsed && testResult && (
        <div className={`mx-3 mb-2 text-sm rounded-lg px-3 py-1.5 ${testResult.success ? 'text-ive-green bg-ive-green/10' : 'text-ive-red bg-ive-red/10'}`}>
          <i className={`fa-solid ${testResult.success ? 'fa-circle-check' : 'fa-circle-xmark'} mr-1`} />
          {testResult.message}
        </div>
      )}

      {!collapsed && <>
      {editing && (
        <div className="p-3 border-b border-ive-border-dark bg-ive-bg-deep/50 space-y-3">
          <div>
            <label className="block text-xs font-bold text-ive-text-muted mb-1">{t('nameLabel')}</label>
            <input
              type="text"
              value={editName}
              onChange={e => setEditName(e.target.value)}
              className="w-full bg-ive-bg-input border border-ive-border rounded-lg px-3 py-2 text-base text-ive-text focus:outline-none focus:border-ive-green"
              autoFocus
            />
          </div>
          <div>
            <label className="block text-xs font-bold text-ive-text-muted mb-1">{t('avatar')}</label>
            <AvatarSelector value={editAvatar} onChange={setEditAvatar} cliName={agent.cliName} />
          </div>
          {editCliModels.length > 0 && (
            <div>
              <label className="block text-xs font-bold text-ive-text-muted mb-1">{t('model')}</label>
              <select
                value={editModel}
                onChange={e => setEditModel(e.target.value)}
                className="w-full bg-ive-bg-input border border-ive-border rounded-lg px-3 py-2 text-base text-ive-text focus:outline-none focus:border-ive-green"
              >
                <option value="">{t('modelDefault')}</option>
                {editCliModels.map(m => (
                  <option key={m} value={m}>{m}</option>
                ))}
              </select>
            </div>
          )}
          {/* 휴가 자동 복귀 예약 시각 (선택) — Codex 한도 리셋 시각 등 */}
          <div>
            <label className="block text-xs font-bold text-ive-text-muted mb-1">
              <i className="fa-solid fa-power-off mr-1" />{t('pausedUntilLabel')}
            </label>
            <div className="flex gap-1.5">
              <input
                type="datetime-local"
                value={editPausedUntil}
                onChange={e => setEditPausedUntil(e.target.value)}
                className="flex-1 min-w-0 bg-ive-bg-input border border-ive-border rounded-lg px-3 py-2 text-base text-ive-text focus:outline-none focus:border-ive-green"
              />
              {editPausedUntil && (
                <button
                  type="button"
                  onClick={() => setEditPausedUntil('')}
                  className="shrink-0 px-3 rounded-lg border border-ive-border text-ive-text-dim hover:text-ive-text hover:bg-ive-bg-deep transition-colors"
                  title={tc('clear')}
                >
                  <i className="fa-solid fa-xmark text-xs" />
                </button>
              )}
            </div>
            <p className="text-xs text-ive-text-dim mt-1">{t('pausedUntilHint')}</p>
          </div>
          <div className="flex gap-2">
            <button
              onClick={async () => {
                const pu = editPausedUntil ? new Date(editPausedUntil).toISOString() : null
                await updateAgent({
                  ...agent,
                  name: editName.trim() || agent.name,
                  avatar: editAvatar,
                  modelName: editModel,
                  pausedUntil: pu,
                  // 복귀 예약을 넣으면 기간제 휴가(enabled 유지). 비우면 마스터 스위치는 그대로.
                  enabled: pu ? true : agent.enabled,
                })
                setEditing(false)
              }}
              className="flex-1 text-sm font-bold text-ive-green border border-ive-green/30 py-1.5 rounded-lg hover:bg-ive-green/10 transition-colors"
            >
              <i className="fa-solid fa-check mr-1" />{tc('save')}
            </button>
            <button
              onClick={() => setEditing(false)}
              className="flex-1 text-sm font-bold text-ive-text-dim border border-ive-border py-1.5 rounded-lg hover:bg-ive-bg-deep transition-colors"
            >
              {tc('cancel')}
            </button>
          </div>
        </div>
      )}

      {/* 정보 */}
      <div className="p-3 space-y-2">
        {agent.cliVersion && (
          <div className="flex items-center gap-2 text-sm font-bold">
            <span className="text-ive-text-muted"><i className="fa-solid fa-code-branch w-4 text-center" /> {t('version')}</span>
            <span className="text-ive-text">{agent.cliVersion}</span>
          </div>
        )}

        <div className="flex items-center gap-2 text-sm font-bold">
          <span className="text-ive-text-muted"><i className="fa-solid fa-repeat w-4 text-center" /> {t('maxTurns')}</span>
          <span className="text-ive-text">{agent.maxTurns}</span>
          <span className="text-xs font-bold text-ive-text-dim">({t('maxTurnsHint')})</span>
        </div>

        {assignedProjects !== undefined && (
          <div className="flex items-center gap-2 text-sm font-bold">
            <span className="text-ive-text-muted shrink-0"><i className="fa-solid fa-plug w-4 text-center" /> {t('assigned')}</span>
            {assignedProjects.length === 0 ? (
              <span className="text-ive-text-dim">{t('notAssigned')}</span>
            ) : (
              <div className="flex flex-wrap gap-1.5">
                {assignedProjects.map(p => (
                  <span key={p.id} className="inline-flex items-center gap-1 px-2 py-0.5 rounded-lg text-xs font-bold bg-ive-bg-deep border border-ive-border-dark">
                    <i className={`fa-brands ${p.provider === 'github' ? 'fa-github' : 'fa-gitlab'}`} style={{ color: p.color }} />
                    <span className="text-ive-text">{p.name}</span>
                  </span>
                ))}
              </div>
            )}
          </div>
        )}
      </div>

      {/* 대시보드 통계 바 */}
      <div data-tour="agent-card-stats" className="flex items-stretch border-t border-ive-border-dark">
        {/* 작업중 */}
        <button
          onClick={() => setExpandedPanel(expandedPanel === 'running' ? null : 'running')}
          className={`flex-1 py-2.5 px-2 flex flex-col items-center gap-0.5 transition-all ${expandedPanel === 'running' ? 'bg-ive-amber/5' : 'hover:bg-white/[0.02]'}`}
        >
          <span className={`text-sm font-bold ${runningCount > 0 ? 'text-ive-amber animate-pulse' : 'text-ive-text-dim'}`}>
            {runningCount}
          </span>
          <Sparkline data={snapshots.map(s => s.running)} width={40} height={12} color="amber" />
          <span className="text-xs text-ive-text-dim font-bold">{t('workingLabel')}</span>
        </button>

        {/* 완료 */}
        <button
          onClick={() => setExpandedPanel(expandedPanel === 'done' ? null : 'done')}
          className={`flex-1 py-2.5 px-2 flex flex-col items-center gap-0.5 transition-all ${expandedPanel === 'done' ? 'bg-ive-green/5' : 'hover:bg-white/[0.02]'}`}
        >
          <div className="flex items-baseline gap-1">
            <span className={`text-sm font-bold ${completedCount > 0 ? 'text-ive-green' : 'text-ive-text-dim'}`}>
              {completedCount}
            </span>
            {stats && yesterdayDiff !== 0 && (
              <span className={`text-xs font-bold ${yesterdayDiff > 0 ? 'text-ive-green' : 'text-ive-red'}`}>
                {yesterdayDiff > 0 ? '+' : ''}{yesterdayDiff}
              </span>
            )}
          </div>
          <Sparkline data={snapshots.map(s => s.completed)} width={40} height={12} color="cyan" />
          <span className="text-xs text-ive-text-dim font-bold">{t('completedLabel')}</span>
        </button>

        {/* 실패 */}
        <button
          onClick={() => setExpandedPanel(expandedPanel === 'failed' ? null : 'failed')}
          className={`flex-1 py-2.5 px-2 flex flex-col items-center gap-0.5 transition-all ${expandedPanel === 'failed' ? 'bg-ive-red/5' : 'hover:bg-white/[0.02]'}`}
        >
          <span className={`text-sm font-bold ${failedCount > 0 ? 'text-ive-red' : 'text-ive-text-dim'}`}>
            {failedCount}
          </span>
          <Sparkline data={snapshots.map(s => s.failed)} width={40} height={12} color="red" />
          <span className="text-xs text-ive-text-dim font-bold">{t('failedLabel')}</span>
        </button>

        {/* 대기 (지정 작업) */}
        {(pendingQueue.count > 0 || snapshots.some(s => s.waiting > 0)) && (
          <button
            onClick={() => setExpandedPanel(expandedPanel === 'pending' ? null : 'pending')}
            className={`flex-1 py-2.5 px-2 flex flex-col items-center gap-0.5 transition-all ${expandedPanel === 'pending' ? 'bg-ive-amber/5' : 'hover:bg-white/[0.02]'}`}
          >
            <span className={`text-sm font-bold ${pendingQueue.count > 0 ? 'text-ive-amber animate-pulse' : 'text-ive-text-dim'}`}>
              {pendingQueue.count}
            </span>
            <Sparkline data={snapshots.map(s => s.waiting)} width={40} height={12} color="amber" />
            <span className="text-xs text-ive-text-dim font-bold">{t('pendingQueue')}</span>
          </button>
        )}

        {/* 통계 */}
        <button
          onClick={() => setExpandedPanel(expandedPanel === 'stats' ? null : 'stats')}
          className={`flex-1 py-2.5 px-2 flex flex-col items-center gap-0.5 transition-all ${expandedPanel === 'stats' ? 'bg-ive-cyan/5' : 'hover:bg-white/[0.02]'}`}
        >
          <i className={`fa-solid fa-chart-bar text-sm ${expandedPanel === 'stats' ? 'text-ive-cyan' : 'text-ive-text-dim'}`} />
          <Sparkline data={snapshots.map(s => s.costUsd)} width={40} height={12} color="cyan" />
          <span className="text-xs text-ive-text-dim font-bold">{t('statsLabel')}</span>
        </button>
      </div>

      {/* 인터뷰 & 동작확인 & 제거 */}
      <div className="px-3 py-2 flex flex-col gap-2 border-t border-ive-border-dark">
        <div className="flex gap-2">
          <button
            onClick={() => {
              if (!showInterview) {
                setShowInterview(true)
                if (chatHistory.length === 0) {
                  setChatHistory([{ role: 'agent', text: t('interviewGreeting', { name: agent.name }) }])
                }
              } else {
                setShowInterview(false)
              }
            }}
            data-tour="agent-interview"
            className={`flex-1 text-sm font-bold py-1.5 rounded-lg border transition-colors ${
              showInterview
                ? 'text-ive-green border-ive-green/40 bg-ive-green/10'
                : 'text-ive-cyan border-ive-cyan/30 active:bg-ive-cyan/10'
            }`}
          >
            <i className="fa-solid fa-comments mr-1" /> {t('interview')}
          </button>

          <button
            onClick={() => {
              const willEdit = !editing
              setEditing(willEdit)
              setEditName(agent.name)
              setEditAvatar(agent.avatar)
              setEditModel(agent.modelName || '')
              setEditPausedUntil(isoToLocalInput(agent.pausedUntil))
              if (willEdit) {
                fetch('/api/settings/cli-models').then(r => r.json()).then(data => {
                  setEditCliModels(data[agent.cliName] || [])
                }).catch(() => {})
              }
            }}
            className={`text-sm font-bold py-1.5 px-3 rounded-lg border transition-colors ${
              editing
                ? 'text-ive-green border-ive-green/40 bg-ive-green/10'
                : 'text-ive-text-dim border-ive-border active:bg-white/5'
            }`}
            title={t('editNameAvatar')}
          >
            <i className="fa-solid fa-pen" />
          </button>

          <button
            data-tour="agent-test"
            onClick={handleTest}
            disabled={testing}
            className="text-sm font-bold text-ive-text-dim py-1.5 px-3 rounded-lg border border-ive-border active:bg-white/5 transition-colors disabled:opacity-50"
            title={t('checkOperation')}
          >
            {testing ? <i className="fa-solid fa-spinner fa-spin" /> : <i className="fa-solid fa-stethoscope" />}
          </button>

          {onDelete && (
            <button
              onClick={() => onDelete(agent.id)}
              className="text-sm font-bold text-ive-red/60 py-1.5 px-3 rounded-lg border border-ive-red/20 active:bg-ive-red/10 transition-colors"
              title={tc('remove')}
            >
              <i className="fa-solid fa-trash-can" />
            </button>
          )}
        </div>

        {testResult && !showInterview && (
          <div className={`text-sm font-bold rounded-lg px-3 py-2 ${testResult.success ? 'text-ive-green bg-ive-green/10' : 'text-ive-red bg-ive-red/10'}`}>
            <i className={`fa-solid ${testResult.success ? 'fa-circle-check' : 'fa-circle-xmark'} mr-1`} />
            {testResult.message}
          </div>
        )}

        {/* 인터뷰 채팅 */}
        {showInterview && (
          <div className="bg-ive-bg rounded-lg border border-ive-border-subtle overflow-hidden">
            <div className="max-h-[240px] overflow-y-auto p-3 space-y-2.5" ref={el => { if (el) el.scrollTop = el.scrollHeight }}>
              {chatHistory.map((msg, i) => (
                <div key={i} className={`flex ${msg.role === 'user' ? 'flex-row-reverse' : ''} items-start gap-2`}>
                  <div className="shrink-0 mt-0.5">
                    {msg.role === 'user' ? (
                      <AgentAvatar avatar={state.user?.avatar || 'av-01'} size="sm" />
                    ) : (
                      <AgentAvatar avatar={agent.avatar} size="sm" />
                    )}
                  </div>
                  <div
                    className={`rounded-lg px-3 py-2 text-sm leading-relaxed ${
                      msg.role === 'user'
                        ? 'max-w-[80%] bg-white/5 text-ive-text border border-ive-border-subtle'
                        : 'flex-1 bg-ive-bg-card text-ive-text border border-ive-border-subtle'
                    }`}
                    style={{ whiteSpace: 'pre-wrap' }}
                  >
                    {msg.role === 'agent' ? (
                      <ReactMarkdown
                        remarkPlugins={[remarkGfm]}
                        components={{
                          h1: ({ children }) => <h1 className="text-base font-bold text-ive-text mt-2 mb-1">{children}</h1>,
                          h2: ({ children }) => <h2 className="text-sm font-bold text-ive-text mt-2 mb-1">{children}</h2>,
                          h3: ({ children }) => <h3 className="text-sm font-bold text-ive-text mt-1.5 mb-0.5">{children}</h3>,
                          p: ({ children }) => <p className="mb-1.5 last:mb-0" style={{ whiteSpace: 'pre-wrap' }}>{children}</p>,
                          ul: ({ children }) => <ul className="list-disc list-inside mb-1.5 space-y-0.5">{children}</ul>,
                          ol: ({ children }) => <ol className="list-decimal list-inside mb-1.5 space-y-0.5">{children}</ol>,
                          li: ({ children }) => <li>{children}</li>,
                          strong: ({ children }) => <strong className="font-bold text-ive-text">{children}</strong>,
                          em: ({ children }) => <em className="italic">{children}</em>,
                          code: ({ children, className }) => {
                            const isBlock = className?.includes('language-')
                            if (isBlock) {
                              return <code className="block bg-ive-bg-deep rounded-lg p-2 my-1.5 text-xs font-mono overflow-x-auto whitespace-pre">{children}</code>
                            }
                            return <code className="bg-ive-bg-deep px-1 py-0.5 rounded text-xs font-mono text-ive-text">{children}</code>
                          },
                          pre: ({ children }) => <pre className="mb-1.5">{children}</pre>,
                          blockquote: ({ children }) => <blockquote className="border-l-2 border-ive-border pl-2.5 my-1.5 text-ive-text-dim">{children}</blockquote>,
                          a: ({ href, children }) => <a href={href} target="_blank" rel="noopener noreferrer" className="text-ive-cyan hover:underline">{children}</a>,
                          hr: () => <hr className="border-ive-border-dark my-2" />,
                          table: ({ children }) => <table className="w-full border-collapse my-2 text-sm">{children}</table>,
                          thead: ({ children }) => <thead className="bg-ive-bg-deep">{children}</thead>,
                          tbody: ({ children }) => <tbody>{children}</tbody>,
                          tr: ({ children }) => <tr className="border-b border-ive-border-dark">{children}</tr>,
                          th: ({ children }) => <th className="border border-ive-border-dark px-2 py-1 text-left font-bold text-ive-text">{children}</th>,
                          td: ({ children }) => <td className="border border-ive-border-dark px-2 py-1 text-ive-text-dim">{children}</td>,
                        }}
                      >
                        {msg.text}
                      </ReactMarkdown>
                    ) : msg.text}
                  </div>
                </div>
              ))}
              {chatLoading && (
                <div className="flex gap-2 justify-start">
                  <AgentAvatar avatar={agent.avatar} size="sm" className="shrink-0 mt-0.5" />
                  <div className="bg-ive-bg-card text-ive-text-dim border border-ive-border-subtle rounded-lg px-3 py-2 text-sm">
                    <i className="fa-solid fa-ellipsis fa-beat-fade" /> {t('thinking')}
                  </div>
                </div>
              )}
            </div>
            <div className="border-t border-ive-border-dark p-2 flex gap-2">
              <textarea
                ref={chatInputRef}
                value={chatInput}
                onChange={e => {
                  setChatInput(e.target.value)
                  e.target.style.height = 'auto'
                  e.target.style.height = Math.min(e.target.scrollHeight, 120) + 'px'
                }}
                onKeyDown={e => {
                  if (e.key !== 'Enter') return
                  const isMobile = typeof window !== 'undefined' && ('ontouchstart' in window || navigator.maxTouchPoints > 0)
                  if (isMobile) return
                  if (e.shiftKey) return
                  e.preventDefault()
                  handleInterview()
                }}
                placeholder={t('questionPlaceholder')}
                rows={1}
                className="flex-1 min-h-[34px] bg-ive-bg-input border border-ive-border rounded-lg px-3 py-1.5 text-sm text-ive-text placeholder:text-ive-text-dim focus:outline-none focus:border-ive-green resize-none"
                style={{ overflowY: 'auto', scrollbarGutter: 'stable' }}
                disabled={chatLoading}
              />
              <button
                onClick={handleInterview}
                disabled={chatLoading || !chatInput.trim()}
                className="text-sm font-bold text-ive-green px-3 py-1.5 rounded-lg border border-ive-green/30 hover:bg-ive-green/10 transition-colors disabled:opacity-30"
              >
                <i className="fa-solid fa-paper-plane" />
              </button>
            </div>
          </div>
        )}
      </div>

      {/* 작업중 패널 */}
      {expandedPanel === 'running' && (
        <div className="border-t border-ive-amber/20">
          <div className="px-3 py-2 bg-ive-bg-deep/50 border-b border-ive-border-dark">
            <span className="text-xs font-bold text-ive-amber uppercase tracking-widest">
              <i className="fa-solid fa-gear fa-spin mr-1" />{t('inProgress', { count: runningExecs.length })}
            </span>
          </div>
          <div className="max-h-[50vh] overflow-y-auto" data-scroll-container>
            <ExecutionList executions={runningExecs} showAgent={false} onKill={handleKill} killing={killing} scrollKey={`ac-running-${agent.id}`} />
          </div>
        </div>
      )}

      {/* 완료 패널 */}
      {expandedPanel === 'done' && (
        <div className="border-t border-ive-green/20">
          <div className="px-3 py-2 bg-ive-bg-deep/50 border-b border-ive-border-dark">
            <span className="text-xs font-bold text-ive-green uppercase tracking-widest">
              <i className="fa-solid fa-circle-check mr-1" />{t('completedToday', { count: todayDoneExecs.length })}
            </span>
          </div>
          <div className="max-h-[50vh] overflow-y-auto" data-scroll-container>
            <ExecutionList executions={todayDoneExecs} showAgent={false} onKill={handleKill} killing={killing} scrollKey={`ac-done-${agent.id}`} />
          </div>
        </div>
      )}

      {/* 실패 패널 */}
      {expandedPanel === 'failed' && (
        <div className="border-t border-ive-red/20">
          <div className="px-3 py-2 bg-ive-bg-deep/50 border-b border-ive-border-dark">
            <span className="text-xs font-bold text-ive-red uppercase tracking-widest">
              <i className="fa-solid fa-circle-xmark mr-1" />{t('failedToday', { count: todayFailedExecs.length })}
            </span>
          </div>
          <div className="max-h-[50vh] overflow-y-auto" data-scroll-container>
            <ExecutionList executions={todayFailedExecs} showAgent={false} onKill={handleKill} killing={killing} scrollKey={`ac-failed-${agent.id}`} />
          </div>
        </div>
      )}

      {/* 대기 패널 */}
      {expandedPanel === 'pending' && pendingQueue.count > 0 && (
        <div className="border-t border-ive-amber/20">
          <div className="px-3 py-2 bg-ive-bg-deep/50 border-b border-ive-border-dark">
            <span className="text-xs font-bold text-ive-amber uppercase tracking-widest">
              <i className="fa-solid fa-clock mr-1" />{t('pendingQueueCount', { count: pendingQueue.count })}
            </span>
          </div>
          <div className="max-h-[50vh] overflow-y-auto divide-y divide-ive-border-dark">
            {pendingQueue.issues.map(issue => (
              <a
                key={`${issue.projectId}-${issue.issueIid}`}
                href={`/issues/${issue.projectId}/${issue.issueIid}`}
                className="flex items-center gap-2 px-3 py-2.5 hover:bg-white/[0.02] transition-colors"
              >
                <span className="text-xs font-bold text-ive-text-secondary">#{issue.issueIid}</span>
                <span className="text-xs text-ive-text-dim truncate">{issue.projectName}</span>
              </a>
            ))}
          </div>
        </div>
      )}

      {/* 통계 패널 */}
      {expandedPanel === 'stats' && stats && (
        <div className="border-t border-ive-cyan/20">
          <div className="px-3 py-2 bg-ive-bg-deep/50 border-b border-ive-border-dark">
            <span className="text-xs font-bold text-ive-cyan uppercase tracking-widest">
              <i className="fa-solid fa-chart-bar mr-1" />{t('performanceStats')}
            </span>
          </div>
          <ExecutionStats
            avgDurationSec={stats.avgDurationSec}
            avgTokensPerTask={stats.avgTokensPerTask}
            avgCostPerTask={stats.avgCostPerTask}
            successRate={stats.successRate}
            tasksPerHour={stats.tasksPerHour}
            avgTurnsPerTask={stats.avgTurnsPerTask}
          />
        </div>
      )}
      </>}
    </div>
  )
}

export { cliConfig }
