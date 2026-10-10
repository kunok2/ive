import { NextRequest, NextResponse } from 'next/server'
import {
  getDb, getProject, getProjectAuthToken, getProjectAccess, getRunningAgentWork, hasActiveExecution, stageFromLabels,
  isIssueAssignee, isIssueAuthor, getPresetRoles, setPresetRoles, markRolesInitialized, setStageWorkerNote, getAssignMode,
  updateExecutionStatus, markHumanStageEnd, touchProjectActivity,
} from '@/lib/db'
import { getCurrentUser } from '@/lib/auth'
import { execKind } from '@/lib/active-work'
import { agentRoleAvailable } from '@/lib/role-assignment'
import { fetchSingleIssue, reopenIssue } from '@/lib/provider'
import { logActivity } from '@/lib/activity'
import { checkStageHandOff, handOffKind, type HandOffStage } from '@/lib/scanner/stage-dispatch'

// 같은 작업을 두 번 맡기는 것을 막는다(더블클릭·두 화면). 서버는 한 프로세스라 메모리 잠금으로 충분하다.
const handOffInFlight = new Set<string>()

/**
 * 검증대기·검증 중·확인대기·확인 중인 작업의 그 단계 일(검증·확인)을 에이전트에게 맡긴다
 * — 검증자/확인자를 그 에이전트로 바꾸고 단계 작업자를 바로 띄운다. 어느 일인지는 실제 단계(Git 라벨)로 정한다.
 *
 * Body: { agentId? }
 *   - agentId 없음: 자동 배정 — 그 역할(검증·확인) 명부의 에이전트 중 지금 맡을 수 있는 것을 서버가 고른다
 *   - agentId 있음: 그 에이전트에게 — 명부의 그 역할 에이전트이거나, 이 작업의 작업자로 지정된 에이전트(입력창 위 작업자 선택)
 *   작업자가 사람(담당자가 직접)으로 지정된 작업은 에이전트에게 맡기지 않는다.
 *
 * 스캐너는 검증자·확인자가 에이전트인 작업만 자동으로 띄우고, 진행 단계(V/C)에서 판단 불가로 멈췄거나 사람이 시작한
 * 작업은 다시 띄우지 않는다. 사람이 직접 맡기는 길이 이것이다.
 *   - 사람이 하던 검증·확인(열린 ex-verify-/ex-confirm- 사람 기록)은 「취소」로 닫는다 — 같은 일을 둘이 겹쳐 하지 않게
 *   - 도중에 닫힌 이슈(MR 머지의 닫기 키워드)는 다시 연다 — 결과(재작업 등)로 단계를 옮길 수 있게
 *   - 지금 띄울 수 없으면(MR 닫힘·배포 대기·에이전트가 다른 작업 중 등) 아무것도 바꾸지 않고 이유를 돌려준다
 *
 * 권한: 단계 이동과 같다 — 관리자, 이슈 담당자(Git assignee), 작성자.
 */
export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string; iid: string }> }
) {
  const user = await getCurrentUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { id: projectId, iid: iidStr } = await params
  const iid = Number(iidStr)
  const project = getProject(projectId)
  if (!project) return NextResponse.json({ error: '프로젝트를 찾을 수 없습니다. 삭제되었을 수 있습니다 — 새로고침해 주세요.' }, { status: 404 })
  if (!getProjectAccess(projectId, user.id)) return NextResponse.json({ error: '이 프로젝트에서 이 작업을 할 권한이 없습니다. 프로젝트 소유자에게 권한을 요청해 주세요.' }, { status: 403 })

  const body = await req.json().catch(() => ({}))
  if (body?.agentId != null && typeof body.agentId !== 'string') return NextResponse.json({ error: '요청이 올바르지 않습니다. 새로고침한 뒤 에이전트를 다시 골라 주세요.' }, { status: 400 })
  const pickedAgentId: string | null = body?.agentId || null
  if (getAssignMode(projectId, iid).mode === 'assignee') {
    return NextResponse.json({ error: '작업자가 사람(담당자)으로 지정된 작업은 에이전트에게 맡길 수 없습니다.' }, { status: 409 })
  }

  const agentWork = getRunningAgentWork(projectId, iid)
  if (agentWork) {
    const kindLabel = { process: '처리', verify: '검증', confirm: '확인', chat: '대화' }[execKind(agentWork.executionId)]
    return NextResponse.json(
      { error: `에이전트 ${agentWork.agentName ? `'${agentWork.agentName}'` : ''}이(가) ${kindLabel} 중입니다. 끝난 뒤 진행하거나, 실행을 중지한 뒤 진행해 주세요.`, agentWork },
      { status: 409 }
    )
  }

  const lockKey = `${projectId}:${iid}`
  if (handOffInFlight.has(lockKey)) {
    return NextResponse.json({ error: '이 작업을 에이전트에게 맡기는 중입니다. 잠시 후 다시 시도해 주세요.' }, { status: 409 })
  }
  handOffInFlight.add(lockKey)

  try {
    const token = getProjectAuthToken(projectId)
    const issue = await fetchSingleIssue(project, iid, token)
    if (!issue) return NextResponse.json({ error: '이슈를 찾을 수 없습니다' }, { status: 404 })

    if (!user.isAdmin
      && !(await isIssueAssignee(project, iid, token, user))
      && !(await isIssueAuthor(project, iid, token, user))
    ) {
      return NextResponse.json({ error: '이 이슈의 담당자(Git assignee) 또는 관리자만 단계를 변경할 수 있습니다' }, { status: 403 })
    }

    // 실제 단계(Git 라벨)로 판단 — 화면이 오래된 단계를 보고 누른 경우를 막는다
    const hasActive = hasActiveExecution(projectId, iid, { ignoreChat: true })
    const stage = stageFromLabels(issue.labels || [], project, { hasActiveExec: hasActive }) ?? 'none'
    const kind = handOffKind(stage)
    if (!kind) {
      return NextResponse.json({ error: '검증대기·검증 중·확인대기·확인 중인 작업만 에이전트에게 맡길 수 있습니다. 이 작업은 지금 그 단계가 아닙니다 — 새로고침한 뒤 단계를 확인해 주세요.', actualStage: stage }, { status: 409 })
    }
    const label = kind === 'verify' ? '검증' : '확인'
    if (!agentRoleAvailable(kind)) return NextResponse.json({ error: `${label} 에이전트 작업자를 쓸 수 없습니다` }, { status: 400 })

    const check = await checkStageHandOff(project, issue, stage as HandOffStage, pickedAgentId, token)
    if (!check.ok) return NextResponse.json({ error: `지금은 에이전트에게 맡길 수 없습니다: ${check.reason}` }, { status: 409 })

    // 그 단계의 담당 = 그 에이전트 (다른 단계 배정은 그대로)
    const agentId = check.agent.id
    const current = getPresetRoles(projectId, iid)
    const picked = { mode: 'agent' as const, userId: null, username: null, agentId }
    setPresetRoles(projectId, iid, kind === 'verify'
      ? { verifier: picked, confirmer: current.confirmer }
      : { verifier: current.verifier, confirmer: picked })
    markRolesInitialized(projectId, iid)   // 사람이 직접 정한 역할 — 프로젝트 기본 배정이 덮어쓰지 않게
    setStageWorkerNote(projectId, iid, null)

    // 사람이 하던 검증·확인은 취소로 닫는다 — 열린 기록이 있으면 작업자가 기록을 만들지 못한다(중복 방지)
    const now = new Date().toISOString()
    const humanRuns = getDb().prepare(
      "SELECT id FROM task_executions WHERE project_id = ? AND issue_iid = ? AND id LIKE ? AND status IN ('running', 'assigned') AND COALESCE(assignee_type, '') <> 'agent'"
    ).all(projectId, iid, `ex-${kind}-%`) as { id: string }[]
    for (const ex of humanRuns) {
      updateExecutionStatus(ex.id, 'failed', now)
      markHumanStageEnd(ex.id, 'cancelled')
    }

    // 도중에 닫힌 이슈는 다시 연다 — 닫힌 채로는 결과(재작업 → 스케줄)를 스캐너가 이어 가지 못한다
    if (issue.state === 'closed') {
      try { await reopenIssue(project, iid, token) } catch (err) { console.error(`[StageAgent] 이슈 #${iid} 다시 열기 실패:`, err) }
    }

    check.launch()
    touchProjectActivity(projectId)

    logActivity({
      userId: user.id,
      category: 'task',
      action: kind === 'verify' ? 'task_verify_by_agent' : 'task_confirm_by_agent',
      detail: `${label}을 에이전트에게 맡김: ${project.name} #${iid} → ${check.agent.name}`,
      targetType: 'issue',
      targetId: `${projectId}:${iid}`,
      req,
    })

    return NextResponse.json({ success: true, kind, agentId, agentName: check.agent.name })
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : '에이전트에게 맡기지 못했습니다' }, { status: 500 })
  } finally {
    handOffInFlight.delete(lockKey)
  }
}
