// 간단한 in-memory rate limiter
// IP 기반으로 일정 시간 내 최대 요청 횟수를 제한합니다.

interface RateLimitEntry {
  count: number
  resetAt: number
}

const store = new Map<string, RateLimitEntry>()

// 만료된 항목 주기적 정리 (메모리 누수 방지)
setInterval(() => {
  const now = Date.now()
  for (const [key, entry] of store) {
    if (now > entry.resetAt) store.delete(key)
  }
}, 60_000)

/**
 * @param key     구분 키 (예: `login:1.2.3.4`)
 * @param limit   허용 횟수
 * @param windowMs 시간 창 (ms)
 * @returns true = 제한 초과, false = 허용
 */
export function isRateLimited(key: string, limit: number, windowMs: number): boolean {
  const now = Date.now()
  const entry = store.get(key)

  if (!entry || now > entry.resetAt) {
    store.set(key, { count: 1, resetAt: now + windowMs })
    return false
  }

  entry.count++
  if (entry.count > limit) return true
  return false
}

export function getClientIp(req: Request): string {
  const forwarded = (req as any).headers?.get?.('x-forwarded-for')
  if (forwarded) return forwarded.split(',')[0].trim()
  return 'unknown'
}
