/**
 * 보고서 모델용 DB 조회. 보고서 조회 중에는 Git 을 호출하지 않는다(DB 만).
 * 범위(scope): 사용자 id 면 그 사람이 소유하거나 공유받은 프로젝트, null 이면 전체.
 * { user, projects } 면 그 범위 안에서 고른 프로젝트만(보고서 화면의 프로젝트 필터).
 */
import { getDb, getExecutionsInRange, getGlobalExecutionsInRange, resolveManualAlias, type ReportExecution } from '../db'
import { kstDayStartISO } from './period'
import { AGED_HOURS, DEFAULT_PROJECT_COLOR } from './format'
import type { HeldStage } from './types'

/** 프로젝트 필터 — 사용자 범위(user) 안에서 고른 프로젝트만. 범위 밖 id 는 무시된다 */
export interface FilteredScope { user: string | null; projects: string[] }
export type Scope = string | null | FilteredScope

const userOf = (scope: Scope): string | null => (scope && typeof scope === 'object' ? scope.user : scope)
const projectFilterOf = (scope: Scope): Set<string> | null => (scope && typeof scope === 'object' ? new Set(scope.projects) : null)

/** 확정본 저장 키 — 필터 보기는 고른 프로젝트 조합마다 따로 확정한다(전체 보고서 확정본과 섞이지 않게) */
export function scopeKey(scope: Scope, globalKey: string): string {
  const user = userOf(scope) ?? globalKey
  const filter = projectFilterOf(scope)
  return filter ? `${user}|p:${[...filter].sort().join(',')}` : user
}

/**
 * 이슈의 "처리" 실행만 — 검증·확인 실행, 충돌 검사(iid 0), 채팅, 재현 실행은 뺀다.
 * 완료·유입·처리 기간이 모두 이 기준으로 세어야 서로 맞는다.
 */
const PROCESS_EXEC_SQL = (alias = 'te') => `${alias}.issue_iid > 0
  AND ${alias}.id NOT LIKE 'ex-verify-%' AND ${alias}.id NOT LIKE 'ex-confirm-%'
  AND ${alias}.id NOT LIKE 'ex-conflict-%' AND ${alias}.id NOT LIKE 'exec-chat%' AND ${alias}.id NOT LIKE 'ex-reproduce-%'`

export interface ScopedProject { id: string; name: string; provider: string; color: string }

export function scopedProjects(scope: Scope): ScopedProject[] {
  const filter = projectFilterOf(scope)
  const user = userOf(scope)
  const rows = user
    ? getDb().prepare(`
        SELECT id, name, provider, color FROM projects p
        WHERE p.user_id = ? OR EXISTS (SELECT 1 FROM project_shares ps WHERE ps.project_id = p.id AND ps.user_id = ?)
        ORDER BY name`).all(user, user)
    : getDb().prepare(`SELECT id, name, provider, color FROM projects ORDER BY name`).all()
  return (rows as any[]).filter(r => !filter || filter.has(r.id)).map(r => ({ id: r.id, name: r.name, provider: r.provider, color: r.color || DEFAULT_PROJECT_COLOR }))
}

export function execsInRange(scope: Scope, start: string, end: string): ReportExecution[] {
  const user = userOf(scope)
  const filter = projectFilterOf(scope)
  const rows = user ? getExecutionsInRange(user, start, end) : getGlobalExecutionsInRange(start, end)
  return filter ? rows.filter(e => filter.has(e.projectId)) : rows
}

// ─── 이슈 이력: 접수·재오픈·완료 (사이클 단위) ───

const HELD_STAGE_SQL = `('waiting','dev','dev_fail','verify_waiting','verifying','confirm_waiting','confirming')`
/**
 * 시각을 비교 가능한 ISO(UTC) 문자열로. 옛 행에는 SQLite datetime('now') 형식('YYYY-MM-DD HH:MM:SS', UTC)도 있다.
 * 알아볼 수 없으면 null.
 */
export function isoTime(t: string | null | undefined): string | null {
  if (!t) return null
  const m = t.match(/^(\d{4}-\d\d-\d\d) (\d\d:\d\d:\d\d)$/)
  if (m) return `${m[1]}T${m[2]}.000Z`
  if (!/^\d{4}-\d\d-\d\dT\d\d:\d\d/.test(t)) return null
  // 시간대 표기(+09:00 등)가 섞여 있어도 문자열로 비교할 수 있게 UTC(Z)로 맞춘다
  const ms = Date.parse(t)
  return Number.isFinite(ms) ? new Date(ms).toISOString() : null
}
const maxOf = (xs: (string | null)[]): string | null => xs.filter((t): t is string => !!t).sort().pop() ?? null

/**
 * 한 이슈의 접수·완료 이력. 완료 뒤 다시 열리면(재오픈 사건) 새 사이클이다 — 사이클마다 따로 접수·완료한다.
 * 지난 사이클의 완료는 다시 열려도 사라지지 않는다.
 */
export interface IssueHistory {
  /** 처음 접수 — 스케줄 라벨을 처음 본 시각 · 첫 처리 실행(사후 기록 제외) · 처음 보유 단계로 보인 사건 중 이른 것. 없으면 null(사후 기록만 있는 일) */
  firstReceipt: string | null
  /** 재오픈(완료·닫힘 → 진행) 시각, 오래된 순 — 각각 새 접수다 */
  reopens: string[]
  /** 사이클마다의 완료 시각, 오래된 순 */
  completions: string[]
  /** 처리 실행이 모두 사후 기록(외부 도구)인 일 */
  direct: boolean
}

/** 사후 기록(외부 도구) 실행 — 스캐너의 EXTERNAL_EXEC_WHERE 와 같은 판정(옛 id 형식의 행도 포함) */
export const isExternalRow = (r: { assigneeType: string | null; agentId: string | null; userId: string | null }) =>
  r.assigneeType === 'user' && !r.agentId && !r.userId

interface HistRow { started: string; ended: string | null; status: string; verified: string | null; external: boolean }

/**
 * 프로젝트들의 이슈 이력 전부. 완료 판정(사이클마다):
 *  - 그 사이클의 처리 실행이 성공했거나 검증 승인·확인 완료가 있어야 한다(실패로만 끝난 일은 완료가 아니다).
 *  - 지난 사이클: 완료(done)에서 다시 열렸을 때만 완료다(닫힘·버려짐에서 다시 열린 것은 완료가 아니다).
 *  - 지금 사이클: 단계가 완료이고, 진행 중 처리 실행이 없고, 마지막 단계 사건이 "닫힘(버려짐)"이 아니어야 한다.
 *  완료 시각 = 확인 완료(지금 사이클) 또는 완료 사건(지난 사이클) → 그 사이클 검증 승인 중 가장 늦은 것 → 그 사이클 처리 실행이 끝난 가장 늦은 시각.
 *  (채팅·충돌 검사·검증/확인 실행의 시각은 쓰지 않는다 — 예전에 끝난 이슈가 채팅 한 번으로 이번 주 완료가 되지 않게.)
 */
export function loadIssueHistory(projectIds: string[], opts: { onlyHeld?: boolean } = {}): Map<string, IssueHistory> {
  const out = new Map<string, IssueHistory>()
  if (projectIds.length === 0) return out
  const db = getDb()
  const ph = projectIds.map(() => '?').join(',')
  // 지금 보유 중인 이슈만(보유 나이 계산용 — 매분 도는 수집기도 쓰므로 필요한 이슈만 읽는다)
  const held = (a: string) => opts.onlyHeld
    ? `AND EXISTS (SELECT 1 FROM issue_stages hs WHERE hs.project_id = ${a}.project_id AND hs.issue_iid = ${a}.issue_iid AND hs.cached_stage IN ${HELD_STAGE_SQL})`
    : ''
  const rows = new Map<string, HistRow[]>()
  const running = new Set<string>()
  for (const r of db.prepare(`
    SELECT te.project_id, te.issue_iid, te.status, te.started_at, te.ended_at, te.verified_at, te.assignee_type, te.agent_id, te.user_id
    FROM task_executions te WHERE te.project_id IN (${ph}) AND ${PROCESS_EXEC_SQL('te')} ${held('te')}
  `).all(...projectIds) as any[]) {
    const k = `${r.project_id}:${r.issue_iid}`
    if (r.status === 'running' || r.status === 'assigned') running.add(k)
    const list = rows.get(k) ?? []
    const started = isoTime(r.started_at)
    if (!started) continue
    list.push({
      started, ended: isoTime(r.ended_at), status: r.status, verified: isoTime(r.verified_at),
      external: isExternalRow({ assigneeType: r.assignee_type ?? null, agentId: r.agent_id || null, userId: r.user_id || null }),
    })
    rows.set(k, list)
  }
  const stages = new Map<string, { stage: string | null; confirmedAt: string | null; scheduledAt: string | null }>()
  for (const r of db.prepare(`SELECT project_id, issue_iid, cached_stage, confirmed_at, scheduled_at FROM issue_stages x WHERE project_id IN (${ph}) ${held('x')}`).all(...projectIds) as any[]) {
    stages.set(`${r.project_id}:${r.issue_iid}`, { stage: r.cached_stage || null, confirmedAt: isoTime(r.confirmed_at), scheduledAt: isoTime(r.scheduled_at) })
  }
  // +x.event: 사건 종류 인덱스(전체 사건을 훑는다) 대신 이슈 인덱스를 타게 한다
  const events = new Map<string, { from: string | null; to: string | null; at: string; external: boolean }[]>()
  for (const r of db.prepare(`
    SELECT project_id, issue_iid, from_stage, to_stage, occurred_at, action FROM issue_events x
    WHERE +x.event = 'stage' AND project_id IN (${ph}) ${held('x')} ORDER BY id
  `).all(...projectIds) as any[]) {
    const at = isoTime(r.occurred_at)
    if (!at) continue
    const k = `${r.project_id}:${r.issue_iid}`
    const list = events.get(k) ?? []
    list.push({ from: r.from_stage ?? null, to: r.to_stage ?? null, at, external: r.action === 'external' })
    events.set(k, list)
  }

  const isOpen = (s: string | null) => !!s && s !== 'done' && s !== 'closed'
  const keys = new Set([...rows.keys(), ...stages.keys(), ...events.keys()])
  for (const k of keys) {
    const rs = rows.get(k) ?? []
    const st = stages.get(k)
    const ev = events.get(k) ?? []
    const reopenEv = ev.filter(e => (e.from === 'done' || e.from === 'closed') && isOpen(e.to)).sort((a, b) => (a.at < b.at ? -1 : 1))
    const firstHeldEvent = ev.filter(e => isOpen(e.to)).map(e => e.at).sort()[0]
    const firstReceipt = [st?.scheduledAt, ...rs.filter(r => !r.external).map(r => r.started), firstHeldEvent]
      .filter((t): t is string => !!t).sort()[0] ?? null

    const completions: string[] = []
    const bounds = ['', ...reopenEv.map(e => e.at), '\uffff']
    for (let j = 0; j + 1 < bounds.length; j++) {
      const lo = bounds[j], hi = bounds[j + 1]
      const last = j === bounds.length - 2
      const inC = rs.filter(r => r.started >= lo && r.started < hi)
      if (last) {
        const stage = st?.stage ?? null
        if (stage && stage !== 'done') continue
        if (running.has(k)) continue
        if (ev.length && ev[ev.length - 1].to === 'closed') continue // 머지 없이 닫힘(버려짐)
      } else if (reopenEv[j].from !== 'done') continue
      // 확인 완료 시각은 이번 사이클 안의 것만(다시 열 때 지우지만, 못 지웠어도 지난 사이클의 시각을 쓰지 않게)
      const confirmed = last && st?.confirmedAt && st.confirmedAt >= lo ? st.confirmedAt : null
      // 완료로 옮겨진 사건(사후 기록을 처음 본 사건은 작업 시각이 아니므로 뺀다)
      const doneEv = maxOf(ev.filter(e => e.to === 'done' && !e.external && e.at >= lo && e.at < hi).map(e => e.at))
      if (!confirmed && !doneEv && !inC.some(r => r.verified || r.status === 'success')) continue
      const at = confirmed ?? doneEv ?? maxOf(inC.map(r => r.verified))
        ?? maxOf(inC.filter(r => r.status === 'success' || r.status === 'failed').map(r => r.ended))
      if (at) completions.push(at)
    }
    if (!rs.length && !completions.length && !firstReceipt && !reopenEv.length) continue
    out.set(k, {
      firstReceipt, reopens: reopenEv.map(e => e.at), completions: completions.sort(),
      direct: rs.length > 0 && rs.every(r => r.external),
    })
  }
  return out
}

/**
 * 이슈마다 단계 사건(도착 단계·시각), 오래된 순 — 하루 마감 기록(held_daily)이 없는 날의 보유를 다시 셀 때 쓴다.
 * 버려짐은 'closed', 유입으로 되돌림은 'none' 으로 남는다.
 */
export function stageTimeline(projectIds: string[]): Map<string, { at: string; to: string | null }[]> {
  const out = new Map<string, { at: string; to: string | null }[]>()
  if (projectIds.length === 0) return out
  const ph = projectIds.map(() => '?').join(',')
  for (const r of getDb().prepare(`
    SELECT project_id, issue_iid, to_stage, occurred_at FROM issue_events x
    WHERE +x.event = 'stage' AND project_id IN (${ph}) ORDER BY id
  `).all(...projectIds) as any[]) {
    const at = isoTime(r.occurred_at)
    if (!at) continue
    const k = `${r.project_id}:${r.issue_iid}`
    const list = out.get(k) ?? []
    list.push({ at, to: r.to_stage ?? null })
    out.set(k, list)
  }
  for (const list of out.values()) list.sort((a, b) => (a.at < b.at ? -1 : a.at > b.at ? 1 : 0))
  return out
}

/** 이슈의 한 사이클 사건(접수 또는 완료) */
export interface CycleEvent { key: string; at: string }

/**
 * 기간(KST 날짜, 끝 미포함) 안의 완료 — 사이클마다 하나(한 이슈가 기간 안에 두 번 끝났으면 둘).
 * 보유 식(기초 + 유입 − 완료 = 기말)이 다시 작업(재오픈)이 있어도 맞도록 이슈가 아니라 사이클을 센다. 오래된 순.
 */
export function completedInRange(history: Map<string, IssueHistory>, startDay: string, endDay: string): CycleEvent[] {
  const lo = kstDayStartISO(startDay), hi = kstDayStartISO(endDay)
  const out: CycleEvent[] = []
  for (const [key, h] of history) for (const at of h.completions) if (at >= lo && at < hi) out.push({ key, at })
  return out.sort((a, b) => (a.at < b.at ? -1 : 1))
}

/**
 * 기간 안의 접수 — 처음 접수와 재오픈(새 사이클)이 각각 하나.
 * 처음 접수가 없는 사후 기록 일(처리 실행이 모두 외부 도구이고 보유 단계로 보인 적도 없음)은
 * 접수 시각이 없으므로 처음 완료된 시각에 들어온 것으로 센다 — 그래야 기간 경계를 넘어도 보유 식이 맞는다.
 */
export function receivedInRange(history: Map<string, IssueHistory>, startDay: string, endDay: string): CycleEvent[] {
  const lo = kstDayStartISO(startDay), hi = kstDayStartISO(endDay)
  const out: CycleEvent[] = []
  for (const [key, h] of history) {
    const first = h.firstReceipt ?? (h.direct ? h.completions[0] ?? null : null)
    for (const at of [first, ...h.reopens]) if (at && at >= lo && at < hi) out.push({ key, at })
  }
  return out.sort((a, b) => (a.at < b.at ? -1 : 1))
}

/** 사이클 사건 → 이슈별 마지막 시각(이슈 단위로 볼 때 — 평가·한 사람 의존) */
export const byIssue = (xs: CycleEvent[]) => new Map(xs.map(x => [x.key, x.at]))

/** 지금 보유 중인 이슈 → 이번 사이클 접수 시각(마지막 재오픈, 없으면 처음 접수). 보유 나이는 여기서부터 잰다 */
export function heldReceipts(projectIds: string[]): Map<string, string | null> {
  const out = new Map<string, string | null>()
  for (const [k, h] of loadIssueHistory(projectIds, { onlyHeld: true })) out.set(k, h.reopens[h.reopens.length - 1] ?? h.firstReceipt)
  return out
}

/** 프로젝트별 7일 넘게 보유 중인 일 수(지금) — 하루 마감 보유 기록(held_daily)에 함께 남긴다 */
export function agedHeldByProject(projectIds: string[], now: Date): Map<string, number> {
  const out = new Map<string, number>()
  const limit = new Date(now.getTime() - AGED_HOURS * 3_600_000).toISOString()
  for (const [k, at] of heldReceipts(projectIds)) {
    if (!at || at > limit) continue
    const pid = k.slice(0, k.lastIndexOf(':'))
    out.set(pid, (out.get(pid) ?? 0) + 1)
  }
  return out
}

/** 그 시각이 속한 사이클의 접수 시각(처음 접수 또는 그 전 마지막 재오픈). 없으면 null */
export function receiptBefore(h: IssueHistory | undefined, at: string): string | null {
  if (!h) return null
  const reopen = h.reopens.filter(t => t <= at).pop()
  return reopen ?? (h.firstReceipt && h.firstReceipt <= at ? h.firstReceipt : null)
}

/** 한 이슈의 실행 기록(전 기간) — 처리 횟수·반려·처리 종료 시각·모델·사람을 판정한다 */
export interface IssueExec {
  id: string
  agentId: string | null
  assigneeType: string | null
  status: string
  startedAt: string
  endedAt: string | null
  verifiedAt: string | null
  rejectedAt: string | null
  /** 사람 검증·확인 기록이 실패로 닫힌 까닭(fail 반려 · cancelled 취소 · abandoned 버려짐), 에이전트 판정(pass/fail/blocked) */
  stageVerdict: string | null
  modelName: string | null
  cliName: string | null
  userId: string | null
  userName: string | null
  issueCreatedAt: string | null
  verifierName: string | null
  verifierUserId: string | null
  verifierUsername: string | null
}

export interface IssueFacts {
  key: string
  projectId: string
  iid: number
  title: string | null
  scheduledAt: string | null
  confirmedAt: string | null
  execs: IssueExec[]
  /** 단계 사건(도착 단계·시각), 오래된 순 — 실행 기록이 없는 빈 시간이 실제로 어느 단계였는지 */
  stages: { at: string; to: string | null }[]
}

/** 이슈 키 목록('pid:iid')의 실행 기록과 단계 정보 */
export function issueFacts(keys: string[]): Map<string, IssueFacts> {
  const out = new Map<string, IssueFacts>()
  if (keys.length === 0) return out
  const byProject = new Map<string, number[]>()
  for (const k of keys) {
    const i = k.lastIndexOf(':')
    const pid = k.slice(0, i), iid = Number(k.slice(i + 1))
    const list = byProject.get(pid) ?? []
    list.push(iid)
    byProject.set(pid, list)
  }
  const db = getDb()
  for (const [pid, iids] of byProject) {
    for (let off = 0; off < iids.length; off += 400) {
      const chunk = iids.slice(off, off + 400)
      const ph = chunk.map(() => '?').join(',')
      const stages = db.prepare(`
        SELECT issue_iid, issue_title, scheduled_at, confirmed_at FROM issue_stages WHERE project_id = ? AND issue_iid IN (${ph})
      `).all(pid, ...chunk) as any[]
      const stageMap = new Map(stages.map(s => [s.issue_iid, s]))
      const execs = db.prepare(`
        SELECT te.id, te.issue_iid, te.agent_id, te.assignee_type, te.status, te.started_at, te.ended_at, te.verified_at, te.rejected_at, te.stage_verdict,
               te.model_name, a.cli_name, te.user_id, te.user_name, te.issue_created_at, te.issue_title,
               te.verifier_name, te.verifier_user_id, te.verifier_username
        FROM task_executions te LEFT JOIN agents a ON a.id = te.agent_id
        WHERE te.project_id = ? AND te.issue_iid IN (${ph})
        ORDER BY te.started_at ASC
      `).all(pid, ...chunk) as any[]
      for (const iid of chunk) {
        const st = stageMap.get(iid)
        out.set(`${pid}:${iid}`, {
          key: `${pid}:${iid}`, projectId: pid, iid,
          title: st?.issue_title ?? null, scheduledAt: isoTime(st?.scheduled_at), confirmedAt: isoTime(st?.confirmed_at),
          execs: [], stages: [],
        })
      }
      for (const r of db.prepare(`
        SELECT issue_iid, to_stage, occurred_at FROM issue_events x
        WHERE +x.event = 'stage' AND project_id = ? AND issue_iid IN (${ph}) ORDER BY id
      `).all(pid, ...chunk) as any[]) {
        const at = isoTime(r.occurred_at)
        if (at) out.get(`${pid}:${r.issue_iid}`)?.stages.push({ at, to: r.to_stage ?? null })
      }
      for (const iid of chunk) out.get(`${pid}:${iid}`)!.stages.sort((a, b) => (a.at < b.at ? -1 : a.at > b.at ? 1 : 0))
      for (const e of execs) {
        const f = out.get(`${pid}:${e.issue_iid}`)
        if (!f) continue
        if (!f.title && e.issue_title) f.title = e.issue_title
        f.execs.push({
          id: e.id, agentId: e.agent_id || null, assigneeType: e.assignee_type ?? null, status: e.status,
          startedAt: isoTime(e.started_at) ?? e.started_at, endedAt: isoTime(e.ended_at), verifiedAt: isoTime(e.verified_at), rejectedAt: isoTime(e.rejected_at), stageVerdict: e.stage_verdict || null,
          modelName: e.model_name || null, cliName: e.cli_name || null, userId: e.user_id || null, userName: e.user_name || null,
          issueCreatedAt: isoTime(e.issue_created_at), verifierName: e.verifier_name || null,
          verifierUserId: e.verifier_user_id || null, verifierUsername: e.verifier_username || null,
        })
      }
    }
  }
  return out
}

// ─── 지금 보유 ───

export interface HeldRow {
  projectId: string
  iid: number
  title: string | null
  stage: HeldStage
  provider: string | null
  assignMode: string | null
  assigneeUsername: string | null
  assigneeName: string | null
  assigneeGitUserId: string | null
  confirmerName: string | null
  confirmerUserId: string | null
  presetVerifierMode: string | null
  presetConfirmerMode: string | null
  /** 처리 중이면 그 실행의 담당 유형('user'면 사람이 처리 중) */
  activeAssigneeType: string | null
  activeUserId: string | null
  activeUserName: string | null
}

export function heldNow(projectIds: string[]): HeldRow[] {
  if (projectIds.length === 0) return []
  const ph = projectIds.map(() => '?').join(',')
  const db = getDb()
  // 진행 중 처리 실행(이슈마다 가장 최근 것)
  const active = new Map<string, any>()
  for (const r of db.prepare(`
    SELECT te.project_id, te.issue_iid, te.assignee_type, te.user_id, te.user_name FROM task_executions te
    WHERE te.project_id IN (${ph}) AND te.status IN ('running','assigned') AND ${PROCESS_EXEC_SQL('te')}
    ORDER BY te.started_at
  `).all(...projectIds) as any[]) active.set(`${r.project_id}:${r.issue_iid}`, r)
  const rows = db.prepare(`
    SELECT s.project_id, s.issue_iid, s.issue_title, s.cached_stage, s.assign_mode, p.provider AS provider,
           s.assignee_username, s.assignee_name, s.assignee_git_user_id, s.confirmer_name, s.confirmer_user_id,
           s.preset_verifier_mode, s.preset_confirmer_mode
    FROM issue_stages s JOIN projects p ON p.id = s.project_id
    WHERE s.project_id IN (${ph}) AND s.cached_stage IN ${HELD_STAGE_SQL}
  `).all(...projectIds) as any[]
  return rows.map(r => {
    const a = active.get(`${r.project_id}:${r.issue_iid}`)
    return {
      projectId: r.project_id, iid: r.issue_iid, title: r.issue_title ?? null, stage: r.cached_stage, provider: r.provider ?? null,
      assignMode: r.assign_mode ?? null, assigneeUsername: r.assignee_username ?? null, assigneeName: r.assignee_name ?? null,
      assigneeGitUserId: r.assignee_git_user_id ?? null, confirmerName: r.confirmer_name ?? null, confirmerUserId: r.confirmer_user_id ?? null,
      presetVerifierMode: r.preset_verifier_mode ?? null, presetConfirmerMode: r.preset_confirmer_mode ?? null,
      activeAssigneeType: a?.assignee_type ?? null, activeUserId: a?.user_id ?? null, activeUserName: a?.user_name ?? null,
    }
  })
}

// ─── 하루 마감 보유 ───

export interface HeldDayRow { projectId: string; date: string; total: number; over7: number | null }

/** 날짜 범위(포함·미포함)의 프로젝트별 하루 마감 보유 합계 */
export function heldDaily(projectIds: string[], fromDay: string, toDay: string): HeldDayRow[] {
  if (projectIds.length === 0) return []
  const ph = projectIds.map(() => '?').join(',')
  const rows = getDb().prepare(`
    SELECT project_id, date, waiting + dev + dev_fail + verify_waiting + verifying + confirm_waiting + confirming AS total, over7
    FROM held_daily WHERE project_id IN (${ph}) AND date >= ? AND date < ?
  `).all(...projectIds, fromDay, toDay) as any[]
  return rows.map(r => ({ projectId: r.project_id, date: r.date, total: r.total, over7: r.over7 ?? null }))
}

/** 보유 기록이 처음 시작된 날짜(전체). 없으면 null */
export function heldTrackingSince(projectIds: string[]): string | null {
  if (projectIds.length === 0) return null
  const ph = projectIds.map(() => '?').join(',')
  const r = getDb().prepare(`SELECT MIN(date) AS d FROM held_daily WHERE project_id IN (${ph})`).get(...projectIds) as { d: string | null } | undefined
  return r?.d ?? null
}

// ─── 뒤집힘 근거(사건 로그) ───

/** 완료 후 다시 열렸거나(단계 사건) 후속 이슈가 고친(연결) 이슈 키 집합 */
export function overturnedKeys(projectIds: string[], sinceISO: string): Set<string> {
  const out = new Set<string>()
  if (projectIds.length === 0) return out
  const ph = projectIds.map(() => '?').join(',')
  const links = getDb().prepare(`
    SELECT ref_project_id, ref_issue_iid FROM issue_events
    WHERE event = 'link' AND reason = 'fixes' AND ref_project_id IN (${ph}) AND occurred_at >= ?
  `).all(...projectIds, sinceISO) as any[]
  for (const l of links) out.add(`${l.ref_project_id}:${l.ref_issue_iid}`)
  const reopens = getDb().prepare(`
    SELECT project_id, issue_iid FROM issue_events
    WHERE +event = 'stage' AND from_stage = 'done' AND to_stage IS NOT NULL AND to_stage NOT IN ('done','closed')
      AND project_id IN (${ph}) AND occurred_at >= ?
  `).all(...projectIds, sinceISO) as any[]
  for (const r of reopens) out.add(`${r.project_id}:${r.issue_iid}`)
  return out
}

// ─── 사람 식별 ───

export interface PersonRef {
  key: string
  name: string
  /**
   * 확실한 식별인가 — IVE 사용자 id, 공급자(GitLab/GitHub)까지 맞춘 Git 숫자 id·계정, 관리자가 직접 연결한 별칭.
   * 표시 이름만으로 정한 것은 false. 범위 밖 일을 그 사람에게 보여주는 곳(메일의 "내 손에 있는 일")은 확실한 식별만 쓴다.
   */
  strong: boolean
}

export type GitProvider = 'gitlab' | 'github'
const personCache = new Map<string, PersonRef>()

function userByOAuth(provider: GitProvider, gitId: string): string | null {
  const r = getDb().prepare(`
    SELECT u.id FROM users u JOIN oauth_providers op ON op.id = u.oauth_provider_id
    WHERE op.type = ? AND u.oauth_user_id = ? LIMIT 1
  `).get(provider, gitId) as { id: string } | undefined
  return r?.id ?? null
}

function userByGitUsername(provider: GitProvider, username: string): string | null {
  const col = provider === 'github' ? 'github_username' : 'gitlab_username'
  const r = getDb().prepare(`SELECT id FROM users WHERE ${col} = ? COLLATE NOCASE LIMIT 1`).get(username) as { id: string } | undefined
  return r?.id ?? resolveManualAlias(username, provider)
}

/**
 * 사람 → 통합 키·표시 이름.
 *  1) IVE 사용자 id
 *  2) Git 숫자 id·Git 계정 — 공급자를 알 때만, 그 공급자 칸에서만 찾는다(GitLab kim ≠ GitHub kim)
 *  3) 관리자가 직접 연결한 이름
 *  4) 사용자 표에 한 명뿐인 표시 이름 · 자동 이름 별칭 — 약한 식별(strong=false)
 *  그래도 없으면 이름 자체를 키로 쓴다.
 */
export function personOf(
  userId: string | null | undefined,
  name: string | null | undefined,
  gitUsername?: string | null,
  provider?: string | null,
): PersonRef | null {
  const prov: GitProvider | null = provider === 'github' ? 'github' : provider === 'gitlab' ? 'gitlab' : null
  const ck = `${userId ?? ''}|${name ?? ''}|${gitUsername ?? ''}|${prov ?? ''}`
  const cached = personCache.get(ck)
  if (cached) return cached
  let id: string | null = null
  let strong = false
  if (userId) {
    const u = getDb().prepare('SELECT id FROM users WHERE id = ?').get(userId) as { id: string } | undefined
    id = u?.id ?? null
    // 실행 행의 user_id 가 Git 숫자 id 인 경로(담당자 처리) — 공급자를 알 때만
    if (!id && prov) id = userByOAuth(prov, userId)
    strong = !!id
  }
  if (!id && gitUsername && prov) {
    id = userByGitUsername(prov, gitUsername)
    strong = !!id
  }
  if (!id && name) {
    id = resolveManualAlias(name, 'name')
    strong = !!id
    if (!id) {
      // 표시 이름이 겹치면(대소문자 무시) 누구인지 정할 수 없으므로 한 명일 때만 — 약한 식별
      const rows = getDb().prepare(`SELECT id FROM users WHERE TRIM(name) = TRIM(?) COLLATE NOCASE LIMIT 2`).all(name) as { id: string }[]
      id = rows.length === 1 ? rows[0].id : null
    }
  }
  let result: PersonRef | null = null
  if (id) {
    const u = getDb().prepare('SELECT name FROM users WHERE id = ?').get(id) as { name: string } | undefined
    result = { key: `u:${id}`, name: u?.name || name || gitUsername || id, strong }
  } else if (name || gitUsername) {
    const n = (name || gitUsername)!.trim()
    result = { key: `n:${n.toLowerCase()}`, name: n, strong: false }
  }
  if (result) personCache.set(ck, result)
  return result
}

/** 테스트·요청 사이에 별칭이 바뀔 수 있으므로 요청마다 비운다 */
export function resetPersonCache(): void { personCache.clear() }

/** 사람 키(u:<id>)들의 아바타 — 보고서 화면이 사람 줄에 아바타를 그린다. 이름만 아는 사람(n:)은 없다 */
export function avatarsOfPersonKeys(keys: Iterable<string>): Record<string, string> {
  const ids = [...new Set([...keys].filter(k => k.startsWith('u:')).map(k => k.slice(2)))]
  if (!ids.length) return {}
  const rows = getDb().prepare(`SELECT id, avatar FROM users WHERE id IN (${ids.map(() => '?').join(',')})`).all(...ids) as { id: string; avatar: string | null }[]
  return Object.fromEntries(rows.filter(r => r.avatar).map(r => [`u:${r.id}`, r.avatar as string]))
}

/** 기간 안에 검증 판정(승인·반려)을 내린 검증 실행 */
export interface VerifyDecision {
  projectId: string; iid: number; userId: string | null; userName: string | null; username: string | null
  approvedAt: string | null; rejectedAt: string | null
  /** 검증 에이전트가 한 판정 — 사람 의존도에서 빼고, 검증자 평가에서는 모델 단위로 묶는다 */
  byAgent: boolean
  model: string | null
}

/**
 * 사람의 검증·확인 기록이 "실패"로 닫힌 것이 반려인가. 닫을 때 까닭을 남긴다(markHumanStageEnd):
 * fail=반려, cancelled=취소, abandoned=이슈가 머지 없이 닫혀 정리됨. 까닭이 없는 옛 기록은 같은 무렵(10분 안)의
 * 닫힘 사건이 없을 때만 반려로 본다. 승인(성공)은 까닭과 무관하게 판정이다.
 */
const HUMAN_REJECTED_SQL = (a: string) => `(${a}.stage_verdict = 'fail' OR (${a}.stage_verdict IS NULL
  AND NOT EXISTS (SELECT 1 FROM issue_events ce WHERE +ce.event = 'stage' AND ce.to_stage = 'closed'
    AND ce.project_id = ${a}.project_id AND ce.issue_iid = ${a}.issue_iid
    AND ABS(julianday(ce.occurred_at) - julianday(${a}.ended_at)) <= 10.0 / 1440)))`

export function verifyDecisions(projectIds: string[], startISO: string, endISO: string): VerifyDecision[] {
  if (projectIds.length === 0) return []
  const ph = projectIds.map(() => '?').join(',')
  const rows = getDb().prepare(`
    SELECT v.project_id, v.issue_iid, v.user_id, v.user_name, v.verifier_username, v.verified_at, v.rejected_at, v.ended_at, v.status, v.assignee_type, v.stage_verdict, v.model_name
    FROM task_executions v
    WHERE v.id LIKE 'ex-verify-%' AND v.project_id IN (${ph})
      AND julianday(COALESCE(v.verified_at, v.rejected_at, v.ended_at)) >= julianday(?) AND julianday(COALESCE(v.verified_at, v.rejected_at, v.ended_at)) < julianday(?)
      AND (v.status = 'success' OR (v.status = 'failed' AND (v.assignee_type = 'agent' OR ${HUMAN_REJECTED_SQL('v')})))
  `).all(...projectIds, startISO, endISO) as any[]
  return rows.map(r => {
    const verified = isoTime(r.verified_at), rejected = isoTime(r.rejected_at), ended = isoTime(r.ended_at)
    const byAgent = r.assignee_type === 'agent'
    // 에이전트의 실패 상태에는 "판단 불가(blocked)"·오류도 섞여 있다 — 판정이 fail 일 때만 반려로 본다
    const agentRejected = byAgent && r.stage_verdict === 'fail'
    const agentApproved = byAgent && r.stage_verdict === 'pass'
    return {
      projectId: r.project_id, iid: r.issue_iid, userId: r.user_id || null, userName: r.user_name || null, username: r.verifier_username || null,
      approvedAt: verified || (byAgent ? (agentApproved ? ended : null) : (r.status === 'success' && !rejected ? ended : null)),
      rejectedAt: rejected || (byAgent ? (agentRejected ? ended : null) : (r.status === 'failed' ? ended : null)),
      byAgent, model: r.model_name || null,
    }
  })
}

/** 기간 안에 확인 판정(완료·반려)을 내린 확인 실행 — 검증 판정(verifyDecisions)과 같은 규칙 */
export interface ConfirmDecision {
  projectId: string; iid: number; userId: string | null; userName: string | null
  acceptedAt: string | null; rejectedAt: string | null
  byAgent: boolean
}

export function confirmDecisions(projectIds: string[], startISO: string, endISO: string): ConfirmDecision[] {
  if (projectIds.length === 0) return []
  const ph = projectIds.map(() => '?').join(',')
  const rows = getDb().prepare(`
    SELECT c.project_id, c.issue_iid, c.user_id, c.user_name, c.rejected_at, c.ended_at, c.status, c.assignee_type, c.stage_verdict
    FROM task_executions c
    WHERE c.id LIKE 'ex-confirm-%' AND c.project_id IN (${ph})
      AND julianday(COALESCE(c.rejected_at, c.ended_at)) >= julianday(?) AND julianday(COALESCE(c.rejected_at, c.ended_at)) < julianday(?)
      AND (c.status = 'success' OR (c.status = 'failed' AND (c.assignee_type = 'agent' OR ${HUMAN_REJECTED_SQL('c')})))
  `).all(...projectIds, startISO, endISO) as any[]
  return rows.map(r => {
    const rejected = isoTime(r.rejected_at), ended = isoTime(r.ended_at)
    const byAgent = r.assignee_type === 'agent'
    // 에이전트의 실패에는 판단 불가·오류도 섞여 있다 — 판정(pass/fail)으로만 센다
    const accepted = byAgent ? r.stage_verdict === 'pass' : r.status === 'success' && !rejected
    const rej = byAgent ? r.stage_verdict === 'fail' : !!rejected || r.status === 'failed'
    return {
      projectId: r.project_id, iid: r.issue_iid, userId: r.user_id || null, userName: r.user_name || null,
      acceptedAt: accepted ? ended : null, rejectedAt: rej ? (rejected || ended) : null, byAgent,
    }
  })
}

/** 이슈들의 확인 반려 시각(확인 실행이 실패로 끝난 시각) */
export function confirmRejections(projectIds: string[], sinceISO: string): Map<string, string[]> {
  const out = new Map<string, string[]>()
  if (projectIds.length === 0) return out
  const ph = projectIds.map(() => '?').join(',')
  const rows = getDb().prepare(`
    SELECT c.project_id, c.issue_iid, COALESCE(c.rejected_at, c.ended_at) AS at FROM task_executions c
    WHERE c.id LIKE 'ex-confirm-%' AND c.project_id IN (${ph})
      AND (c.rejected_at IS NOT NULL OR (c.status = 'failed' AND ((c.assignee_type = 'agent' AND c.stage_verdict = 'fail') OR (COALESCE(c.assignee_type, '') <> 'agent' AND ${HUMAN_REJECTED_SQL('c')}))))
      AND julianday(COALESCE(c.rejected_at, c.ended_at)) >= julianday(?)
  `).all(...projectIds, sinceISO) as any[]
  for (const r of rows) {
    const k = `${r.project_id}:${r.issue_iid}`
    const list = out.get(k) ?? []
    const at = isoTime(r.at)
    if (at) list.push(at)
    out.set(k, list)
  }
  return out
}
