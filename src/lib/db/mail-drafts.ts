import { getDb } from './connection'

/**
 * 메일 임시저장(draft) — 작성했지만 아직 발송하지 않은 메일.
 * 발송 전까지 보관·수정하고, '메일 발송'에서 불러와 발송한다.
 * 발송 이력 복제도 새 draft로 들어온다(수신자는 비워 다른 사용자에게 재발송).
 */
export interface MailDraft {
  id: string
  subject: string
  body: string
  targetUserIds: string[]
  createdByUserId: string | null
  createdAt: string
  updatedAt: string
}

export type MailDraftSummary = Omit<MailDraft, 'body' | 'targetUserIds'> & { bodyLength: number; targetCount: number }

function rid(): string {
  return `mdf-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
}

function parseArr(s: any): string[] {
  if (!s) return []
  try { const v = JSON.parse(s); return Array.isArray(v) ? v : [] } catch { return [] }
}

export function createMailDraft(d: { subject: string; body: string; targetUserIds: string[]; createdByUserId: string | null }): MailDraft {
  const id = rid()
  const now = new Date().toISOString()
  getDb().prepare('INSERT INTO mail_drafts (id, subject, body, target_user_ids, created_by_user_id, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)')
    .run(id, d.subject, d.body, JSON.stringify(d.targetUserIds || []), d.createdByUserId, now, now)
  return { id, subject: d.subject, body: d.body, targetUserIds: d.targetUserIds || [], createdByUserId: d.createdByUserId, createdAt: now, updatedAt: now }
}

export function updateMailDraft(id: string, d: { subject: string; body: string; targetUserIds: string[] }): boolean {
  const now = new Date().toISOString()
  const r = getDb().prepare('UPDATE mail_drafts SET subject = ?, body = ?, target_user_ids = ?, updated_at = ? WHERE id = ?')
    .run(d.subject, d.body, JSON.stringify(d.targetUserIds || []), now, id)
  return r.changes > 0
}

export function getMailDrafts(): MailDraftSummary[] {
  const rows = getDb().prepare('SELECT * FROM mail_drafts ORDER BY updated_at DESC').all() as any[]
  return rows.map(r => ({
    id: r.id,
    subject: r.subject,
    bodyLength: (r.body ?? '').length,
    targetCount: parseArr(r.target_user_ids).length,
    createdByUserId: r.created_by_user_id ?? null,
    createdAt: r.created_at,
    updatedAt: r.updated_at,
  }))
}

export function getMailDraft(id: string): MailDraft | null {
  const r = getDb().prepare('SELECT * FROM mail_drafts WHERE id = ?').get(id) as any
  if (!r) return null
  return {
    id: r.id, subject: r.subject, body: r.body,
    targetUserIds: parseArr(r.target_user_ids),
    createdByUserId: r.created_by_user_id ?? null,
    createdAt: r.created_at, updatedAt: r.updated_at,
  }
}

export function deleteMailDraft(id: string) {
  getDb().prepare('DELETE FROM mail_drafts WHERE id = ?').run(id)
}
