import { NextResponse } from 'next/server'
import { getCurrentUser } from '@/lib/auth'
import { getSlackWorkspacesByUser, getSlackProviderRaw } from '@/lib/db'

export const runtime = 'nodejs'

/**
 * 로그인 사용자가 소유한 Slack 워크스페이스 목록 + 노출 자격.
 * eligible: Slack으로 로그인한 사용자이고(Slack 앱이 설정돼 있고) 일 때만 true.
 * 이메일/GitHub/GitLab 로그인 사용자에겐 사용자 설정에서 이 섹션을 숨긴다(이슈 #415).
 */
export async function GET() {
  const user = await getCurrentUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const slack = getSlackProviderRaw()
  const eligible = !!slack?.client_id && user.oauthProviderId === 'slack'
  return NextResponse.json({
    eligible,
    workspaces: eligible ? getSlackWorkspacesByUser(user.id) : [],
  })
}
