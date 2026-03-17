'use client'

import { useState, useEffect, useCallback } from 'react'
import { Agent, CliName, TaskExecution, StatSnapshot } from '@/types'
import { useStore } from '@/lib/store'
import Sparkline from '@/components/ui/Sparkline'
import ExecutionList from '@/components/execution/ExecutionList'
import ExecutionStats from '@/components/execution/ExecutionStats'
import AgentAvatar, { AvatarSelector } from '@/components/agent/AgentAvatar'
import ReactMarkdown from 'react-markdown'

interface Props {
  agent: Agent
  onDelete?: (id: string) => void
  compact?: boolean
  assignedProject?: string | null
  onRemove?: (id: string) => void
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

const cliConfig: Record<CliName, { label: string; icon: string; color: string; desc: string }> = {
  claude: { label: 'Claude Code', icon: 'fa-solid fa-atom', color: 'text-ive-amber', desc: 'Anthropic' },
  gemini: { label: 'Gemini CLI', icon: 'fa-brands fa-google', color: 'text-ive-cyan', desc: 'Google' },
  codex: { label: 'Codex CLI', icon: 'fa-solid fa-brain', color: 'text-ive-green-light', desc: 'OpenAI' },
}

const statusConfig = {
  available: { label: '대기', dot: 'bg-ive-green' },
  busy: { label: '작업 중', dot: 'bg-ive-amber' },
  offline: { label: '오프라인', dot: 'bg-ive-text-dim' },
}

export default function AgentCard({ agent, onDelete, compact, assignedProject, onRemove }: Props) {
  const { refreshAgents, updateAgent } = useStore()
  const cli = cliConfig[agent.cliName]
  const status = statusConfig[agent.status]
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
  const [testing, setTesting] = useState(false)
  const [testResult, setTestResult] = useState<{ success: boolean; message: string } | null>(null)
  const [showInterview, setShowInterview] = useState(false)
  const [chatHistory, setChatHistory] = useState<{ role: 'user' | 'agent'; text: string }[]>([])
  const [chatInput, setChatInput] = useState('')
  const [chatLoading, setChatLoading] = useState(false)
  const [expandedPanel, _setExpandedPanel] = useState<'running' | 'done' | 'failed' | 'stats' | null>(() => {
    if (typeof window === 'undefined') return null
    const saved = sessionStorage.getItem(`ac-panel-${agent.id}`)
    return (['running', 'done', 'failed', 'stats'].includes(saved ?? '')) ? saved as any : null
  })
  const setExpandedPanel = (v: 'running' | 'done' | 'failed' | 'stats' | null) => {
    _setExpandedPanel(v)
    if (v) sessionStorage.setItem(`ac-panel-${agent.id}`, v)
    else sessionStorage.removeItem(`ac-panel-${agent.id}`)
  }
  const [stats, setStats] = useState<AgentStats | null>(null)
  const [snapshots, setSnapshots] = useState<StatSnapshot[]>([])
  const [executions, setExecutions] = useState<TaskExecution[]>([])
  const [killing, setKilling] = useState<string | null>(null)

  const fetchStats = useCallback(async () => {
    try {
      const [statsRes, snapRes] = await Promise.all([
        fetch(`/api/agents/${agent.id}/stats`),
        fetch(`/api/agents/${agent.id}/snapshots`),
      ])
      if (statsRes.ok) setStats(await statsRes.json())
      if (snapRes.ok) setSnapshots(await snapRes.json())
    } catch { /* ignore */ }
  }, [agent.id])

  useEffect(() => {
    if (compact) return
    fetchStats()
    const timer = setInterval(fetchStats, 10000)
    const onVisible = () => { if (document.visibilityState === 'visible') fetchStats() }
    document.addEventListener('visibilitychange', onVisible)
    return () => { clearInterval(timer); document.removeEventListener('visibilitychange', onVisible) }
  }, [fetchStats, compact])

  useEffect(() => {
    if (!expandedPanel || expandedPanel === 'stats') return
    const fetchExecs = async () => {
      try {
        const res = await fetch(`/api/agents/${agent.id}/executions`)
        if (res.ok) setExecutions(await res.json())
      } catch { /* ignore */ }
    }
    fetchExecs()
    const timer = setInterval(fetchExecs, 5000)
    return () => clearInterval(timer)
  }, [expandedPanel, agent.id])

  async function handleTest() {
    setTesting(true)
    setTestResult(null)
    try {
      const res = await fetch(`/api/agents/${agent.id}/test`, { method: 'POST' })
      const data = await res.json()
      if (data.success) {
        setTestResult({ success: true, message: data.version || '정상 동작' })
        refreshAgents()
      } else {
        setTestResult({ success: false, message: data.error || '연결 실패' })
      }
    } catch {
      setTestResult({ success: false, message: '네트워크 오류' })
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
        setChatHistory(prev => [...prev, { role: 'agent', text: `⚠ ${data.error || '응답 실패'}` }])
      }
    } catch {
      setChatHistory(prev => [...prev, { role: 'agent', text: '⚠ 네트워크 오류' }])
    } finally {
      setChatLoading(false)
    }
  }

  const handleKill = async (id: string) => {
    setKilling(id)
    try {
      await fetch(`/api/executions/${id}/kill`, { method: 'POST' })
      const res = await fetch(`/api/agents/${agent.id}/executions`)
      if (res.ok) setExecutions(await res.json())
      fetchStats()
    } finally { setKilling(null) }
  }

  if (compact) {
    return (
      <div className="flex items-center gap-3 bg-ive-bg-card rounded-lg p-3 border border-ive-border-subtle">
        <AgentAvatar avatar={agent.avatar} size="sm" />
        <div className="flex-1 min-w-0">
          <div className="text-base font-bold text-ive-green-pale truncate">{agent.name}</div>
          <div className="text-sm text-ive-text-muted truncate">{cli.label}</div>
        </div>
        <div className="flex items-center gap-1.5 shrink-0">
          <div className={`w-2 h-2 rounded-full ${status.dot}`} />
          <span className="text-sm text-ive-text-muted">{status.label}</span>
          {onRemove && (
            <button
              onClick={(e) => { e.stopPropagation(); onRemove(agent.id) }}
              className="ml-1 w-6 h-6 rounded-md bg-ive-bg-deep border border-ive-red/20 text-ive-red/40 hover:bg-ive-red/10 hover:text-ive-red hover:border-ive-red/40 flex items-center justify-center transition-all"
              title="배정 해제"
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
  const todayStr = new Date().toISOString().slice(0, 10)
  const todayDoneExecs = doneExecs.filter(e => e.startedAt >= todayStr)
  const todayFailedExecs = failedExecs.filter(e => e.startedAt >= todayStr)

  return (
    <div className={`bg-ive-bg-card rounded-xl border overflow-hidden transition-colors duration-200 ${expandedPanel ? 'border-ive-cyan/30' : 'border-ive-border-subtle'}`}>
      {/* 헤더 — 클릭으로 접기/펼치기 */}
      <div
        onClick={toggleCollapsed}
        className={`p-3 flex items-center justify-between cursor-pointer active:bg-white/[0.02] transition-colors ${collapsed ? '' : 'border-b border-ive-border-dark'}`}
      >
        <div className="flex items-center gap-2.5">
          <AgentAvatar avatar={agent.avatar} size="md" />
          <div>
            <div className="text-base font-bold text-ive-green-pale">{agent.name}</div>
            <div className="text-sm text-ive-text-muted">{cli.label} · {cli.desc}</div>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <div className="flex items-center gap-1.5">
            <div className={`w-2 h-2 rounded-full ${status.dot}`} />
            <span className="text-sm text-ive-text-muted">{status.label}</span>
          </div>
          <i className={`fa-solid fa-chevron-down text-xs text-ive-text-dim transition-transform duration-200 ${collapsed ? '' : 'rotate-180'}`} />
        </div>
      </div>

      {!collapsed && <>
      {editing && (
        <div className="p-3 border-b border-ive-border-dark bg-ive-bg-deep/50 space-y-3">
          <div>
            <label className="block text-xs font-bold text-ive-text-muted mb-1">이름</label>
            <input
              type="text"
              value={editName}
              onChange={e => setEditName(e.target.value)}
              className="w-full bg-ive-bg-input border border-ive-border rounded-lg px-3 py-2 text-base text-ive-text focus:outline-none focus:border-ive-green"
              autoFocus
            />
          </div>
          <div>
            <label className="block text-xs font-bold text-ive-text-muted mb-1">아바타</label>
            <AvatarSelector value={editAvatar} onChange={setEditAvatar} />
          </div>
          <div className="flex gap-2">
            <button
              onClick={async () => {
                await updateAgent({ ...agent, name: editName.trim() || agent.name, avatar: editAvatar })
                setEditing(false)
              }}
              className="flex-1 text-sm font-bold text-ive-green border border-ive-green/30 py-1.5 rounded-lg hover:bg-ive-green/10 transition-colors"
            >
              <i className="fa-solid fa-check mr-1" />저장
            </button>
            <button
              onClick={() => setEditing(false)}
              className="flex-1 text-sm font-bold text-ive-text-dim border border-ive-border py-1.5 rounded-lg hover:bg-ive-bg-deep transition-colors"
            >
              취소
            </button>
          </div>
        </div>
      )}

      {/* 정보 */}
      <div className="p-3 space-y-2">
        <div className="flex items-center gap-2 text-base">
          <span className="text-ive-text-muted"><i className="fa-solid fa-folder w-4 text-center" /> 경로</span>
          <code className="flex-1 text-base text-ive-text-dim bg-ive-bg-deep px-2 py-0.5 rounded font-mono truncate">
            {agent.cliPath}
          </code>
          <button
            onClick={() => { setEditing(true); setEditName(agent.name); setEditAvatar(agent.avatar) }}
            className="shrink-0 text-xs text-ive-text-dim hover:text-ive-text transition-colors"
          >
            <i className="fa-solid fa-pen text-[10px]" />
          </button>
        </div>

        {agent.cliVersion && (
          <div className="flex items-center gap-2 text-base">
            <span className="text-ive-text-muted"><i className="fa-solid fa-code-branch w-4 text-center" /> 버전</span>
            <span className="text-ive-text font-semibold">{agent.cliVersion}</span>
          </div>
        )}

        <div className="flex items-center gap-2 text-base">
          <span className="text-ive-text-muted"><i className="fa-solid fa-repeat w-4 text-center" /> 최대 턴</span>
          <span className="text-ive-text font-semibold">{agent.maxTurns}</span>
          <span className="text-xs text-ive-text-dim">(이슈당 최대 대화 횟수)</span>
        </div>

        {assignedProject !== undefined && (
          <div className="flex items-center gap-2 text-base">
            <span className="text-ive-text-muted"><i className="fa-solid fa-plug w-4 text-center" /> 배정</span>
            <span className={`font-semibold ${assignedProject ? 'text-ive-green' : 'text-ive-text-dim'}`}>
              {assignedProject || '미배정'}
            </span>
          </div>
        )}
      </div>

      {/* 대시보드 통계 바 */}
      <div className="flex items-stretch border-t border-ive-border-dark">
        {/* 작업중 */}
        <button
          onClick={() => setExpandedPanel(expandedPanel === 'running' ? null : 'running')}
          className={`flex-1 py-2.5 px-2 flex flex-col items-center gap-0.5 transition-all ${expandedPanel === 'running' ? 'bg-ive-amber/5' : 'hover:bg-white/[0.02]'}`}
        >
          <span className={`text-lg font-black leading-none ${runningCount > 0 ? 'text-ive-amber animate-pulse' : 'text-ive-text-dim'}`}>
            {runningCount}
          </span>
          <Sparkline data={snapshots.map(s => s.running)} width={40} height={12} color="amber" />
          <span className="text-xs text-ive-text-dim font-bold">작업중</span>
        </button>

        {/* 완료 */}
        <button
          onClick={() => setExpandedPanel(expandedPanel === 'done' ? null : 'done')}
          className={`flex-1 py-2.5 px-2 flex flex-col items-center gap-0.5 transition-all ${expandedPanel === 'done' ? 'bg-ive-green/5' : 'hover:bg-white/[0.02]'}`}
        >
          <div className="flex items-baseline gap-1">
            <span className={`text-lg font-black leading-none ${completedCount > 0 ? 'text-ive-green' : 'text-ive-text-dim'}`}>
              {completedCount}
            </span>
            {stats && yesterdayDiff !== 0 && (
              <span className={`text-xs font-bold ${yesterdayDiff > 0 ? 'text-ive-green' : 'text-ive-red'}`}>
                {yesterdayDiff > 0 ? '+' : ''}{yesterdayDiff}
              </span>
            )}
          </div>
          <Sparkline data={snapshots.map(s => s.completed)} width={40} height={12} color="green" />
          <span className="text-xs text-ive-text-dim font-bold">완료</span>
        </button>

        {/* 실패 */}
        <button
          onClick={() => setExpandedPanel(expandedPanel === 'failed' ? null : 'failed')}
          className={`flex-1 py-2.5 px-2 flex flex-col items-center gap-0.5 transition-all ${expandedPanel === 'failed' ? 'bg-ive-red/5' : 'hover:bg-white/[0.02]'}`}
        >
          <span className={`text-lg font-black leading-none ${failedCount > 0 ? 'text-ive-red' : 'text-ive-text-dim'}`}>
            {failedCount}
          </span>
          <Sparkline data={snapshots.map(s => s.failed)} width={40} height={12} color="red" />
          <span className="text-xs text-ive-text-dim font-bold">실패</span>
        </button>

        {/* 통계 */}
        <button
          onClick={() => setExpandedPanel(expandedPanel === 'stats' ? null : 'stats')}
          className={`flex-1 py-2.5 px-2 flex flex-col items-center gap-0.5 transition-all ${expandedPanel === 'stats' ? 'bg-ive-cyan/5' : 'hover:bg-white/[0.02]'}`}
        >
          <span className="text-lg leading-none">
            <i className={`fa-solid fa-chart-bar ${expandedPanel === 'stats' ? 'text-ive-cyan' : 'text-ive-text-dim'}`} />
          </span>
          <Sparkline data={snapshots.map(s => s.costUsd)} width={40} height={12} color="cyan" />
          <span className="text-xs text-ive-text-dim font-bold">통계</span>
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
                  setChatHistory([{ role: 'agent', text: `안녕하세요, ${agent.name}입니다. 무엇이든 물어보세요!` }])
                }
              } else {
                setShowInterview(false)
              }
            }}
            className={`flex-1 text-base py-1.5 rounded border transition-colors ${
              showInterview
                ? 'text-ive-green border-ive-green/40 bg-ive-green/10'
                : 'text-ive-cyan border-ive-cyan/30 active:bg-ive-cyan/10'
            }`}
          >
            <i className="fa-solid fa-comments mr-1" /> 인터뷰
          </button>

          <button
            onClick={handleTest}
            disabled={testing}
            className="text-base text-ive-text-dim py-1.5 px-3 rounded border border-ive-border active:bg-white/5 transition-colors disabled:opacity-50"
            title="동작 확인"
          >
            {testing ? <i className="fa-solid fa-spinner fa-spin" /> : <i className="fa-solid fa-stethoscope" />}
          </button>

          {onDelete && (
            <button
              onClick={() => onDelete(agent.id)}
              className="text-base text-ive-red/60 py-1.5 px-3 rounded border border-ive-red/20 active:bg-ive-red/10 transition-colors"
              title="제거"
            >
              <i className="fa-solid fa-trash-can" />
            </button>
          )}
        </div>

        {testResult && !showInterview && (
          <div className={`text-base rounded-lg px-3 py-2 ${testResult.success ? 'text-ive-green bg-ive-green/10' : 'text-ive-red bg-ive-red/10'}`}>
            <i className={`fa-solid ${testResult.success ? 'fa-circle-check' : 'fa-circle-xmark'} mr-1`} />
            {testResult.message}
          </div>
        )}

        {/* 인터뷰 채팅 */}
        {showInterview && (
          <div className="bg-ive-bg rounded-xl border border-ive-border-subtle overflow-hidden">
            <div className="max-h-[240px] overflow-y-auto p-3 space-y-2.5" ref={el => { if (el) el.scrollTop = el.scrollHeight }}>
              {chatHistory.map((msg, i) => (
                <div key={i} className={`flex gap-2 ${msg.role === 'user' ? 'justify-end' : 'justify-start'}`}>
                  {msg.role === 'agent' && (
                    <AgentAvatar avatar={agent.avatar} size="sm" className="shrink-0 mt-0.5" />
                  )}
                  <div className={`max-w-[80%] rounded-xl px-3 py-2 text-sm leading-relaxed ${
                    msg.role === 'user'
                      ? 'bg-ive-green/15 text-ive-green-pale'
                      : 'bg-ive-bg-card text-ive-text border border-ive-border-subtle'
                  }`}>
                    {msg.role === 'agent' ? (
                      <ReactMarkdown
                        components={{
                          h1: ({ children }) => <h1 className="text-base font-bold text-ive-text mt-2 mb-1">{children}</h1>,
                          h2: ({ children }) => <h2 className="text-sm font-bold text-ive-text mt-2 mb-1">{children}</h2>,
                          h3: ({ children }) => <h3 className="text-sm font-bold text-ive-text mt-1.5 mb-0.5">{children}</h3>,
                          p: ({ children }) => <p className="mb-1.5 last:mb-0">{children}</p>,
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
                            return <code className="bg-ive-bg-deep px-1 py-0.5 rounded text-xs font-mono text-ive-cyan">{children}</code>
                          },
                          pre: ({ children }) => <pre className="mb-1.5">{children}</pre>,
                          blockquote: ({ children }) => <blockquote className="border-l-2 border-ive-border pl-2.5 my-1.5 text-ive-text-dim">{children}</blockquote>,
                          a: ({ href, children }) => <a href={href} target="_blank" rel="noopener noreferrer" className="text-ive-cyan hover:underline">{children}</a>,
                          hr: () => <hr className="border-ive-border-dark my-2" />,
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
                  <div className="bg-ive-bg-card text-ive-text-dim border border-ive-border-subtle rounded-xl px-3 py-2 text-sm">
                    <i className="fa-solid fa-ellipsis fa-beat-fade" /> 생각 중...
                  </div>
                </div>
              )}
            </div>
            <div className="border-t border-ive-border-dark p-2 flex gap-2">
              <input
                type="text"
                value={chatInput}
                onChange={e => setChatInput(e.target.value)}
                onKeyDown={e => e.key === 'Enter' && handleInterview()}
                placeholder="질문을 입력하세요..."
                className="flex-1 bg-ive-bg-input border border-ive-border rounded-lg px-3 py-1.5 text-sm text-ive-text placeholder:text-ive-text-dim focus:outline-none focus:border-ive-green"
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
              <i className="fa-solid fa-gear fa-spin mr-1" />진행 중 ({runningExecs.length})
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
              <i className="fa-solid fa-circle-check mr-1" />금일 완료 ({todayDoneExecs.length})
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
              <i className="fa-solid fa-circle-xmark mr-1" />금일 실패 ({todayFailedExecs.length})
            </span>
          </div>
          <div className="max-h-[50vh] overflow-y-auto" data-scroll-container>
            <ExecutionList executions={todayFailedExecs} showAgent={false} onKill={handleKill} killing={killing} scrollKey={`ac-failed-${agent.id}`} />
          </div>
        </div>
      )}

      {/* 통계 패널 */}
      {expandedPanel === 'stats' && stats && (
        <div className="border-t border-ive-cyan/20">
          <div className="px-3 py-2 bg-ive-bg-deep/50 border-b border-ive-border-dark">
            <span className="text-xs font-bold text-ive-cyan uppercase tracking-widest">
              <i className="fa-solid fa-chart-bar mr-1" />성과 통계 (최근 20건 기준)
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

export { cliConfig, statusConfig }
