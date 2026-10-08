// 단계 라벨을 실제로 부착한 사람 판정.
// 에이전트가 CLI 로 검증·확인을 진행하면 이슈 담당자와 실제 수행자가 다를 수 있어,
// 라벨 이벤트의 행위자를 1순위로 쓴다. 단 IVE 자신(프로젝트 토큰=봇)은 건너뛴다.
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { resolveStageActorAsync } from '@/lib/ive-author'
import { stageLabelFor } from '@/lib/stage-transitions'
import { setupTestDb, teardownTestDb, seedUser } from './helpers/test-db'
import type { Project } from '@/types'
import { LEGACY_LABELS } from '@/lib/labels'

const legacyLabels = {
  labelTarget: LEGACY_LABELS.target, labelSchedule: LEGACY_LABELS.schedule, labelDev: LEGACY_LABELS.dev,
  labelVerifyWait: LEGACY_LABELS.verifyWait, labelVerify: LEGACY_LABELS.verify, labelConfirmWait: LEGACY_LABELS.confirmWait,
  labelConfirm: LEGACY_LABELS.confirm, labelEnd: LEGACY_LABELS.end, labelNotify: LEGACY_LABELS.notify,
}

// 옛 기본 이름(IVE, IVE-S …)으로 등록된 기존 프로젝트 — 저장된 이름을 그대로 쓴다
const project = { id: 'p1', provider: 'gitlab', ...legacyLabels } as unknown as Project

const ev = (label: string, username: string | null, createdAt: string, action: 'add' | 'remove' = 'add') =>
  ({ action, label, userId: null, username, createdAt })

describe('resolveStageActorAsync', () => {
  beforeEach(() => {
    const db = setupTestDb()
    seedUser(db, 'u-verifier', '검증자', { gitlabUsername: 'verifier1' })
  })
  afterEach(() => teardownTestDb())

  it('그 라벨을 가장 최근 부착한 사람을 고르고 IVE 계정까지 매칭한다', async () => {
    const a = await resolveStageActorAsync(project, 'IVE-P', async () => [
      ev('IVE-P', 'someone-old', '2026-08-30T00:00:00Z'),
      ev('IVE-P', 'verifier1', '2026-08-31T00:00:00Z'),
    ])
    expect(a?.username).toBe('verifier1')
    expect(a?.user?.id).toBe('u-verifier')
  })

  it('IVE 계정이 없는 외부 협력자도 username 은 돌려준다', async () => {
    const a = await resolveStageActorAsync(project, 'IVE-P', async () => [ev('IVE-P', 'outsider', '2026-08-31T00:00:00Z')])
    expect(a?.username).toBe('outsider')
    expect(a?.user).toBeNull()
  })

  it('봇(IVE 프로젝트 토큰)은 건너뛴다 — 호출부가 assignee 로 fallback 하도록', async () => {
    const a = await resolveStageActorAsync(project, 'IVE-P', async () => [
      ev('IVE-P', 'verifier1', '2026-08-30T00:00:00Z'),
      ev('IVE-P', 'project_12_bot_abc', '2026-08-31T00:00:00Z'),
    ])
    expect(a?.username).toBe('verifier1')   // 최신은 봇이므로 건너뛰고 그 앞의 사람
  })

  it('봇만 있으면 null (담당자 fallback)', async () => {
    const a = await resolveStageActorAsync(project, 'IVE-P', async () => [ev('IVE-P', 'ive-bot', '2026-08-31T00:00:00Z')])
    expect(a).toBeNull()
  })

  it('remove 이벤트나 다른 라벨은 무시한다', async () => {
    const a = await resolveStageActorAsync(project, 'IVE-P', async () => [
      ev('IVE-P', 'verifier1', '2026-08-31T00:00:00Z', 'remove'),
      ev('IVE-V', 'verifier1', '2026-08-31T00:00:00Z'),
    ])
    expect(a).toBeNull()
  })

  it('라벨 이벤트 조회 실패는 null (스캔을 멈추지 않는다)', async () => {
    const a = await resolveStageActorAsync(project, 'IVE-P', async () => { throw new Error('403') })
    expect(a).toBeNull()
  })
})

describe('stageLabelFor', () => {
  it('단계 → 라벨 매핑 (프로젝트 커스텀 라벨 반영)', () => {
    expect(stageLabelFor(project, 'verifying')).toBe('IVE-V')
    expect(stageLabelFor(project, 'confirm_waiting')).toBe('IVE-P')
    expect(stageLabelFor(project, 'done')).toBe('IVE-E')
    expect(stageLabelFor({ ...project, labelConfirm: 'REVIEW-C' } as Project, 'confirming')).toBe('REVIEW-C')
    expect(stageLabelFor(project, null)).toBeNull()
  })
})
