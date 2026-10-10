import { NextResponse } from 'next/server'
import { getCurrentUser } from '@/lib/auth'
import { getProject, getProjectAccess, getDb } from '@/lib/db'
import { countTodayStageTransitions } from '@/lib/db/issues'
import { getKSTTodayStartISO } from '@/lib/date-utils'
import { completedOnDays } from '@/lib/report-model/load'
import { addDays, kstToday, kstDayStartISO } from '@/lib/report-model/period'

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

  // 오늘·어제 완료 — 보고서와 같은 완료 사이클(completedOnDays)로 센다.
  // 단계 스냅샷(issue_stages.updated_at)으로 세면 단계가 그대로여도 스냅샷을 다시 쓸 때마다 시각이 바뀌어
  // 어제 끝난 일이 오늘로 넘어오고, 버려진(머지 없이 닫힌) 일까지 섞여 보고서와 숫자가 어긋났다(#563).
  const today = kstToday()
  const doneCycles = completedOnDays(id, addDays(today, -1), addDays(today, 1))
  const todayCut = kstDayStartISO(today)
  const completed = doneCycles.filter(c => c.at >= todayCut).length
  // 카드의 전일 대비 증감(오늘 완료 − 어제 완료)의 어제 몫 — 보고서의 그날 완료와 같은 숫자
  const yesterdayCompleted = doneCycles.length - completed
  // 오늘 반려 — 단계 기록(issue_stages)에서. datetime() 정규화로 updated_at/todayStartISO 포맷 차이를 흡수한다(#448)
  const failed = countTodayStageTransitions(id, 'rejected', todayStartISO)

  // 대기 중인 issue 수 (waiting 단계)
  const waitingCount = db.prepare(`
    SELECT COUNT(*) as count FROM issue_stages
    WHERE project_id = ? AND cached_stage = 'waiting'
  `).get(id) as any
  const waiting = waitingCount?.count ?? 0

  // 처리 실패로 남은 issue 수 (dev_fail — IVE-D 는 있는데 실행이 없음). 진행이 아니라 다시 처리하기를 기다리는 일
  const devFailed = (db.prepare(`
    SELECT COUNT(*) as count FROM issue_stages
    WHERE project_id = ? AND cached_stage = 'dev_fail'
  `).get(id) as { count: number } | undefined)?.count ?? 0

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
    devFailed,
    verifyWaiting,
    confirmWaiting,
    conflictCount: conflicts,
    totalTokens,
    totalCost,
    yesterdayCompleted,
    tasksPerHour,
  })
}
