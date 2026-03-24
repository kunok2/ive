import { createActivityLog } from './db'
import { ActivityCategory } from '@/types'

/** 요청에서 IP와 User-Agent를 추출 */
export function extractRequestInfo(req: Request): { ipAddress: string; userAgent: string } {
  const headers = req.headers
  const ipAddress = headers.get('x-forwarded-for')?.split(',')[0]?.trim()
    || headers.get('x-real-ip')
    || '0.0.0.0'
  const userAgent = headers.get('user-agent') || ''
  return { ipAddress, userAgent }
}

/** 사용자 활동을 기록 */
export function logActivity(opts: {
  userId: string
  category: ActivityCategory
  action: string
  detail: string
  targetType?: string
  targetId?: string
  req?: Request
}) {
  try {
    const reqInfo = opts.req ? extractRequestInfo(opts.req) : {}
    createActivityLog({
      userId: opts.userId,
      category: opts.category,
      action: opts.action,
      detail: opts.detail,
      targetType: opts.targetType,
      targetId: opts.targetId,
      ...reqInfo,
    })
  } catch (e) {
    console.error('[Activity] Failed to log activity:', e)
  }
}
