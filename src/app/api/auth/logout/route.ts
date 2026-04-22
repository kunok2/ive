import { NextResponse } from 'next/server'
import { clearAuthCookie, getCurrentUser } from '@/lib/auth'
import { logActivity } from '@/lib/activity'
import { clearUserOAuth, getUserOAuthTokenRaw } from '@/lib/db'
import { revokeOAuthToken, loadProvider, getPublicOrigin } from '@/lib/oauth'

/**
 * OAuth 공급자(GitHub/GitLab)의 **브라우저 세션**까지 종료시키는 로그아웃 URL.
 *
 * `prompt=login` 같은 쿼리 파라미터는 GitLab/GitHub가 무시하거나 부분적으로만 지원하므로,
 * 유일하게 확실한 방법은 사용자의 브라우저를 공급자 로그아웃 URL로 direct navigate 시키는 것.
 *
 * - GitHub: `/logout` → Sign out 확인 페이지 표시. 사용자 버튼 클릭으로 로그아웃 확정.
 * - GitLab: `{baseUrl}/users/sign_out` → 즉시 로그아웃 또는 로그아웃 확인 페이지.
 */
function buildProviderLogoutUrl(
  providerType: 'github' | 'gitlab',
  providerBaseUrl: string,
  returnTo: string | null,
): string {
  const base = providerBaseUrl.replace(/\/+$/, '')
  if (providerType === 'github') {
    // GitHub는 custom return_to 파라미터를 `/logout`에서 지원하지 않음.
    // 사용자는 GitHub 로그아웃 페이지에서 "Sign out" 버튼을 누른 뒤 수동으로 돌아와야 함.
    return 'https://github.com/logout'
  }
  // GitLab은 일부 버전에서 redirect 후 로그인 페이지로 리다이렉트 시 next 파라미터 지원.
  // 확실히 동작하는 단일 URL만 반환.
  return returnTo
    ? `${base}/users/sign_out?redirect_to=${encodeURIComponent(returnTo)}`
    : `${base}/users/sign_out`
}

export async function POST(req: Request) {
  const user = await getCurrentUser()
  let providerLogoutUrl: string | null = null

  if (user) {
    const raw = getUserOAuthTokenRaw(user.id)
    if (raw?.providerId) {
      // 공급자 메타 먼저 읽기 (clearUserOAuth가 providerId를 지우기 전에)
      const provider = loadProvider(raw.providerId)
      if (provider) {
        // 공급자 측 토큰 revoke (API grant 삭제 / OAuth token revoke)
        // - GitHub grant 삭제 → 다음 로그인 시 권한 재승인 화면 강제
        // - GitLab token revoke → 토큰 무효화
        if (raw.encrypted) {
          try {
            const { decrypt } = await import('@/lib/crypto')
            const accessToken = decrypt(raw.encrypted)
            await revokeOAuthToken(raw.providerId, accessToken)
          } catch (e) {
            console.warn('[logout] revoke failed:', e)
          }
        }

        // 공급자 측 **브라우저 세션 로그아웃 URL** — 핵심
        // 클라이언트는 이 URL로 full-page navigate 해서 GitLab/GitHub 쿠키를 종료시킴
        const returnTo = `${getPublicOrigin(req)}/login`
        providerLogoutUrl = buildProviderLogoutUrl(provider.type, provider.baseUrl, returnTo)
      }
    }

    logActivity({ userId: user.id, category: 'auth', action: 'logout', detail: '로그아웃', req })
    clearUserOAuth(user.id)
  }

  await clearAuthCookie()
  return NextResponse.json({ success: true, providerLogoutUrl })
}
