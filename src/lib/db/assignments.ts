// #272: project_assignments 테이블이 폐기되어 배정 관리 함수는 모두 제거됨.
// 이 파일에는 task_executions 기반의 일반 헬퍼만 남김 (다른 곳에서도 쓰는 일반 카운터).
// 향후 executions.ts 로 이동 가능.

import { getDb } from './connection'

export function countActiveExecutionsByProject(projectId: string): number {
  const r = getDb().prepare(
    "SELECT COUNT(*) as cnt FROM task_executions WHERE project_id = ? AND status IN ('running', 'assigned')"
  ).get(projectId) as { cnt: number }
  return r.cnt
}

export function countActiveExecutionsByAgent(agentId: string): number {
  const r = getDb().prepare(
    "SELECT COUNT(*) as cnt FROM task_executions WHERE agent_id = ? AND status = 'running'"
  ).get(agentId) as { cnt: number }
  return r.cnt
}

export function getLastCompletedAt(agentId: string): string | null {
  const r = getDb().prepare(
    "SELECT ended_at FROM task_executions WHERE agent_id = ? AND status IN ('success','failed') ORDER BY ended_at DESC LIMIT 1"
  ).get(agentId) as { ended_at: string } | undefined
  return r?.ended_at ?? null
}
