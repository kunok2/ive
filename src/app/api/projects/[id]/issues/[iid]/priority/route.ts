import { NextRequest, NextResponse } from 'next/server'
import { getProject, getProjectAccess, getAssignMode, setIssuePriority, type IssuePriority } from '@/lib/db'
import { getCurrentUser } from '@/lib/auth'
import { logActivity } from '@/lib/activity'

const LABEL: Record<IssuePriority, string> = { 0: '보통', 1: '높음', 2: '긴급' }

/**
 * 작업 우선순위 — 0 보통 · 1 높음 · 2 긴급. IVE DB(issue_stages.priority)에만 둔다(Git 에는 쓰지 않는다).
 * 에이전트(처리·검증·확인)는 대기 작업 중 우선순위가 높은 것부터, 같으면 먼저 들어온 것부터 집는다.
 * 순서 조정은 팀의 일이라 프로젝트 편집 권한자(뷰어 제외) 누구나 바꿀 수 있다.
 */
export async function PUT(
  req: NextRequest,
  { params }: { params: Promise<{ id: string; iid: string }> }
) {
  const user = await getCurrentUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { id: projectId, iid } = await params
  const project = getProject(projectId)
  if (!project) return NextResponse.json({ error: 'Project not found' }, { status: 404 })
  const access = getProjectAccess(projectId, user.id)
  if (!access || access === 'viewer') return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const { priority } = await req.json().catch(() => ({})) as { priority?: unknown }
  if (priority !== 0 && priority !== 1 && priority !== 2) {
    return NextResponse.json({ error: 'priority 는 0(보통)·1(높음)·2(긴급) 중 하나입니다' }, { status: 400 })
  }
  const before = getAssignMode(projectId, Number(iid)).priority
  if (before !== priority) {
    setIssuePriority(projectId, Number(iid), priority)
    logActivity({
      userId: user.id,
      category: 'task',
      action: 'update_priority',
      detail: `우선순위 변경: ${project.name} #${iid} ${LABEL[before]} → ${LABEL[priority]}`,
      targetType: 'issue',
      targetId: `${projectId}:${iid}`,
      req,
    })
  }
  return NextResponse.json({ priority })
}
