import { NextResponse } from 'next/server'
import { getCurrentUser } from '@/lib/auth'
import { getUserOAuthTokenRaw, getOAuthProviderById } from '@/lib/db'

/**
 * 현재 로그인한 유저의 OAuth 토큰 메타 정보 조회.
 * 실제 access_token은 반환하지 않음 — 프로젝트 생성/테스트 시 서버가 직접 복호화해 사용.
 */
export async function GET() {
  const user = await getCurrentUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const raw = getUserOAuthTokenRaw(user.id)
  if (!raw || !raw.providerId) {
    return NextResponse.json({ hasToken: false })
  }
  const provider = getOAuthProviderById(raw.providerId)
  if (!provider) {
    return NextResponse.json({ hasToken: false })
  }
  return NextResponse.json({
    hasToken: true,
    providerId: provider.id,
    providerType: provider.type,
    providerName: provider.name,
    baseUrl: provider.baseUrl,
  })
}
