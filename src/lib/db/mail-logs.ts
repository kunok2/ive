import { getDb } from './connection'

export interface MailBroadcastLog {
  id: string
  senderUserId: string | null
  senderName: string | null
  senderEmail: string | null
  /** 보낸 사람 아바타 (users 조인 — 탈퇴했으면 null) */
  senderAvatar: string | null
  subject: string
  body: string
  recipientEmails: string[]
  totalCount: number
  sentCount: number
  failedCount: number
  failedRecipients: { email: string; error?: string }[]
  sentAt: string
}

export type MailBroadcastLogSummary = Omit<MailBroadcastLog, 'body'> & {
  bodyLength: number
  clickCount: number      // 총 접속(클릭) 횟수
  clickUserCount: number  // 접속한 고유 사용자 수
}

/** 발송별 사용자 접속 통계 1행 */
export interface MailClickStat {
  userId: string | null
  email: string | null
  name: string | null      // users 조인 (탈퇴/미가입이면 null)
  avatar: string | null
  count: number            // 이 사용자의 접속 횟수
  firstAt: string
  lastAt: string
}

function mapRow(r: any, includeBody: boolean): any {
  const base = {
    id: r.id,
    senderUserId: r.sender_user_id ?? null,
    senderName: r.sender_name ?? null,
    senderEmail: r.sender_email ?? null,
    senderAvatar: r.sender_avatar ?? null,
    subject: r.subject,
    recipientEmails: safeParseArr(r.recipient_emails),
    totalCount: r.total_count ?? 0,
    sentCount: r.sent_count ?? 0,
    failedCount: r.failed_count ?? 0,
    failedRecipients: safeParseArr(r.failed_recipients),
    sentAt: r.sent_at,
  }
  if (includeBody) return { ...base, body: r.body ?? '' }
  return { ...base, bodyLength: (r.body ?? '').length }
}

function safeParseArr(s: any): any[] {
  if (!s) return []
  try {
    const v = JSON.parse(s)
    return Array.isArray(v) ? v : []
  } catch {
    return []
  }
}

export function createMailBroadcastLog(log: Omit<MailBroadcastLog, 'id' | 'sentAt' | 'senderAvatar'> & { id?: string; sentAt?: string }): MailBroadcastLog {
  const id = log.id || (typeof crypto !== 'undefined' && crypto.randomUUID ? crypto.randomUUID() : `mbl-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`)
  const sentAt = log.sentAt || new Date().toISOString()
  getDb().prepare(`
    INSERT INTO mail_broadcast_logs (id, sender_user_id, sender_name, sender_email, subject, body, recipient_emails, total_count, sent_count, failed_count, failed_recipients, sent_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    id,
    log.senderUserId,
    log.senderName,
    log.senderEmail,
    log.subject,
    log.body,
    JSON.stringify(log.recipientEmails || []),
    log.totalCount,
    log.sentCount,
    log.failedCount,
    JSON.stringify(log.failedRecipients || []),
    sentAt,
  )
  return { ...log, id, sentAt } as MailBroadcastLog
}

export function getMailBroadcastLogs(limit: number = 50, offset: number = 0): MailBroadcastLogSummary[] {
  const rows = getDb().prepare('SELECT l.*, u.avatar AS sender_avatar FROM mail_broadcast_logs l LEFT JOIN users u ON u.id = l.sender_user_id ORDER BY l.sent_at DESC LIMIT ? OFFSET ?').all(limit, offset) as any[]
  const summaries = rows.map(r => mapRow(r, false)) as MailBroadcastLogSummary[]
  // 발송별 접속 횟수/고유 사용자 수를 한 번에 채운다.
  const counts = getMailClickCountsBulk(summaries.map(s => s.id))
  for (const s of summaries) {
    const c = counts.get(s.id)
    s.clickCount = c?.clickCount ?? 0
    s.clickUserCount = c?.clickUserCount ?? 0
  }
  return summaries
}

/** 여러 발송의 접속 횟수/고유 사용자 수를 일괄 조회 */
export function getMailClickCountsBulk(logIds: string[]): Map<string, { clickCount: number; clickUserCount: number }> {
  const map = new Map<string, { clickCount: number; clickUserCount: number }>()
  if (logIds.length === 0) return map
  const placeholders = logIds.map(() => '?').join(',')
  const rows = getDb().prepare(`
    SELECT broadcast_log_id AS id, COUNT(*) AS clicks, COUNT(DISTINCT COALESCE(user_id, email, id)) AS users
    FROM mail_broadcast_clicks
    WHERE broadcast_log_id IN (${placeholders})
    GROUP BY broadcast_log_id
  `).all(...logIds) as any[]
  for (const r of rows) map.set(r.id, { clickCount: r.clicks ?? 0, clickUserCount: r.users ?? 0 })
  return map
}

/** 단일 발송의 접속 기록을 사용자별로 집계 (최근 접속 순). users 조인으로 이름/아바타 포함. */
export function getMailClickStats(logId: string): MailClickStat[] {
  const rows = getDb().prepare(`
    SELECT c.user_id AS userId,
           COALESCE(u.email, c.email) AS email,
           u.name AS name,
           u.avatar AS avatar,
           COUNT(*) AS count,
           MIN(c.clicked_at) AS firstAt,
           MAX(c.clicked_at) AS lastAt
    FROM mail_broadcast_clicks c
    LEFT JOIN users u ON u.id = c.user_id
    WHERE c.broadcast_log_id = ?
    GROUP BY COALESCE(c.user_id, c.email)
    ORDER BY lastAt DESC
  `).all(logId) as any[]
  return rows.map(r => ({
    userId: r.userId ?? null,
    email: r.email ?? null,
    name: r.name ?? null,
    avatar: r.avatar ?? null,
    count: r.count ?? 0,
    firstAt: r.firstAt,
    lastAt: r.lastAt,
  }))
}

/** IVE 접속 링크 클릭 1건 기록 */
export function recordMailClick(click: { broadcastLogId: string; userId?: string | null; email?: string | null; ip?: string | null; userAgent?: string | null }) {
  const id = `mbc-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
  getDb().prepare(`
    INSERT INTO mail_broadcast_clicks (id, broadcast_log_id, user_id, email, ip_address, user_agent)
    VALUES (?, ?, ?, ?, ?, ?)
  `).run(id, click.broadcastLogId, click.userId ?? null, click.email ?? null, click.ip ?? null, click.userAgent ?? null)
}

export function getMailBroadcastLogCount(): number {
  return (getDb().prepare('SELECT COUNT(*) as cnt FROM mail_broadcast_logs').get() as { cnt: number }).cnt
}

export function getMailBroadcastLog(id: string): MailBroadcastLog | null {
  const r = getDb().prepare('SELECT l.*, u.avatar AS sender_avatar FROM mail_broadcast_logs l LEFT JOIN users u ON u.id = l.sender_user_id WHERE l.id = ?').get(id) as any
  return r ? (mapRow(r, true) as MailBroadcastLog) : null
}

export function deleteMailBroadcastLog(id: string) {
  getDb().prepare('DELETE FROM mail_broadcast_clicks WHERE broadcast_log_id = ?').run(id)
  getDb().prepare('DELETE FROM mail_broadcast_logs WHERE id = ?').run(id)
}
