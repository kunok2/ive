'use client'

import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { Project, Agent, TaskExecution, StatSnapshot } from '@/types'
import { useEffect, useState, useCallback } from 'react'
import { useStore } from '@/lib/store'
import { formatDateShort, formatDateMedium } from '@/lib/format-date'
import { getKSTTodayStartISO } from '@/lib/date-utils'
import Sparkline from '@/components/ui/Sparkline'
import ExecutionList from '@/components/execution/ExecutionList'
import LiveTracePanel from '@/components/execution/LiveTracePanel'
import AgentAvatar from '@/components/agent/AgentAvatar'
import MarqueeText from '@/components/ui/MarqueeText'
import ConflictResolutionPanel from '@/components/mr/ConflictResolutionPanel'
import type { ToolActivity } from '@/lib/tool-activity'
import { useTranslations } from 'next-intl'
import { useTab } from '@/lib/tab-context'

function formatDuration(startedAt: string): string {
  const s = Math.floor((Date.now() - new Date(startedAt).getTime()) / 1000)
  if (s < 60) return `${s}s`
  if (s < 3600) return `${Math.floor(s / 60)}m ${s % 60}s`
  return `${Math.floor(s / 3600)}h ${Math.floor((s % 3600) / 60)}m`
}


interface Props {
  project: Project & { shareRole?: string | null; chatActive?: boolean; chatProcessing?: boolean }
}

interface ProjectStats {
  agentWorking: number
  verifying: number
  confirming: number
  completed: number
  failed: number
  waiting: number
  verifyWaiting: number
  confirmWaiting: number
  conflictCount: number
  totalTokens: number
  totalCost: number
  yesterdayCompleted: number
  tasksPerHour: number
}

export default function ProjectCard({ project }: Props) {
  const isOwner = !project.shareRole
  const canEdit = isOwner || project.shareRole === 'editor'
  const router = useRouter()
  const { updateProject, state } = useStore()
  const userLocale = state.user?.locale
  const userTz = state.user?.timezone
  const { navigateToAddIssue } = useTab()
  const tp = useTranslations('project')
  const [expandedPanel, _setExpandedPanel] = useState<'running' | 'done' | 'waiting' | 'verifying' | 'confirming' | 'conflicts' | null>(() => {
    if (typeof window === 'undefined') return null
    const saved = sessionStorage.getItem(`pc-panel-${project.id}`)
    return (saved === 'running' || saved === 'done' || saved === 'waiting' || saved === 'verifying' || saved === 'confirming' || saved === 'conflicts') ? saved as any : null
  })
  const setExpandedPanel = (v: 'running' | 'done' | 'waiting' | 'verifying' | 'confirming' | 'conflicts' | null) => {
    if (v) sessionStorage.removeItem(`pc-panel-count-${project.id}-${v}`)
    _setExpandedPanel(v)
    if (v) sessionStorage.setItem(`pc-panel-${project.id}`, v)
    else sessionStorage.removeItem(`pc-panel-${project.id}`)
  }
  const [stats, setStats] = useState<ProjectStats | null>(null)
  const [snapshots, setSnapshots] = useState<StatSnapshot[]>([])
  const [executions, setExecutions] = useState<TaskExecution[]>([])
  const [killing, setKilling] = useState<string | null>(null)
  const [waitingIssues, setWaitingIssues] = useState<any[]>([])
  const [verifyingIssues, setVerifyingIssues] = useState<any[]>([])
  const [confirmingIssues, setConfirmingIssues] = useState<any[]>([])
  const [activities, setActivities] = useState<Record<string, ToolActivity>>({})
  const [liveMRCount, setLiveMRCount] = useState<number | null>(null)
  const [liveConflictCount, setLiveConflictCount] = useState<number | null>(null)
  const [tick, setTick] = useState(0)

  const fetchStats = useCallback(async () => {
    try {
      const [statsRes, snapRes] = await Promise.all([
        fetch(`/api/projects/${project.id}/stats`),
        fetch(`/api/projects/${project.id}/snapshots?mode=daily_avg`),
      ])
      if (statsRes.ok) setStats(await statsRes.json())
      if (snapRes.ok) setSnapshots(await snapRes.json())
    } catch { /* ignore */ }
  }, [project.id])

  useEffect(() => {
    fetchStats()
    const totalActive = (stats?.agentWorking ?? 0) + (stats?.verifying ?? 0) + (stats?.confirming ?? 0)
    const interval = totalActive > 0 ? 3000 : 10000
    const timer = setInterval(fetchStats, interval)
    const onVisible = () => { if (document.visibilityState === 'visible') fetchStats() }
    document.addEventListener('visibilitychange', onVisible)
    return () => { clearInterval(timer); document.removeEventListener('visibilitychange', onVisible) }
  }, [fetchStats, stats?.agentWorking, stats?.verifying, stats?.confirming])

  // 경과 시간 실시간 업데이트 (진행 중 작업 요약에 표시)
  useEffect(() => {
    const totalActive = (stats?.agentWorking ?? 0) + (stats?.verifying ?? 0) + (stats?.confirming ?? 0)
    if (totalActive > 0 && !expandedPanel) {
      const timer = setInterval(() => setTick(t => t + 1), 1000)
      return () => clearInterval(timer)
    }
  }, [stats?.agentWorking, stats?.verifying, stats?.confirming, expandedPanel])

  // 실행 목록 로드: 패널 열렸을 때 또는 진행 중 건이 있을 때
  useEffect(() => {
    const needForPanel = expandedPanel === 'running' || expandedPanel === 'done' || expandedPanel === 'verifying' || expandedPanel === 'confirming'
    const totalActive = (stats?.agentWorking ?? 0) + (stats?.verifying ?? 0) + (stats?.confirming ?? 0)
    const needForSummary = totalActive > 0 && !expandedPanel
    if (!needForPanel && !needForSummary) {
      setExecutions([])
      return
    }
    const fetchExecs = async () => {
      try {
        const res = await fetch(`/api/projects/${project.id}/executions`)
        if (res.ok) setExecutions(await res.json())
      } catch { /* ignore */ }
    }
    fetchExecs()
    const timer = setInterval(fetchExecs, 5000)
    return () => clearInterval(timer)
  }, [expandedPanel, project.id, stats?.agentWorking, stats?.verifying, stats?.confirming])

  // 대기 패널 열릴 때 대기 이슈 목록 로드
  useEffect(() => {
    if (expandedPanel !== 'waiting') return
    const fetchWaiting = async () => {
      try {
        const res = await fetch(`/api/projects/${project.id}/issues`)
        if (res.ok) {
          const all = await res.json()
          setWaitingIssues(all.filter((i: any) => i.stage === 'waiting' || i.stage === 'verify_waiting' || i.stage === 'confirm_waiting'))
        }
      } catch { /* ignore */ }
    }
    fetchWaiting()
    const timer = setInterval(fetchWaiting, 10000)
    return () => clearInterval(timer)
  }, [expandedPanel, project.id])

  // 검증/확인 이슈 목록 로드 — 라벨 기반(task_execution 없어도 표시).
  // 패널이 열렸거나, 카드 닫힌 상태에서 인라인 요약에 라벨 기반 행을 표시하기 위해
  // 통계 카운트 > 0 이면 백그라운드로도 폴링.
  useEffect(() => {
    const vCount = stats?.verifying ?? 0
    const cCount = stats?.confirming ?? 0
    const needForVerify = expandedPanel === 'verifying' || (vCount > 0 && !expandedPanel)
    const needForConfirm = expandedPanel === 'confirming' || (cCount > 0 && !expandedPanel)
    if (!needForVerify && !needForConfirm) {
      setVerifyingIssues([])
      setConfirmingIssues([])
      return
    }
    const fetchIssues = async () => {
      try {
        const res = await fetch(`/api/projects/${project.id}/issues`)
        if (res.ok) {
          const all = await res.json()
          if (needForVerify) setVerifyingIssues(all.filter((i: any) => i.stage === 'verifying'))
          if (needForConfirm) setConfirmingIssues(all.filter((i: any) => i.stage === 'confirming'))
        }
      } catch { /* ignore */ }
    }
    fetchIssues()
    const timer = setInterval(fetchIssues, 10000)
    return () => clearInterval(timer)
  }, [expandedPanel, project.id, stats?.verifying, stats?.confirming])

  const toggleScanner = async (e: React.MouseEvent) => {
    e.preventDefault(); e.stopPropagation()
    // 재개 시 즉시 스캔은 서버(PUT)가 트리거한다
    await updateProject({ ...project, accessToken: '', scannerActive: !project.scannerActive })
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

  const runningExecs = executions.filter(e => e.status === 'running' || e.status === 'assigned')
  // 검증·확인 단계 작업자(에이전트)의 실행 — 처리가 아니라 그 단계로 보인다
  const stageKindOf = (id: string): 'verify' | 'confirm' | null =>
    id.startsWith('ex-verify-') ? 'verify' : id.startsWith('ex-confirm-') ? 'confirm' : null
  // 에이전트 실행 → 실시간 화면(LiveTracePanel) 탭. 처리·검증·확인 패널이 같은 화면을 쓴다.
  // #272: 프로젝트 배정 폐기 → 현재 실행 중인 에이전트만 탭으로 표시.
  // execution row에 inline JOIN된 agent_name/agent_avatar 사용 (다른 사용자 풀의 에이전트도 표시 가능).
  const toAgentTabs = (execs: typeof runningExecs) => execs.map(ex => ({
    agent: {
      id: ex.agentId,
      userId: '',
      name: ex.agentName ?? '',
      avatar: ex.agentAvatar ?? 'av-01',
      cliName: 'claude' as const,
      cliPath: '',
      cliVersion: '',
      modelName: ex.modelName ?? '',
      maxTurns: 0,
      status: 'busy' as const,
      snapshotInterval: 1,
      sparklinePoints: 60,
      statsRetention: 7,
      enabled: true,
      createdAt: '',
    } satisfies Agent,
    execution: ex,
  }))
  // 검증·확인 단계를 지금 에이전트가 돌리고 있는 실행
  const liveStageExecs = (kind: 'verify' | 'confirm') => runningExecs.filter(e => e.assigneeType !== 'user' && stageKindOf(e.id) === kind)
  const liveAgentCount = runningExecs.filter(e => e.assigneeType !== 'user').length
  const doneExecs = executions.filter(e => e.status !== 'running' && e.status !== 'assigned')
  const todayStartISO = getKSTTodayStartISO()
  // agent_id가 비어있으면(=null/'') 외부 도구 execution. mapExecution에서 NULL→''로 정규화하긴 하지만
  // 호출 경로가 여럿이라 방어적으로 둘 다 처리.
  const todayDoneExecs = doneExecs.filter(e => e.startedAt >= todayStartISO && (e.verifiedAt != null || e.rejectedAt != null || !e.agentId))

  // 라이브 값(/api/.../conflicts)이 단일 진실. stats.conflictCount는
  // 'merge 단계 이슈 수'라는 다른 지표라 fallback으로 쓰면 카운트가 어긋남(0 MR인데
  // conflict>0 같은 모순 표시). 로드 전에는 null로 두고 화면에서 placeholder 처리.
  const mergeCount = liveMRCount
  const conflictCount = liveConflictCount ?? 0
  const agentWorkingCount = stats?.agentWorking ?? 0
  const verifyingCount = stats?.verifying ?? 0
  const confirmingCount = stats?.confirming ?? 0
  const completedCount = stats?.completed ?? 0
  const failedCount = stats?.failed ?? 0
  const totalDone = completedCount + failedCount
  const yesterdayDiff = stats ? totalDone - stats.yesterdayCompleted : 0

  // 펼친 패널의 건수가 1건 이상이었다가 0이 되면(작업이 처리되어 비워짐) 패널을 닫는다.
  // 처음부터 0건인 패널을 사용자가 직접 연 경우는 그대로 둔다.
  // 상세 화면에 다녀오면 카드가 다시 마운트되므로 마지막으로 본 건수를 sessionStorage에 둔다.
  const expandedCount: number | null =
    !expandedPanel || expandedPanel === 'done' ? null
    : expandedPanel === 'conflicts' ? mergeCount
    : !stats ? null
    : expandedPanel === 'waiting' ? stats.waiting + (stats.verifyWaiting ?? 0) + (stats.confirmWaiting ?? 0)
    : expandedPanel === 'running' ? agentWorkingCount
    : expandedPanel === 'verifying' ? verifyingCount
    : confirmingCount
  useEffect(() => {
    if (!expandedPanel || expandedCount === null) return
    const key = `pc-panel-count-${project.id}-${expandedPanel}`
    const lastSeen = Number(sessionStorage.getItem(key) ?? '0')
    if (expandedCount === 0 && lastSeen > 0) {
      sessionStorage.removeItem(key)
      setExpandedPanel(null)
    } else {
      sessionStorage.setItem(key, String(expandedCount))
    }
  }, [expandedPanel, expandedCount, project.id])

  // 실시간 충돌(병합) 카운트 — DB 캐시와 별도로 API에서 직접 조회
  useEffect(() => {
    const fetchConflictCount = async () => {
      try {
        const res = await fetch(`/api/projects/${project.id}/conflicts`)
        if (res.ok) {
          const data = await res.json()
          setLiveMRCount(data.totalOpenMRs ?? 0)
          setLiveConflictCount(data.conflictCount ?? 0)
        }
      } catch { /* ignore */ }
    }
    fetchConflictCount()
    const timer = setInterval(fetchConflictCount, 60000)
    return () => clearInterval(timer)
  }, [project.id])

  // activities 폴링 (AI 에이전트 작업 중일 때만 — 처리·검증·확인 모두)
  useEffect(() => {
    if (liveAgentCount === 0) return
    const fetchActivities = async () => {
      try {
        const res = await fetch('/api/activities')
        if (res.ok) {
          const list: ToolActivity[] = await res.json()
          const map: Record<string, ToolActivity> = {}
          for (const a of list) map[a.agentId] = a
          setActivities(map)
        }
      } catch { /* ignore */ }
    }
    fetchActivities()
    const timer = setInterval(fetchActivities, 2000)
    return () => clearInterval(timer)
  }, [liveAgentCount])

  return (
    <div
      className={`bg-ive-bg-card rounded-lg border overflow-hidden transition-colors duration-200 flex flex-col ${expandedPanel ? 'border-ive-cyan/30 h-[calc(100vh-160px)]' : 'border-ive-border-subtle hover:border-ive-green/30'}`}
      style={{ background: `linear-gradient(135deg, ${project.color || '#4ade80'}08 0%, transparent 40%), var(--color-ive-bg-card, #121e14)` }}
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
                <span className="shrink-0 text-xs font-bold px-1.5 py-0.5 rounded-lg leading-none flex items-center gap-0.5 bg-white/5 text-ive-text-muted border border-ive-border-subtle">
                  <i className="fa-solid fa-share-nodes" />
                  {project.shareRole === 'editor' ? tp('shareEditor') : tp('shareViewer')}
                </span>
              )}
              {project.chatActive && (
                <span className={`shrink-0 text-xs font-bold px-1.5 py-0.5 rounded-lg leading-none flex items-center gap-0.5 bg-ive-cyan/15 text-ive-cyan ${project.chatProcessing ? 'animate-pulse' : ''}`}>
                  {project.chatProcessing
                    ? <><i className="fa-solid fa-circle-notch fa-spin" />{tp('chatBadgeThinking')}</>
                    : <><i className="fa-solid fa-comments" />{tp('chatBadgeActive')}</>}
                </span>
              )}
            </div>
            <span className="text-sm text-ive-text-muted font-mono opacity-60 mb-1 break-all leading-tight inline-block">
              {project.repoUrl}<i onClick={e => { e.preventDefault(); e.stopPropagation(); window.open(project.repoUrl.replace(/\.git$/, ''), '_blank') }} className="fa-solid fa-arrow-up-right-from-square text-xs ml-1 opacity-50 cursor-pointer hover:text-ive-green hover:opacity-100 transition-colors p-1" />
            </span>
            <div className="flex items-center gap-2 mt-1">
              {project.lastCheckedAt && (
                <span className="text-sm text-ive-text-dim font-bold whitespace-nowrap flex items-center gap-1">
                  <i className="fa-solid fa-bolt-lightning opacity-70" />
                  {formatDateShort(project.lastCheckedAt, userLocale, userTz).replace(',', '')}
                </span>
              )}
              {project.testSiteUrl && (
                <button
                  onClick={e => { e.preventDefault(); e.stopPropagation(); window.open(project.testSiteUrl, '_blank') }}
                  className="flex items-center transition-all"
                  title={tp('testSiteOpen')}
                  aria-label={tp('testSiteOpen')}
                >
                  <span className="h-8 px-2.5 rounded-lg flex items-center gap-1 text-xs font-bold bg-ive-bg-deep text-ive-cyan/60 hover:text-ive-cyan hover:bg-ive-cyan/10 border border-ive-border-dark transition-all">
                    <i className="fa-solid fa-globe text-xs" />
                  </span>
                </button>
              )}
              {canEdit && (
                <>
                  <button data-tour="project-scanner-toggle" onClick={toggleScanner} className="flex items-center gap-1 transition-all" title={project.scannerActive ? tp('pauseScanner') : tp('resumeScanner')} aria-label={project.scannerActive ? tp('pauseScanner') : tp('resumeScanner')}>
                    <span className={`h-8 px-2.5 rounded-lg flex items-center gap-1 text-xs font-bold transition-all ${project.scannerActive ? 'bg-ive-bg-deep text-ive-green/60 hover:text-ive-green hover:bg-ive-green/10 border border-ive-border-dark' : 'bg-ive-red/10 text-ive-red border border-ive-red/30 hover:bg-ive-red/20 scale-105'}`}>
                      {project.scannerActive ? <i className="fa-solid fa-pause text-xs" /> : <i className="fa-solid fa-play text-xs ml-px" />}
                    </span>
                  </button>
                  <button
                    onClick={e => { e.preventDefault(); e.stopPropagation(); navigateToAddIssue(project.id) }}
                    className="flex items-center transition-all"
                    title={tp('addIssue')}
                    aria-label={tp('addIssue')}
                  >
                    <span className="h-8 px-2.5 rounded-lg flex items-center gap-1 text-xs font-bold bg-ive-bg-deep text-ive-cyan/60 hover:text-ive-cyan hover:bg-ive-cyan/10 border border-ive-border-dark transition-all">
                      <i className="fa-solid fa-plus text-xs" />
                    </span>
                  </button>
                  <button
                    onClick={e => { e.preventDefault(); e.stopPropagation(); window.location.href = `/projects/${project.id}` }}
                    className="flex items-center transition-all"
                    title={tp('projectSettings')}
                    aria-label={tp('projectSettings')}
                  >
                    <span className="h-8 px-2.5 rounded-lg flex items-center gap-1 text-xs font-bold bg-ive-bg-deep text-ive-text-dim hover:text-ive-text hover:bg-white/[0.05] border border-ive-border-dark transition-all">
                      <i className="fa-solid fa-ellipsis text-xs" />
                    </span>
                  </button>
                </>
              )}
            </div>
          </div>
          {/* 작업 중 애니메이션 아이콘 — 진행 중 건이 있을 때만 표시 */}
          {(agentWorkingCount + verifyingCount + confirmingCount) > 0 && (
            <div className="shrink-0 flex items-center">
              <div className="relative w-10 h-10 flex items-center justify-center">
                <i className="fa-solid fa-gear fa-spin text-xl text-ive-amber" style={{ animationDuration: '2s' }} />
                <span className="absolute -bottom-0.5 -right-0.5 bg-ive-amber text-ive-bg-deep text-xs font-bold rounded-full w-4 h-4 flex items-center justify-center">{agentWorkingCount + verifyingCount + confirmingCount}</span>
              </div>
            </div>
          )}
        </div>

        {project.lastError && (
          <div className="mt-3 mx-0 bg-ive-red/10 border border-ive-red/20 rounded-lg px-3 py-2 text-sm text-ive-red/80">
            <i className="fa-solid fa-triangle-exclamation mr-1.5" />
            <span className="font-bold">{tp('errorLabel')}</span> {project.lastError}
            {project.lastErrorAt && (
              <span className="text-ive-red/50 ml-1.5 text-xs">({formatDateMedium(project.lastErrorAt, userLocale, userTz)})</span>
            )}
          </div>
        )}

      </Link>

      {/* 대시보드 통계 바 */}
      <div data-tour="project-card-stats" className="flex items-stretch border-t border-ive-border-dark">
        {/* 대기 */}
        <button
          onClick={() => setExpandedPanel(expandedPanel === 'waiting' ? null : 'waiting')}
          title={tp('waitingTooltip')}
          className={`flex-1 py-2.5 px-2 flex flex-col items-center gap-0.5 transition-all ${expandedPanel === 'waiting' ? 'bg-ive-cyan/5' : 'hover:bg-white/[0.02]'}`}
        >
          <span className={`text-lg font-bold leading-none ${((stats?.waiting ?? 0) + (stats?.verifyWaiting ?? 0) + (stats?.confirmWaiting ?? 0)) > 0 ? 'text-ive-cyan' : 'text-ive-text-dim'}`}>
            {(stats?.waiting ?? 0) + (stats?.verifyWaiting ?? 0) + (stats?.confirmWaiting ?? 0)}
          </span>
          <Sparkline data={snapshots.map(s => s.waiting)} width={40} height={12} color="cyan" />
          <span className="text-xs text-ive-text-dim font-bold">{tp('waitingLabel')}</span>
        </button>

        {/* 처리 (AI 에이전트) */}
        <button
          onClick={() => setExpandedPanel(expandedPanel === 'running' ? null : 'running')}
          title={tp('workingTooltip')}
          className={`flex-1 py-2.5 px-2 flex flex-col items-center gap-0.5 transition-all ${expandedPanel === 'running' ? 'bg-ive-amber/5' : 'hover:bg-white/[0.02]'}`}
        >
          <div className="flex items-baseline gap-0.5">
            <span className={`text-lg font-bold leading-none ${agentWorkingCount > 0 ? 'text-ive-amber animate-pulse' : 'text-ive-text-dim'}`}>
              {agentWorkingCount}
            </span>
          </div>
          <Sparkline data={snapshots.map(s => s.running)} width={40} height={12} color="amber" />
          <span className="text-xs text-ive-text-dim font-bold">{tp('workingLabel')}</span>
        </button>

        {/* 검증 (사람) — 검증중은 행동/주의 필요 신호이므로 amber */}
        <button
          onClick={() => setExpandedPanel(expandedPanel === 'verifying' ? null : 'verifying')}
          title={tp('verifyingTooltip')}
          className={`flex-1 py-2.5 px-2 flex flex-col items-center gap-0.5 transition-all ${expandedPanel === 'verifying' ? 'bg-ive-amber/5' : 'hover:bg-white/[0.02]'}`}
        >
          <span className={`text-lg font-bold leading-none ${verifyingCount > 0 ? 'text-ive-amber animate-pulse' : 'text-ive-text-dim'}`}>
            {verifyingCount}
          </span>
          <Sparkline data={snapshots.map(s => s.running)} width={40} height={12} color="amber" />
          <span className="text-xs text-ive-text-dim font-bold">{tp('verifyingLabel')}</span>
        </button>

        {/* 확인 (사람) — 검증과 동일한 amber 톤 */}
        <button
          onClick={() => setExpandedPanel(expandedPanel === 'confirming' ? null : 'confirming')}
          title={tp('confirmingTooltip')}
          className={`flex-1 py-2.5 px-2 flex flex-col items-center gap-0.5 transition-all ${expandedPanel === 'confirming' ? 'bg-ive-amber/5' : 'hover:bg-white/[0.02]'}`}
        >
          <span className={`text-lg font-bold leading-none ${confirmingCount > 0 ? 'text-ive-amber animate-pulse' : 'text-ive-text-dim'}`}>
            {confirmingCount}
          </span>
          <Sparkline data={snapshots.map(s => s.running)} width={40} height={12} color="amber" />
          <span className="text-xs text-ive-text-dim font-bold">{tp('confirmingLabel')}</span>
        </button>

        {/* 완료 (금일) */}
        <button
          onClick={() => setExpandedPanel(expandedPanel === 'done' ? null : 'done')}
          title={tp('completedTooltip')}
          className={`flex-1 py-2.5 px-2 flex flex-col items-center gap-0.5 transition-all ${expandedPanel === 'done' ? 'bg-ive-green/5' : 'hover:bg-white/[0.02]'}`}
        >
          <div className="flex items-baseline gap-1">
            <span className={`text-lg font-bold leading-none ${totalDone > 0 ? 'text-ive-green' : 'text-ive-text-dim'}`}>
              {totalDone}
            </span>
            {stats && yesterdayDiff !== 0 && (
              <span className={`text-xs font-bold ${yesterdayDiff > 0 ? 'text-ive-green' : 'text-ive-red'}`}>
                {yesterdayDiff > 0 ? '+' : ''}{yesterdayDiff}
              </span>
            )}
          </div>
          <Sparkline data={snapshots.map(s => s.completed + s.failed)} width={40} height={12} />
          <span className="text-xs text-ive-text-dim font-bold">{tp('completedLabel')}</span>
        </button>

        {/* 취합 */}
        <button
          onClick={() => setExpandedPanel(expandedPanel === 'conflicts' ? null : 'conflicts')}
          title={tp('conflictTooltip')}
          className={`flex-1 py-2.5 px-2 flex flex-col items-center gap-0.5 transition-all ${expandedPanel === 'conflicts' ? 'bg-ive-amber/5' : 'hover:bg-white/[0.02]'}`}
        >
          <span className={`text-lg font-bold leading-none ${mergeCount === null ? 'text-ive-text-dim/40' : conflictCount > 0 ? 'text-ive-red animate-pulse' : mergeCount > 0 ? 'text-ive-amber' : 'text-ive-text-dim'}`}>
            {mergeCount === null ? '–' : mergeCount}
          </span>
          {/* Sparkline(40x12)과 동일 박스로 감싸야 <i> baseline 정렬이 위 숫자와 붙어 보이는 현상 방지 */}
          <div className="flex items-center justify-center" style={{ width: 40, height: 12 }}>
            <i className={`fa-solid fa-code-merge text-[10px] leading-none ${conflictCount > 0 ? 'text-ive-red' : (mergeCount ?? 0) > 0 ? 'text-ive-amber' : 'text-ive-text-dim'}`} />
          </div>
          <span className={`text-xs font-bold ${conflictCount > 0 ? 'text-ive-red' : (mergeCount ?? 0) > 0 ? 'text-ive-amber' : 'text-ive-text-dim'}`}>{tp('conflictLabel')}</span>
        </button>
      </div>

      {/* 진행 중 작업 요약 (패널 펼치지 않았을 때).
          runningExecs(=task_executions 기반) 외에 라벨만 verifying/confirming 인 이슈도 표시.
          GitLab UI 등 외부에서 라벨을 직접 바꾼 경우 exec 가 없어도 한줄 표시되도록 보강. */}
      {(() => {
        if (expandedPanel) return null
        const activeIids = new Set(runningExecs.map(ex => ex.issueIid))
        const labelOnlyVerify = verifyingIssues.filter((i: any) => !activeIids.has(i.iid))
        const labelOnlyConfirm = confirmingIssues.filter((i: any) => !activeIids.has(i.iid))
        if (runningExecs.length === 0 && labelOnlyVerify.length === 0 && labelOnlyConfirm.length === 0) return null

        const renderLabelRow = (issue: any, kind: 'verify' | 'confirm') => {
          const actor = kind === 'verify' ? issue.actualVerifier : issue.actualConfirmer
          const badge = kind === 'verify' ? tp('verifyingBadge') : tp('confirmingBadge')
          const avatarSrc = actor?.avatar
          const isPhotoUrl = typeof avatarSrc === 'string' && (avatarSrc.startsWith('/') || avatarSrc.startsWith('http'))
          return (
            <div
              key={`${kind}-${issue.iid}`}
              onClick={() => router.push(`/issues/${project.id}/${issue.iid}`)}
              className="flex items-center gap-1.5 text-xs cursor-pointer rounded-lg -mx-1 px-1 py-0.5 hover:bg-ive-amber/5 transition-colors"
            >
              {avatarSrc ? (
                isPhotoUrl ? (
                  <img src={avatarSrc} alt="" className="w-7 h-7 rounded-lg object-cover shrink-0 border border-ive-border" />
                ) : (
                  <AgentAvatar avatar={avatarSrc} size="sm" />
                )
              ) : (
                <div className="w-7 h-7 rounded-lg bg-ive-bg-deep border border-ive-border-subtle flex items-center justify-center shrink-0">
                  <i className="fa-solid fa-user text-[10px] text-ive-text-dim" />
                </div>
              )}
              {actor?.name && <span className="font-bold shrink-0 text-ive-amber/70">{actor.name}</span>}
              <MarqueeText className="text-ive-text-muted">
                {`#${issue.iid} `}{issue.title}
              </MarqueeText>
              <span className="shrink-0 text-[10px] font-bold uppercase tracking-wider text-ive-amber/70 ml-auto">
                {badge}
              </span>
            </div>
          )
        }

        return (
          <div className="border-t border-ive-amber/15 px-3 py-1.5 space-y-1">
            {runningExecs.map(ex => {
              const isChat = ex.id.startsWith('exec-chat-')
              const isVerify = ex.assigneeType === 'user'
              // 에이전트 풀이 전역화되어 어느 사용자의 에이전트인지 모르므로
              // execution row에 inline JOIN된 agent_name/agent_avatar를 우선 사용.
              const agentName = isVerify ? null : (ex.agentName ?? null)
              const agentAvatar = isVerify ? null : (ex.agentAvatar ?? 'av-01')
              const activity = ex.agentId ? activities[ex.agentId] : undefined
              const displayName = isVerify ? ex.userName : agentName
              return (
                <div
                  key={ex.id}
                  // LiveTracePanel 의 「전체화면」 버튼과 동일한 이동 (채팅 세션은 이슈 상세로)
                  onClick={() => router.push(isChat ? `/issues/${project.id}/${ex.issueIid}` : `/executions/${ex.id}`)}
                  className="flex items-center gap-1.5 text-xs cursor-pointer rounded-lg -mx-1 px-1 py-0.5 hover:bg-ive-amber/5 transition-colors"
                >
                  {isVerify ? (
                    ex.userAvatar === 'photo' && ex.userId ? (
                      <img src={`/api/auth/avatar/image?id=${ex.userId}`} alt="" className="w-7 h-7 rounded-lg object-cover shrink-0 border border-ive-border" />
                    ) : ex.userAvatar ? (
                      <AgentAvatar avatar={ex.userAvatar} size="sm" />
                    ) : null
                  ) : agentAvatar ? (
                    <AgentAvatar
                      avatar={agentAvatar}
                      size="sm"
                      toolBadge={isChat ? null : (activity?.category ?? null)}
                    />
                  ) : null}
                  {displayName && <span className={`font-bold shrink-0 ${'text-ive-amber/70'}`}>{displayName}</span>}
                  <MarqueeText className="text-ive-text-muted">
                    {isChat ? `💬 #${ex.issueIid} ${tp('chatLabel')}` : `#${ex.issueIid} `}
                    {!isChat && ex.issueTitle && `${ex.issueTitle}`}
                  </MarqueeText>
                  {!isVerify && stageKindOf(ex.id) && (
                    <span className="shrink-0 text-[10px] font-bold uppercase tracking-wider text-ive-amber/70 ml-auto">
                      {tp(stageKindOf(ex.id) === 'verify' ? 'verifyingBadge' : 'confirmingBadge')}
                    </span>
                  )}
                  <span className={`shrink-0 text-xs font-mono font-bold tabular-nums ${!isVerify && stageKindOf(ex.id) ? '' : 'ml-auto'} ${'text-ive-amber/70'}`}>
                    {formatDuration(ex.startedAt)}
                    {tick >= 0 ? '' : ''}
                  </span>
                </div>
              )
            })}
            {labelOnlyVerify.map((i: any) => renderLabelRow(i, 'verify'))}
            {labelOnlyConfirm.map((i: any) => renderLabelRow(i, 'confirm'))}
          </div>
        )
      })()}

      {/* 작업 현황 패널 (AI 에이전트만) — 처리 */}
      {expandedPanel === 'running' && (
        <div className="flex-1 flex flex-col min-h-0">
          <LiveTracePanel
            agents={toAgentTabs(runningExecs.filter(e => e.assigneeType !== 'user' && !stageKindOf(e.id)))}
            projectId={project.id}
            onKill={handleKill}
            onAllCompleted={() => setExpandedPanel(null)}
          />
        </div>
      )}

      {/* 검증 중 패널 — IVE-V 라벨 단계 이슈 목록 (라벨 기반, task_execution 없어도 표시) */}
      {expandedPanel === 'verifying' && (
        <div className="flex-1 flex flex-col min-h-0 border-t border-ive-amber/20">
          {/* 에이전트가 이 단계를 돌리는 중이면 처리 패널과 같은 실시간 화면 */}
          {liveStageExecs('verify').length > 0 && (
            <div className="flex-1 flex flex-col min-h-0">
              <LiveTracePanel
                agents={toAgentTabs(liveStageExecs('verify'))}
                projectId={project.id}
                onKill={handleKill}
              />
            </div>
          )}
          {liveStageExecs('verify').length > 0 && verifyingIssues.every((i: any) => liveStageExecs('verify').some(e => e.issueIid === i.iid)) ? null : verifyingIssues.length === 0 ? (
            <div className="flex-1 flex flex-col items-center justify-center gap-2 text-ive-text-dim text-sm">
              <i className="fa-solid fa-inbox text-2xl" />
              <span>{tp('noVerifying')}</span>
            </div>
          ) : (
            <div className="flex-1 overflow-y-auto space-y-2 p-3">
              {verifyingIssues.map((issue: any) => (
                <div
                  key={issue.iid}
                  onClick={() => router.push(`/issues/${project.id}/${issue.iid}`)}
                  className="bg-ive-bg-card border border-ive-border-subtle rounded-lg p-3 hover:border-ive-amber/40 transition-all cursor-pointer active:scale-[0.98]"
                >
                  <div className="flex items-center gap-2 mb-1">
                    <span className="text-sm font-bold text-ive-text-muted">#{issue.iid}</span>
                    <span className="text-xs font-bold px-1.5 py-0.5 rounded shrink-0 border text-ive-amber bg-ive-amber/10 border-ive-amber/20">
                      {tp('verifyingBadge')}
                    </span>
                  </div>
                  <MarqueeText className="text-sm text-ive-text font-bold">{issue.title}</MarqueeText>
                  <div className="flex items-center gap-3 text-xs text-ive-text-dim mt-1">
                    {issue.author?.name && (
                      <span className="flex items-center gap-1">
                        {issue.author.avatar ? (
                          <AgentAvatar avatar={issue.author.avatar} size="xs" />
                        ) : issue.author.avatarUrl ? (
                          <img src={issue.author.avatarUrl} className="w-4 h-4 rounded-lg object-cover bg-ive-bg-deep" alt="" />
                        ) : (
                          <i className="fa-solid fa-user" />
                        )}
                        {issue.author.name}
                      </span>
                    )}
                    <span>{formatDateShort(issue.createdAt, userLocale, userTz)}</span>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* 확인 중 패널 — IVE-C 라벨 단계 이슈 목록 (검증 패널과 동일 구조) */}
      {expandedPanel === 'confirming' && (
        <div className="flex-1 flex flex-col min-h-0 border-t border-ive-amber/20">
          {/* 에이전트가 이 단계를 돌리는 중이면 처리 패널과 같은 실시간 화면 */}
          {liveStageExecs('confirm').length > 0 && (
            <div className="flex-1 flex flex-col min-h-0">
              <LiveTracePanel
                agents={toAgentTabs(liveStageExecs('confirm'))}
                projectId={project.id}
                onKill={handleKill}
              />
            </div>
          )}
          {liveStageExecs('confirm').length > 0 && confirmingIssues.every((i: any) => liveStageExecs('confirm').some(e => e.issueIid === i.iid)) ? null : confirmingIssues.length === 0 ? (
            <div className="flex-1 flex flex-col items-center justify-center gap-2 text-ive-text-dim text-sm">
              <i className="fa-solid fa-inbox text-2xl" />
              <span>{tp('noConfirming')}</span>
            </div>
          ) : (
            <div className="flex-1 overflow-y-auto space-y-2 p-3">
              {confirmingIssues.map((issue: any) => (
                <div
                  key={issue.iid}
                  onClick={() => router.push(`/issues/${project.id}/${issue.iid}`)}
                  className="bg-ive-bg-card border border-ive-border-subtle rounded-lg p-3 hover:border-ive-amber/40 transition-all cursor-pointer active:scale-[0.98]"
                >
                  <div className="flex items-center gap-2 mb-1">
                    <span className="text-sm font-bold text-ive-text-muted">#{issue.iid}</span>
                    <span className="text-xs font-bold px-1.5 py-0.5 rounded shrink-0 border text-ive-amber bg-ive-amber/10 border-ive-amber/20">
                      {tp('confirmingBadge')}
                    </span>
                  </div>
                  <MarqueeText className="text-sm text-ive-text font-bold">{issue.title}</MarqueeText>
                  <div className="flex items-center gap-3 text-xs text-ive-text-dim mt-1">
                    {issue.author?.name && (
                      <span className="flex items-center gap-1">
                        {issue.author.avatar ? (
                          <AgentAvatar avatar={issue.author.avatar} size="xs" />
                        ) : issue.author.avatarUrl ? (
                          <img src={issue.author.avatarUrl} className="w-4 h-4 rounded-lg object-cover bg-ive-bg-deep" alt="" />
                        ) : (
                          <i className="fa-solid fa-user" />
                        )}
                        {issue.author.name}
                      </span>
                    )}
                    <span>{formatDateShort(issue.createdAt, userLocale, userTz)}</span>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* 대기 이슈 패널 */}
      {expandedPanel === 'waiting' && (
        <div className="flex-1 flex flex-col min-h-0 border-t border-ive-cyan/20">
          {waitingIssues.length > 0 && (
            <div className="px-3 py-2 bg-ive-bg-deep/50 border-b border-ive-border-dark shrink-0">
              <span className="text-xs font-bold text-ive-cyan uppercase tracking-widest">
                <i className="fa-solid fa-clock mr-1" />{tp('waitingIssuesTitle', { count: waitingIssues.length })}
              </span>
            </div>
          )}
          <div className="flex-1 flex flex-col overflow-y-auto">
            {waitingIssues.length === 0 ? (
              <div className="flex-1 flex flex-col items-center justify-center gap-2 text-ive-text-dim text-sm">
                <i className="fa-solid fa-inbox text-2xl" />
                <span>{tp('noWaitingIssues')}</span>
              </div>
            ) : (
              <div className="space-y-2 p-3">
                {waitingIssues.map((issue: any) => (
                  <div
                    key={issue.iid}
                    onClick={() => router.push(`/issues/${project.id}/${issue.iid}`)}
                    className="bg-ive-bg-card border border-ive-border-subtle rounded-lg p-3 hover:border-ive-cyan/40 transition-all cursor-pointer active:scale-[0.98]"
                  >
                    <div className="flex items-center gap-2 mb-1">
                      <span className="text-sm font-bold text-ive-text-muted">#{issue.iid}</span>
                      <span className={`text-xs font-bold px-1.5 py-0.5 rounded shrink-0 border ${
                        issue.stage === 'verify_waiting' || issue.stage === 'confirm_waiting'
                          ? 'text-ive-amber bg-ive-amber/10 border-ive-amber/20'
                          : 'text-ive-cyan/70 bg-ive-cyan/10 border-ive-cyan/20'
                      }`}>
                        {tp(issue.stage === 'verify_waiting' ? 'verifyWaitBadge' : issue.stage === 'confirm_waiting' ? 'confirmWaitBadge' : 'waitingBadge')}
                      </span>
                    </div>
                    <MarqueeText className="text-sm text-ive-text font-bold">{issue.title}</MarqueeText>
                    <div className="flex items-center gap-3 text-xs text-ive-text-dim mt-1">
                      {issue.author?.name && (
                        <span className="flex items-center gap-1">
                          {issue.author.avatar ? (
                            <AgentAvatar avatar={issue.author.avatar} size="xs" />
                          ) : issue.author.avatarUrl ? (
                            <img src={issue.author.avatarUrl} className="w-4 h-4 rounded-lg object-cover bg-ive-bg-deep" alt="" />
                          ) : (
                            <i className="fa-solid fa-user" />
                          )}
                          {issue.author.name}
                        </span>
                      )}
                      <span>
                        {formatDateShort(issue.createdAt, userLocale, userTz)}
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
          {todayDoneExecs.length > 0 && (
            <div className="px-3 py-2 bg-ive-bg-deep/50 border-b border-ive-border-dark shrink-0">
              <span className="text-xs font-bold text-ive-green uppercase tracking-widest">
                <i className="fa-solid fa-clock-rotate-left mr-1" />{tp('todayRecords', { count: todayDoneExecs.length })}
              </span>
            </div>
          )}
          <div className="flex-1 flex flex-col overflow-y-auto" data-scroll-container>
            <ExecutionList executions={todayDoneExecs} onKill={handleKill} killing={killing} scrollKey={`pc-done-${project.id}`} />
          </div>
        </div>
      )}

      {/* 취합 관리 패널 */}
      {expandedPanel === 'conflicts' && (
        <ConflictResolutionPanel
          projectId={project.id}
          projectColor={project.color || '#4ade80'}
          onClose={() => setExpandedPanel(null)}
        />
      )}
    </div>
  )
}
