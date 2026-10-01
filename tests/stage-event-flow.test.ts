/**
 * 단계 전이 사건 로그 — 흐름 통합 (DB 는 실제 스키마, Git 호스팅 API 만 가짜).
 *
 * F-1: 단계 작업자(에이전트)가 applyStageAction 으로 옮기면 작업자·모델·실행·판정이 함께 남는다.
 *      다음 스캔이 같은 라벨 변화를 감지해도 Git 라벨 이력을 조회하지 않고 건너뛴다(중복 없음).
 * F-2: 사람이 Git 화면에서 라벨을 옮긴 전이는 스캐너가 남기고, 작업자는 라벨을 붙인 사람, 시각은 라벨을 붙인 시각이다.
 * F-3: 누가 옮겼는지 모르면 작업자 unknown 으로 남기고, 참고로 담당자 Git 계정을 함께 둔다.
 * F-4: 단계 기록이 없던 이슈가 곧바로 완료로 보이면(사후 기록 IVE-E) action=external 로 남는다.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import Database from 'better-sqlite3'

const providerMock = vi.hoisted(() => ({
  addIssueLabels: vi.fn(async () => undefined),
  removeIssueLabels: vi.fn(async () => undefined),
  fetchSingleIssue: vi.fn(),
}))
vi.mock('@/lib/provider', () => providerMock)

import { initSchema } from '@/lib/db/schema'
import { getIssueEvents } from '@/lib/db'
import { applyStageAction } from '@/lib/stage-apply'
import { agentActor } from '@/lib/event-actor'
import { recordScannedStageChange } from '@/lib/scanner/stage-events'
import type { Project, User } from '@/types'

const project = {
  id: 'p1', provider: 'gitlab', labelTarget: 'IVE',
  labelSchedule: 'IVE-S', labelDev: 'IVE-D', labelVerifyWait: 'IVE-W', labelVerify: 'IVE-V',
  labelConfirmWait: 'IVE-P', labelConfirm: 'IVE-C', labelEnd: 'IVE-E',
} as unknown as Project

let db: Database.Database
beforeEach(() => {
  vi.clearAllMocks()
  db = new Database(':memory:')
  initSchema(db)
  ;(globalThis as any).db = db
  db.pragma('foreign_keys = OFF')
})
afterEach(() => { db.close(); (globalThis as any).db = undefined })

describe('단계 작업자 경로', () => {
  it('F-1: 검증 에이전트가 승인하면 작업자·모델·실행·판정이 남고, 다음 스캔은 Git 조회 없이 건너뛴다', async () => {
    db.prepare(`INSERT INTO task_executions (id, project_id, agent_id, issue_iid, status, started_at, model_name, prompt_version)
                VALUES ('ex-verify-1', 'p1', 'agV', 7, 'success', '2026-10-01T00:00:00Z', 'claude-opus-5-5', 'verify:v3')`).run()
    providerMock.fetchSingleIssue.mockResolvedValue({ iid: 7, labels: ['IVE', 'IVE-P'], assignees: [], title: 't' })

    const next = await applyStageAction(project, 7, 'tok', 'verifying', 'approve', {
      actor: agentActor({ id: 'agV', cliName: 'claude', modelName: '' }, 'ex-verify-1'),
      executionId: 'ex-verify-1', reason: 'pass',
    })
    expect(next).toBe('confirm_waiting')

    const [ev] = getIssueEvents('p1', 7)
    expect(ev).toMatchObject({
      event: 'stage', fromStage: 'verifying', toStage: 'confirm_waiting', action: 'approve',
      actorType: 'agent', actorAgentId: 'agV', actorModel: 'claude-opus-5-5',
      executionId: 'ex-verify-1', promptVersion: 'verify:v3', reason: 'pass', source: 'worker',
    })

    const resolveActor = vi.fn(async () => null)
    const recorded = await recordScannedStageChange({
      project, iid: 7, prevStage: 'verifying', stage: 'confirm_waiting', resolveActor, assigneeUsername: () => null,
    })
    expect(recorded).toBe(false)
    expect(resolveActor).not.toHaveBeenCalled()
    expect(getIssueEvents('p1', 7)).toHaveLength(1)
  })
})

describe('스캐너가 감지한 전이', () => {
  it('F-2: 사람이 라벨을 옮기면 그 사람과 라벨을 붙인 시각으로 남는다', async () => {
    const user = { id: 'u1', name: '정균옥' } as unknown as User
    const ok = await recordScannedStageChange({
      project, iid: 8, prevStage: 'verify_waiting', stage: 'verifying',
      resolveActor: async () => ({ username: 'kojoung', user, createdAt: '2026-10-01T01:02:03.000Z' }),
      assigneeUsername: () => 'someone',
    })
    expect(ok).toBe(true)
    expect(getIssueEvents('p1', 8)[0]).toMatchObject({
      fromStage: 'verify_waiting', toStage: 'verifying', actorType: 'user', actorUserId: 'u1',
      actorGitUsername: 'kojoung', occurredAt: '2026-10-01T01:02:03.000Z', source: 'scanner', detail: null,
    })
  })

  it('F-2: 검증·확인 마커 처리에서 이미 찾은 작업자가 있으면 다시 조회하지 않는다', async () => {
    const resolveActor = vi.fn(async () => null)
    await recordScannedStageChange({
      project, iid: 9, prevStage: 'verifying', stage: 'waiting',
      knownActor: { username: 'kim-dev', user: null, createdAt: '2026-10-01T02:00:00Z' },
      resolveActor, assigneeUsername: () => null,
    })
    expect(resolveActor).not.toHaveBeenCalled()
    expect(getIssueEvents('p1', 9)[0]).toMatchObject({ actorType: 'user', actorUserId: null, actorGitUsername: 'kim-dev' })
  })

  it('F-3: 누가 옮겼는지 모르면 unknown 과 담당자 계정을 남긴다', async () => {
    await recordScannedStageChange({
      project, iid: 10, prevStage: 'dev', stage: 'dev_fail',
      resolveActor: async () => null, assigneeUsername: () => 'park-dev',
    })
    expect(getIssueEvents('p1', 10)[0]).toMatchObject({ actorType: 'unknown', detail: { assignee: 'park-dev' } })
  })

  it('F-4: 단계 기록이 없던 이슈가 곧바로 완료면 사후 기록(external)이다', async () => {
    await recordScannedStageChange({
      project, iid: 11, prevStage: null, stage: 'done',
      resolveActor: async () => null, assigneeUsername: () => null,
    })
    expect(getIssueEvents('p1', 11)[0]).toMatchObject({ fromStage: null, toStage: 'done', action: 'external' })
  })

  it('단계가 그대로면 아무것도 하지 않는다', async () => {
    const resolveActor = vi.fn(async () => null)
    expect(await recordScannedStageChange({ project, iid: 12, prevStage: 'dev', stage: 'dev', resolveActor, assigneeUsername: () => null })).toBe(false)
    expect(resolveActor).not.toHaveBeenCalled()
  })
})
