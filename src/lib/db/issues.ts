import { Project } from '@/types'
import { getDb } from './connection'
import { getKSTTodayStartISO } from '../date-utils'

// ── Issue Stage (레이블 기반 상태 판정) ──

export type IssueStage = 'waiting' | 'verify_waiting' | 'dev' | 'dev_fail' | 'verifying' | 'done' | 'rejected'

export function stageFromLabels(
  labels: string[],
  project: Project,
  options?: { hasActiveExec?: boolean }
): IssueStage | null {
  if (!labels.includes(project.labelTarget)) return null

  const labelS = project.labelSchedule || 'IVE-S'
  const labelD = project.labelDev || 'IVE-D'
  const labelW = project.labelVerifyWait || 'IVE-W'
  const labelV = project.labelVerify || 'IVE-V'
  const labelE = project.labelEnd || 'IVE-E'

  if (labels.includes(labelE)) return 'done'
  if (labels.includes(labelV)) return 'verifying'
  if (labels.includes(labelW)) return 'verify_waiting'
  if (labels.includes(labelD)) {
    if (options?.hasActiveExec === false) return 'dev_fail'
    return 'dev'
  }
  if (labels.includes(labelS)) return 'waiting'
  return null
}

export function getLastExecutionStatus(projectId: string, issueIid: number): string | null {
  const r = getDb().prepare(
    "SELECT status FROM task_executions WHERE project_id = ? AND issue_iid = ? ORDER BY started_at DESC LIMIT 1"
  ).get(projectId, issueIid) as any
  return r?.status || null
}

// 하위 호환을 위해 유지 (deprecated)
export function getIssueStage(_projectId: string, _issueIid: number): IssueStage | null { return null }
export function getIssueStageUpdatedAt(_projectId: string, _issueIid: number): string | null { return null }

export function getIssueScheduledAt(projectId: string, issueIid: number): string | null {
  const r = getDb().prepare('SELECT scheduled_at FROM issue_stages WHERE project_id = ? AND issue_iid = ?').get(projectId, issueIid) as any
  return r?.scheduled_at || null
}

export function getCachedStage(projectId: string, issueIid: number): string | null {
  const r = getDb().prepare('SELECT cached_stage FROM issue_stages WHERE project_id = ? AND issue_iid = ?').get(projectId, issueIid) as any
  return r?.cached_stage || null
}

export function recordIssueScheduledAt(projectId: string, issueIid: number, scheduledAt: string) {
  getDb().prepare(`
    INSERT INTO issue_stages (project_id, issue_iid, stage, scheduled_at, updated_at)
    VALUES (?, ?, 'waiting', ?, datetime('now'))
    ON CONFLICT(project_id, issue_iid) DO UPDATE SET
      scheduled_at = COALESCE(issue_stages.scheduled_at, excluded.scheduled_at)
  `).run(projectId, issueIid, scheduledAt)
}

export function setIssueStage(_projectId: string, _issueIid: number, _stage: IssueStage, _failReason?: string, _updatedAt?: string) {
  // no-op: 레이블 기반으로 전환됨
}

export function deleteIssueStage(_projectId: string, _issueIid: number) {
  // no-op: 레이블 기반으로 전환됨
}

export function countIssuesByStage(_projectId: string, _stage: IssueStage): number {
  return 0
}

// ── Assign Mode ──

export interface AssignModeInfo {
  mode: 'auto' | 'assignee' | 'agent'
  agentId: string | null
  assigneeAuto: boolean
}

export function getAssignMode(projectId: string, issueIid: number): AssignModeInfo {
  const r = getDb().prepare('SELECT assign_mode, preferred_agent_id, assignee_auto FROM issue_stages WHERE project_id = ? AND issue_iid = ?').get(projectId, issueIid) as any
  return {
    mode: (r?.assign_mode as 'auto' | 'assignee' | 'agent') || 'auto',
    agentId: r?.preferred_agent_id || null,
    assigneeAuto: !!r?.assignee_auto,
  }
}

export function getAssignModeMap(projectId: string): Map<number, AssignModeInfo> {
  const rows = getDb().prepare(
    'SELECT issue_iid, assign_mode, preferred_agent_id, assignee_auto FROM issue_stages WHERE project_id = ?'
  ).all(projectId) as any[]
  const map = new Map<number, AssignModeInfo>()
  for (const r of rows) map.set(r.issue_iid, {
    mode: r.assign_mode || 'auto',
    agentId: r.preferred_agent_id || null,
    assigneeAuto: !!r.assignee_auto,
  })
  return map
}

export function setAssignMode(projectId: string, issueIid: number, mode: 'auto' | 'assignee' | 'agent', agentId?: string | null) {
  const effectiveAgentId = mode === 'agent' ? (agentId || null) : null
  getDb().prepare(`
    INSERT INTO issue_stages (project_id, issue_iid, stage, assign_mode, preferred_agent_id, updated_at)
    VALUES (?, ?, '', ?, ?, datetime('now'))
    ON CONFLICT(project_id, issue_iid) DO UPDATE SET assign_mode = excluded.assign_mode, preferred_agent_id = excluded.preferred_agent_id
  `).run(projectId, issueIid, mode, effectiveAgentId)
}

export function setAssigneeAuto(projectId: string, issueIid: number, value: boolean) {
  getDb().prepare(`
    INSERT INTO issue_stages (project_id, issue_iid, stage, assignee_auto, updated_at)
    VALUES (?, ?, '', ?, datetime('now'))
    ON CONFLICT(project_id, issue_iid) DO UPDATE SET assignee_auto = excluded.assignee_auto, updated_at = datetime('now')
  `).run(projectId, issueIid, value ? 1 : 0)
}

export function getAssigneeAuto(projectId: string, issueIid: number): boolean {
  const r = getDb().prepare('SELECT assignee_auto FROM issue_stages WHERE project_id = ? AND issue_iid = ?').get(projectId, issueIid) as any
  return !!r?.assignee_auto
}

export function countPreferredIssuesByAgent(agentId: string): number {
  const r = getDb().prepare("SELECT COUNT(*) as cnt FROM issue_stages WHERE preferred_agent_id = ?").get(agentId) as any
  return r?.cnt || 0
}

export function getPreferredIssuesByAgent(agentId: string): { projectId: string; projectName: string; issueIid: number }[] {
  return getDb().prepare(`
    SELECT s.project_id as projectId, p.name as projectName, s.issue_iid as issueIid
    FROM issue_stages s JOIN projects p ON p.id = s.project_id
    WHERE s.preferred_agent_id = ?
    ORDER BY s.updated_at ASC
  `).all(agentId) as any[]
}

export function clearPreferredAgentRefs(agentId: string) {
  getDb().prepare('UPDATE issue_stages SET preferred_agent_id = NULL WHERE preferred_agent_id = ?').run(agentId)
}

// ── Project Members ──

export function replaceProjectMembers(
  projectId: string,
  members: { username: string; name: string; avatarUrl: string; provider: string; gitUserId?: string | null }[]
) {
  const db = getDb()
  const tx = db.transaction(() => {
    db.prepare('DELETE FROM project_members WHERE project_id = ?').run(projectId)
    const stmt = db.prepare(`
      INSERT INTO project_members (project_id, username, name, avatar_url, provider, git_user_id, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, datetime('now'))
    `)
    for (const m of members) {
      if (!m.username) continue
      stmt.run(projectId, m.username, m.name || m.username, m.avatarUrl || '', m.provider || 'gitlab', m.gitUserId ?? null)
    }
  })
  tx()
}

// ── Verifier (Git assignee 기반 검증자) ──

export function upsertIssueStageSnapshot(
  projectId: string,
  issueIid: number,
  snapshot: {
    cachedStage: string | null
    assigneeUsername: string | null
    assigneeName: string | null
    assigneeAvatar: string | null
    assigneeProvider: string | null
    assigneeGitUserId: string | null
    issueTitle: string | null
  }
) {
  getDb().prepare(`
    INSERT INTO issue_stages (project_id, issue_iid, stage, cached_stage, assignee_username, assignee_name, assignee_avatar, assignee_provider, assignee_git_user_id, issue_title, verify_waiting_since, updated_at)
    VALUES (?, ?, '', ?, ?, ?, ?, ?, ?, ?,
      CASE WHEN ? IN ('verify_waiting', 'verifying') THEN datetime('now') ELSE NULL END,
      datetime('now'))
    ON CONFLICT(project_id, issue_iid) DO UPDATE SET
      cached_stage = excluded.cached_stage,
      assignee_username = excluded.assignee_username,
      assignee_name = excluded.assignee_name,
      assignee_avatar = excluded.assignee_avatar,
      assignee_provider = excluded.assignee_provider,
      assignee_git_user_id = excluded.assignee_git_user_id,
      issue_title = excluded.issue_title,
      verify_waiting_since = CASE
        WHEN excluded.cached_stage IN ('verify_waiting', 'verifying') THEN
          COALESCE(issue_stages.verify_waiting_since, datetime('now'))
        ELSE NULL
      END,
      updated_at = datetime('now')
  `).run(
    projectId, issueIid,
    snapshot.cachedStage,
    snapshot.assigneeUsername,
    snapshot.assigneeName,
    snapshot.assigneeAvatar,
    snapshot.assigneeProvider,
    snapshot.assigneeGitUserId,
    snapshot.issueTitle,
    snapshot.cachedStage
  )
}

export function getIssueAssigneeUsername(projectId: string, issueIid: number): { username: string | null; name: string | null; avatar: string | null } {
  const r = getDb().prepare(
    'SELECT assignee_username, assignee_name, assignee_avatar FROM issue_stages WHERE project_id = ? AND issue_iid = ?'
  ).get(projectId, issueIid) as any
  return {
    username: r?.assignee_username || null,
    name: r?.assignee_name || null,
    avatar: r?.assignee_avatar || null,
  }
}

export interface VerifierSummary {
  username: string
  name: string
  avatar: string
  provider: string
  verifying: number
  verifyWaiting: number
  approvedToday: number
  rejectedToday: number
  approved7d: number
  rejected7d: number
  avgVerifyMin: number
  oldestWaitMin: number
  assignedProjects: { id: string; name: string; color: string; provider: string }[]
  iveUser: { id: string; name: string; email: string; avatar: string } | null
}

export function getVerifiersList(userId: string): VerifierSummary[] {
  const db = getDb()
  const accessCondition = `(p.user_id = ? OR EXISTS (SELECT 1 FROM project_shares ps WHERE ps.project_id = p.id AND ps.user_id = ?))`
  const todayStartISO = getKSTTodayStartISO()
  const week7Ago = new Date(Date.now() - 7 * 86400 * 1000).toISOString()

  const memberRows = db.prepare(`
    SELECT pm.username, pm.name, pm.avatar_url, pm.provider, pm.git_user_id, p.id as project_id, p.name as project_name, p.color as project_color
    FROM project_members pm JOIN projects p ON p.id = pm.project_id
    WHERE ${accessCondition}
  `).all(userId, userId) as any[]

  interface Meta {
    username: string; name: string; avatar: string; provider: string; gitUserId: string | null
    projects: Map<string, { id: string; name: string; color: string; provider: string }>
  }
  const metaMap = new Map<string, Meta>()
  const metaKey = (provider: string, username: string) => `${provider || 'gitlab'}:${username}`

  for (const m of memberRows) {
    const key = metaKey(m.provider, m.username)
    const existing = metaMap.get(key) || {
      username: m.username, name: m.name || m.username, avatar: m.avatar_url || 'av-01',
      provider: m.provider || 'gitlab', gitUserId: m.git_user_id || null, projects: new Map(),
    }
    existing.projects.set(m.project_id, { id: m.project_id, name: m.project_name, color: m.project_color, provider: m.provider || 'gitlab' })
    if (!existing.name && m.name) existing.name = m.name
    if (!existing.avatar && m.avatar_url) existing.avatar = m.avatar_url
    if (!existing.gitUserId && m.git_user_id) existing.gitUserId = m.git_user_id
    metaMap.set(key, existing)
  }

  const currentRows = db.prepare(`
    SELECT s.assignee_username as username, COALESCE(s.assignee_provider, 'gitlab') as provider,
      MAX(s.assignee_name) as name, MAX(s.assignee_avatar) as avatar, MAX(s.assignee_git_user_id) as git_user_id,
      SUM(CASE WHEN s.cached_stage = 'verifying' THEN 1 ELSE 0 END) as verifying,
      SUM(CASE WHEN s.cached_stage = 'verify_waiting' THEN 1 ELSE 0 END) as verify_waiting,
      MIN(CASE WHEN s.cached_stage IN ('verify_waiting', 'verifying') THEN s.verify_waiting_since ELSE NULL END) as oldest_wait_at
    FROM issue_stages s JOIN projects p ON p.id = s.project_id
    WHERE s.assignee_username IS NOT NULL AND s.cached_stage IN ('verify_waiting', 'verifying') AND ${accessCondition}
    GROUP BY COALESCE(s.assignee_provider, 'gitlab'), s.assignee_username
  `).all(userId, userId) as any[]
  const currentMap = new Map<string, any>()
  for (const r of currentRows) {
    const key = metaKey(r.provider, r.username)
    currentMap.set(key, r)
    const existing = metaMap.get(key)
    if (!existing) {
      metaMap.set(key, { username: r.username, name: r.name || r.username, avatar: r.avatar || 'av-01', provider: r.provider || 'gitlab', gitUserId: r.git_user_id || null, projects: new Map() })
    } else if (!existing.gitUserId && r.git_user_id) { existing.gitUserId = r.git_user_id }
  }

  // IVE 사용자 매칭
  const iveUserByGitId = new Map<string, { id: string; name: string; email: string; avatar: string }>()
  const gitIdsToMatch = Array.from(metaMap.values()).map(m => m.gitUserId).filter((id): id is string => !!id)
  if (gitIdsToMatch.length > 0) {
    const placeholders = gitIdsToMatch.map(() => '?').join(',')
    const iveRows = db.prepare(`
      SELECT u.id, u.name, u.email, u.avatar, u.oauth_user_id, op.type as provider_type
      FROM users u JOIN oauth_providers op ON op.id = u.oauth_provider_id
      WHERE u.oauth_user_id IN (${placeholders})
    `).all(...gitIdsToMatch) as any[]
    for (const row of iveRows) {
      iveUserByGitId.set(`${row.provider_type}:${row.oauth_user_id}`, { id: row.id, name: row.name, email: row.email, avatar: row.avatar || 'av-01' })
    }
  }

  const execStats = db.prepare(`
    SELECT te.verifier_username as username, p.provider as provider,
      SUM(CASE WHEN te.verified_at IS NOT NULL AND te.verified_at >= ? THEN 1 ELSE 0 END) as approved_7d,
      SUM(CASE WHEN te.rejected_at IS NOT NULL AND te.rejected_at >= ? THEN 1 ELSE 0 END) as rejected_7d,
      SUM(CASE WHEN te.verified_at IS NOT NULL AND te.verified_at >= ? THEN 1 ELSE 0 END) as approved_today,
      SUM(CASE WHEN te.rejected_at IS NOT NULL AND te.rejected_at >= ? THEN 1 ELSE 0 END) as rejected_today,
      AVG(CASE WHEN te.verified_at IS NOT NULL AND te.verify_started_at IS NOT NULL AND te.verified_at >= ?
        THEN (strftime('%s', te.verified_at) - strftime('%s', te.verify_started_at)) / 60.0
        ELSE NULL END) as avg_verify_min
    FROM task_executions te JOIN projects p ON p.id = te.project_id
    WHERE te.verifier_username IS NOT NULL AND ${accessCondition}
    GROUP BY p.provider, te.verifier_username
  `).all(week7Ago, week7Ago, todayStartISO, todayStartISO, week7Ago, userId, userId) as any[]
  const execMap = new Map<string, any>()
  for (const r of execStats) {
    const key = metaKey(r.provider, r.username)
    execMap.set(key, r)
    if (!metaMap.has(key)) {
      metaMap.set(key, { username: r.username, name: r.username, avatar: 'av-01', provider: r.provider || 'gitlab', gitUserId: null, projects: new Map() })
    }
  }

  const now = Date.now()
  return Array.from(metaMap.entries()).map(([key, meta]) => {
    const curr = currentMap.get(key)
    const exec = execMap.get(key)
    const oldestWaitMs = curr?.oldest_wait_at ? now - new Date(curr.oldest_wait_at + 'Z').getTime() : 0
    const iveUser = meta.gitUserId ? (iveUserByGitId.get(`${meta.provider}:${meta.gitUserId}`) || null) : null
    return {
      username: meta.username, name: meta.name, avatar: meta.avatar, provider: meta.provider,
      verifying: Number(curr?.verifying || 0), verifyWaiting: Number(curr?.verify_waiting || 0),
      approvedToday: Number(exec?.approved_today || 0), rejectedToday: Number(exec?.rejected_today || 0),
      approved7d: Number(exec?.approved_7d || 0), rejected7d: Number(exec?.rejected_7d || 0),
      avgVerifyMin: exec?.avg_verify_min != null ? Math.round(Number(exec.avg_verify_min) * 10) / 10 : 0,
      oldestWaitMin: oldestWaitMs > 0 ? Math.round(oldestWaitMs / 60000) : 0,
      assignedProjects: Array.from(meta.projects.values()),
      iveUser,
    }
  }).sort((a, b) => {
    const diff = (b.verifyWaiting + b.verifying) - (a.verifyWaiting + a.verifying)
    if (diff !== 0) return diff
    const activityDiff = (b.approved7d + b.rejected7d) - (a.approved7d + a.rejected7d)
    if (activityDiff !== 0) return activityDiff
    return a.name.localeCompare(b.name)
  })
}

export function getVerifierBacklogForReport(userId: string): {
  username: string; name: string; avatar: string; provider: string;
  verifyWaiting: number; verifying: number; oldestWaitMin: number; assignedProjectNames: string[]
}[] {
  const db = getDb()
  const rows = db.prepare(`
    SELECT s.assignee_username as username, MAX(s.assignee_name) as name, MAX(s.assignee_avatar) as avatar,
      MAX(s.assignee_provider) as provider,
      SUM(CASE WHEN s.cached_stage = 'verify_waiting' THEN 1 ELSE 0 END) as verify_waiting,
      SUM(CASE WHEN s.cached_stage = 'verifying' THEN 1 ELSE 0 END) as verifying,
      MIN(CASE WHEN s.cached_stage IN ('verify_waiting', 'verifying') THEN s.verify_waiting_since ELSE NULL END) as oldest_wait_at
    FROM issue_stages s JOIN projects p ON p.id = s.project_id
    WHERE s.assignee_username IS NOT NULL AND s.cached_stage IN ('verify_waiting', 'verifying')
      AND (p.user_id = ? OR EXISTS (SELECT 1 FROM project_shares ps WHERE ps.project_id = p.id AND ps.user_id = ?))
    GROUP BY s.assignee_username
  `).all(userId, userId) as any[]

  const projectRows = db.prepare(`
    SELECT DISTINCT s.assignee_username as username, p.name as project_name
    FROM issue_stages s JOIN projects p ON p.id = s.project_id
    WHERE s.assignee_username IS NOT NULL AND s.cached_stage IN ('verify_waiting', 'verifying')
      AND (p.user_id = ? OR EXISTS (SELECT 1 FROM project_shares ps WHERE ps.project_id = p.id AND ps.user_id = ?))
  `).all(userId, userId) as any[]
  const projMap = new Map<string, string[]>()
  for (const r of projectRows) {
    if (!projMap.has(r.username)) projMap.set(r.username, [])
    projMap.get(r.username)!.push(r.project_name)
  }

  const now = Date.now()
  return rows.map(r => ({
    username: r.username, name: r.name || r.username, avatar: r.avatar || 'av-01', provider: r.provider || 'gitlab',
    verifyWaiting: Number(r.verify_waiting || 0), verifying: Number(r.verifying || 0),
    oldestWaitMin: r.oldest_wait_at ? Math.round((now - new Date(r.oldest_wait_at + 'Z').getTime()) / 60000) : 0,
    assignedProjectNames: projMap.get(r.username) || [],
  }))
}

export function getVerifierQueue(userId: string, username: string): { projectId: string; projectName: string; projectColor: string; issueIid: number; issueTitle: string; stage: string; waitingSince: string | null }[] {
  return getDb().prepare(`
    SELECT s.project_id as projectId, p.name as projectName, p.color as projectColor,
      s.issue_iid as issueIid, COALESCE(s.issue_title, '') as issueTitle,
      s.cached_stage as stage, s.verify_waiting_since as waitingSince
    FROM issue_stages s JOIN projects p ON p.id = s.project_id
    WHERE s.assignee_username = ? AND s.cached_stage IN ('verify_waiting', 'verifying')
      AND (p.user_id = ? OR EXISTS (SELECT 1 FROM project_shares ps WHERE ps.project_id = p.id AND ps.user_id = ?))
    ORDER BY s.verify_waiting_since IS NULL, s.verify_waiting_since ASC, s.issue_iid ASC
  `).all(username, userId, userId) as any[]
}

export function getMyVerifierQueue(
  userId: string, oauthUserId: string, providerType: 'github' | 'gitlab',
): { projectId: string; projectName: string; projectColor: string; issueIid: number; issueTitle: string; stage: string; waitingSince: string | null }[] {
  return getDb().prepare(`
    SELECT s.project_id as projectId, p.name as projectName, p.color as projectColor,
      s.issue_iid as issueIid, COALESCE(s.issue_title, '') as issueTitle,
      s.cached_stage as stage, s.verify_waiting_since as waitingSince
    FROM issue_stages s JOIN projects p ON p.id = s.project_id
    WHERE s.assignee_git_user_id = ? AND p.provider = ?
      AND s.cached_stage IN ('verify_waiting', 'verifying')
      AND (p.user_id = ? OR EXISTS (SELECT 1 FROM project_shares ps WHERE ps.project_id = p.id AND ps.user_id = ?))
    ORDER BY s.verify_waiting_since IS NULL, s.verify_waiting_since ASC, s.issue_iid ASC
  `).all(oauthUserId, providerType, userId, userId) as any[]
}

export function getMyVerifierCounts(
  userId: string, oauthUserId: string, providerType: 'github' | 'gitlab',
): { verifyWaiting: number; verifying: number; total: number } {
  const r = getDb().prepare(`
    SELECT
      SUM(CASE WHEN s.cached_stage = 'verify_waiting' THEN 1 ELSE 0 END) as verify_waiting,
      SUM(CASE WHEN s.cached_stage = 'verifying' THEN 1 ELSE 0 END) as verifying
    FROM issue_stages s JOIN projects p ON p.id = s.project_id
    WHERE s.assignee_git_user_id = ? AND p.provider = ?
      AND s.cached_stage IN ('verify_waiting', 'verifying')
      AND (p.user_id = ? OR EXISTS (SELECT 1 FROM project_shares ps WHERE ps.project_id = p.id AND ps.user_id = ?))
  `).get(oauthUserId, providerType, userId, userId) as any
  const verifyWaiting = Number(r?.verify_waiting || 0)
  const verifying = Number(r?.verifying || 0)
  return { verifyWaiting, verifying, total: verifyWaiting + verifying }
}
