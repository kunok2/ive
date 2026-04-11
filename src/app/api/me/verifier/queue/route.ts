import { NextResponse } from 'next/server'
import { getCurrentUser } from '@/lib/auth'
import { getMyVerifierQueue, getMyVerifierCounts, getOAuthProviderById } from '@/lib/db'

/**
 * 현재 로그인한 사용자의 "내 검증 대기/중" 이슈 목록.
 * OAuth 로그인 시 저장된 provider user id를 assignee.git_user_id와 매칭합니다.
 *
 * 쿼리 파라미터:
 *   ?counts=1  → 개수만 반환 (뱃지용, 가벼움)
 */
export async function GET(req: Request) {
  const user = await getCurrentUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  // OAuth 로그인 유저가 아니면 매칭 불가 — 빈 결과
  if (!user.oauthProviderId || !user.oauthUserId) {
    const url = new URL(req.url)
    if (url.searchParams.get('counts') === '1') {
      return NextResponse.json({ verifyWaiting: 0, verifying: 0, total: 0, matched: false })
    }
    return NextResponse.json({ issues: [], matched: false })
  }

  const provider = getOAuthProviderById(user.oauthProviderId)
  if (!provider) {
    return NextResponse.json({ issues: [], matched: false })
  }

  const url = new URL(req.url)
  if (url.searchParams.get('counts') === '1') {
    const counts = getMyVerifierCounts(user.id, user.oauthUserId, provider.type)
    return NextResponse.json({ ...counts, matched: true })
  }

  const issues = getMyVerifierQueue(user.id, user.oauthUserId, provider.type)
  return NextResponse.json({ issues, matched: true })
}
