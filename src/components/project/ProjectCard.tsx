'use client'

import Link from 'next/link'
import { Project, ProjectAssignment, Agent, TaskExecution, StatSnapshot } from '@/types'
import { useEffect, useState, useCallback } from 'react'
import { useStore } from '@/lib/store'
import { useDialog } from '@/components/ui/ConfirmDialog'
import Sparkline from '@/components/ui/Sparkline'
import ExecutionList from '@/components/execution/ExecutionList'
import LiveTracePanel from '@/components/execution/LiveTracePanel'

function formatTokens(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}K`
  return String(n)
}

interface Props {
  project: Project & { assignedAgents?: (ProjectAssignment & { agent: Agent })[]; shareRole?: string | null }
}

interface ProjectStats {
  running: number
  completed: number
  failed: number
  waiting: number
  totalTokens: number
  totalCost: number
  yesterdayCompleted: number
  tasksPerHour: number
}

export default function ProjectCard({ project }: Props) {
  const agentCount = project.assignedAgents?.length ?? 0
  const isOwner = !project.shareRole
  const { updateProject, scanProjectNow } = useStore()
  const { alert: showAlert } = useDialog()
  const [scanning, setScanning] = useState(false)
  const [expandedPanel, _setExpandedPanel] = useState<'running' | 'done' | 'waiting' | null>(() => {
    if (typeof window === 'undefined') return null
    const saved = sessionStorage.getItem(`pc-panel-${project.id}`)
    return (saved === 'running' || saved === 'done' || saved === 'waiting') ? saved as any : null
  })
  const setExpandedPanel = (v: 'running' | 'done' | 'waiting' | null) => {
    _setExpandedPanel(v)
    if (v) sessionStorage.setItem(`pc-panel-${project.id}`, v)
    else sessionStorage.removeItem(`pc-panel-${project.id}`)
  }
  const [stats, setStats] = useState<ProjectStats | null>(null)
  const [snapshots, setSnapshots] = useState<StatSnapshot[]>([])
  const [executions, setExecutions] = useState<TaskExecution[]>([])
  const [killing, setKilling] = useState<string | null>(null)
  const [waitingIssues, setWaitingIssues] = useState<any[]>([])

  const fetchStats = useCallback(async () => {
    try {
      const [statsRes, snapRes] = await Promise.all([
        fetch(`/api/projects/${project.id}/stats`),
        fetch(`/api/projects/${project.id}/snapshots`),
      ])
      if (statsRes.ok) setStats(await statsRes.json())
      if (snapRes.ok) setSnapshots(await snapRes.json())
    } catch { /* ignore */ }
  }, [project.id])

  useEffect(() => {
    fetchStats()
    const interval = (stats?.running ?? 0) > 0 ? 3000 : 10000
    const timer = setInterval(fetchStats, interval)
    const onVisible = () => { if (document.visibilityState === 'visible') fetchStats() }
    document.addEventListener('visibilitychange', onVisible)
    return () => { clearInterval(timer); document.removeEventListener('visibilitychange', onVisible) }
  }, [fetchStats, stats?.running])

  // 패널 열릴 때 실행 목록 로드
  useEffect(() => {
    if (!expandedPanel || expandedPanel === 'waiting') return
    const fetchExecs = async () => {
      try {
        const res = await fetch(`/api/projects/${project.id}/executions`)
        if (res.ok) setExecutions(await res.json())
      } catch { /* ignore */ }
    }
    fetchExecs()
    const timer = setInterval(fetchExecs, 5000)
    return () => clearInterval(timer)
  }, [expandedPanel, project.id])

  // 대기 패널 열릴 때 대기 이슈 목록 로드
  useEffect(() => {
    if (expandedPanel !== 'waiting') return
    const fetchWaiting = async () => {
      try {
        const res = await fetch(`/api/projects/${project.id}/issues`)
        if (res.ok) {
          const all = await res.json()
          setWaitingIssues(all.filter((i: any) => i.stage === 'waiting'))
        }
      } catch { /* ignore */ }
    }
    fetchWaiting()
    const timer = setInterval(fetchWaiting, 10000)
    return () => clearInterval(timer)
  }, [expandedPanel, project.id])

  const toggleScanner = async (e: React.MouseEvent) => {
    e.preventDefault(); e.stopPropagation()
    await updateProject({ ...project, scannerActive: !project.scannerActive, lastCheckedAt: !project.scannerActive ? new Date().toISOString() : project.lastCheckedAt })
  }

  const handleManualScan = async (e: React.MouseEvent) => {
    e.preventDefault(); e.stopPropagation()
    if (scanning) return
    setScanning(true)
    try { await scanProjectNow(project.id) }
    catch (err) { showAlert({ message: err instanceof Error ? err.message : '스캔 실행 중 오류가 발생했습니다.', variant: 'error' }) }
    finally { setScanning(false) }
  }

  const handleKill = async (id: string) => {
    setKilling(id)
    try {
      await fetch(`/api/executions/${id}/kill`, { method: 'POST' })
      const res = await fetch(`/api/projects/${project.id}/executions`)
      if (res.ok) setExecutions(await res.json())
      fetchStats()
    } finally { setKilling(null) }
  }

  const runningExecs = executions.filter(e => e.status === 'running')
  const doneExecs = executions.filter(e => e.status !== 'running')
  const todayStr = new Date().toISOString().slice(0, 10)
  const todayDoneExecs = doneExecs.filter(e => e.startedAt >= todayStr)

  const runningCount = stats?.running ?? 0
  const completedCount = stats?.completed ?? 0
  const failedCount = stats?.failed ?? 0
  const totalDone = completedCount + failedCount
  const yesterdayDiff = stats ? totalDone - stats.yesterdayCompleted : 0

  return (
    <div
      className={`bg-ive-bg-card rounded-xl border shadow-sm overflow-hidden transition-colors duration-200 flex flex-col ${expandedPanel ? 'border-ive-cyan/30 h-[calc(100vh-160px)]' : 'border-ive-border-subtle hover:border-ive-green/30'}`}
      style={{ borderLeftWidth: '3px', borderLeftColor: project.color || '#4ade80' }}
    >
      <Link href={`/projects/${project.id}`} className="block p-4 active:bg-white/[0.03] transition-colors group">
        <div className="flex items-start gap-3">
          {project.avatarUrl ? (
            <img src={project.avatarUrl} alt="" className="w-10 h-10 rounded-lg object-cover border border-ive-border-subtle shrink-0 mt-0.5" style={{ borderColor: `${project.color || '#4ade80'}40` }} />
          ) : (
            <div className="w-10 h-10 rounded-lg bg-ive-bg-deep border border-ive-border-subtle flex items-center justify-center shrink-0 mt-0.5" style={{ borderColor: `${project.color || '#4ade80'}40` }}>
              <i className={`fa-brands ${project.provider === 'github' ? 'fa-github' : 'fa-gitlab'} text-xl`} style={{ color: project.color || '#4ade80' }} />
            </div>
          )}
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-1.5 mb-1">
              <span className="font-bold text-base truncate leading-none" style={{ color: project.color || '#4ade80' }}>{project.name}</span>
              {project.shareRole && (
                <span className={`shrink-0 text-[10px] font-black px-1.5 py-0.5 rounded-full leading-none flex items-center gap-0.5 ${project.shareRole === 'editor' ? 'bg-ive-amber/15 text-ive-amber border border-ive-amber/30' : 'bg-ive-cyan/15 text-ive-cyan border border-ive-cyan/30'}`}>
                  <i className="fa-solid fa-share-nodes" />
                  {project.shareRole === 'editor' ? '참조·편집' : '참조·뷰어'}
                </span>
              )}
            </div>
            <span className="text-sm text-ive-text-muted font-mono opacity-60 mb-1 break-all leading-tight inline-block">
              {project.repoUrl}<i onClick={e => { e.preventDefault(); e.stopPropagation(); window.open(project.repoUrl.replace(/\.git$/, ''), '_blank') }} className="fa-solid fa-arrow-up-right-from-square text-xs ml-1 opacity-50 cursor-pointer hover:text-ive-green hover:opacity-100 transition-colors p-1" />
            </span>
            <div className="flex items-center gap-2 mt-1">
              {project.lastCheckedAt && (
                <span className="text-sm text-ive-green/50 font-medium whitespace-nowrap flex items-center gap-1">
                  <i className="fa-solid fa-bolt-lightning opacity-70" />
                  {new Date(project.lastCheckedAt).toLocaleString([], { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hour12: false }).replace(',', '')}
                </span>
              )}
              {isOwner && (
                <>
                  <button onClick={toggleScanner} className="flex items-center gap-1 transition-all" title={project.scannerActive ? '일시정지' : '다시 시작'}>
                    <span className={`h-6 px-2 rounded-full flex items-center gap-1 text-xs font-bold transition-all ${project.scannerActive ? 'bg-ive-bg-deep text-ive-green/60 hover:text-ive-green hover:bg-ive-green/10 border border-ive-border-dark' : 'bg-ive-red/10 text-ive-red border border-ive-red/30 hover:bg-ive-red/20 scale-105'}`}>
                      {project.scannerActive ? <i className="fa-solid fa-pause text-[10px]" /> : <i className="fa-solid fa-play text-[10px] ml-px" />}
                    </span>
                  </button>
                  <button onClick={handleManualScan} disabled={scanning} className="flex items-center gap-1 transition-all disabled:opacity-30 disabled:cursor-not-allowed" title="지금 스캔 수행">
                    <span className={`h-6 px-2 rounded-full flex items-center gap-1 text-xs font-bold transition-all ${scanning ? 'bg-ive-green/20 text-ive-green border border-ive-green/30' : 'bg-ive-bg-deep text-ive-green/60 hover:text-ive-green hover:bg-ive-green/10 border border-ive-border-dark'}`}>
                      {scanning ? <i className="fa-solid fa-circle-notch fa-spin text-[10px]" /> : <i className="fa-solid fa-rocket text-[10px]" />}
                    </span>
                  </button>
                  <button
                    onClick={e => { e.preventDefault(); e.stopPropagation(); window.location.href = `/projects/${project.id}` }}
                    className="flex items-center transition-all"
                    title="편집"
                  >
                    <span className="h-6 px-2 rounded-full flex items-center gap-1 text-xs font-bold bg-ive-bg-deep text-ive-text-dim hover:text-ive-text hover:bg-white/[0.05] border border-ive-border-dark transition-all">
                      <i className="fa-solid fa-ellipsis text-[10px]" />
                    </span>
                  </button>
                </>
              )}
            </div>
          </div>
          {/* 작업 중 애니메이션 아이콘 — runningCount > 0 일 때만 표시 */}
          {runningCount > 0 && (
            <div className="shrink-0 flex items-center">
              <div className="relative w-10 h-10 flex items-center justify-center">
                <i className="fa-solid fa-gear fa-spin text-xl text-ive-amber" style={{ animationDuration: '2s' }} />
                <span className="absolute -bottom-0.5 -right-0.5 bg-ive-amber text-ive-bg-deep text-[9px] font-black rounded-full w-4 h-4 flex items-center justify-center">{runningCount}</span>
              </div>
            </div>
          )}
        </div>

        {project.lastError && (
          <div className="mt-3 mx-0 bg-ive-red/10 border border-ive-red/20 rounded-lg px-3 py-2 text-sm text-ive-red/80">
            <i className="fa-solid fa-triangle-exclamation mr-1.5" />
            <span className="font-bold">오류:</span> {project.lastError}
            {project.lastErrorAt && (
              <span className="text-ive-red/50 ml-1.5 text-xs">({new Date(project.lastErrorAt).toLocaleString('ko-KR', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit', hour12: false })})</span>
            )}
          </div>
        )}
      </Link>

      {/* 대시보드 통계 바 */}
      <div className="flex items-stretch border-t border-ive-border-dark">
        {/* 작업중 */}
        <button
          onClick={() => setExpandedPanel(expandedPanel === 'running' ? null : 'running')}
          className={`flex-1 py-2.5 px-2 flex flex-col items-center gap-0.5 transition-all ${expandedPanel === 'running' ? 'bg-ive-amber/5' : 'hover:bg-white/[0.02]'}`}
        >
          <div className="flex items-baseline gap-0.5">
            <span className={`text-lg font-black leading-none ${runningCount > 0 ? 'text-ive-amber animate-pulse' : 'text-ive-text-dim'}`}>
              {runningCount}/{agentCount}
            </span>
          </div>
          <Sparkline data={snapshots.map(s => s.running)} width={40} height={12} color="amber" />
          <span className="text-xs text-ive-text-dim font-bold">작업중</span>
        </button>

        {/* 대기 */}
        <button
          onClick={() => setExpandedPanel(expandedPanel === 'waiting' ? null : 'waiting')}
          className={`flex-1 py-2.5 px-2 flex flex-col items-center gap-0.5 transition-all ${expandedPanel === 'waiting' ? 'bg-ive-cyan/5' : 'hover:bg-white/[0.02]'}`}
        >
          <span className={`text-lg font-black leading-none ${(stats?.waiting ?? 0) > 0 ? 'text-ive-cyan' : 'text-ive-text-dim'}`}>
            {stats?.waiting ?? 0}
          </span>
          <Sparkline data={snapshots.map(s => s.waiting)} width={40} height={12} color="cyan" />
          <span className="text-xs text-ive-text-dim font-bold">대기</span>
        </button>

        {/* 완료 (금일) */}
        <button
          onClick={() => setExpandedPanel(expandedPanel === 'done' ? null : 'done')}
          className={`flex-1 py-2.5 px-2 flex flex-col items-center gap-0.5 transition-all ${expandedPanel === 'done' ? 'bg-ive-green/5' : 'hover:bg-white/[0.02]'}`}
        >
          <div className="flex items-baseline gap-1">
            <span className={`text-lg font-black leading-none ${totalDone > 0 ? 'text-ive-green' : 'text-ive-text-dim'}`}>
              {totalDone}
            </span>
            {stats && yesterdayDiff !== 0 && (
              <span className={`text-xs font-bold ${yesterdayDiff > 0 ? 'text-ive-green' : 'text-ive-red'}`}>
                {yesterdayDiff > 0 ? '+' : ''}{yesterdayDiff}
              </span>
            )}
          </div>
          <Sparkline data={snapshots.map(s => s.completed + s.failed)} width={40} height={12} />
          <span className="text-xs text-ive-text-dim font-bold">완료</span>
        </button>

        {/* 토큰 */}
        <div className="flex-1 py-2.5 px-2 flex flex-col items-center gap-0.5">
          <span className={`text-lg font-black leading-none ${(stats?.totalTokens ?? 0) > 0 ? 'text-ive-text' : 'text-ive-text-dim'}`}>
            {formatTokens(stats?.totalTokens ?? 0)}
          </span>
          <Sparkline data={snapshots.map(s => s.totalTokens)} width={40} height={12} />
          <span className="text-xs text-ive-text-dim font-bold">토큰</span>
        </div>
      </div>

      {/* 작업 현황 패널 */}
      {expandedPanel === 'running' && (
        <div className="flex-1 flex flex-col min-h-0">
          <LiveTracePanel
            agents={(project.assignedAgents ?? []).map(pa => ({
              agent: pa.agent,
              execution: runningExecs.find(e => e.agentId === pa.agentId) ?? null,
            }))}
            onKill={handleKill}
          />
        </div>
      )}

      {/* 대기 이슈 패널 */}
      {expandedPanel === 'waiting' && (
        <div className="flex-1 flex flex-col min-h-0 border-t border-ive-cyan/20">
          <div className="px-3 py-2 bg-ive-bg-deep/50 border-b border-ive-border-dark shrink-0">
            <span className="text-xs font-bold text-ive-cyan uppercase tracking-widest">
              <i className="fa-solid fa-clock mr-1" />대기 중 이슈 ({waitingIssues.length})
            </span>
          </div>
          <div className="flex-1 overflow-y-auto">
            {waitingIssues.length === 0 ? (
              <div className="text-center py-10 text-ive-text-dim text-sm">
                <i className="fa-solid fa-inbox text-2xl mb-2 block" />
                대기 중인 이슈가 없습니다
              </div>
            ) : (
              <div className="space-y-2 p-3">
                {waitingIssues.map((issue: any) => (
                  <div
                    key={issue.iid}
                    onClick={() => window.open(issue.webUrl, '_blank')}
                    className="bg-ive-bg-card border border-ive-border-subtle rounded-xl p-3 hover:border-ive-cyan/40 transition-all cursor-pointer active:scale-[0.98]"
                  >
                    <div className="flex items-center gap-2 mb-1">
                      <span className="text-sm font-black text-ive-cyan">#{issue.iid}</span>
                      <span className="text-xs font-bold text-ive-cyan/70 bg-ive-cyan/10 border border-ive-cyan/20 px-1.5 py-0.5 rounded shrink-0">
                        대기
                      </span>
                    </div>
                    <div className="text-sm text-ive-text font-semibold truncate">{issue.title}</div>
                    <div className="flex items-center gap-3 text-xs text-ive-text-dim mt-1">
                      {issue.author && (
                        <span><i className="fa-solid fa-user mr-0.5" />{issue.author}</span>
                      )}
                      <span>
                        {new Date(issue.createdAt).toLocaleString('ko-KR', { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hour12: false })}
                      </span>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      )}

      {/* 수행기록 패널 */}
      {expandedPanel === 'done' && (
        <div className="flex-1 flex flex-col min-h-0 border-t border-ive-green/20">
          <div className="px-3 py-2 bg-ive-bg-deep/50 border-b border-ive-border-dark shrink-0">
            <span className="text-xs font-bold text-ive-green uppercase tracking-widest">
              <i className="fa-solid fa-clock-rotate-left mr-1" />금일 수행기록 ({todayDoneExecs.length})
            </span>
          </div>
          <div className="flex-1 overflow-y-auto" data-scroll-container>
            <ExecutionList executions={todayDoneExecs} onKill={handleKill} killing={killing} scrollKey={`pc-done-${project.id}`} />
          </div>
        </div>
      )}
    </div>
  )
}
