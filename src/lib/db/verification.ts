import { getDb } from './connection'

export function saveVerificationCode(email: string, code: string, expiresAt: number) {
  getDb().prepare(`
    INSERT INTO verification_codes (email, code, expires_at)
    VALUES (?, ?, ?)
    ON CONFLICT(email) DO UPDATE SET code = excluded.code, expires_at = excluded.expires_at
  `).run(email, code, expiresAt)
}

export function getVerificationCode(email: string): string | null {
  const row = getDb().prepare(
    'SELECT code, expires_at FROM verification_codes WHERE email = ?'
  ).get(email) as { code: string; expires_at: number } | undefined

  if (!row) return null
  if (Date.now() > row.expires_at) {
    deleteVerificationCode(email)
    return null
  }
  return row.code
}

export function deleteVerificationCode(email: string) {
  getDb().prepare('DELETE FROM verification_codes WHERE email = ?').run(email)
}

// 만료된 코드 정리 (주기적으로 호출)
export function cleanExpiredVerificationCodes() {
  getDb().prepare('DELETE FROM verification_codes WHERE expires_at <= ?').run(Date.now())
}
