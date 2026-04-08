import { NextRequest, NextResponse } from 'next/server'
import { getExecution, updateExecutionStatus, getProject, getProjectAccess } from '@/lib/db'
import { getCurrentUser } from '@/lib/auth'
import { decrypt } from '@/lib/crypto'
import { removeIssueLabels, addIssueLabels } from '@/lib/provider'

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const user = await getCurrentUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { id } = await params
  const execution = getExecution(id)
  if (!execution) return NextResponse.json({ error: 'Execution not found' }, { status: 404 })

  if (!getProjectAccess(execution.projectId, user.id)) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  if (execution.assigneeType !== 'user') {
    return NextResponse.json({ error: '사람 작업만 수동 완료할 수 있습니다.' }, { status: 400 })
  }
  if (execution.status !== 'assigned') {
    return NextResponse.json({ error: '배정 상태인 작업만 완료 처리할 수 있습니다.' }, { status: 400 })
  }

  const { status } = await req.json() as { status?: 'success' | 'failed' }
  const finalStatus = status === 'failed' ? 'failed' : 'success'

  updateExecutionStatus(id, finalStatus, new Date().toISOString())

  // 레이블 전환: 성공 → IVE-D 제거 + IVE-V 부착 / 실패 → IVE-D 유지 (활성 실행 없으면 dev_fail로 자동 판정)
  const project = getProject(execution.projectId)
  if (project && execution.issueIid > 0) {
    try {
      const decryptedToken = decrypt(project.accessToken)
      if (finalStatus === 'success') {
        await removeIssueLabels(project, execution.issueIid, decryptedToken, [project.labelDev || 'IVE-D'])
        await addIssueLabels(project, execution.issueIid, decryptedToken, [project.labelVerify || 'IVE-V'])
      }
      // 실패 시: IVE-D 레이블 유지 → 스캐너가 활성 실행 없음을 감지하여 dev_fail로 판정
    } catch (e) {
      console.warn(`[CompleteAPI] Failed to switch labels on #${execution.issueIid}:`, e)
    }
  }

  return NextResponse.json({ success: true, status: finalStatus })
}
