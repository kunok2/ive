// 서버 재기동으로 끊긴 처리(dev) 실행 → 처리 실패로 남은 이슈를 대기로 되돌리는 근거(DB 기록).
//
// #67 에서 기동 시 issue_stages.stage 를 dev → waiting 으로 되돌렸으나, 단계를 라벨로 판정하게 바뀌면서(d63b7ea)
// 그 줄이 지워져 재기동마다 처리 중이던 작업이 「처리 실패」로 굳었다(2026-10-03 운영 8건).
// 이제 기동 정리가 end_reason='restart' 를 남기고, 스캐너가 그것을 보고 라벨을 IVE-D → IVE-S 로 옮긴다.
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { getDb, createExecution, resetStuckExecutions, takeRestartRequeue, setExecutionEndReason, MAX_RESTART_REQUEUE } from '@/lib/db'
import { setupTestDb, teardownTestDb, seedUser, seedProject } from './helpers/test-db'

const PROJ = 'proj-1'
const IID = 42

let seq = 0
function exec(id: string, status: 'running' | 'success' | 'failed', opts: { iid?: number; assigneeType?: 'agent' | 'user' } = {}) {
  const t = new Date(Date.UTC(2026, 9, 3, 9, 0, seq++)).toISOString()
  createExecution({
    id, projectId: PROJ, agentId: '', issueIid: opts.iid ?? IID, issueTitle: 't', status, startedAt: t,
    logPath: '', inputTokens: 0, outputTokens: 0, costUsd: 0, turns: 0, issueCreatedAt: t,
    assigneeType: opts.assigneeType ?? 'agent',
  } as Parameters<typeof createExecution>[0])
}
const reason = (id: string) => (getDb().prepare('SELECT status, end_reason FROM task_executions WHERE id = ?').get(id) as { status: string; end_reason: string | null })

describe('재기동 재처리', () => {
  beforeEach(() => {
    seq = 0
    const db = setupTestDb()
    seedUser(db, 'user-1', '사용자')
    seedProject(db, PROJ, 'user-1', 'P')
  })
  afterEach(() => teardownTestDb())

  it('기동 정리는 돌던 에이전트 실행을 failed + end_reason=restart 로 남긴다', () => {
    exec('ex-1', 'running')
    resetStuckExecutions()
    expect(reason('ex-1')).toMatchObject({ status: 'failed', end_reason: 'restart' })
  })

  it('재기동으로 끊긴 처리 실행이 마지막이면 되돌릴 후보다 — 되돌린 뒤엔 다시 후보가 아니다', () => {
    exec('ex-1', 'running')
    resetStuckExecutions()
    expect(takeRestartRequeue(PROJ, IID)).toEqual({ executionId: 'ex-1', streak: 1 })
    setExecutionEndReason('ex-1', 'restart_requeued')
    expect(takeRestartRequeue(PROJ, IID)).toBeNull()
  })

  it('그냥 실패한 처리(재기동 아님)는 되돌리지 않는다', () => {
    exec('ex-1', 'failed')
    expect(takeRestartRequeue(PROJ, IID)).toBeNull()
  })

  it('검증·확인 실행은 처리 판정에 쓰지 않는다 (그쪽은 stage-dispatch 가 다시 띄운다)', () => {
    exec('ex-1', 'success')
    exec('ex-verify-1', 'running')
    resetStuckExecutions()
    expect(takeRestartRequeue(PROJ, IID)).toBeNull()
  })

  it('다른 이슈의 끊긴 실행과 섞이지 않는다', () => {
    exec('ex-1', 'running', { iid: 99 })
    resetStuckExecutions()
    expect(takeRestartRequeue(PROJ, IID)).toBeNull()
    expect(takeRestartRequeue(PROJ, 99)?.executionId).toBe('ex-1')
  })

  it('연달아 끊긴 횟수를 센다 — 상한을 넘으면 스캐너가 멈출 수 있게', () => {
    for (let i = 1; i <= MAX_RESTART_REQUEUE + 1; i++) {
      exec(`ex-${i}`, 'running')
      resetStuckExecutions()
      const rq = takeRestartRequeue(PROJ, IID)!
      expect(rq).toEqual({ executionId: `ex-${i}`, streak: i })
      if (i <= MAX_RESTART_REQUEUE) setExecutionEndReason(rq.executionId, 'restart_requeued')
    }
    expect(takeRestartRequeue(PROJ, IID)!.streak).toBeGreaterThan(MAX_RESTART_REQUEUE)
  })

  it('사이에 정상 끝난 처리가 있으면 연속 횟수는 거기서 끊긴다', () => {
    exec('ex-1', 'running'); resetStuckExecutions(); setExecutionEndReason('ex-1', 'restart_requeued')
    exec('ex-2', 'success')
    exec('ex-3', 'running'); resetStuckExecutions()
    expect(takeRestartRequeue(PROJ, IID)).toEqual({ executionId: 'ex-3', streak: 1 })
  })
})
