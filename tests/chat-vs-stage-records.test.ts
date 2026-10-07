// AI 채팅 실행(exec-chat-)이 단계 기록을 흐트러뜨리지 않는다.
//
// 채팅도 task_executions 에 assignee_type='agent' 행으로 남는다. 종전에는
//   - 검증 마커가 「가장 최근에 끝난 행」에 달려, 검증 중 채팅을 열었다 닫으면 승인 기록이 채팅 행으로 가서 사라졌다
//   - 검증 시작이 열린 채팅 실행까지 success 로 닫았고, 채팅이 열려 있으면 사람 검증 행이 조용히 안 만들어졌다
//   - 재기동으로 끊긴 채팅이 처리 실패 작업을 자동 재처리시켰다
//   - 채팅만 한 에이전트가 「처리자」로 보였다
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { NextRequest } from 'next/server'
import { getDb, markIssueVerifyStarted, markIssueVerified, markIssueVerifyRejected, takeRestartRequeue, getActualRoleAssignees } from '@/lib/db'
import { setupTestDb, teardownTestDb, seedUser, seedProject, seedAgent, seedExecution } from './helpers/test-db'
import { transitionTarget, TRANSITIONS } from '@/lib/stage-transitions'

const fetchSingleIssue = vi.fn()
const swapIssueLabels = vi.fn()
vi.mock('@/lib/auth', () => ({
  getCurrentUser: async () => ({ id: 'user-1', name: '검증자', isAdmin: true }),
}))
vi.mock('@/lib/provider', async (orig) => ({
  ...(await orig<typeof import('@/lib/provider')>()),
  fetchSingleIssue: (...a: unknown[]) => fetchSingleIssue(...a),
  swapIssueLabels: (...a: unknown[]) => swapIssueLabels(...a),
}))
vi.mock('@/lib/scanner', () => ({ triggerScan: () => {} }))

const PROJ = 'proj-1'
const IID = 7
const T = (m: number) => new Date(Date.UTC(2026, 9, 1, 0, m)).toISOString()

describe('채팅 실행과 단계 기록', () => {
  let db: ReturnType<typeof setupTestDb>
  beforeEach(() => {
    db = setupTestDb()
    seedUser(db, 'user-1', '검증자')
    seedProject(db, PROJ, 'user-1', 'P')
    seedAgent(db, 'agent-dev', 'user-1', '처리봇')
    seedAgent(db, 'agent-chat', 'user-1', '대화봇')
    fetchSingleIssue.mockReset(); swapIssueLabels.mockReset()
    // 처리 실행(끝남)
    seedExecution(db, { id: 'ex-100', projectId: PROJ, agentId: 'agent-dev', issueIid: IID, status: 'success', startedAt: T(0), endedAt: T(10), assigneeType: 'agent' })
  })
  afterEach(() => teardownTestDb())

  const row = (id: string) => getDb().prepare('SELECT * FROM task_executions WHERE id = ?').get(id) as any

  it('검증 중 채팅을 열었다 닫아도 승인 기록은 처리 실행에 남는다', () => {
    markIssueVerifyStarted(PROJ, IID)
    seedExecution(db, { id: 'exec-chat-1', projectId: PROJ, agentId: 'agent-chat', issueIid: IID, status: 'success', startedAt: T(20), endedAt: '2099-01-01T00:00:00.000Z', assigneeType: 'agent' })
    markIssueVerified(PROJ, IID, { name: '검증자', userId: 'user-1' })
    expect(row('ex-100').verified_at).toBeTruthy()
    expect(row('exec-chat-1').verified_at).toBeNull()
  })

  it('반려도 마찬가지 — 확인 기록이 나중에 닫혀도 처리 실행에 단다', () => {
    seedExecution(db, { id: 'ex-confirm-1', projectId: PROJ, agentId: '', issueIid: IID, status: 'failed', startedAt: T(30), endedAt: '2099-01-01T00:00:00.000Z', assigneeType: 'user' })
    markIssueVerifyStarted(PROJ, IID)
    expect(row('ex-100').verify_started_at).toBeTruthy()
    expect(row('ex-confirm-1').verify_started_at).toBeNull()
    markIssueVerifyRejected(PROJ, IID, { name: '검증자' })
    expect(row('ex-100').rejected_at).toBeTruthy()
  })

  it('재기동으로 끊긴 채팅은 처리 재기동 재처리 대상이 아니다', () => {
    seedExecution(db, { id: 'exec-chat-2', projectId: PROJ, agentId: 'agent-chat', issueIid: IID, status: 'failed', startedAt: T(40), endedAt: T(41), assigneeType: 'agent' })
    getDb().prepare("UPDATE task_executions SET end_reason = 'restart' WHERE id = 'exec-chat-2'").run()
    expect(takeRestartRequeue(PROJ, IID)).toBeNull()
  })

  it('채팅만 한 에이전트는 처리자로 보이지 않는다', () => {
    seedExecution(db, { id: 'exec-chat-3', projectId: PROJ, agentId: 'agent-chat', issueIid: IID, status: 'success', startedAt: T(50), endedAt: T(55), assigneeType: 'agent' })
    expect(getActualRoleAssignees(PROJ, IID).processor?.agentName).toBe('처리봇')
  })

  it('채팅이 열려 있어도 「검증 시작」은 채팅을 닫지 않고 검증자 기록을 만든다', async () => {
    seedExecution(db, { id: 'exec-chat-4', projectId: PROJ, agentId: 'agent-chat', issueIid: IID, status: 'running', startedAt: T(60), assigneeType: 'agent' })
    fetchSingleIssue.mockResolvedValue({ iid: IID, title: 't', labels: ['IVE', 'IVE-W'], assignees: [], state: 'opened' })
    const { POST } = await import('@/app/api/projects/[id]/issues/[iid]/stage/route')
    const res = await POST(
      new NextRequest('http://x/api', { method: 'POST', body: JSON.stringify({ stage: 'verify_waiting', action: 'start_verification' }) }),
      { params: Promise.resolve({ id: PROJ, iid: String(IID) }) },
    )
    expect(res.status).toBe(200)
    expect(row('exec-chat-4').status).toBe('running')
    const v = getDb().prepare("SELECT status, user_id FROM task_executions WHERE id LIKE 'ex-verify-%'").all() as any[]
    expect(v).toEqual([{ status: 'assigned', user_id: 'user-1' }])
  })
})

describe('코멘트 말머리 도착 단계 = 실제 전이', () => {
  it('전이 표의 모든 액션이 도착 단계를 가진다', () => {
    for (const [stage, ts] of Object.entries(TRANSITIONS)) for (const t of ts) expect(transitionTarget(stage, t.action), `${stage}.${t.action}`).toBeTruthy()
  })
  it('종전 표가 틀렸던 곳 — 확인 쪽 반려는 검증대기(2026-10-07), 처리 실패 재처리도 말머리가 있다', () => {
    expect(transitionTarget('confirm_waiting', 'return_to_dev')).toBe('verify_waiting')
    expect(transitionTarget('confirming', 'return_to_dev')).toBe('verify_waiting')
    expect(transitionTarget('confirming', 'retry')).toBeNull()
    expect(transitionTarget('dev_fail', 'retry')).toBe('waiting')
    expect(transitionTarget('verifying', 'to_inflow')).toBe('none')
    expect(transitionTarget('verifying', 'approve')).toBe('confirm_waiting')
    expect(transitionTarget('verifying', 'nope')).toBeNull()
  })
})
