import { NextRequest, NextResponse } from 'next/server'
import { getProject, getProjectAccess, getProjectAuthToken } from '@/lib/db'
import { getCurrentUser } from '@/lib/auth'
import { logActivity } from '@/lib/activity'
import { updateIssue, fetchSingleIssue } from '@/lib/provider'
import { toggleCheckboxInBody } from '@/lib/stage-progress'

/** 작업 본문의 체크박스 하나를 켜고 끈다 — 저장소의 이슈 본문을 직접 고쳐 쓴다(IVE 쪽에 따로 저장하는 값 없음) */
export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string; iid: string }> }
) {
  const user = await getCurrentUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { id: projectId, iid } = await params
  const project = getProject(projectId)
  if (!project) return NextResponse.json({ error: '프로젝트를 찾을 수 없습니다. 삭제되었을 수 있습니다 — 새로고침해 주세요.' }, { status: 404 })

  const access = getProjectAccess(projectId, user.id)
  if (!access || access === 'viewer') {
    return NextResponse.json({ error: '이 프로젝트에서 이 작업을 할 권한이 없습니다. 프로젝트 소유자에게 권한을 요청해 주세요.' }, { status: 403 })
  }

  const { index, checked } = await req.json().catch(() => ({})) as { index?: number; checked?: boolean }
  if (!Number.isInteger(index) || (index as number) < 0 || typeof checked !== 'boolean') {
    return NextResponse.json({ error: '잘못된 요청입니다' }, { status: 400 })
  }

  try {
    const token = getProjectAuthToken(projectId)
    const current = await fetchSingleIssue(project, Number(iid), token)
    if (!current) return NextResponse.json({ error: '이슈를 찾을 수 없습니다' }, { status: 404 })
    if (current.state === 'closed') {
      return NextResponse.json({ error: '닫힌 작업의 체크리스트는 바꿀 수 없습니다' }, { status: 409 })
    }
    const next = toggleCheckboxInBody(current.description || '', index as number, checked)
    if (next === null) {
      return NextResponse.json({ error: '그 사이 본문이 바뀌었습니다. 새로고침한 뒤 다시 눌러 주세요.' }, { status: 409 })
    }
    await updateIssue(project, Number(iid), token, { description: next })
    logActivity({
      userId: user.id,
      category: 'task',
      action: 'toggle_issue_checkbox',
      detail: `체크리스트 ${checked ? '체크' : '해제'}: ${project.name} #${iid} (${(index as number) + 1}번째)`,
      targetType: 'issue',
      targetId: `${projectId}:${iid}`,
      req,
    })
    return NextResponse.json({ ok: true })
  } catch {
    return NextResponse.json({ error: '체크리스트 저장에 실패했습니다. 잠시 뒤 다시 시도해 주세요.' }, { status: 500 })
  }
}
