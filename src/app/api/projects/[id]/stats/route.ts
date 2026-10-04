import { NextResponse } from 'next/server'
import { getCurrentUser } from '@/lib/auth'
import { getProject, getProjectAccess, getDb } from '@/lib/db'
import { countTodayStageTransitions } from '@/lib/db/issues'
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

  // AI 에이전트 처리 중 (assigneeType이 'user'가 아닌 것).
  // 검증·확인·재현 단계 작업자의 실행(ex-verify-/ex-confirm-/ex-reproduce-)은 처리가 아니다 — 그 이슈는 아래 검증 중·확인 중으로 센다.
  // AI 대화(exec-chat-)도 처리가 아니다 — 대화를 열어 두기만 해도 「처리」 숫자가 오르던 것. 대화는 진행 목록에 「대화」 항목으로 따로 보인다.
  const agentWorkingExec = db.prepare(`
    SELECT COUNT(*) as count FROM task_executions
    WHERE project_id = ? AND status IN ('running', 'assigned') AND (assignee_type IS NULL OR assignee_type != 'user')
      AND id NOT LIKE 'ex-verify-%' AND id NOT LIKE 'ex-confirm-%' AND id NOT LIKE 'ex-reproduce-%' AND id NOT LIKE 'exec-chat-%'
  `).get(id) as any
  const agentWorking = agentWorkingExec?.count ?? 0
  // 열려 있는 AI 대화 수 — 처리 숫자에는 넣지 않지만, 카드가 진행 목록(대화 항목 포함)을 불러올지 정하는 데 쓴다
  const chatting = (db.prepare(
    "SELECT COUNT(*) as count FROM task_executions WHERE project_id = ? AND status IN ('running', 'assigned') AND id LIKE 'exec-chat-%'"
  ).get(id) as { count: number } | undefined)?.count ?? 0

  // 검증 중 (IVE-V 라벨 단계) — issue_stages.cached_stage 기준
  // waiting/verifyWaiting 카운트와 동일한 소스(issue_stages)를 사용해
  // GitLab/GitHub에서 수동으로 라벨을 바꾼 경우(=task_execution 없는 경우)도
  // 즉시 반영되도록 한다. task_execution 기반으로 세면 IVE가 만든 검증 exec만
  // 잡혀서 수동 라벨 전환이 집계에서 빠지는 버그가 있었음.
  const verifyingCount = db.prepare(`
    SELECT COUNT(*) as count FROM issue_stages
    WHERE project_id = ? AND cached_stage = 'verifying'
  `).get(id) as any
  const verifying = verifyingCount?.count ?? 0

  // 오늘 완료/반려된 이슈 수 — 권위적 소스(issue_stages.cached_stage)에서 집계.
  // task_execution 기반은 (a) 수동 라벨 전환을 놓치고 (b) ex-verify/ex-confirm 등
  // 실행 종류별 필터링이 끼어들어 "오늘 완료 N건"이 실제 done 이슈 수와 어긋남.
  // countTodayStageTransitions 는 updated_at/todayStartISO 포맷 불일치를 datetime()
  // 정규화로 흡수한다(#448 — 단순 문자열 비교 시 KST 오전 완료 건이 0으로 누락됐음).
  const completed = countTodayStageTransitions(id, 'done', todayStartISO)
  const failed = countTodayStageTransitions(id, 'rejected', todayStartISO)

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

  // 확인 중 (IVE-C 라벨 단계) — verifying 과 동일하게 issue_stages 기준
  const confirmingCount = db.prepare(`
    SELECT COUNT(*) as count FROM issue_stages
    WHERE project_id = ? AND cached_stage = 'confirming'
  `).get(id) as any
  const confirming = confirmingCount?.count ?? 0

  // 확인 대기 중인 issue 수 (confirm_waiting 단계)
  const confirmWaitingCount = db.prepare(`
    SELECT COUNT(*) as count FROM issue_stages
    WHERE project_id = ? AND cached_stage = 'confirm_waiting'
  `).get(id) as any
  const confirmWaiting = confirmWaitingCount?.count ?? 0

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
  const totalActive = agentWorking + verifying + confirming
  const tasksPerHour = totalActive > 0 ? (completed + failed) / 24 : 0

  return NextResponse.json({
    agentWorking,
    chatting,
    verifying,
    confirming,
    completed,
    failed,
    waiting,
    verifyWaiting,
    confirmWaiting,
    conflictCount: conflicts,
    totalTokens,
    totalCost,
    yesterdayCompleted,
    tasksPerHour,
  })
}
