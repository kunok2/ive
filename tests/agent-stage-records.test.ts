// 에이전트가 glab/gh 로 라벨을 옮겨 검증·확인을 진행하는 경로의 기록.
//
// 종전에는 검증/확인 실행 기록(ex-verify-/ex-confirm-)을 IVE 화면의 단계 버튼만 만들었다.
// CLI 로 라벨만 옮기면 행이 없어 검증·확인이 보고서에서 통째로 빠졌다.
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { getDb, createExecution, updateExecutionStatus, markIssueVerifyStarted, markIssueVerified, markIssueVerifyRejected, getActualRoleAssignees, getActualRoleAssigneesMap } from '@/lib/db'
import { setupTestDb, teardownTestDb, seedUser, seedProject } from './helpers/test-db'
import { openStageExecution, closeStageExecutions, hasOpenStageExecution, pickStageMeta } from '@/lib/scanner/stage-records'
import { parseIveMetaSessions } from '@/lib/scanner/formatters'
import { resolveExecutionCostBreakdown, computeHumanRate } from '@/lib/token-pricing'

const PROJ = 'proj-1'
const IID = 77

describe('CLI 경로의 검증/확인 실행 기록', () => {
  beforeEach(() => {
    const db = setupTestDb()
    seedUser(db, 'user-1', '검증자', { gitlabUsername: 'verifier1' })
    seedProject(db, PROJ, 'user-1', 'P')
  })
  afterEach(() => teardownTestDb())

  it('검증 시작 → 행 생성, 승인 → success 로 닫힘', () => {
    const id = openStageExecution(PROJ, IID, 'verify', { issueTitle: '이슈', userId: 'user-1', userName: '검증자' })
    expect(id).toBeTruthy()
    expect(hasOpenStageExecution(PROJ, IID, 'verify')).toBe(true)

    expect(closeStageExecutions(PROJ, IID, 'verify', 'success')).toBe(1)
    const row = getDb().prepare('SELECT status, ended_at FROM task_executions WHERE id = ?').get(id!) as any
    expect(row.status).toBe('success')
    expect(row.ended_at).toBeTruthy()
    expect(hasOpenStageExecution(PROJ, IID, 'verify')).toBe(false)
  })

  it('이미 열린 행이 있으면(화면 버튼으로 시작) 중복 생성하지 않는다', () => {
    openStageExecution(PROJ, IID, 'verify', {})
    expect(openStageExecution(PROJ, IID, 'verify', {})).toBeNull()
    const n = getDb().prepare("SELECT COUNT(*) c FROM task_executions WHERE id LIKE 'ex-verify-%'").get() as any
    expect(n.c).toBe(1)
  })

  it('검증과 확인은 서로 다른 행으로 관리된다', () => {
    openStageExecution(PROJ, IID, 'verify', {})
    expect(hasOpenStageExecution(PROJ, IID, 'confirm')).toBe(false)
    openStageExecution(PROJ, IID, 'confirm', {})
    expect(closeStageExecutions(PROJ, IID, 'verify', 'success')).toBe(1)
    expect(hasOpenStageExecution(PROJ, IID, 'confirm')).toBe(true)
  })

  it('반려는 failed 로 닫히고, 반려라는 까닭(fail)을 남긴다', () => {
    openStageExecution(PROJ, IID, 'verify', {})
    closeStageExecutions(PROJ, IID, 'verify', 'failed')
    const row = getDb().prepare("SELECT status, stage_verdict FROM task_executions WHERE id LIKE 'ex-verify-%'").get() as any
    expect(row).toMatchObject({ status: 'failed', stage_verdict: 'fail' })
  })

  it('에이전트가 남긴 ive-meta 로 토큰·구간이 채워지고, 사람 비용은 0이 된다', () => {
    const notes = [
      { body: '개발 완료했습니다' },
      { body: `검토 결과: 통과.\n\n<!-- ive-meta\nstage: verify\nmodel: claude-opus-5\ninput_tokens: 120000\noutput_tokens: 4000\ncost_usd: 0.42\nturns: 12\nstarted_at: 2026-08-31T10:00:00+09:00\nended_at: 2026-08-31T10:18:00+09:00\n-->` },
    ]
    const meta = pickStageMeta(notes, 'verify')
    expect(meta?.costUsd).toBeCloseTo(0.42)
    expect(meta?.stage).toBe('verify')

    const id = openStageExecution(PROJ, IID, 'verify', {})!
    closeStageExecutions(PROJ, IID, 'verify', 'success', meta)
    const row = getDb().prepare('SELECT * FROM task_executions WHERE id = ?').get(id) as any
    expect(row.cost_usd).toBeCloseTo(0.42)
    expect(row.input_tokens).toBe(120000)
    expect(row.model_name).toBe('claude-opus-5')
    expect(row.started_at).toBe('2026-08-31T01:00:00.000Z')  // KST → UTC

    // 라벨이 열려 있던 시간(30분)이 아니라 AI 비용만 잡힌다
    const rate = computeHumanRate(9600, 5, 8)  // 분당 $1
    const b = resolveExecutionCostBreakdown({
      id: row.id, costUsd: row.cost_usd, inputTokens: row.input_tokens, outputTokens: row.output_tokens,
      modelName: row.model_name, assigneeType: 'user', startedAt: row.started_at,
      verifyStartedAt: '2026-08-31T09:00:00+09:00', verifiedAt: '2026-08-31T09:30:00+09:00',
    }, rate)
    expect(b.human).toBe(0)
    expect(b.ai).toBeCloseTo(0.42)
  })

  it('확인 단계 ive-meta 는 검증 기록으로 오인되지 않는다', () => {
    const notes = [{ body: '<!-- ive-meta\nstage: confirm\ncost_usd: 0.1\n-->' }]
    expect(pickStageMeta(notes, 'verify')).toBeNull()
    expect(pickStageMeta(notes, 'confirm')?.costUsd).toBeCloseTo(0.1)
  })

  it('stage 가 없는 블록은 개발(dev)로 본다 — 기존 이슈 본문 하위호환', () => {
    const [s] = parseIveMetaSessions('<!-- ive-meta\nmodel: x\ninput_tokens: 10\n-->')
    expect(s.stage).toBe('dev')
  })
})

// 사람이 Git 에서 레이블을 직접 옮겨 검증한 경우 — 상태 그래프(actualVerifier)는 verifier_user_id 가 있는 기록만 읽는다.
// 스캐너가 이름·아바타만 남기고 사용자 id 를 빼면 화면 버튼으로 검증했을 때와 달리 아바타가 비었다.
describe('레이블로 진행한 검증의 검증자 표시', () => {
  beforeEach(() => {
    const db = setupTestDb()
    seedUser(db, 'user-1', '검증자', { gitlabUsername: 'verifier1' })
    seedProject(db, PROJ, 'user-1', 'P')
    createExecution({
      id: 'ex-dev-1', projectId: PROJ, agentId: '', issueIid: IID, issueTitle: '이슈', status: 'assigned',
      startedAt: '2026-10-01T00:00:00.000Z', logPath: '', inputTokens: 0, outputTokens: 0, costUsd: 0, turns: 0,
      issueCreatedAt: '2026-10-01T00:00:00.000Z',
    } as Parameters<typeof createExecution>[0])
    updateExecutionStatus('ex-dev-1', 'success', '2026-10-01T01:00:00.000Z')
    markIssueVerifyStarted(PROJ, IID)
  })
  afterEach(() => teardownTestDb())

  it('통과 — 사용자 id 를 함께 기록하면 검증자로 나온다', () => {
    markIssueVerified(PROJ, IID, { name: '검증자', avatar: 'av-03', username: 'verifier1', userId: 'user-1' })
    expect(getActualRoleAssignees(PROJ, IID).verifier).toEqual({ userId: 'user-1', name: '검증자', avatar: 'av-03' })
    expect(getActualRoleAssigneesMap(PROJ).get(IID)?.verifier?.userId).toBe('user-1')
  })

  it('반려 — 사용자 id 를 함께 기록하면 검증자로 나온다', () => {
    markIssueVerifyRejected(PROJ, IID, { name: '검증자', avatar: 'av-03', username: 'verifier1', userId: 'user-1' })
    expect(getActualRoleAssignees(PROJ, IID).verifier?.userId).toBe('user-1')
  })

  it('사용자 id 없이 이름만 기록하면 검증자가 비어 있다 (종전 스캐너 동작)', () => {
    markIssueVerified(PROJ, IID, { name: '검증자', avatar: 'av-03', username: 'verifier1' })
    expect(getActualRoleAssignees(PROJ, IID).verifier).toBeNull()
  })
})
