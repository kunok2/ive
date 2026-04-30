import { getDb } from './connection'

export interface MailBroadcastLog {
  id: string
  senderUserId: string | null
  senderName: string | null
  senderEmail: string | null
  subject: string
  body: string
  recipientEmails: string[]
  totalCount: number
  sentCount: number
  failedCount: number
  failedRecipients: { email: string; error?: string }[]
  sentAt: string
}

export type MailBroadcastLogSummary = Omit<MailBroadcastLog, 'body'> & { bodyLength: number }

function mapRow(r: any, includeBody: boolean): any {
  const base = {
    id: r.id,
    senderUserId: r.sender_user_id ?? null,
    senderName: r.sender_name ?? null,
    senderEmail: r.sender_email ?? null,
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

export function createMailBroadcastLog(log: Omit<MailBroadcastLog, 'id' | 'sentAt'> & { id?: string; sentAt?: string }): MailBroadcastLog {
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
  const rows = getDb().prepare('SELECT * FROM mail_broadcast_logs ORDER BY sent_at DESC LIMIT ? OFFSET ?').all(limit, offset) as any[]
  return rows.map(r => mapRow(r, false)) as MailBroadcastLogSummary[]
}

export function getMailBroadcastLogCount(): number {
  return (getDb().prepare('SELECT COUNT(*) as cnt FROM mail_broadcast_logs').get() as { cnt: number }).cnt
}

export function getMailBroadcastLog(id: string): MailBroadcastLog | null {
  const r = getDb().prepare('SELECT * FROM mail_broadcast_logs WHERE id = ?').get(id) as any
  return r ? (mapRow(r, true) as MailBroadcastLog) : null
}

export function deleteMailBroadcastLog(id: string) {
  getDb().prepare('DELETE FROM mail_broadcast_logs WHERE id = ?').run(id)
}
