import { NextRequest, NextResponse } from 'next/server'
import { getExecution, updateExecutionStatus, getProject, getProjectAccess, recordStageEvent, markHumanStageEnd } from '@/lib/db'
import { userActor } from '@/lib/event-actor'
import { getCurrentUser } from '@/lib/auth'
import { logActivity } from '@/lib/activity'
import { decrypt } from '@/lib/crypto'
import { removeIssueLabels, addIssueLabels, swapIssueLabels } from '@/lib/provider'

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
  if (finalStatus === 'failed') markHumanStageEnd(id, 'fail') // 검증·확인 기록이면 반려(처리 기록이면 아무것도 하지 않는다)

  // 레이블 전환: 성공 → IVE-D 제거 + IVE-V 부착 / 실패 → IVE-D 유지 (활성 실행 없으면 dev_fail로 자동 판정)
  const project = getProject(execution.projectId)
  if (project && execution.issueIid > 0) {
    try {
      const decryptedToken = decrypt(project.accessToken)
      if (finalStatus === 'success') {
        await swapIssueLabels(project, execution.issueIid, decryptedToken, [project.labelVerify || 'IVE-V'], [project.labelDev || 'IVE-D'])
      }
      // 실패 시: IVE-D 레이블 유지 → 스캐너가 활성 실행 없음을 감지하여 dev_fail로 판정
      // 사건 로그 — 사람이 처리 결과를 직접 확정
      recordStageEvent({
        projectId: project.id, issueIid: execution.issueIid, fromStage: 'dev',
        toStage: finalStatus === 'success' ? 'verifying' : 'dev_fail', action: finalStatus === 'success' ? 'complete' : 'fail',
        actor: userActor(user), source: 'ui', executionId: id,
      })
    } catch (e) {
      console.warn(`[CompleteAPI] Failed to switch labels on #${execution.issueIid}:`, e)
    }
  }

  logActivity({
    userId: user.id,
    category: 'execution',
    action: 'complete_execution',
    detail: `사람 작업 수동 완료: 이슈 #${execution.issueIid} (${finalStatus})`,
    targetType: 'execution',
    targetId: id,
    req,
  })

  return NextResponse.json({ success: true, status: finalStatus })
}
