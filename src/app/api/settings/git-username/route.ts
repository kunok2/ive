import { NextResponse } from 'next/server'
import { updateUserGitUsername } from '@/lib/db'
import { getCurrentUser } from '@/lib/auth'
import { logActivity } from '@/lib/activity'

// 본인 GitLab/GitHub username 저장 (셀프서비스).
// 다른 방식(GitHub/Slack 등)으로 IVE에 로그인한 사람이 GitLab 프로젝트의 확인자/담당자로
// 지정됐을 때, git username 만 채워두면 그 사람의 IVE 계정으로 매핑돼 Slack DM 을 받을 수 있다.
// (oauth id 매칭이 안 되는 cross-provider 케이스 보강.)
const USERNAME_RE = /^[A-Za-z0-9](?:[A-Za-z0-9._-]{0,38})$/

export async function PUT(req: Request) {
  const user = await getCurrentUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const body = await req.json().catch(() => ({}))

  // gitlabUsername / githubUsername 중 보낸 것만 갱신(빈 문자열 = 연결 해제).
  for (const provider of ['gitlab', 'github'] as const) {
    const key = provider === 'gitlab' ? 'gitlabUsername' : 'githubUsername'
    if (body[key] === undefined) continue
    const raw = typeof body[key] === 'string' ? body[key].trim() : ''
    if (raw && !USERNAME_RE.test(raw)) {
      return NextResponse.json({ error: 'invalid_username' }, { status: 400 })
    }
    updateUserGitUsername(user.id, provider, raw)
  }

  logActivity({
    userId: user.id,
    category: 'settings',
    action: 'update_git_username',
    detail: `git username 설정 변경`,
    req,
  })

  return NextResponse.json({ ok: true })
}
