'use client'

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { useTranslations } from 'next-intl'
import { useKillExecution } from '@/lib/use-kill-execution'
import type { Project, TaskExecution } from '@/types'
import type { TodayDoneIssue } from '@/lib/db/issues'
import { useTab } from '@/lib/tab-context'
import { execKind, execHref, ageOf, ageText, STAGE_TONE } from '@/lib/active-work'
import WaitPill, { FailPill } from '@/components/project/WaitPill'
import CountBump from '@/components/ui/CountBump'
import AgentAvatar from '@/components/agent/AgentAvatar'
import { PriorityBadge } from '@/components/tabs/issues/Priority'
import IssueBadges, { hasIssueBadges } from '@/components/tabs/issues/IssueBadges'
import type { ToolActivity } from '@/lib/tool-activity'

/** 칸 안 묶음의 성격 — 정렬 순서(실패 → 대기 → 진행 중)대로 바뀌는 자리에 구분선을 긋는다 */
const groupKind = (g: { waiting: boolean; failed: boolean }) => g.failed ? 'fail' : g.waiting ? 'wait' : 'active'

type Col = 'process' | 'verify' | 'confirm' | 'done'
const COLS: Col[] = ['process', 'verify', 'confirm', 'done']
const COL_LABEL: Record<Col, string> = { process: 'boardProcess', verify: 'boardVerify', confirm: 'boardConfirm', done: 'boardDoneToday' }
/** 단계 칸 안의 대기 묶음 — 그 단계에서 아직 아무도 잡지 않은 건. 칸 맨 위에 둔다 */
const WAIT_LABEL: Record<Exclude<Col, 'done'>, string> = { process: 'waitGroupProcess', verify: 'waitGroupVerify', confirm: 'waitGroupConfirm' }

/** /api/projects/[id]/issues 에서 보드가 쓰는 필드 */
interface BoardIssue {
  iid: number
  title: string
  stage: string
  state: string
  createdAt?: string
  updatedAt: string
  /** 지금 단계에 들어온 시각(단계 사건) — 처리 대기·처리 실패가 얼마나 기다렸는지 */
  stageSince?: string | null
  dueDate?: string | null
  priority?: 0 | 1 | 2
  iterationCounts?: { processCount: number; retryTotal: number }
  preferredAgentName?: string | null
  actualVerifier?: { name?: string | null; avatar?: string | null; userId?: string | null } | null
  actualConfirmer?: { name?: string | null; avatar?: string | null; userId?: string | null } | null
}

/** 맡은 사람·에이전트의 아바타 — 카드의 진행 중 목록과 같은 부품(AgentAvatar)으로 그린다 */
interface Face { src: string; userId?: string | null; agentId?: string | null; human: boolean }

/** issue — 배지(우선순위·마감일·처리 N회·되돌리기 N회)의 근거. 열린 이슈 목록에 없는 실행·오늘 완료 건은 없다 */
/** href — 카드를 누르면 가는 작업 상세. traceExecId — 에이전트가 돌리고 있으면 그 실행(트레이스·강제종료 버튼) */
interface BoardItem { key: string; iid: number; title: string; who: string | null; face?: Face | null; startedAt: string | null; href: string; traceExecId?: string; waiting?: boolean; failed?: boolean; issue?: BoardIssue }

/**
 * PC 폭의 프로젝트 단계 보드 — 대기 | 처리 | 검증 | 확인 | 완료(오늘).
 * 어느 칸에 있느냐가 곧 그 일의 종류다. 칸 안에서는 맡은 사람으로 묶고(이름은 한 번), 칸마다 따로 스크롤한다.
 * 데이터는 프로젝트 카드와 같은 API(열린 이슈의 단계 + 실행 기록)를 쓴다.
 */
/** onOpenTrace — 넓은 화면에서 에이전트 실행을 누르면 페이지를 넘기지 않고 오른쪽 칸에 트레이스를 띄운다(ProjectsTab) */
export default function ProjectBoard({ project, onOpenTrace }: { project: Project & { shareRole?: string | null }; onOpenTrace?: (executionId: string) => void }) {
  const tp = useTranslations('project')
  const te = useTranslations('execution')
  const router = useRouter()
  const { navigateToAddIssue } = useTab()
  const [issues, setIssues] = useState<BoardIssue[] | null>(null)
  const [execs, setExecs] = useState<TaskExecution[]>([])
  // 완료(오늘) — 카드 「완료」 숫자와 같은 근거(오늘 완료·반려로 바뀐 이슈)
  const [doneToday, setDoneToday] = useState<TodayDoneIssue[]>([])
  const [lastSyncedAt, setLastSyncedAt] = useState<number | null>(null)
  const [boardSyncError, setBoardSyncError] = useState(false)
  const [executionSyncError, setExecutionSyncError] = useState(false)
  // 경과는 분 단위 — 30초마다 다시 그린다
  const [now, setNow] = useState(() => Date.now())
  // 에이전트 도구 배지 — 카드와 같은 실시간 도구 활동
  const [activities, setActivities] = useState<Record<string, ToolActivity>>({})
  // 강제종료 — 소유자·편집자만(프로젝트 카드와 같은 기준, 서버도 프로젝트 권한을 본다). 끝나면 실행·이슈를 바로 다시 읽는다
  const canEdit = !project.shareRole || project.shareRole === 'editor'
  const [killing, setKilling] = useState<string | null>(null)
  const [reloadTick, setReloadTick] = useState(0)
  const killExecution = useKillExecution()
  const handleKill = async (execId: string) => {
    try {
      if (await killExecution(execId, () => setKilling(execId))) setReloadTick(t => t + 1)
    } finally { setKilling(null) }
  }

  useEffect(() => {
    // 프로젝트가 바뀌면 보드는 key 로 새로 마운트된다(ProjectsTab) — 여기서 비울 필요가 없다
    let alive = true
    const loadBoardData = async () => {
      const [issuesResult, doneResult] = await Promise.allSettled([
        fetch(`/api/projects/${project.id}/issues`).then(r => { if (!r.ok) throw new Error(String(r.status)); return r.json() }),
        fetch(`/api/projects/${project.id}/done-today`).then(r => { if (!r.ok) throw new Error(String(r.status)); return r.json() }),
      ])
      if (!alive) return
      if (issuesResult.status === 'fulfilled') setIssues(Array.isArray(issuesResult.value) ? issuesResult.value : [])
      if (doneResult.status === 'fulfilled') setDoneToday(Array.isArray(doneResult.value) ? doneResult.value : [])
      const failed = issuesResult.status === 'rejected' || doneResult.status === 'rejected'
      setBoardSyncError(failed)
      if (!failed) setLastSyncedAt(Date.now())
    }
    const loadExecs = () => fetch(`/api/projects/${project.id}/executions`)
      .then(r => { if (!r.ok) throw new Error(String(r.status)); return r.json() })
      .then(d => { if (alive) { setExecs(Array.isArray(d) ? d : []); setExecutionSyncError(false) } })
      .catch(() => { if (alive) setExecutionSyncError(true) })
    loadBoardData(); loadExecs()
    const t1 = setInterval(loadBoardData, 10_000)
    const t2 = setInterval(loadExecs, 5_000)
    const t3 = setInterval(() => setNow(Date.now()), 30_000)
    return () => { alive = false; clearInterval(t1); clearInterval(t2); clearInterval(t3) }
  }, [project.id, reloadTick])

  const running = execs.filter(e => e.status === 'running' || e.status === 'assigned')
  // 같은 단계에 사람 배정과 에이전트 실행이 함께 있으면 에이전트 쪽 — 트레이스·강제종료 버튼이 그 실행을 가리켜야 한다
  const execFor = (iid: number, kind: 'process' | 'verify' | 'confirm') => {
    const mine = running.filter(e => e.issueIid === iid && execKind(e.id) === kind)
    return mine.find(e => e.assigneeType !== 'user') ?? mine[0]
  }
  const execWho = (e?: TaskExecution) => e ? (e.assigneeType === 'user' ? (e.userName ?? null) : (e.agentName ?? null)) : null
  const execFace = (e?: TaskExecution): Face | null => !e ? null
    : e.assigneeType === 'user' ? { src: e.userAvatar || 'person', userId: e.userId, human: true }
    : { src: e.agentAvatar || 'av-01', agentId: e.agentId, human: false }
  const actorFace = (a?: { avatar?: string | null; userId?: string | null } | null): Face | null =>
    a ? { src: a.avatar || 'person', userId: a.userId, human: true } : null
  const liveAgents = running.filter(e => e.assigneeType !== 'user').length
  useEffect(() => {
    if (liveAgents === 0) return
    let alive = true
    const load = () => fetch('/api/activities').then(r => r.ok ? r.json() : []).then((list: ToolActivity[]) => {
      if (!alive) return
      const map: Record<string, ToolActivity> = {}
      for (const a of list) map[a.agentId] = a
      setActivities(map)
    }).catch(() => {})
    load()
    const t = setInterval(load, 2000)
    return () => { alive = false; clearInterval(t) }
  }, [liveAgents])
  const issueHref = (iid: number) => `/issues/${project.id}/${iid}`
  // 에이전트가 돌리는 실행이면 트레이스로 갈 실행 id — 사람이 맡은 일·AI 채팅은 트레이스가 없다(execHref 와 같은 규칙)
  const traceOf = (e?: TaskExecution) => e && execHref(e, project.id).startsWith('/executions/') ? e.id : undefined

  const cols: Record<Col, BoardItem[]> = { process: [], verify: [], confirm: [], done: [] }
  for (const i of issues ?? []) {
    const base = { key: `i-${i.iid}`, iid: i.iid, title: i.title, href: issueHref(i.iid), issue: i }
    if (i.stage === 'waiting') {
      // 처리 대기에 들어온 시각(단계 사건) — 카드의 대기 목록과 같은 기준. 사건 기록 이전이면 이슈 작성 시각
      cols.process.push({ ...base, who: tp(WAIT_LABEL.process), startedAt: i.stageSince ?? i.createdAt ?? null, waiting: true })
    } else if (i.stage === 'dev_fail') {
      // 처리 실패 — 실패 뒤 아무도 다시 처리하지 않은 일. 진행 숫자에는 넣지 않고 처리 칸 맨 위 묶음으로 드러낸다
      cols.process.push({ ...base, who: tp('failGroupProcess'), startedAt: i.stageSince ?? null, failed: true })
    } else if (i.stage === 'dev') {
      const e = execFor(i.iid, 'process')
      // 에이전트가 처리 중이면 실시간 실행 화면으로(검증·확인도 같다 — execHref)
      cols.process.push({ ...base, who: execWho(e), face: execFace(e), startedAt: e?.startedAt ?? null, traceExecId: traceOf(e) })
    } else if (i.stage === 'verify_waiting') {
      // 검증·확인 대기도 그 단계에 들어온 시각(단계 사건)부터 — 카드의 대기 묶음과 같은 기준. 사건 기록 전이면 모름(경과 생략)
      cols.verify.push({ ...base, who: tp(WAIT_LABEL.verify), startedAt: i.stageSince ?? null, waiting: true })
    } else if (i.stage === 'verifying') {
      const e = execFor(i.iid, 'verify')
      cols.verify.push({ ...base, who: i.actualVerifier?.name ?? execWho(e), face: i.actualVerifier?.name ? actorFace(i.actualVerifier) : execFace(e), startedAt: e?.startedAt ?? null, traceExecId: traceOf(e) })
    } else if (i.stage === 'confirm_waiting') {
      cols.confirm.push({ ...base, who: tp(WAIT_LABEL.confirm), startedAt: i.stageSince ?? null, waiting: true })
    } else if (i.stage === 'confirming') {
      const e = execFor(i.iid, 'confirm')
      cols.confirm.push({ ...base, who: i.actualConfirmer?.name ?? execWho(e), face: i.actualConfirmer?.name ? actorFace(i.actualConfirmer) : execFace(e), startedAt: e?.startedAt ?? null, traceExecId: traceOf(e) })
    }
  }
  // 이슈 목록(Git 조회)에 없거나 아직 못 받은 진행 중 실행도 그 종류의 칸에 둔다 — 카드의 진행 중 목록과 같은 근거(실행 기록)
  for (const e of running) {
    const kind = execKind(e.id)
    if (kind === 'chat') continue
    const col: Col = kind
    if (cols[col].some(it => it.iid === e.issueIid)) continue
    cols[col].push({
      key: `e-${e.id}`, iid: e.issueIid, title: e.issueTitle ?? '', who: execWho(e), face: execFace(e), startedAt: e.startedAt,
      href: issueHref(e.issueIid), traceExecId: traceOf(e),
    })
  }
  // 완료(오늘) — 카드의 「완료」 숫자와 같은 근거: 오늘 끝낸 완료 사이클(보고서와 같은 판정)과 오늘 반려.
  // 실행 기록으로 세면 어제 시작한 일·사후 등록·최근 실행 목록 밖의 일이 빠진다(60건 처리에 「오늘 완료 1」).
  for (const d of doneToday) {
    cols.done.push({
      key: `d-${d.iid}-${d.at}`, iid: d.iid, title: d.title, who: d.who?.name ?? null,
      face: d.who ? { src: d.who.avatar || 'person', userId: d.who.userId, human: true } : null,
      startedAt: null, href: issueHref(d.iid),
    })
  }

  const color = project.color || '#4ade80'
  const syncError = boardSyncError || executionSyncError
  const syncTime = lastSyncedAt == null ? null : new Date(lastSyncedAt).toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' })
  const syncMessage = syncError
    ? syncTime ? tp('boardSyncFailed', { time: syncTime }) : tp('boardSyncFailedNoTime')
    : lastSyncedAt == null ? tp('boardSyncLoading') : tp('boardSyncAt', { time: syncTime! })

  return (
    <section className="flex-1 min-w-0 flex flex-col gap-4 p-5 overflow-hidden">
      <header className="flex items-center gap-3 shrink-0">
        <div className="w-9 h-9 rounded-lg bg-ive-bg-deep border flex items-center justify-center shrink-0" style={{ borderColor: `${color}66` }}>
          <i className={`fa-brands ${project.provider === 'github' ? 'fa-github' : 'fa-gitlab'} text-lg`} style={{ color }} />
        </div>
        <div className="min-w-0 flex flex-col">
          <h2 className="text-lg font-bold leading-tight truncate" style={{ color }}>{project.name}</h2>
          <span className="text-xs font-bold text-ive-text-dim font-mono truncate">{project.repoUrl.replace(/^https?:\/\//, '').replace(/\.git$/, '')}</span>
        </div>
        <div className="ml-auto flex items-center gap-2 shrink-0">
          <span
            role="status"
            aria-live={syncError ? 'polite' : 'off'}
            className={`inline-flex items-center gap-1.5 text-xs font-bold ${syncError ? 'text-ive-red' : 'text-ive-text-secondary'}`}
            title={syncMessage}
            aria-label={syncMessage}
          >
            <i className={`fa-solid ${syncError ? 'fa-triangle-exclamation' : lastSyncedAt == null ? 'fa-circle-notch fa-spin' : 'fa-rotate'}`} />
            <span className="max-w-[160px] truncate">{syncMessage}</span>
          </span>
          {/* 1440px 아래에서는 완료 칸을 접고 오늘 완료 건수만 보인다 */}
          <span className="wide:hidden text-xs font-bold text-ive-text-secondary mr-1">
            {tp('boardDoneToday')} <span className={cols.done.length ? 'text-ive-cyan' : 'text-ive-text-dim'}><CountBump value={cols.done.length} /></span>
          </span>
          <button onClick={() => navigateToAddIssue(project.id)} className="h-9 px-3 rounded-lg text-sm font-bold bg-ive-bg-card border border-ive-border-subtle text-ive-text hover:border-ive-cyan/40">
            <i className="fa-solid fa-plus mr-1.5 text-xs" />{tp('addIssue')}
          </button>
          <button onClick={() => router.push(`/projects/${project.id}`)} aria-label={tp('boardOpenProject')} title={tp('boardOpenProject')} className="w-9 h-9 rounded-lg bg-ive-bg-card border border-ive-border-subtle text-ive-text-dim hover:text-ive-text">
            <i className="fa-solid fa-ellipsis" />
          </button>
        </div>
      </header>

      <div className="flex-1 min-h-0 grid grid-cols-3 wide:grid-cols-4 items-start content-start gap-3">
        {COLS.map(col => {
          const items = cols[col]
          // 묶음: 그 단계의 대기 묶음이 맨 위, 그다음 맡은 사람(건수 많은 순)
          const groups = [...new Set(items.map(i => i.who ?? ''))]
            .map(who => {
              const mine = items.filter(i => (i.who ?? '') === who)
              return { who, waiting: mine.some(i => i.waiting), failed: mine.some(i => i.failed), face: mine.find(i => i.face)?.face ?? null, items: mine }
            })
            .sort((a, b) => Number(b.failed) - Number(a.failed) || Number(b.waiting) - Number(a.waiting) || b.items.length - a.items.length)
          const waitN = items.filter(i => i.waiting).length
          const failN = items.filter(i => i.failed).length
          const activeN = items.length - waitN - failN
          // 완료는 브랜드색, 사람·에이전트 손에 있는 칸은 진행색(카드 숫자 칸과 같은 규칙)
          const calm = col === 'done'
          return (
            <div key={col} className={`min-h-[180px] max-h-full min-w-0 flex-col rounded-lg bg-ive-bg-card/60 border border-ive-border-subtle ${col === 'done' ? 'hidden wide:flex' : 'flex'}`}>
              <div className={`shrink-0 flex items-center gap-1.5 mx-3 pt-3 pb-2 border-b-2 ${calm ? 'border-ive-cyan' : STAGE_TONE[col as 'process' | 'verify' | 'confirm'].border}`}>
                <span className="text-sm font-bold text-ive-text">{tp(COL_LABEL[col])}</span>
                {/* 진행 중 건수 + 그 단계 대기(←n) — 카드의 단계 칸과 같은 표기 */}
                <span className={`text-xl font-bold leading-none tabular-nums ${!activeN ? 'text-ive-text-dim' : calm ? 'text-ive-cyan' : STAGE_TONE[col as 'process' | 'verify' | 'confirm'].text}`}><CountBump value={activeN} /></span>
                <WaitPill n={waitN} title={tp('stageWaitingHint', { n: waitN })} />
                <FailPill n={failN} />
              </div>
              <div className="flex-1 min-h-0 overflow-y-auto p-2.5 flex flex-col gap-3">
                {issues === null && items.length === 0 && (
                  <div className="flex flex-1 flex-col items-center justify-center gap-2 px-3 py-5 text-center text-xs font-bold text-ive-text-muted">
                    <i className="fa-solid fa-circle-notch fa-spin text-base" />
                    <span>{tp('boardLoading')}</span>
                  </div>
                )}
                {issues !== null && items.length === 0 && (
                  <div className="flex flex-1 flex-col items-center justify-center gap-2 rounded-lg border border-dashed border-ive-border-dark bg-ive-bg/30 px-3 py-5 text-center text-xs font-bold text-ive-text-muted">
                    <i className="fa-regular fa-folder-open text-base text-ive-text-dim" />
                    <span>{tp('boardEmpty')}</span>
                  </div>
                )}
                {groups.map((g, gi) => (
                  // 묶음 성격(실패 · 대기 · 진행 중)이 바뀌는 곳마다 구분선 — 한 목록으로 섞여 읽히지 않게
                  <div key={g.who || '-'} className={`flex flex-col gap-1.5 ${gi > 0 && groupKind(g) !== groupKind(groups[gi - 1]) ? 'pt-3 border-t border-ive-text-dim/40' : ''}`}>
                    {g.who && (
                      <div className={`flex items-center gap-1.5 px-1 text-xs font-bold ${g.failed ? 'text-ive-red' : 'text-ive-text-secondary'}`}>
                        {/* 아바타 — 진행 중이면 카드와 같은 배지(사람: 작업 중, 에이전트: 지금 쓰는 도구). 완료 칸은 배지 없음 */}
                        {g.failed && <i className="fa-solid fa-triangle-exclamation" />}
                        {!g.waiting && !g.failed && g.face && (
                          <AgentAvatar
                            avatar={g.face.src}
                            userId={g.face.userId}
                            size="sm"
                            toolBadge={col === 'done' ? null : g.face.human ? 'human' : (g.face.agentId ? activities[g.face.agentId]?.category ?? null : null)}
                          />
                        )}
                        <span className="truncate">{g.who}</span>
                        <span className="ml-auto shrink-0 text-ive-text-dim tabular-nums">{g.items.length}</span>
                      </div>
                    )}
                    {g.items.map(it => {
                      const age = it.startedAt ? ageOf(it.startedAt, now) : null
                      const badges = !!it.issue && (hasIssueBadges(it.issue) || it.issue.priority === 1 || it.issue.priority === 2)
                      return (
                        // 카드 = 작업 상세. 에이전트가 돌리는 중이면 아래 줄의 「트레이스」로 실행 화면을, 「강제종료」로 중지(카드 안에 버튼이 있어 div 로 둔다)
                        <div
                          key={it.key}
                          role="button"
                          tabIndex={0}
                          onClick={() => router.push(it.href)}
                          onKeyDown={e => { if (e.target === e.currentTarget && (e.key === 'Enter' || e.key === ' ')) { e.preventDefault(); router.push(it.href) } }}
                          className={`cursor-pointer text-left flex flex-col gap-1.5 p-2.5 rounded-lg bg-ive-bg-card border hover:border-ive-cyan/40 transition-colors ${it.failed ? 'border-ive-red/40' : 'border-ive-border-subtle'}`}
                        >
                          {/* 대기 건은 한 단계 낮은 글자색 — 손에 있는(진행 중) 건이 먼저 읽히게. 흐린색(dim)은 정보 글씨에 쓰지 않는다 */}
                          <span className={`text-xs font-bold leading-snug line-clamp-2 ${it.waiting ? 'text-ive-text-secondary' : 'text-ive-text'}`}>
                            <span className="font-bold text-ive-text-secondary">#{it.iid}</span> {it.title}
                          </span>
                          {/* 작업 정보 배지(작업 목록 카드와 같은 부품) 왼쪽 · 경과 오른쪽 */}
                          {(badges || age) && (
                            <span className="flex flex-wrap items-center gap-1">
                              {badges && it.issue && (
                                <>
                                  <PriorityBadge priority={it.issue.priority} />
                                  <IssueBadges issue={it.issue} />
                                </>
                              )}
                              {age && (
                                <span className={`ml-auto text-xs font-bold tabular-nums ${age.aged ? 'px-1.5 py-0.5 rounded-lg bg-ive-red/15 text-ive-red' : 'text-ive-text-secondary'}`}>
                                  {ageText(tp, age)}
                                </span>
                              )}
                            </span>
                          )}
                          {it.traceExecId && (
                            <span className="flex items-center gap-1.5">
                              <button
                                type="button"
                                onClick={e => { e.stopPropagation(); const id = it.traceExecId!; if (onOpenTrace) onOpenTrace(id); else router.push(`/executions/${id}`) }}
                                className="text-xs font-bold px-2 py-1 rounded-lg bg-ive-bg-deep border border-ive-border-dark text-ive-text-secondary hover:text-ive-text transition-colors"
                              >
                                <i className="fa-solid fa-terminal mr-1" />{te('viewTrace')}
                              </button>
                              {canEdit && (
                                <button
                                  type="button"
                                  onClick={e => { e.stopPropagation(); void handleKill(it.traceExecId!) }}
                                  disabled={killing === it.traceExecId}
                                  className="ml-auto text-xs font-bold px-2 py-1 rounded-lg bg-ive-bg-deep border border-ive-red/30 text-ive-red/70 hover:bg-ive-red/10 transition-colors disabled:opacity-40"
                                >
                                  {killing === it.traceExecId ? <i className="fa-solid fa-circle-notch fa-spin" /> : <><i className="fa-solid fa-skull-crossbones mr-1" />{te('forceStop')}</>}
                                </button>
                              )}
                            </span>
                          )}
                        </div>
                      )
                    })}
                  </div>
                ))}
              </div>
            </div>
          )
        })}
      </div>
    </section>
  )
}
