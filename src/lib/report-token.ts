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

// HMAC 토큰 검증
export function verifyReportToken(
  secret: string,
  projectId: string,
  token: string,
  nonce: string,
  timestamp: number,
  expires: number
): { valid: boolean; error?: string } {
  // 만료 확인
  if (Date.now() > expires) {
    return { valid: false, error: 'Token expired' }
  }

  // Replay attack 방지: nonce 재사용 체크
  const nonceKey = `${projectId}:${nonce}`
  if (usedNonces.has(nonceKey)) {
    return { valid: false, error: 'Token already used' }
  }

  // HMAC 서명 검증
  const data = `${projectId}:${nonce}:${timestamp}:${expires}`
  const expectedToken = crypto
    .createHmac('sha256', secret)
    .update(data)
    .digest('hex')

  if (token !== expectedToken) {
    return { valid: false, error: 'Invalid token' }
  }

  // Nonce 사용 기록
  usedNonces.set(nonceKey, Date.now())

  return { valid: true }
}

// 만료된 nonce 정리 (5분마다)
setInterval(() => {
  const now = Date.now()
  for (const [key, ts] of usedNonces.entries()) {
    if (now - ts > NONCE_EXPIRY_MS) {
      usedNonces.delete(key)
    }
  }
}, 5 * 60 * 1000)
