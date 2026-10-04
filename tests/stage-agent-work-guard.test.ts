// 에이전트가 검증·확인·처리 중인 작업은 사람이 단계를 옮기지 못한다.
//
// 종전에는 검증 에이전트가 도는 동안에도 작업 상세의 「확인 →」·「← 재실행」·「유입」(검증대기면 「검증 시작」)이 살아 있어
// 누르면 사람이 같은 검증을 겹쳐 하거나, 에이전트의 판정과 사람이 옮긴 단계가 엇갈렸다.
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { NextRequest } from 'next/server'
import { setupTestDb, teardownTestDb, seedUser, seedProject, seedAgent, seedExecution } from './helpers/test-db'
import { getRunningAgentWork } from '@/lib/db'

const fetchSingleIssue = vi.fn()
const swapIssueLabels = vi.fn()
vi.mock('@/lib/auth', () => ({
  getCurrentUser: async () => ({ id: 'user-1', name: '관리자', isAdmin: true }),
}))
vi.mock('@/lib/provider', async (orig) => ({
  ...(await orig<typeof import('@/lib/provider')>()),
  fetchSingleIssue: (...a: unknown[]) => fetchSingleIssue(...a),
  swapIssueLabels: (...a: unknown[]) => swapIssueLabels(...a),
}))

const PROJ = 'proj-1'
const IID = 42
const NOW = new Date().toISOString()

function post(stage: string, action: string, dryRun?: boolean) {
  return import('@/app/api/projects/[id]/issues/[iid]/stage/route').then(m =>
    m.POST(
      new NextRequest('http://x/api', { method: 'POST', body: JSON.stringify({ stage, action, dryRun }) }),
      { params: Promise.resolve({ id: PROJ, iid: String(IID) }) },
    ))
}

describe('에이전트 작업 중 단계 이동 차단', () => {
  let db: ReturnType<typeof setupTestDb>
  beforeEach(() => {
    db = setupTestDb()
    seedUser(db, 'user-1', '관리자')
    seedProject(db, PROJ, 'user-1', 'P')
    seedAgent(db, 'agent-1', 'user-1', '검증봇')
    fetchSingleIssue.mockReset()
    swapIssueLabels.mockReset()
  })
  afterEach(() => teardownTestDb())

  it('검증 에이전트가 돌고 있으면 그 실행과 에이전트 이름을 돌려준다', () => {
    seedExecution(db, { id: 'ex-verify-1', projectId: PROJ, agentId: 'agent-1', issueIid: IID, status: 'running', startedAt: NOW, assigneeType: 'agent' })
    expect(getRunningAgentWork(PROJ, IID)).toEqual({ executionId: 'ex-verify-1', agentName: '검증봇' })
  })

  it('사람이 맡은 검증·AI 채팅·끝난 실행은 막지 않는다', () => {
    seedExecution(db, { id: 'ex-verify-2', projectId: PROJ, agentId: '', issueIid: IID, status: 'assigned', startedAt: NOW, assigneeType: 'user', userName: '사람' })
    seedExecution(db, { id: 'exec-chat-1', projectId: PROJ, agentId: 'agent-1', issueIid: IID, status: 'running', startedAt: NOW, assigneeType: 'agent' })
    seedExecution(db, { id: 'ex-verify-3', projectId: PROJ, agentId: 'agent-1', issueIid: IID, status: 'success', startedAt: NOW, endedAt: NOW, assigneeType: 'agent' })
    expect(getRunningAgentWork(PROJ, IID)).toBeNull()
  })

  it('검증 에이전트 실행 중 사람의 승인·반려·검증 시작은 409 로 거절되고 Git 은 건드리지 않는다', async () => {
    seedExecution(db, { id: 'ex-verify-1', projectId: PROJ, agentId: 'agent-1', issueIid: IID, status: 'running', startedAt: NOW, assigneeType: 'agent' })
    for (const [stage, action] of [['verifying', 'approve'], ['verifying', 'retry'], ['verifying', 'to_inflow'], ['verify_waiting', 'start_verification']]) {
      const res = await post(stage, action)
      expect(res.status).toBe(409)
      const body = await res.json()
      expect(body.error).toContain("'검증봇'")
      expect(body.error).toContain('검증 중')
    }
    expect(fetchSingleIssue).not.toHaveBeenCalled()
  })

  it('확인 에이전트면 「확인 중」으로 알린다', async () => {
    seedExecution(db, { id: 'ex-confirm-1', projectId: PROJ, agentId: 'agent-1', issueIid: IID, status: 'running', startedAt: NOW, assigneeType: 'agent' })
    const res = await post('confirming', 'accept')
    expect(res.status).toBe(409)
    expect((await res.json()).error).toContain('확인 중')
  })

  it('에이전트 실행이 없으면 가드를 지나 종전 경로(Git 단계 확인)로 간다', async () => {
    fetchSingleIssue.mockResolvedValue(null)
    await post('verifying', 'approve')
    expect(fetchSingleIssue).toHaveBeenCalled()
  })

  // 코멘트 + 단계 이동: 화면은 코멘트를 올리기 전에 dryRun 으로 먼저 묻는다 — 거절될 이동의 코멘트가 남지 않게
  it('dryRun — 에이전트 작업 중이면 409', async () => {
    seedExecution(db, { id: 'ex-verify-1', projectId: PROJ, agentId: 'agent-1', issueIid: IID, status: 'running', startedAt: NOW, assigneeType: 'agent' })
    const res = await post('verifying', 'approve', true)
    expect(res.status).toBe(409)
  })

  it('dryRun — 통과해도 라벨을 바꾸지 않는다', async () => {
    fetchSingleIssue.mockResolvedValue({ labels: ['IVE', 'IVE-V'], assignees: [] })
    const res = await post('verifying', 'approve', true)
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ ok: true, dryRun: true })
    expect(swapIssueLabels).not.toHaveBeenCalled()
  })

  it('dryRun — 단계가 이미 바뀌었으면 409(실제 단계를 알려준다)', async () => {
    fetchSingleIssue.mockResolvedValue({ labels: ['IVE', 'IVE-P'], assignees: [] })
    const res = await post('verifying', 'approve', true)
    expect(res.status).toBe(409)
    expect((await res.json()).actualStage).toBe('confirm_waiting')
    expect(swapIssueLabels).not.toHaveBeenCalled()
  })

  // 같은 작업에 단계 변경이 동시에 두 번 오면(버튼 두 곳·더블클릭) 두 번째는 거절 — 기록이 두 번 남지 않게
  it('동시에 두 번 오면 두 번째는 409, 끝난 뒤에는 다시 받는다', async () => {
    let release!: () => void
    fetchSingleIssue.mockImplementationOnce(() => new Promise(r => { release = () => r(null) }))
    const first = post('verifying', 'approve')
    await new Promise(r => setTimeout(r, 0))
    const second = await post('verifying', 'approve')
    expect(second.status).toBe(409)
    expect((await second.json()).error).toContain('처리하는 중')
    // dryRun 은 잠그지도 막히지도 않는다
    fetchSingleIssue.mockResolvedValue({ labels: ['IVE', 'IVE-V'], assignees: [] })
    expect((await post('verifying', 'approve', true)).status).toBe(200)
    release()
    await first
    fetchSingleIssue.mockResolvedValue({ labels: ['IVE', 'IVE-P'], assignees: [] })  // 단계가 이미 바뀜 → 잠금이 아니라 단계 불일치로 거절
    const third = await post('verifying', 'approve')
    expect((await third.json()).actualStage).toBe('confirm_waiting')
  })
})
