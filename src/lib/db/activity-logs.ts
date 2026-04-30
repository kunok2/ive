import { UserActivityLog, ActivityCategory } from '@/types'
import { getDb } from './connection'

function mapActivityLog(r: any): UserActivityLog {
  return {
    id: r.id, userId: r.user_id,
    userName: r.user_name ?? undefined, userEmail: r.user_email ?? undefined,
    category: r.category as ActivityCategory, action: r.action,
    detail: r.detail || '',
    targetType: r.target_type ?? undefined, targetId: r.target_id ?? undefined,
    ipAddress: r.ip_address ?? undefined, userAgent: r.user_agent ?? undefined,
    createdAt: r.created_at,
  }
}

export function createActivityLog(log: {
  userId: string; category: ActivityCategory; action: string; detail: string;
  targetType?: string; targetId?: string; ipAddress?: string; userAgent?: string
}) {
  const id = `al-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
  getDb().prepare(
    `INSERT INTO user_activity_logs (id, user_id, category, action, detail, target_type, target_id, ip_address, user_agent)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(id, log.userId, log.category, log.action, log.detail, log.targetType ?? null, log.targetId ?? null, log.ipAddress ?? null, log.userAgent ?? null)
  return id
}

export function getActivityLogs(opts: {
  limit?: number; offset?: number; userId?: string; category?: string; startDate?: string; endDate?: string
}): { logs: UserActivityLog[]; total: number } {
  const conditions: string[] = []
  const params: any[] = []

  if (opts.userId) { conditions.push('al.user_id = ?'); params.push(opts.userId) }
  if (opts.category) { conditions.push('al.category = ?'); params.push(opts.category) }
  if (opts.startDate) { conditions.push('al.created_at >= ?'); params.push(opts.startDate) }
  if (opts.endDate) { conditions.push('al.created_at < ?'); params.push(opts.endDate) }

  const where = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : ''

  const countRow = getDb().prepare(`SELECT COUNT(*) as cnt FROM user_activity_logs al ${where}`).get(...params) as { cnt: number }

  const limit = opts.limit || 50
  const offset = opts.offset || 0
  const rows = getDb().prepare(`
    SELECT al.*, u.name as user_name, u.email as user_email
    FROM user_activity_logs al LEFT JOIN users u ON al.user_id = u.id
    ${where}
    ORDER BY al.created_at DESC LIMIT ? OFFSET ?
  `).all(...params, limit, offset) as any[]

  return { logs: rows.map(mapActivityLog), total: countRow.cnt }
}

export interface IssueRetryCounts {
  fromVerify: number   // 검증→처리 (반려)
  fromConfirm: number  // 확인→처리 (재작업 요청)
  fromDone: number     // 완료→재오픈
}

export interface IssueForwardCounts {
  toProcess: number   // 유입→처리 진입 횟수 (execution 행 수로 집계)
  toVerify: number    // 처리→검증 (task_complete)
  toConfirm: number   // 검증→확인 (task_approve)
  toDone: number      // 확인→완료 (task_accept)
}

/** 각 단계로 진입한 횟수 — 정방향 화살표에 표시. */
export function getIssueForwardCounts(projectId: string, issueIid: number): IssueForwardCounts {
  const targetId = `${projectId}:${issueIid}`
  // toConfirm(task_approve)/toDone(task_accept) 는 사람 액션이라 활동 로그로 집계.
  const rows = getDb().prepare(
    `SELECT action, COUNT(*) as cnt FROM user_activity_logs
     WHERE target_type = 'issue' AND target_id = ?
       AND action IN ('task_approve', 'task_accept')
     GROUP BY action`
  ).all(targetId) as Array<{ action: string; cnt: number }>
  let toConfirm = 0, toDone = 0
  for (const r of rows) {
    if (r.action === 'task_approve') toConfirm = r.cnt
    else if (r.action === 'task_accept') toDone = r.cnt
  }
  // toProcess: 전체 dev execution 수
  // toVerify: 검증 단계로 넘어간 dev execution 수 (verify_started_at 가 채워진 것)
  //   — agent 자동 플로우는 task_complete 활동 로그를 안 남기므로 execution 데이터로 집계.
  const DEV_FILTER = "id NOT LIKE 'ex-verify-%' AND id NOT LIKE 'ex-confirm-%'"
  const execRow = getDb().prepare(
    `SELECT
       COUNT(*) AS total,
       SUM(CASE WHEN verify_started_at IS NOT NULL THEN 1 ELSE 0 END) AS verified
     FROM task_executions
     WHERE project_id = ? AND issue_iid = ? AND ${DEV_FILTER}`
  ).get(projectId, issueIid) as { total: number; verified: number } | undefined
  return {
    toProcess: execRow?.total ?? 0,
    toVerify: execRow?.verified ?? 0,
    toConfirm,
    toDone,
  }
}

/** 이슈의 단계별 재실행 횟수를 user_activity_logs 에서 집계한다. */
export function getIssueRetryCounts(projectId: string, issueIid: number): IssueRetryCounts {
  const targetId = `${projectId}:${issueIid}`
  const rows = getDb().prepare(
    `SELECT action, COUNT(*) as cnt FROM user_activity_logs
     WHERE target_type = 'issue' AND target_id = ?
       AND action IN ('task_reject', 'task_return_to_dev', 'task_reopen')
     GROUP BY action`
  ).all(targetId) as Array<{ action: string; cnt: number }>
  let fromVerify = 0, fromConfirm = 0, fromDone = 0
  for (const r of rows) {
    if (r.action === 'task_reject') fromVerify = r.cnt
    else if (r.action === 'task_return_to_dev') fromConfirm = r.cnt
    else if (r.action === 'task_reopen') fromDone = r.cnt
  }
  return { fromVerify, fromConfirm, fromDone }
}

export function cleanOldActivityLogs(retentionDays: number = 90) {
  const cutoff = new Date(Date.now() - retentionDays * 86400000).toISOString()
  const result = getDb().prepare('DELETE FROM user_activity_logs WHERE created_at < ?').run(cutoff)
  if (result.changes > 0) {
    console.log(`[Cleanup] Purged ${result.changes} activity logs (retention: ${retentionDays}d)`)
  }
}
