/**
 * 재기동 재처리 — 흐름 통합 (DB 는 실제 스키마, Git 호스팅 API 만 가짜).
 *
 * 기동 정리(resetStuckExecutions) → 스캐너가 처리 실패 이슈를 보고 requeueRestartInterrupted →
 * 라벨 IVE-D 제거·IVE-S 부착, cached_stage=waiting, 사건 로그(reason=restart), 실행 기록 end_reason 갱신.
 * 같은 기록으로 두 번 되돌리지 않고, 연달아 끊기면 상한에서 멈춰 이슈 안내를 남긴다. Git 코멘트는 달지 않는다.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import Database from 'better-sqlite3'

const labels = vi.hoisted(() => ({ current: [] as string[] }))
const providerMock = vi.hoisted(() => ({
  addIssueLabels: vi.fn(async (_p: unknown, _i: number, _t: string, add: string[]) => { labels.current = [...new Set([...labels.current, ...add])] }),
  removeIssueLabels: vi.fn(async (_p: unknown, _i: number, _t: string, rm: string[]) => { labels.current = labels.current.filter(l => !rm.includes(l)) }),
  fetchSingleIssue: vi.fn(async () => ({ iid: 42, labels: labels.current, assignees: [], title: 't' })),
  addIssueComment: vi.fn(async () => undefined),
}))
vi.mock('@/lib/provider', () => providerMock)

import { initSchema } from '@/lib/db/schema'
import { getIssueEvents, resetStuckExecutions, stageFromLabels, hasActiveExecution, getStageWorkerNote, MAX_RESTART_REQUEUE } from '@/lib/db'
import { requeueRestartInterrupted, RESTART_GAVE_UP_NOTE } from '@/lib/scanner/restart-requeue'
import type { Project } from '@/types'

const project = {
  id: 'p1', provider: 'gitlab', labelTarget: 'IVE',
  labelSchedule: 'IVE-S', labelDev: 'IVE-D', labelVerifyWait: 'IVE-W', labelVerify: 'IVE-V',
  labelConfirmWait: 'IVE-P', labelConfirm: 'IVE-C', labelEnd: 'IVE-E',
} as unknown as Project
const IID = 42

let db: Database.Database
let seq = 0
function runningDevExec(id: string) {
  db.prepare(`INSERT INTO task_executions (id, project_id, agent_id, issue_iid, status, started_at, assignee_type)
              VALUES (?, 'p1', 'ag1', ?, 'running', ?, 'agent')`).run(id, IID, new Date(Date.UTC(2026, 9, 3, 9, 0, seq++)).toISOString())
}
const stageNow = () => stageFromLabels(labels.current, project, { hasActiveExec: hasActiveExecution('p1', IID) })
const endReason = (id: string) => (db.prepare('SELECT end_reason FROM task_executions WHERE id = ?').get(id) as { end_reason: string | null }).end_reason

beforeEach(() => {
  vi.clearAllMocks()
  seq = 0
  db = new Database(':memory:')
  initSchema(db)
  ;(globalThis as { db?: Database.Database }).db = db
  db.pragma('foreign_keys = OFF')
  labels.current = ['IVE', 'IVE-D']
})
afterEach(() => { db.close(); (globalThis as { db?: Database.Database }).db = undefined })

describe('재기동 재처리 흐름', () => {
  it('처리 중 재기동 → 처리 실패 → 대기(IVE-S)로 되돌린다. 사건 로그에 재기동 사유가 남고, Git 코멘트는 없다', async () => {
    runningDevExec('ex-1')
    expect(stageNow()).toBe('dev')
    resetStuckExecutions()                              // 서버 기동
    expect(stageNow()).toBe('dev_fail')                 // 종전에는 여기서 멈췄다

    expect(await requeueRestartInterrupted(project, IID, 'tok')).toBe('requeued')
    expect(labels.current).toEqual(['IVE', 'IVE-S'])
    expect(stageNow()).toBe('waiting')
    expect(endReason('ex-1')).toBe('restart_requeued')
    expect(db.prepare("SELECT cached_stage FROM issue_stages WHERE project_id='p1' AND issue_iid=?").get(IID)).toEqual({ cached_stage: 'waiting' })
    expect(getIssueEvents('p1', IID)[0]).toMatchObject({ fromStage: 'dev_fail', toStage: 'waiting', action: 'retry', reason: 'restart', source: 'scanner', executionId: 'ex-1', actorType: 'system' })
    expect(providerMock.addIssueComment).not.toHaveBeenCalled()

    // 다음 스캔에서 같은 기록으로 다시 되돌리지 않는다
    labels.current = ['IVE', 'IVE-D']
    expect(await requeueRestartInterrupted(project, IID, 'tok')).toBeNull()
  })

  it('재기동과 무관하게 실패한 처리는 건드리지 않는다', async () => {
    db.prepare(`INSERT INTO task_executions (id, project_id, agent_id, issue_iid, status, started_at, assignee_type)
                VALUES ('ex-1', 'p1', 'ag1', ?, 'failed', '2026-10-03T09:00:00Z', 'agent')`).run(IID)
    expect(await requeueRestartInterrupted(project, IID, 'tok')).toBeNull()
    expect(labels.current).toEqual(['IVE', 'IVE-D'])
    expect(providerMock.removeIssueLabels).not.toHaveBeenCalled()
  })

  it('Git 전이가 실패하면 기록을 그대로 두어 다음 스캔에 다시 시도한다', async () => {
    runningDevExec('ex-1'); resetStuckExecutions()
    providerMock.removeIssueLabels.mockRejectedValueOnce(new Error('502'))
    expect(await requeueRestartInterrupted(project, IID, 'tok')).toBe('failed')
    expect(endReason('ex-1')).toBe('restart')
    expect(await requeueRestartInterrupted(project, IID, 'tok')).toBe('requeued')
  })

  it(`연달아 ${MAX_RESTART_REQUEUE}회 넘게 끊기면 멈추고 이슈 안내를 남긴다 — 사람이 재처리한 뒤로는 새로 센다`, async () => {
    for (let i = 1; i <= MAX_RESTART_REQUEUE; i++) {
      labels.current = ['IVE', 'IVE-D']; runningDevExec(`ex-${i}`); resetStuckExecutions()
      expect(await requeueRestartInterrupted(project, IID, 'tok')).toBe('requeued')
    }
    labels.current = ['IVE', 'IVE-D']; runningDevExec('ex-x'); resetStuckExecutions()
    expect(await requeueRestartInterrupted(project, IID, 'tok')).toBe('gave_up')
    expect(labels.current).toEqual(['IVE', 'IVE-D'])
    expect(getStageWorkerNote('p1', IID)).toBe(RESTART_GAVE_UP_NOTE)
    expect(await requeueRestartInterrupted(project, IID, 'tok')).toBeNull()   // 다음 스캔에도 그대로

    // 사람이 「재처리」 → 새 처리가 또 재기동으로 끊김 → 1회째로 다시 되돌린다
    runningDevExec('ex-after'); resetStuckExecutions()
    expect(await requeueRestartInterrupted(project, IID, 'tok')).toBe('requeued')
  })
})
