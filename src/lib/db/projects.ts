import { Project } from '@/types'
import { getDb } from './connection'
import { getProjectWithUserOAuth } from './oauth'
import { decrypt } from '../crypto'

export type ProjectRow = {
  id: string; user_id: string; name: string; provider: string;
  repo_url: string; auth_type: string; git_username: string;
  access_token: string; color: string; created_at: string;
  label_target: string; show_tool_usage: number;
  check_interval: number; last_checked_at: string | null;
  last_scanned_issue_count: number | null;
  last_verify_waiting_count: number | null;
  scanner_active: number;
  uses_oauth_token: number;
  last_error: string | null; last_error_at: string | null;
  sort_order: number; avatar_url: string;
  snapshot_interval: number; sparkline_points: number; stats_retention: number;
  conflict_count: number;
  last_activity_at: string | null;
  label_schedule: string;
  label_dev: string;
  label_verify_wait: string;
  label_verify: string;
  label_confirm_wait: string;
  label_confirm: string;
  label_end: string;
  base_branch: string;
  confirm_base_branch: string;
}

export function mapProject(r: ProjectRow): Project {
  return {
    id: r.id, userId: r.user_id, name: r.name, provider: r.provider as Project['provider'],
    repoUrl: r.repo_url, authType: (r.auth_type || 'token') as Project['authType'],
    gitUsername: r.git_username || '', accessToken: r.access_token,
    color: (r.color || '#4ade80') as Project['color'],
    createdAt: r.created_at,
    labelTarget: r.label_target,
    labelSchedule: r.label_schedule || 'IVE-S',
    labelDev: r.label_dev || 'IVE-D',
    labelVerifyWait: r.label_verify_wait || 'IVE-W',
    labelVerify: r.label_verify || 'IVE-V',
    labelConfirmWait: r.label_confirm_wait || 'IVE-P',
    labelConfirm: r.label_confirm || 'IVE-C',
    labelEnd: r.label_end || 'IVE-E',
    baseBranch: r.base_branch || '',
    confirmBaseBranch: r.confirm_base_branch || '',
    showToolUsage: r.show_tool_usage === 1,
    checkInterval: r.check_interval,
    lastCheckedAt: r.last_checked_at,
    lastScannedIssueCount: r.last_scanned_issue_count,
    lastVerifyWaitingCount: r.last_verify_waiting_count,
    scannerActive: r.scanner_active === 1,
    usesOAuthToken: r.uses_oauth_token === 1,
    lastError: r.last_error ?? null,
    lastErrorAt: r.last_error_at ?? null,
    sortOrder: r.sort_order ?? 0,
    avatarUrl: r.avatar_url || '',
    snapshotInterval: r.snapshot_interval ?? 1,
    sparklinePoints: r.sparkline_points ?? 60,
    statsRetention: r.stats_retention ?? 7,
    conflictCount: r.conflict_count ?? 0,
    lastActivityAt: r.last_activity_at ?? null,
  }
}

export function getAllProjects(): Project[] {
  return (getDb().prepare('SELECT * FROM projects').all() as ProjectRow[]).map(mapProject)
}

export function getProjectsByUser(userId: string): Project[] {
  return (getDb().prepare(`
    SELECT p.*
    FROM projects p
    WHERE p.user_id = ?
    ORDER BY p.last_activity_at DESC, p.sort_order ASC, p.created_at ASC
  `).all(userId) as ProjectRow[]).map(mapProject)
}

export function touchProjectActivity(projectId: string) {
  getDb().prepare('UPDATE projects SET last_activity_at = datetime(\'now\') WHERE id = ?').run(projectId)
}

export function getProject(id: string): Project | null {
  const r = getDb().prepare('SELECT * FROM projects WHERE id = ?').get(id) as ProjectRow | undefined
  return r ? mapProject(r) : null
}

export function getProjectAuthToken(projectId: string): string {
  const p = getProject(projectId)
  if (!p) return ''
  if (p.usesOAuthToken) {
    const full = getProjectWithUserOAuth(projectId)
    if (full?.oauth_access_token) {
      return decrypt(full.oauth_access_token)
    }
    return ''
  }
  try {
    return decrypt(p.accessToken)
  } catch {
    return p.accessToken
  }
}

export function createProject(p: Project) {
  const maxOrder = getDb().prepare("SELECT COALESCE(MAX(sort_order), -1) as m FROM projects WHERE user_id = ?").get(p.userId) as { m: number }
  const sortOrder = p.sortOrder ?? (maxOrder.m + 1)

  getDb().prepare(
    `INSERT INTO projects (
      id, user_id, name, provider, repo_url, auth_type, git_username, access_token, color,
      label_target, label_schedule, label_dev, label_verify_wait, label_verify, label_confirm_wait, label_confirm, label_end, base_branch, confirm_base_branch, show_tool_usage,
      check_interval, last_checked_at, last_scanned_issue_count, last_verify_waiting_count, scanner_active, uses_oauth_token, sort_order,
      avatar_url, snapshot_interval, sparkline_points, stats_retention, last_error, last_error_at, created_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(
    p.id, p.userId, p.name, p.provider, p.repoUrl, p.authType || 'token', p.gitUsername || '',
    p.accessToken, p.color || '#4ade80',
    p.labelTarget, p.labelSchedule || 'IVE-S', p.labelDev || 'IVE-D',
    p.labelVerifyWait || 'IVE-W', p.labelVerify || 'IVE-V',
    p.labelConfirmWait || 'IVE-P', p.labelConfirm || 'IVE-C',
    p.labelEnd || 'IVE-E', p.baseBranch || '', p.confirmBaseBranch || '', p.showToolUsage ? 1 : 0,
    p.checkInterval, p.lastCheckedAt, p.lastScannedIssueCount, p.lastVerifyWaitingCount, p.scannerActive ? 1 : 0, p.usesOAuthToken ? 1 : 0, sortOrder,
    p.avatarUrl || '', p.snapshotInterval ?? 1, p.sparklinePoints ?? 60, p.statsRetention ?? 7,
    p.lastError || null, p.lastErrorAt || null, p.createdAt
  )
}

export function updateProject(p: Project) {
  getDb().prepare(
    `UPDATE projects SET
      name = ?, repo_url = ?, access_token = ?, color = ?,
      auth_type = ?, git_username = ?,
      label_target = ?, label_schedule = ?, label_dev = ?,
      label_verify_wait = ?, label_verify = ?, label_confirm_wait = ?, label_confirm = ?,
      label_end = ?, base_branch = ?, confirm_base_branch = ?, show_tool_usage = ?,
      check_interval = ?, last_checked_at = ?, last_scanned_issue_count = ?,
      scanner_active = ?, uses_oauth_token = ?, sort_order = ?, avatar_url = ?,
      snapshot_interval = ?, sparkline_points = ?, stats_retention = ?
      WHERE id = ? AND user_id = ?`
  ).run(
    p.name, p.repoUrl, p.accessToken, p.color || '#4ade80',
    p.authType || 'token', p.gitUsername || '',
    p.labelTarget, p.labelSchedule || 'IVE-S', p.labelDev || 'IVE-D',
    p.labelVerifyWait || 'IVE-W', p.labelVerify || 'IVE-V',
    p.labelConfirmWait || 'IVE-P', p.labelConfirm || 'IVE-C',
    p.labelEnd || 'IVE-E', p.baseBranch || '', p.confirmBaseBranch || '', p.showToolUsage ? 1 : 0,
    p.checkInterval, p.lastCheckedAt, p.lastScannedIssueCount,
    p.scannerActive ? 1 : 0, p.usesOAuthToken ? 1 : 0, p.sortOrder ?? 0, p.avatarUrl || '',
    p.snapshotInterval ?? 1, p.sparklinePoints ?? 60, p.statsRetention ?? 7,
    p.id, p.userId
  )
}

export function updateProjectSortOrders(userId: string, orders: { id: string; sortOrder: number }[]) {
  const stmt = getDb().prepare('UPDATE projects SET sort_order = ? WHERE id = ? AND user_id = ?')
  const tx = getDb().transaction(() => {
    for (const o of orders) {
      stmt.run(o.sortOrder, o.id, userId)
    }
  })
  tx()
}

export function getVerifyWaitingCount(projectId: string): number {
  const r = getDb().prepare(
    "SELECT COUNT(*) as cnt FROM issue_stages WHERE project_id = ? AND cached_stage = 'verify_waiting'"
  ).get(projectId) as any
  return Number(r?.cnt || 0)
}

export function updateProjectLastChecked(id: string, timestamp: string, issueCount: number, verifyWaitingCount: number = 0) {
  getDb().prepare('UPDATE projects SET last_checked_at = ?, last_scanned_issue_count = ?, last_verify_waiting_count = ?, last_error = NULL, last_error_at = NULL WHERE id = ?').run(timestamp, issueCount, verifyWaitingCount, id)
}

export function updateProjectError(id: string, error: string) {
  getDb().prepare('UPDATE projects SET last_error = ?, last_error_at = ? WHERE id = ?').run(error, new Date().toISOString(), id)
}

export function updateProjectConflictCount(id: string, count: number) {
  getDb().prepare('UPDATE projects SET conflict_count = ? WHERE id = ?').run(count, id)
}

export function clearProjectError(id: string) {
  getDb().prepare('UPDATE projects SET last_error = NULL, last_error_at = NULL WHERE id = ?').run(id)
}

export function deleteProject(id: string, userId: string) {
  getDb().prepare('DELETE FROM projects WHERE id = ? AND user_id = ?').run(id, userId)
}
