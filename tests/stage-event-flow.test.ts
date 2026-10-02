/**
 * 단계 전이 사건 로그 — 흐름 통합 (DB 는 실제 스키마, Git 호스팅 API 만 가짜).
 *
 * F-1: 단계 작업자(에이전트)가 applyStageAction 으로 옮기면 작업자·모델·실행·판정이 함께 남는다.
 *      다음 스캔이 같은 라벨 변화를 감지해도 Git 라벨 이력을 조회하지 않고 건너뛴다(중복 없음).
 * F-2: 사람이 Git 화면에서 라벨을 옮긴 전이는 스캐너가 남기고, 작업자는 라벨을 붙인 사람, 시각은 라벨을 붙인 시각이다.
 * F-3: 누가 옮겼는지 모르면 작업자 unknown 으로 남기고, 참고로 담당자 Git 계정을 함께 둔다.
 * F-4: 단계 기록이 없던 이슈가 곧바로 완료로 보이면(사후 기록 IVE-E) action=external 로 남고, 작업자는 이슈 작성자다.
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

  it('F-4: 사후 기록의 작업자는 이슈 작성자다(Git 계정으로 IVE 사용자를 찾는다)', async () => {
    db.prepare(`INSERT INTO users (id, email, name, gitlab_username) VALUES ('u1', 'k@x.com', '정균옥', 'kojoung')`).run()
    await recordScannedStageChange({
      project, iid: 13, prevStage: null, stage: 'done',
      resolveActor: async () => null, assigneeUsername: () => 'someone', author: { username: 'kojoung', gitUserId: 9 },
    })
    expect(getIssueEvents('p1', 13)[0]).toMatchObject({ action: 'external', actorType: 'user', actorUserId: 'u1', actorGitUsername: 'kojoung', detail: null })
  })

  it('단계가 그대로면 아무것도 하지 않는다', async () => {
    const resolveActor = vi.fn(async () => null)
    expect(await recordScannedStageChange({ project, iid: 12, prevStage: 'dev', stage: 'dev', resolveActor, assigneeUsername: () => null })).toBe(false)
    expect(resolveActor).not.toHaveBeenCalled()
  })
})

describe('리뷰에서 찾은 결함 — 회귀 방지', () => {
  it('처리 중이 아니던 이슈가 dev_fail 로 보이면(담당자가 IVE-D 를 막 붙임) 처리 시작으로 남긴다', async () => {
    const resolveActor = vi.fn(async () => null)
    await recordScannedStageChange({ project, iid: 20, prevStage: 'waiting', stage: 'dev_fail', resolveActor, assigneeUsername: () => null })
    expect(getIssueEvents('p1', 20).map(e => [e.fromStage, e.toStage])).toEqual([['waiting', 'dev']])
    // 다음 스캔에서 실행이 생겨 dev 로 보이면 같은 도착이라 남기지 않는다
    expect(await recordScannedStageChange({ project, iid: 20, prevStage: 'dev_fail', stage: 'dev', resolveActor, assigneeUsername: () => null })).toBe(false)
  })

  it('처리 중 → 실패는 라벨이 바뀌지 않으므로 라벨 이력을 조회하지 않는다', async () => {
    const resolveActor = vi.fn(async () => ({ username: 'owner', user: null, createdAt: '2026-01-01T00:00:00Z' }))
    await recordScannedStageChange({ project, iid: 21, prevStage: 'waiting', stage: 'dev', resolveActor: async () => null, assigneeUsername: () => null })
    await recordScannedStageChange({ project, iid: 21, prevStage: 'dev', stage: 'dev_fail', resolveActor, assigneeUsername: () => null })
    expect(resolveActor).not.toHaveBeenCalled()
    expect(getIssueEvents('p1', 21).at(-1)).toMatchObject({ toStage: 'dev_fail', actorType: 'unknown' })
  })

  it('라벨을 붙인 시각이 마지막 사건보다 앞이면(앞 사이클의 라벨) 작업자·시각으로 쓰지 않는다', async () => {
    await recordScannedStageChange({ project, iid: 22, prevStage: 'waiting', stage: 'dev', resolveActor: async () => null, assigneeUsername: () => null })
    const t = getIssueEvents('p1', 22)[0].occurredAt
    const old = new Date(new Date(t).getTime() - 86_400_000).toISOString()
    await recordScannedStageChange({ project, iid: 22, prevStage: 'dev', stage: 'verify_waiting', resolveActor: async () => ({ username: 'someone', user: null, createdAt: old }), assigneeUsername: () => 'x' })
    const last = getIssueEvents('p1', 22).at(-1)!
    expect(last.actorType).toBe('unknown')
    expect(last.occurredAt >= t).toBe(true)
  })

  it('처음 보는 이슈는 라벨 이력을 조회하지 않는다(프로젝트 연결 직후 API 폭주 방지)', async () => {
    const resolveActor = vi.fn(async () => null)
    await recordScannedStageChange({ project, iid: 23, prevStage: null, stage: 'waiting', resolveActor, assigneeUsername: () => null })
    expect(resolveActor).not.toHaveBeenCalled()
    expect(getIssueEvents('p1', 23)).toHaveLength(1)
  })

  it('출발 단계는 사건 로그를 따른다(닫힘 뒤 다시 보이면 closed → …)', async () => {
    const { recordStageEvent } = await import('@/lib/db')
    recordStageEvent({ projectId: 'p1', issueIid: 24, fromStage: 'verify_waiting', toStage: 'closed', action: 'abandoned', source: 'scanner' })
    await recordScannedStageChange({ project, iid: 24, prevStage: 'done', stage: 'waiting', resolveActor: async () => null, assigneeUsername: () => null })
    expect(getIssueEvents('p1', 24).at(-1)).toMatchObject({ fromStage: 'closed', toStage: 'waiting' })
  })
})
