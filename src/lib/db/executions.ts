import { TaskExecution, TaskStatus } from '@/types'
import { getDb } from './connection'
import { getKSTTodayStartISO, getKSTYesterdayStartISO } from '../date-utils'
import { getIssueAssigneeUsername } from './issues'
import type { IssueStage } from './issues'

/**
 * timestamp 정규화 — DB 에 저장하기 전 모든 시각 컬럼은 이걸 통과해야 한다.
 *
 * 회귀 방지: 운영 (2026-05-07) 에서 외부 도구 ive-meta 의 'REPLACE_END' 같은
 * placeholder 가 task_executions.ended_at 에 그대로 저장되어 보고서 페이지의
 * `new Date(...).toISOString()` 에서 RangeError 가 발생, 사이트 다운.
 *
 * 정책: 파싱 가능한 ISO 문자열만 인정. 그 외는 null. 빈 문자열도 null.
 */
function sanitizeTimestamp(s: string | null | undefined): string | null {
  if (s == null) return null
  const trimmed = String(s).trim()
  if (!trimmed) return null
  const d = new Date(trimmed)
  if (isNaN(d.getTime())) return null
  // ISO 형태로 정규화해 저장 (SQLite datetime() 형식이 들어와도 ISO 로 통일)
  return d.toISOString()
}

function mapExecution(r: any): TaskExecution {
  return {
    id: r.id, projectId: r.project_id, agentId: r.agent_id ?? '',
    issueIid: r.issue_iid, issueTitle: r.issue_title ?? undefined,
    modelName: r.model_name ?? undefined,
    status: r.status, startedAt: r.started_at, endedAt: r.ended_at,
    logPath: r.log_path, pid: r.pid ?? undefined,
    agentName: r.agent_name ?? undefined,
    agentAvatar: r.agent_avatar ?? undefined,
    inputTokens: r.input_tokens ?? 0, outputTokens: r.output_tokens ?? 0,
    cacheReadInputTokens: r.cache_read_input_tokens ?? 0,
    cacheCreationInputTokens: r.cache_creation_input_tokens ?? 0,
    costUsd: r.cost_usd ?? 0, turns: r.turns ?? 0,
    issueCreatedAt: r.issue_created_at ?? undefined,
    assigneeType: r.assignee_type ?? 'agent',
    userId: r.user_id ?? null,
    userName: r.user_name ?? null,
    userAvatar: r.user_avatar ?? null,
    verifiedAt: r.verified_at ?? null,
    rejectedAt: r.rejected_at ?? null,
    workSec: r.work_sec ?? 0,
  }
}

/** 툴 직접개발 작업의 확정 작업시간(초) 저장 — ive-meta > /spend > 0 으로 스캐너가 산정. */
export function updateExecutionWorkSec(id: string, sec: number) {
  getDb().prepare('UPDATE task_executions SET work_sec = ? WHERE id = ?').run(Math.max(0, Math.round(sec)), id)
}

export function createExecution(ex: TaskExecution) {
  getDb().prepare(
    'INSERT INTO task_executions (id, project_id, agent_id, issue_iid, issue_title, status, started_at, ended_at, log_path, issue_created_at, assignee_type, user_id, user_name, user_avatar) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)'
  ).run(
    ex.id, ex.projectId, ex.agentId || null, ex.issueIid, ex.issueTitle ?? null, ex.status,
    sanitizeTimestamp(ex.startedAt) ?? new Date().toISOString(),
    sanitizeTimestamp(ex.endedAt),
    ex.logPath,
    sanitizeTimestamp(ex.issueCreatedAt),
    ex.assigneeType ?? 'agent', ex.userId ?? null, ex.userName ?? null, ex.userAvatar ?? null,
  )
}

export function updateExecutionStatus(id: string, status: TaskStatus, endedAt?: string) {
  const isTerminal = status === 'success' || status === 'failed'
  const safeEndedAt = sanitizeTimestamp(endedAt)
  const effectiveEndedAt = safeEndedAt || (isTerminal ? new Date().toISOString() : null)
  if (effectiveEndedAt) {
    getDb().prepare('UPDATE task_executions SET status = ?, ended_at = ? WHERE id = ?').run(status, effectiveEndedAt, id)
  } else {
    getDb().prepare('UPDATE task_executions SET status = ? WHERE id = ?').run(status, id)
  }
}

export function updateExecutionTokens(
  id: string, inputTokens: number, outputTokens: number, costUsd: number, turns: number = 0, modelName?: string,
  cacheReadInputTokens: number = 0, cacheCreationInputTokens: number = 0,
) {
  if (modelName) {
    getDb().prepare('UPDATE task_executions SET input_tokens = ?, output_tokens = ?, cost_usd = ?, turns = ?, model_name = ?, cache_read_input_tokens = ?, cache_creation_input_tokens = ? WHERE id = ?')
      .run(inputTokens, outputTokens, costUsd, turns, modelName, cacheReadInputTokens, cacheCreationInputTokens, id)
  } else {
    getDb().prepare('UPDATE task_executions SET input_tokens = ?, output_tokens = ?, cost_usd = ?, turns = ?, cache_read_input_tokens = ?, cache_creation_input_tokens = ? WHERE id = ?')
      .run(inputTokens, outputTokens, costUsd, turns, cacheReadInputTokens, cacheCreationInputTokens, id)
  }
}

export function getExecution(id: string): TaskExecution | null {
  const r = getDb().prepare('SELECT * FROM task_executions WHERE id = ?').get(id) as any
  if (!r) return null
  return mapExecution(r)
}

export function updateExecutionPid(id: string, pid: number) {
  getDb().prepare('UPDATE task_executions SET pid = ? WHERE id = ?').run(pid, id)
}

export function killExecution(id: string): boolean {
  const r = getDb().prepare('SELECT * FROM task_executions WHERE id = ?').get(id) as any
  if (!r) return false
  if (r.assignee_type === 'user') {
    getDb().prepare("UPDATE task_executions SET status = 'failed', ended_at = ? WHERE id = ?").run(new Date().toISOString(), id)
    return true
  }
  if (r.pid) {
    try {
      process.kill(-r.pid, 'SIGKILL')
      console.log(`[DB] Killed process group -${r.pid} for execution ${id}`)
    } catch (e: any) {
      if (e.code !== 'ESRCH') console.warn(`[DB] Kill failed for pid ${r.pid}:`, e.message)
    }
  }
  getDb().prepare("UPDATE task_executions SET status = 'failed', ended_at = ? WHERE id = ?").run(new Date().toISOString(), id)
  if (r.agent_id) {
    getDb().prepare("UPDATE agents SET status = 'available' WHERE id = ? AND status = 'busy'").run(r.agent_id)
  }
  return true
}

export function resetStuckExecutions() {
  const stuckRows = getDb().prepare("SELECT * FROM task_executions WHERE status = 'running' AND (assignee_type IS NULL OR assignee_type = 'agent')").all() as any[]
  for (const r of stuckRows) {
    if (r.pid) {
      try { process.kill(-r.pid, 'SIGKILL') } catch (e: any) {
        if (e.code !== 'ESRCH') console.warn(`[DB] Kill failed for pid ${r.pid}:`, e.message)
      }
    }
    getDb().prepare("UPDATE task_executions SET status = 'failed', ended_at = ? WHERE id = ?").run(new Date().toISOString(), r.id)
    if (r.agent_id) {
      getDb().prepare("UPDATE agents SET status = 'available' WHERE id = ? AND status = 'busy'").run(r.agent_id)
    }
    console.log(`[DB] Reset stuck execution ${r.id}`)
  }
  if (stuckRows.length > 0) console.log(`[DB] Reset ${stuckRows.length} stuck execution(s).`)
}

export interface IssueStageTimes {
  /** IVE-S 부착(처리대기 진입) 시각 — 처리대기→픽업 대기시간 측정용 */
  scheduledAt: string | null
  /** 첫 dev execution 의 started_at — 처리대기→처리 픽업 시점 */
  firstDevStartedAt: string | null
  devStartedAt: string | null
  devEndedAt: string | null
  verifyStartedAt: string | null
  verifyEndedAt: string | null   // verified_at OR rejected_at (둘 중 먼저)
  confirmStartedAt: string | null  // 확인 시작 시각 (확인대기→확인 전환 시점)
  confirmedAt: string | null
}

/**
 * 단계별 타임스탬프.
 *   - firstDevStartedAt: 처음 dev 가 시작된 시각 (재시도 무관, 진짜 픽업 시점)
 *   - 그 외: 마지막 execution 기준 (현재 단계 진행 시간/마지막 대기 표시용)
 *   - confirmStartedAt: 확인 시작 클릭 시각 (issue_stages.confirm_started_at)
 */
export function getIssueStageTimes(projectId: string, issueIid: number): IssueStageTimes {
  // ex-verify-% 와 ex-confirm-% 는 사람 작업용 placeholder execution 이므로 제외 — dev exec 만 본다.
  const DEV_EXEC_FILTER = "id NOT LIKE 'ex-verify-%' AND id NOT LIKE 'ex-confirm-%'"
  const lastExec = getDb().prepare(
    `SELECT started_at, ended_at, verify_started_at, verified_at, rejected_at
     FROM task_executions
     WHERE project_id = ? AND issue_iid = ? AND ${DEV_EXEC_FILTER}
     ORDER BY COALESCE(ended_at, started_at) DESC, started_at DESC
     LIMIT 1`
  ).get(projectId, issueIid) as any | undefined

  const firstExec = getDb().prepare(
    `SELECT started_at FROM task_executions
     WHERE project_id = ? AND issue_iid = ? AND ${DEV_EXEC_FILTER}
     ORDER BY started_at ASC LIMIT 1`
  ).get(projectId, issueIid) as any | undefined

  const stage = getDb().prepare(
    'SELECT confirmed_at, confirm_started_at, scheduled_at FROM issue_stages WHERE project_id = ? AND issue_iid = ?'
  ).get(projectId, issueIid) as any | undefined

  return {
    scheduledAt: stage?.scheduled_at ?? null,
    firstDevStartedAt: firstExec?.started_at ?? null,
    devStartedAt: lastExec?.started_at ?? null,
    devEndedAt: lastExec?.ended_at ?? null,
    verifyStartedAt: lastExec?.verify_started_at ?? null,
    verifyEndedAt: lastExec?.verified_at ?? lastExec?.rejected_at ?? null,
    confirmStartedAt: stage?.confirm_started_at ?? null,
    confirmedAt: stage?.confirmed_at ?? null,
  }
}

export function markIssueConfirmStarted(projectId: string, issueIid: number) {
  const now = new Date().toISOString()
  getDb().prepare(`
    INSERT INTO issue_stages (project_id, issue_iid, stage, confirm_started_at, updated_at)
    VALUES (?, ?, '', ?, datetime('now'))
    ON CONFLICT(project_id, issue_iid) DO UPDATE SET
      confirm_started_at = COALESCE(confirm_started_at, excluded.confirm_started_at),
      updated_at = datetime('now')
  `).run(projectId, issueIid, now)
}

export function markIssueVerifyStarted(projectId: string, issueIid: number) {
  const now = new Date().toISOString()
  getDb().prepare(
    "UPDATE task_executions SET verify_started_at = ? WHERE project_id = ? AND issue_iid = ? AND status IN ('success', 'failed') AND ended_at IS NOT NULL AND verify_started_at IS NULL AND id NOT LIKE 'ex-verify-%'"
  ).run(now, projectId, issueIid)
}

export function markIssueVerified(projectId: string, issueIid: number, verifier?: { name: string; avatar?: string; username?: string | null; userId?: string | null }) {
  const now = new Date().toISOString()
  let username = verifier?.username ?? null
  let name = verifier?.name ?? null
  let avatar = verifier?.avatar ?? null
  const userId = verifier?.userId ?? null
  if (!username) {
    const cached = getIssueAssigneeUsername(projectId, issueIid)
    if (cached.username) {
      username = cached.username
      if (!name) name = cached.name
      if (!avatar) avatar = cached.avatar || null
    }
  }
  getDb().prepare(
    "UPDATE task_executions SET verified_at = ?, verifier_name = ?, verifier_avatar = ?, verifier_username = ?, verifier_user_id = ? WHERE project_id = ? AND issue_iid = ? AND status IN ('success', 'failed') AND ended_at IS NOT NULL AND verify_started_at IS NOT NULL AND verified_at IS NULL AND rejected_at IS NULL AND id NOT LIKE 'ex-verify-%'"
  ).run(now, name, avatar, username, userId, projectId, issueIid)
}

/**
 * 확인 완료 시 issue_stages 에 confirmer 정보를 기록한다.
 * task_executions 의 verified_at 패턴과 달리, 확인 단계는 이슈 단위 1회 기록이므로
 * issue_stages.confirmed_at + confirmer_* 컬럼을 사용한다.
 */
export function markIssueConfirmed(projectId: string, issueIid: number, confirmer: { name?: string | null; avatar?: string | null; userId?: string | null }) {
  const now = new Date().toISOString()
  getDb().prepare(`
    INSERT INTO issue_stages (project_id, issue_iid, stage, confirmed_at, confirmer_user_id, confirmer_name, confirmer_avatar, updated_at)
    VALUES (?, ?, '', ?, ?, ?, ?, datetime('now'))
    ON CONFLICT(project_id, issue_iid) DO UPDATE SET
      confirmed_at = excluded.confirmed_at,
      confirmer_user_id = excluded.confirmer_user_id,
      confirmer_name = excluded.confirmer_name,
      confirmer_avatar = excluded.confirmer_avatar,
      updated_at = datetime('now')
  `).run(projectId, issueIid, now, confirmer.userId ?? null, confirmer.name ?? null, confirmer.avatar ?? null)
}

export function markIssueVerifyRejected(projectId: string, issueIid: number, verifier?: { name?: string | null; avatar?: string | null; username?: string | null; userId?: string | null }) {
  const now = new Date().toISOString()
  let username = verifier?.username ?? null
  let name = verifier?.name ?? null
  let avatar = verifier?.avatar ?? null
  const userId = verifier?.userId ?? null
  if (!username) {
    const cached = getIssueAssigneeUsername(projectId, issueIid)
    if (cached.username) {
      username = cached.username
      if (!name) name = cached.name
      if (!avatar) avatar = cached.avatar || null
    }
  }
  getDb().prepare(
    "UPDATE task_executions SET rejected_at = ?, verifier_name = COALESCE(verifier_name, ?), verifier_avatar = COALESCE(verifier_avatar, ?), verifier_username = COALESCE(verifier_username, ?), verifier_user_id = COALESCE(verifier_user_id, ?) WHERE project_id = ? AND issue_iid = ? AND status IN ('success', 'failed') AND ended_at IS NOT NULL AND verify_started_at IS NOT NULL AND verified_at IS NULL AND rejected_at IS NULL AND id NOT LIKE 'ex-verify-%'"
  ).run(now, name, avatar, username, userId, projectId, issueIid)
}

export function resetIssueScheduledAt(projectId: string, issueIid: number) {
  const now = new Date().toISOString()
  getDb().prepare(
    "UPDATE issue_stages SET scheduled_at = ?, updated_at = datetime('now') WHERE project_id = ? AND issue_iid = ?"
  ).run(now, projectId, issueIid)
}

export function hasAnyExecution(projectId: string, issueIid: number): boolean {
  const r = getDb().prepare(
    "SELECT id FROM task_executions WHERE project_id = ? AND issue_iid = ? LIMIT 1"
  ).get(projectId, issueIid)
  return !!r
}

export function hasActiveExecution(projectId: string, issueIid: number): boolean {
  const r = getDb().prepare(
    "SELECT id FROM task_executions WHERE project_id = ? AND issue_iid = ? AND status IN ('running', 'assigned') LIMIT 1"
  ).get(projectId, issueIid)
  return !!r
}

export function getAssignedUserExecution(projectId: string, issueIid: number): TaskExecution | null {
  const r = getDb().prepare(
    "SELECT * FROM task_executions WHERE project_id = ? AND issue_iid = ? AND status = 'assigned' AND assignee_type = 'user' LIMIT 1"
  ).get(projectId, issueIid) as any
  return r ? mapExecution(r) : null
}

export function hasPastExecution(projectId: string, issueIid: number): boolean {
  const r = getDb().prepare(
    "SELECT id FROM task_executions WHERE project_id = ? AND issue_iid = ? AND status IN ('success', 'failed') LIMIT 1"
  ).get(projectId, issueIid)
  return !!r
}

export function getLatestExecutionsByProject(projectId: string, limit: number = 20): TaskExecution[] {
  const rows = getDb().prepare(`
    SELECT te.*, a.name AS agent_name, a.avatar AS agent_avatar
    FROM task_executions te
    LEFT JOIN agents a ON a.id = te.agent_id
    WHERE te.project_id = ?
    ORDER BY te.started_at DESC
    LIMIT ?
  `).all(projectId, limit) as any[]
  return rows.map(mapExecution)
}

export function getLatestExecutionsByAgent(agentId: string, limit: number = 20): TaskExecution[] {
  const rows = getDb().prepare(`
    SELECT te.*, a.name AS agent_name, a.avatar AS agent_avatar
    FROM task_executions te
    LEFT JOIN agents a ON a.id = te.agent_id
    WHERE te.agent_id = ?
    ORDER BY te.started_at DESC
    LIMIT ?
  `).all(agentId, limit) as any[]
  return rows.map(mapExecution)
}

export function getTodayExecutionsByProject(projectId: string): TaskExecution[] {
  const todayStartISO = getKSTTodayStartISO()
  const rows = getDb().prepare(`
    SELECT te.*, a.name AS agent_name, a.avatar AS agent_avatar
    FROM task_executions te
    LEFT JOIN agents a ON a.id = te.agent_id
    WHERE te.project_id = ? AND te.started_at >= ?
    ORDER BY te.started_at DESC
  `).all(projectId, todayStartISO) as any[]
  return rows.map(mapExecution)
}

export function getTodayExecutionsByAgent(agentId: string): TaskExecution[] {
  const todayStartISO = getKSTTodayStartISO()
  const rows = getDb().prepare(`
    SELECT te.*, a.name AS agent_name, a.avatar AS agent_avatar
    FROM task_executions te
    LEFT JOIN agents a ON a.id = te.agent_id
    WHERE te.agent_id = ? AND te.started_at >= ?
    ORDER BY te.started_at DESC
  `).all(agentId, todayStartISO) as any[]
  return rows.map(mapExecution)
}

export function getYesterdayCompletedCount(entityType: 'project' | 'agent', entityId: string): number {
  const yesterdayStartISO = getKSTYesterdayStartISO()
  const todayStartISO = getKSTTodayStartISO()
  const col = entityType === 'project' ? 'project_id' : 'agent_id'
  const r = getDb().prepare(`
    SELECT COUNT(*) as cnt FROM task_executions
    WHERE ${col} = ? AND status IN ('success', 'failed')
    AND started_at >= ? AND started_at < ?
  `).get(entityId, yesterdayStartISO, todayStartISO) as { cnt: number }
  return r.cnt
}

export function assignIssueAtomically(
  projectId: string,
  issueIid: number,
  _stage: IssueStage,
  execution: TaskExecution,
): boolean {
  const tx = getDb().transaction(() => {
    const active = getDb().prepare(
      "SELECT id FROM task_executions WHERE project_id = ? AND issue_iid = ? AND status IN ('running', 'assigned') LIMIT 1"
    ).get(projectId, issueIid)
    if (active) return false

    createExecution(execution)
    return true
  })
  return tx()
}
