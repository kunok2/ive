import { NextResponse } from 'next/server'
import { getCurrentUser } from '@/lib/auth'
import { getProject, getProjectAccess, getDb } from '@/lib/db'
import { getKSTTodayStartISO } from '@/lib/date-utils'

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const user = await getCurrentUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { id } = await params
  const project = getProject(id)
  if (!project || !getProjectAccess(id, user.id)) {
    return NextResponse.json({ error: 'Not found' }, { status: 404 })
  }

  const db = getDb()
  const todayStartISO = getKSTTodayStartISO()

  // AI 에이전트 작업 중 (assigneeType이 'user'가 아닌 것)
  const agentWorkingExec = db.prepare(`
    SELECT COUNT(*) as count FROM task_executions
    WHERE project_id = ? AND status IN ('running', 'assigned') AND (assignee_type IS NULL OR assignee_type != 'user')
  `).get(id) as any
  const agentWorking = agentWorkingExec?.count ?? 0

  // 사람 검증 중 (assigneeType = 'user')
  const verifyingExec = db.prepare(`
    SELECT COUNT(*) as count FROM task_executions
    WHERE project_id = ? AND status IN ('running', 'assigned') AND assignee_type = 'user'
  `).get(id) as any
  const verifying = verifyingExec?.count ?? 0

  // 오늘 완료된 execution 수
  // - 검증 완료(verified_at/rejected_at) OR 외부 도구 작업(agent_id 비어있음) → 완료로 카운트
  // - 검증 exec(ex-verify-%)는 제외
  // - agent_id는 createExecution에서 `ex.agentId || null`로 저장되어 DB에 NULL로 들어가므로
  //   '' 와 NULL 둘 다 매치해야 함 (과거 데이터 호환)
  const completedExec = db.prepare(`
    SELECT COUNT(*) as count FROM task_executions
    WHERE project_id = ? AND status = 'success' AND started_at >= ? AND id NOT LIKE 'ex-verify-%' AND (verified_at IS NOT NULL OR rejected_at IS NOT NULL OR agent_id IS NULL OR agent_id = '')
  `).get(id, todayStartISO) as any
  const completed = completedExec?.count ?? 0

  // 오늘 실패한 execution 수
  // - 검증 반려(rejected_at) OR 외부 도구 작업 실패(agent_id 비어있음) → 실패로 카운트
  const failedExec = db.prepare(`
    SELECT COUNT(*) as count FROM task_executions
    WHERE project_id = ? AND status = 'failed' AND started_at >= ? AND id NOT LIKE 'ex-verify-%' AND (verified_at IS NOT NULL OR rejected_at IS NOT NULL OR agent_id IS NULL OR agent_id = '')
  `).get(id, todayStartISO) as any
  const failed = failedExec?.count ?? 0

  // 대기 중인 issue 수 (waiting 단계)
  const waitingCount = db.prepare(`
    SELECT COUNT(*) as count FROM issue_stages
    WHERE project_id = ? AND cached_stage = 'waiting'
  `).get(id) as any
  const waiting = waitingCount?.count ?? 0

  // 검증 대기 중인 issue 수 (verify_waiting 단계)
  const verifyWaitingCount = db.prepare(`
    SELECT COUNT(*) as count FROM issue_stages
    WHERE project_id = ? AND cached_stage = 'verify_waiting'
  `).get(id) as any
  const verifyWaiting = verifyWaitingCount?.count ?? 0

  // 병합 중인 MR 수
  const mergeCount = db.prepare(`
    SELECT COUNT(*) as count FROM issue_stages
    WHERE project_id = ? AND cached_stage = 'merge'
  `).get(id) as any
  const conflicts = mergeCount?.count ?? 0

  // 어제 완료한 execution 수
  // - 검증 완료(verified_at/rejected_at) OR 외부 도구 작업(agent_id 비어있음) → 완료로 카운트
  const yesterdayStartISO = new Date(new Date(todayStartISO).getTime() - 24 * 60 * 60 * 1000).toISOString()
  const yesterdayExec = db.prepare(`
    SELECT COUNT(*) as count FROM task_executions
    WHERE project_id = ? AND status = 'success' AND started_at >= ? AND started_at < ? AND id NOT LIKE 'ex-verify-%' AND (verified_at IS NOT NULL OR rejected_at IS NOT NULL OR agent_id IS NULL OR agent_id = '')
  `).get(id, yesterdayStartISO, todayStartISO) as any
  const yesterdayCompleted = yesterdayExec?.count ?? 0

  // 금일 토큰
  const tokensResult = db.prepare(`
    SELECT COALESCE(SUM(input_tokens + output_tokens), 0) as total FROM task_executions
    WHERE project_id = ? AND started_at >= ?
  `).get(id, todayStartISO) as any
  const totalTokens = tokensResult?.total ?? 0

  // 금일 비용
  const costResult = db.prepare(`
    SELECT COALESCE(SUM(cost_usd), 0) as total FROM task_executions
    WHERE project_id = ? AND started_at >= ?
  `).get(id, todayStartISO) as any
  const totalCost = costResult?.total ?? 0

  // 시간당 평균 작업 수
  const totalActive = agentWorking + verifying
  const tasksPerHour = totalActive > 0 ? (completed + failed) / 24 : 0

  return NextResponse.json({
    agentWorking,
    verifying,
    completed,
    failed,
    waiting,
    verifyWaiting,
    conflictCount: conflicts,
    totalTokens,
    totalCost,
    yesterdayCompleted,
    tasksPerHour,
  })
}
