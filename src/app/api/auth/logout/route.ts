import { NextResponse } from 'next/server'
import { clearAuthCookie, getCurrentUser } from '@/lib/auth'
import { logActivity } from '@/lib/activity'
import { clearUserOAuth, getUserOAuthTokenRaw } from '@/lib/db'
import { revokeOAuthToken } from '@/lib/oauth'

export async function POST(req: Request) {
  const user = await getCurrentUser()
  if (user) {
    // OAuth 토큰이 있으면 공급자那边에서 취소 (revoke)
    const raw = getUserOAuthTokenRaw(user.id)
    if (raw?.encrypted && raw?.providerId) {
      const { decrypt } = await import('@/lib/crypto')
      const accessToken = decrypt(raw.encrypted)
      await revokeOAuthToken(raw.providerId, accessToken)
    }

    logActivity({ userId: user.id, category: 'auth', action: 'logout', detail: '로그아웃', req })
    clearUserOAuth(user.id)
  }
  await clearAuthCookie()
  return NextResponse.json({ success: true })
}
