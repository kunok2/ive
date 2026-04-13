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

export function cleanOldActivityLogs(retentionDays: number = 90) {
  const cutoff = new Date(Date.now() - retentionDays * 86400000).toISOString()
  const result = getDb().prepare('DELETE FROM user_activity_logs WHERE created_at < ?').run(cutoff)
  if (result.changes > 0) {
    console.log(`[Cleanup] Purged ${result.changes} activity logs (retention: ${retentionDays}d)`)
  }
}
