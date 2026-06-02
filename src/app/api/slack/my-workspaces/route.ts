import { NextResponse } from 'next/server'
import { getCurrentUser } from '@/lib/auth'
import { getSlackWorkspacesByUser, getSlackProviderRaw } from '@/lib/db'

export const runtime = 'nodejs'

/**
 * 로그인 사용자가 소유한 Slack 워크스페이스 목록 + 설치 가능 여부.
 * available=false(Slack 앱 미설정)면 사용자 설정에서 "워크스페이스 추가" 버튼을 숨긴다.
 */
export async function GET() {
  const user = await getCurrentUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const slack = getSlackProviderRaw()
  const available = !!slack?.client_id
  return NextResponse.json({
    available,
    workspaces: getSlackWorkspacesByUser(user.id),
  })
}
