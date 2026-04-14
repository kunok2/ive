import { TaskExecution, TaskStatus } from '@/types'
import { getDb } from './connection'
import { getKSTTodayStartISO, getKSTYesterdayStartISO } from '../date-utils'
import { getIssueAssigneeUsername } from './issues'
import type { IssueStage } from './issues'

function mapExecution(r: any): TaskExecution {
  return {
    id: r.id, projectId: r.project_id, agentId: r.agent_id ?? '',
    issueIid: r.issue_iid, issueTitle: r.issue_title ?? undefined,
    modelName: r.model_name ?? undefined,
    status: r.status, startedAt: r.started_at, endedAt: r.ended_at,
    logPath: r.log_path, pid: r.pid ?? undefined,
    agentName: r.agent_name ?? undefined,
    inputTokens: r.input_tokens ?? 0, outputTokens: r.output_tokens ?? 0,
    cacheReadInputTokens: r.cache_read_input_tokens ?? 0,
    cacheCreationInputTokens: r.cache_creation_input_tokens ?? 0,
    costUsd: r.cost_usd ?? 0, turns: r.turns ?? 0,
    issueCreatedAt: r.issue_created_at ?? undefined,
    assigneeType: r.assignee_type ?? 'agent',
    userId: r.user_id ?? null,
    userName: r.user_name ?? null,
    userAvatar: r.user_avatar ?? null,
  }
}

export function createExecution(ex: TaskExecution) {
  getDb().prepare(
    'INSERT INTO task_executions (id, project_id, agent_id, issue_iid, issue_title, status, started_at, ended_at, log_path, issue_created_at, assignee_type, user_id, user_name, user_avatar) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)'
  ).run(ex.id, ex.projectId, ex.agentId || null, ex.issueIid, ex.issueTitle ?? null, ex.status, ex.startedAt, ex.endedAt ?? null, ex.logPath, ex.issueCreatedAt ?? null, ex.assigneeType ?? 'agent', ex.userId ?? null, ex.userName ?? null, ex.userAvatar ?? null)
}

export function updateExecutionStatus(id: string, status: TaskStatus, endedAt?: string) {
  const isTerminal = status === 'success' || status === 'failed'
  const effectiveEndedAt = endedAt || (isTerminal ? new Date().toISOString() : null)
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

export function markIssueVerifyStarted(projectId: string, issueIid: number) {
  const now = new Date().toISOString()
  getDb().prepare(
    "UPDATE task_executions SET verify_started_at = ? WHERE project_id = ? AND issue_iid = ? AND status IN ('success', 'failed') AND ended_at IS NOT NULL AND verify_started_at IS NULL"
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
    "UPDATE task_executions SET verified_at = ?, verifier_name = ?, verifier_avatar = ?, verifier_username = ?, verifier_user_id = ? WHERE project_id = ? AND issue_iid = ? AND status IN ('success', 'failed') AND ended_at IS NOT NULL AND verify_started_at IS NOT NULL AND verified_at IS NULL AND rejected_at IS NULL"
  ).run(now, name, avatar, username, userId, projectId, issueIid)
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
    "UPDATE task_executions SET rejected_at = ?, verifier_name = COALESCE(verifier_name, ?), verifier_avatar = COALESCE(verifier_avatar, ?), verifier_username = COALESCE(verifier_username, ?), verifier_user_id = COALESCE(verifier_user_id, ?) WHERE project_id = ? AND issue_iid = ? AND status IN ('success', 'failed') AND ended_at IS NOT NULL AND verify_started_at IS NOT NULL AND verified_at IS NULL AND rejected_at IS NULL"
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
    SELECT te.*, a.name AS agent_name
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
    SELECT te.*, a.name AS agent_name
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
    SELECT te.*, a.name AS agent_name
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
    SELECT te.*, a.name AS agent_name
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
