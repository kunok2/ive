import { NextResponse } from 'next/server'
import { clearAuthCookie, getCurrentUser } from '@/lib/auth'
import { logActivity } from '@/lib/activity'
import { clearUserOAuth, getUserOAuthTokenRaw } from '@/lib/db'
import { revokeOAuthToken } from '@/lib/oauth'

/**
 * OAuth 공급자 브라우저 세션 종료를 redirect로 시도하는 접근은 불가능하다:
 *
 *   - GitLab `/users/sign_out`: POST + CSRF 토큰 필수. GET 리다이렉트는 404.
 *   - GitHub `/logout`: 사용자에게 확인 버튼을 누르게 하는 별도 페이지. 외부에서 강제 종료 불가.
 *
 * 대신 아래 2가지 조합으로 "다음 로그인 시 자격 증명을 다시 입력"을 유도한다:
 *   1) 서버 측 토큰 revoke — DB + 공급자 API 모두 무효화.
 *   2) 다음 authorize 요청에 `prompt=login`, `max_age=0` 파라미터 포함 (oauth.ts).
 *      GitLab 14.8+ / GitHub OAuth App grant 삭제 후 첫 로그인에서 재인증/재동의를 강제.
 */
export async function POST(req: Request) {
  const user = await getCurrentUser()

  if (user) {
    const raw = getUserOAuthTokenRaw(user.id)
    if (raw?.providerId && raw.encrypted) {
      try {
        const { decrypt } = await import('@/lib/crypto')
        const accessToken = decrypt(raw.encrypted)
        await revokeOAuthToken(raw.providerId, accessToken)
      } catch (e) {
        console.warn('[logout] revoke failed:', e)
      }
    }

    logActivity({ userId: user.id, category: 'auth', action: 'logout', detail: '로그아웃', req })
    clearUserOAuth(user.id)
  }

  await clearAuthCookie()
  return NextResponse.json({ success: true })
}
