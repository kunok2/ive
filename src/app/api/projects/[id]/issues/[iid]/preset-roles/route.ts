import { NextRequest, NextResponse } from 'next/server'
import { getProject, getProjectAccess, getPresetRoles, setPresetRoles, isIssueAuthor, getProjectAuthToken } from '@/lib/db'
import { getCurrentUser } from '@/lib/auth'

/**
 * 이슈의 검증자/확인자 사전 배정(preset)을 갱신한다.
 *
 * Body 형태 (둘 중 한 쪽 또는 둘 다 보낼 수 있음):
 *   {
 *     verifier?:  { mode: 'creator' | 'auto' | 'specific', userId?: string | null, username?: string | null }
 *     confirmer?: { mode: 'creator' | 'auto' | 'specific', userId?: string | null, username?: string | null }
 *   }
 *
 * 권한: 프로젝트 접근 + (관리자 OR 이슈 작성자) — 검증자/확인자 사전배정은 작성자가 결정.
 */
export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string; iid: string }> }
) {
  const user = await getCurrentUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { id: projectId, iid } = await params
  const project = getProject(projectId)
  if (!project) return NextResponse.json({ error: 'Project not found' }, { status: 404 })

  if (!getProjectAccess(projectId, user.id)) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  // 권한 체크: 관리자 또는 이슈 작성자
  const token = getProjectAuthToken(projectId)
  if (!user.isAdmin && !(await isIssueAuthor(project, Number(iid), token, user))) {
    return NextResponse.json({ error: '이 이슈의 작성자 또는 관리자만 수정할 수 있습니다' }, { status: 403 })
  }

  const body = await req.json()
  const current = getPresetRoles(projectId, Number(iid))

  const sanitize = (input: any, fallback: typeof current.verifier) => {
    if (!input) return fallback
    const mode = input.mode === 'auto' || input.mode === 'specific' ? input.mode : 'creator'
    if (mode === 'specific') {
      return {
        mode: 'specific' as const,
        userId: input.userId ? String(input.userId) : null,
        username: input.username ? String(input.username) : null,
      }
    }
    return { mode, userId: null, username: null }
  }

  const next = {
    verifier: sanitize(body.verifier, current.verifier),
    confirmer: sanitize(body.confirmer, current.confirmer),
  }

  setPresetRoles(projectId, Number(iid), next)
  return NextResponse.json({ verifier: next.verifier, confirmer: next.confirmer })
}
