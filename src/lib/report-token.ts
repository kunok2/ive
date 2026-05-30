import crypto from 'crypto'

// Nonce replay attack 방지를 위한 in-memory store
const usedNonces = new Map<string, number>()
const NONCE_EXPIRY_MS = 24 * 60 * 60 * 1000 // 24시간

// HMAC 토큰 생성
export function generateReportToken(secret: string, projectId: string, expiresHours = 168): {
  token: string
  nonce: string
  timestamp: number
  expires: number
} {
  const nonce = crypto.randomBytes(16).toString('hex')
  const timestamp = Date.now()
  const expires = timestamp + expiresHours * 60 * 60 * 1000

  // HMAC 서명: projectId:nonce:timestamp:expires
  const data = `${projectId}:${nonce}:${timestamp}:${expires}`
  const token = crypto
    .createHmac('sha256', secret)
    .update(data)
    .digest('hex')

  return { token, nonce, timestamp, expires }
}

// HMAC 서명 + 만료만 검증 (nonce 재사용 체크/기록 없음).
// 동일 토큰으로 여러 번 호출되는 보조 동작(이미지 업로드 등)에서 사용한다.
export function verifyReportTokenSignature(
  secret: string,
  projectId: string,
  token: string,
  nonce: string,
  timestamp: number,
  expires: number
): { valid: boolean; error?: string } {
  if (Date.now() > expires) {
    return { valid: false, error: 'Token expired' }
  }

  const data = `${projectId}:${nonce}:${timestamp}:${expires}`
  const expectedToken = crypto
    .createHmac('sha256', secret)
    .update(data)
    .digest('hex')

  if (token !== expectedToken) {
    return { valid: false, error: 'Invalid token' }
  }

  return { valid: true }
}

// HMAC 토큰 검증 (nonce 일회성 보장 포함). 이슈 생성처럼 단 한 번만 허용해야 하는 동작에서 사용한다.
export function verifyReportToken(
  secret: string,
  projectId: string,
  token: string,
  nonce: string,
  timestamp: number,
  expires: number
): { valid: boolean; error?: string } {
  const nonceKey = `${projectId}:${nonce}`
  if (usedNonces.has(nonceKey)) {
    return { valid: false, error: 'Token already used' }
  }

  const sig = verifyReportTokenSignature(secret, projectId, token, nonce, timestamp, expires)
  if (!sig.valid) return sig

  usedNonces.set(nonceKey, Date.now())

  return { valid: true }
}

// 만료된 nonce 정리 (5분마다) — globalThis로 HMR 중복 등록 방지
const CLEANUP_KEY = '__ive_nonce_cleanup'
if (!(globalThis as any)[CLEANUP_KEY]) {
  ;(globalThis as any)[CLEANUP_KEY] = setInterval(() => {
    const now = Date.now()
    for (const [key, ts] of usedNonces.entries()) {
      if (now - ts > NONCE_EXPIRY_MS) {
        usedNonces.delete(key)
      }
    }
  }, 5 * 60 * 1000)
}
