/**
 * 사건 로그 — 보고서·평가를 나중에 "마이닝"할 수 있도록 원재료를 남긴다.
 *
 * 원칙
 *  - 추가만 한다. 수정·삭제하지 않는다. 합계·비율은 조회 때 계산한다.
 *  - 지나간 일은 나중에 채울 수 없으므로, 사건이 일어난 그 자리에서 맥락(누가·어떤 모델·어떤 프롬프트)을 함께 남긴다.
 *  - 기록 실패가 본래 동작(단계 전이·배정)을 막으면 안 된다. 모든 쓰기는 예외를 삼킨다.
 *
 * issue_events  : 이슈 단위 사건 — 단계 전이(stage), 배정 대기 사유(wait), 후속 이슈 연결(link)
 * config_events : 결과에 영향을 주는 설정 변경 — 에이전트 모델·CLI, 시스템 CLI 모델, 자동화 설정, 명부
 * person_aliases: 같은 사람이 여러 이름(표시 이름·Git 계정)으로 남은 과거 기록을 한 사람으로 묶는 표
 */
import { getDb } from './connection'

export type IssueEventKind = 'stage' | 'wait' | 'link'
export type ActorType = 'user' | 'agent' | 'system' | 'unknown'
export type EventSource = 'ui' | 'scanner' | 'worker' | 'bundle' | 'external' | 'api' | 'backfill'

export interface EventActor {
  type: ActorType
  userId?: string | null
  gitUsername?: string | null
  agentId?: string | null
  model?: string | null
}

export const SYSTEM_ACTOR: EventActor = { type: 'system' }
export const UNKNOWN_ACTOR: EventActor = { type: 'unknown' }

export interface IssueEventInput {
  projectId: string
  issueIid: number
  event: IssueEventKind
  fromStage?: string | null
  toStage?: string | null
  action?: string | null
  actor?: EventActor
  source: EventSource
  executionId?: string | null
  promptVersion?: string | null
  reason?: string | null
  refProjectId?: string | null
  refIssueIid?: number | null
  detail?: Record<string, unknown> | null
  occurredAt?: string
}

/** 'none'·빈 문자열은 단계 없음(null)으로 맞춘다. 화면 경로는 null 을 'none' 으로 쓴다. */
function normStage(s: string | null | undefined): string | null {
  if (!s || s === 'none') return null
  return s
}

function insert(e: IssueEventInput): void {
  const a = e.actor ?? UNKNOWN_ACTOR
  getDb().prepare(`
    INSERT INTO issue_events (
      occurred_at, project_id, issue_iid, event, from_stage, to_stage, action,
      actor_type, actor_user_id, actor_git_username, actor_agent_id, actor_model,
      source, execution_id, prompt_version, reason, ref_project_id, ref_issue_iid, detail
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    e.occurredAt ?? new Date().toISOString(), e.projectId, e.issueIid, e.event,
    normStage(e.fromStage), normStage(e.toStage), e.action ?? null,
    a.type, a.userId ?? null, a.gitUsername ?? null, a.agentId ?? null, a.model ?? null,
    e.source, e.executionId ?? null, e.promptVersion ?? null, e.reason ?? null,
    e.refProjectId ?? null, e.refIssueIid ?? null, e.detail ? JSON.stringify(e.detail) : null,
  )
}

/**
 * 단계 전이 기록. 같은 전이를 여러 경로가 알 수 있다(예: 에이전트가 MR 을 만들며 라벨을 옮기고,
 * 다음 스캔이 라벨 변화를 다시 감지). 이 이슈의 마지막 단계 사건이 이미 같은 도착 단계면 다시 남기지 않는다.
 * 먼저 기록한 쪽이 더 많은 맥락(작업자·실행)을 아는 경로라서 그 기록을 살린다.
 * @returns 기록했으면 true
 */
export function recordStageEvent(e: Omit<IssueEventInput, 'event'>): boolean {
  try {
    const to = normStage(e.toStage)
    const from = normStage(e.fromStage)
    if (from === to) return false
    const last = getDb().prepare(`
      SELECT to_stage FROM issue_events
      WHERE project_id = ? AND issue_iid = ? AND event = 'stage'
      ORDER BY id DESC LIMIT 1
    `).get(e.projectId, e.issueIid) as { to_stage: string | null } | undefined
    if (last && (last.to_stage ?? null) === to) return false
    insert({ ...e, event: 'stage' })
    return true
  } catch (err) {
    console.warn('[events] recordStageEvent failed:', (err as Error).message)
    return false
  }
}

/** 이 이슈의 마지막 단계 사건의 도착 단계(없으면 undefined). 같은 전이를 다시 조사하지 않으려고 쓴다. */
export function getLastStageEventTo(projectId: string, issueIid: number): string | null | undefined {
  try {
    const r = getDb().prepare(`
      SELECT to_stage FROM issue_events WHERE project_id = ? AND issue_iid = ? AND event = 'stage'
      ORDER BY id DESC LIMIT 1
    `).get(projectId, issueIid) as { to_stage: string | null } | undefined
    return r ? (r.to_stage ?? null) : undefined
  } catch { return undefined }
}

/**
 * 배정 대기 사유 기록. 스캔마다 같은 사유가 반복되므로 "사유가 바뀌었을 때"만 남긴다.
 * 마지막 대기 사건 이후 단계가 바뀌었다면(대기가 끝났다가 다시 대기) 같은 사유라도 새로 남긴다.
 */
export function recordWaitIfChanged(
  projectId: string, issueIid: number, reason: string,
  opts: { source?: EventSource; detail?: Record<string, unknown> | null; actor?: EventActor } = {},
): boolean {
  try {
    const last = getDb().prepare(`
      SELECT event, reason, detail FROM issue_events
      WHERE project_id = ? AND issue_iid = ? AND event IN ('wait', 'stage')
      ORDER BY id DESC LIMIT 1
    `).get(projectId, issueIid) as { event: string; reason: string | null; detail: string | null } | undefined
    const detailJson = opts.detail ? JSON.stringify(opts.detail) : null
    if (last && last.event === 'wait' && last.reason === reason && (last.detail ?? null) === detailJson) return false
    insert({
      projectId, issueIid, event: 'wait', reason,
      source: opts.source ?? 'scanner', actor: opts.actor ?? SYSTEM_ACTOR, detail: opts.detail ?? null,
    })
    return true
  } catch (err) {
    console.warn('[events] recordWaitIfChanged failed:', (err as Error).message)
    return false
  }
}

/** 후속 이슈 연결 — "이 이슈(issueIid)가 이전 이슈(ref)를 고친다". 같은 연결은 한 번만 남긴다. */
export function recordIssueLink(
  projectId: string, issueIid: number, refProjectId: string, refIssueIid: number,
  opts: { kind?: string; source?: EventSource; actor?: EventActor } = {},
): boolean {
  try {
    const kind = opts.kind ?? 'fixes'
    const dup = getDb().prepare(`
      SELECT 1 FROM issue_events
      WHERE project_id = ? AND issue_iid = ? AND event = 'link'
        AND ref_project_id = ? AND ref_issue_iid = ? AND reason = ?
      LIMIT 1
    `).get(projectId, issueIid, refProjectId, refIssueIid, kind)
    if (dup) return false
    insert({
      projectId, issueIid, event: 'link', reason: kind, refProjectId, refIssueIid,
      source: opts.source ?? 'external', actor: opts.actor ?? UNKNOWN_ACTOR,
    })
    return true
  } catch (err) {
    console.warn('[events] recordIssueLink failed:', (err as Error).message)
    return false
  }
}

export interface IssueEventRow {
  id: number
  occurredAt: string
  projectId: string
  issueIid: number
  event: IssueEventKind
  fromStage: string | null
  toStage: string | null
  action: string | null
  actorType: ActorType
  actorUserId: string | null
  actorGitUsername: string | null
  actorAgentId: string | null
  actorModel: string | null
  source: EventSource
  executionId: string | null
  promptVersion: string | null
  reason: string | null
  refProjectId: string | null
  refIssueIid: number | null
  detail: Record<string, unknown> | null
}

function mapEvent(r: any): IssueEventRow {
  let detail: Record<string, unknown> | null = null
  if (r.detail) { try { detail = JSON.parse(r.detail) } catch { detail = null } }
  return {
    id: r.id, occurredAt: r.occurred_at, projectId: r.project_id, issueIid: r.issue_iid,
    event: r.event, fromStage: r.from_stage, toStage: r.to_stage, action: r.action,
    actorType: r.actor_type, actorUserId: r.actor_user_id, actorGitUsername: r.actor_git_username,
    actorAgentId: r.actor_agent_id, actorModel: r.actor_model, source: r.source,
    executionId: r.execution_id, promptVersion: r.prompt_version, reason: r.reason,
    refProjectId: r.ref_project_id, refIssueIid: r.ref_issue_iid, detail,
  }
}

/** 한 이슈의 사건 목록(오래된 순). */
export function getIssueEvents(projectId: string, issueIid: number): IssueEventRow[] {
  const rows = getDb().prepare(`
    SELECT * FROM issue_events WHERE project_id = ? AND issue_iid = ? ORDER BY id ASC
  `).all(projectId, issueIid) as any[]
  return rows.map(mapEvent)
}

/** 기간 안의 사건(오래된 순). start/end 는 UTC ISO. */
export function getIssueEventsInRange(startISO: string, endISO: string, kinds?: IssueEventKind[]): IssueEventRow[] {
  const kindFilter = kinds && kinds.length > 0 ? `AND event IN (${kinds.map(() => '?').join(',')})` : ''
  const rows = getDb().prepare(`
    SELECT * FROM issue_events
    WHERE occurred_at >= ? AND occurred_at < ? ${kindFilter}
    ORDER BY occurred_at ASC, id ASC
  `).all(startISO, endISO, ...(kinds ?? [])) as any[]
  return rows.map(mapEvent)
}

// ─── 설정 변경 ───

export type ConfigScope = 'agent' | 'system' | 'automation' | 'roster' | 'preset'

/**
 * 설정 변경 기록. before/after 객체에서 fields 에 든 값만 비교해, 달라진 칸마다 한 줄씩 남긴다.
 * 값은 문자열로 남긴다(객체는 JSON). 비밀값이 들어갈 수 있는 칸은 호출부가 fields 에서 빼야 한다.
 * @returns 남긴 줄 수
 */
export function recordConfigChanges(
  scope: ConfigScope,
  targetId: string,
  before: Record<string, unknown> | null | undefined,
  after: Record<string, unknown> | null | undefined,
  fields: string[],
  opts: { projectId?: string | null; actorUserId?: string | null } = {},
): number {
  try {
    const str = (v: unknown): string | null =>
      v === undefined || v === null ? null : typeof v === 'object' ? JSON.stringify(v) : String(v)
    const stmt = getDb().prepare(`
      INSERT INTO config_events (occurred_at, scope, project_id, target_id, field, old_value, new_value, actor_user_id)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `)
    const now = new Date().toISOString()
    let n = 0
    for (const f of fields) {
      const o = str(before?.[f])
      const nv = str(after?.[f])
      if (o === nv) continue
      stmt.run(now, scope, opts.projectId ?? null, targetId, f, o, nv, opts.actorUserId ?? null)
      n++
    }
    return n
  } catch (err) {
    console.warn('[events] recordConfigChanges failed:', (err as Error).message)
    return 0
  }
}

export interface ConfigEventRow {
  id: number; occurredAt: string; scope: ConfigScope; projectId: string | null; targetId: string
  field: string; oldValue: string | null; newValue: string | null; actorUserId: string | null
}

export function getConfigEvents(scope?: ConfigScope, targetId?: string): ConfigEventRow[] {
  const where: string[] = []
  const args: unknown[] = []
  if (scope) { where.push('scope = ?'); args.push(scope) }
  if (targetId) { where.push('target_id = ?'); args.push(targetId) }
  const rows = getDb().prepare(`
    SELECT * FROM config_events ${where.length ? 'WHERE ' + where.join(' AND ') : ''} ORDER BY id ASC
  `).all(...args) as any[]
  return rows.map(r => ({
    id: r.id, occurredAt: r.occurred_at, scope: r.scope, projectId: r.project_id, targetId: r.target_id,
    field: r.field, oldValue: r.old_value, newValue: r.new_value, actorUserId: r.actor_user_id,
  }))
}

// ─── 사람 식별 통합 ───

export type AliasKind = 'name' | 'gitlab' | 'github'

/** 별칭 → IVE 사용자 연결. 이미 있으면 바꾸지 않는다(사람이 고친 연결을 덮어쓰지 않도록). */
export function addPersonAlias(alias: string, kind: AliasKind, userId: string, source: 'auto' | 'manual' = 'auto'): boolean {
  const a = alias?.trim()
  if (!a || !userId) return false
  try {
    const r = getDb().prepare(`
      INSERT OR IGNORE INTO person_aliases (alias, kind, user_id, source) VALUES (?, ?, ?, ?)
    `).run(a, kind, userId, source)
    return r.changes > 0
  } catch (err) {
    console.warn('[events] addPersonAlias failed:', (err as Error).message)
    return false
  }
}

/** 관리자가 직접 연결(기존 연결을 바꾼다). */
export function setPersonAlias(alias: string, kind: AliasKind, userId: string): void {
  getDb().prepare(`
    INSERT INTO person_aliases (alias, kind, user_id, source) VALUES (?, ?, ?, 'manual')
    ON CONFLICT(alias, kind) DO UPDATE SET user_id = excluded.user_id, source = 'manual', updated_at = datetime('now')
  `).run(alias.trim(), kind, userId)
}

/** 별칭 → IVE 사용자 id. 이름은 대소문자·앞뒤 공백을 무시한다. */
export function resolvePersonAlias(alias: string | null | undefined, kind?: AliasKind): string | null {
  const a = alias?.trim()
  if (!a) return null
  const row = kind
    ? getDb().prepare(`SELECT user_id FROM person_aliases WHERE alias = ? COLLATE NOCASE AND kind = ? LIMIT 1`).get(a, kind)
    : getDb().prepare(`SELECT user_id FROM person_aliases WHERE alias = ? COLLATE NOCASE ORDER BY kind = 'name' LIMIT 1`).get(a)
  return (row as { user_id: string } | undefined)?.user_id ?? null
}

/** IVE 사용자 표에서 자동으로 알 수 있는 별칭(표시 이름·Git 계정)을 채운다. 여러 번 돌려도 안전하다. */
export function syncPersonAliasesFromUsers(): number {
  try {
    const db = getDb()
    let n = 0
    n += db.prepare(`
      INSERT OR IGNORE INTO person_aliases (alias, kind, user_id, source)
      SELECT TRIM(name), 'name', id, 'auto' FROM users
      WHERE name IS NOT NULL AND TRIM(name) <> ''
        AND TRIM(name) NOT IN (SELECT TRIM(name) FROM users GROUP BY TRIM(name) HAVING COUNT(*) > 1)
    `).run().changes
    n += db.prepare(`
      INSERT OR IGNORE INTO person_aliases (alias, kind, user_id, source)
      SELECT TRIM(gitlab_username), 'gitlab', id, 'auto' FROM users
      WHERE gitlab_username IS NOT NULL AND TRIM(gitlab_username) <> ''
    `).run().changes
    n += db.prepare(`
      INSERT OR IGNORE INTO person_aliases (alias, kind, user_id, source)
      SELECT TRIM(github_username), 'github', id, 'auto' FROM users
      WHERE github_username IS NOT NULL AND TRIM(github_username) <> ''
    `).run().changes
    return n
  } catch (err) {
    console.warn('[events] syncPersonAliasesFromUsers failed:', (err as Error).message)
    return 0
  }
}

/** 별칭 연결 해제(관리 화면) */
export function removePersonAlias(alias: string, kind: AliasKind): void {
  getDb().prepare(`DELETE FROM person_aliases WHERE alias = ? COLLATE NOCASE AND kind = ?`).run(alias.trim(), kind)
}

/**
 * 기록에 남았지만 IVE 사용자로 정해지지 않는 사람 이름·Git 계정 — 관리자가 연결할 후보.
 * 사용자 표(이름이 한 명뿐·Git 계정)나 별칭표로 이미 정해지는 것은 뺀다.
 */
export function unresolvedPersonNames(): { alias: string; kind: AliasKind; count: number }[] {
  const db = getDb()
  const rows = db.prepare(`
    SELECT alias, kind, SUM(n) AS count FROM (
      SELECT TRIM(user_name) AS alias, 'name' AS kind, COUNT(*) AS n FROM task_executions
        WHERE user_name IS NOT NULL AND TRIM(user_name) <> '' AND (user_id IS NULL OR user_id NOT IN (SELECT id FROM users)) GROUP BY 1
      UNION ALL
      SELECT TRIM(verifier_name), 'name', COUNT(*) FROM task_executions
        WHERE verifier_name IS NOT NULL AND TRIM(verifier_name) <> '' AND (verifier_user_id IS NULL OR verifier_user_id NOT IN (SELECT id FROM users)) GROUP BY 1
      UNION ALL
      SELECT TRIM(assignee_username), 'gitlab', COUNT(*) FROM issue_stages
        WHERE assignee_username IS NOT NULL AND TRIM(assignee_username) <> '' AND (assignee_provider IS NULL OR assignee_provider = 'gitlab') GROUP BY 1
      UNION ALL
      SELECT TRIM(assignee_username), 'github', COUNT(*) FROM issue_stages
        WHERE assignee_username IS NOT NULL AND TRIM(assignee_username) <> '' AND assignee_provider = 'github' GROUP BY 1
    ) GROUP BY alias COLLATE NOCASE, kind ORDER BY count DESC
  `).all() as { alias: string; kind: AliasKind; count: number }[]
  return rows.filter(r => {
    if (r.kind === 'name') {
      const n = db.prepare(`SELECT COUNT(*) AS c FROM users WHERE TRIM(name) = ?`).get(r.alias) as { c: number }
      if (n.c === 1) return false
    } else {
      const col = r.kind === 'github' ? 'github_username' : 'gitlab_username'
      if (db.prepare(`SELECT 1 FROM users WHERE ${col} = ? COLLATE NOCASE`).get(r.alias)) return false
    }
    return !resolvePersonAlias(r.alias, r.kind)
  })
}

/** 이 사람의 모든 별칭(관리 화면용). */
export function getPersonAliases(userId?: string): { alias: string; kind: AliasKind; userId: string; source: string }[] {
  const rows = (userId
    ? getDb().prepare(`SELECT * FROM person_aliases WHERE user_id = ? ORDER BY kind, alias`).all(userId)
    : getDb().prepare(`SELECT * FROM person_aliases ORDER BY user_id, kind, alias`).all()) as any[]
  return rows.map(r => ({ alias: r.alias, kind: r.kind, userId: r.user_id, source: r.source }))
}
