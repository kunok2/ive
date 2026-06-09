import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { getDb, createProject, createAgent, createExecution, updateExecutionStatus, markIssueVerifyStarted, markIssueVerified, markIssueConfirmed, getExecutionsInRange } from '@/lib/db'
import { setupTestDb, teardownTestDb } from './helpers/test-db'

describe('Issue #461 재현: 재처리된 이슈의 검증/확인 시간 공유 문제', () => {
  const USER_ID = 'user-1'
  const PROJ_ID = 'proj-1'
  const AGENT_ID = 'agent-1'
  const ISSUE_IID = 461

  beforeEach(() => {
    setupTestDb()
    const db = getDb()
    // 유저 생성 필요 (foreign key 제약)
    db.prepare("INSERT INTO users (id, email, name) VALUES (?, ?, ?)").run(USER_ID, 'test@test.com', 'Test User')
    createProject({
      id: PROJ_ID,
      userId: USER_ID,
      name: 'Test Project',
      provider: 'gitlab',
      repoUrl: 'https://gitlab.com/test/test',
      labelTarget: 'IVE',
      accessToken: 'token',
      checkInterval: 1,
      createdAt: new Date().toISOString()
    })
    createAgent({
      id: AGENT_ID,
      userId: USER_ID,
      name: 'Test Agent',
      cliName: 'claude',
      cliPath: '/usr/bin/claude',
      cliVersion: '1.0.0',
      maxTurns: 200,
      status: 'available',
      createdAt: new Date().toISOString()
    })
  })

  afterEach(() => {
    teardownTestDb()
  })

  it('실패 후 재시도된 이슈에서 실패 건이 검증/확인 시간을 "빌려오지" 않아야 한다', () => {
    // 1. 첫 번째 시도: 실패
    const ex1Id = 'ex-1'
    createExecution({
      id: ex1Id, projectId: PROJ_ID, agentId: AGENT_ID, issueIid: ISSUE_IID,
      issueTitle: 'Buggy Issue', startedAt: '2026-06-09T10:00:00Z',
      issueCreatedAt: '2026-06-09T09:00:00Z', status: 'assigned', logPath: ''
    })
    updateExecutionStatus(ex1Id, 'failed', '2026-06-09T10:10:00Z')

    // 2. 두 번째 시도: 성공 및 검증 시작
    const ex2Id = 'ex-2'
    createExecution({
      id: ex2Id, projectId: PROJ_ID, agentId: AGENT_ID, issueIid: ISSUE_IID,
      issueTitle: 'Buggy Issue', startedAt: '2026-06-09T11:00:00Z',
      issueCreatedAt: '2026-06-09T09:00:00Z', status: 'assigned', logPath: ''
    })
    updateExecutionStatus(ex2Id, 'success', '2026-06-09T11:10:00Z')

    // 검증 시작
    markIssueVerifyStarted(PROJ_ID, ISSUE_IID)

    // 검증 승인
    markIssueVerified(PROJ_ID, ISSUE_IID, { name: 'Verifier', userId: 'v-1' })

    // 확인 완료
    markIssueConfirmed(PROJ_ID, ISSUE_IID, { name: 'Confirmer', userId: 'c-1' })

    // 결과 확인
    const execs = getExecutionsInRange(USER_ID, '2026-06-09', '2026-06-10')
    const ex1 = execs.find(e => e.id === ex1Id)!
    const ex2 = execs.find(e => e.id === ex2Id)!

    console.log('Ex1 (failed):', { verifiedAt: ex1.verifiedAt, confirmedAt: ex1.confirmedAt })
    console.log('Ex2 (success):', { verifiedAt: ex2.verifiedAt, confirmedAt: ex2.confirmedAt })

    // ex2(성공건)는 검증/확인 정보가 있어야 함
    expect(ex2.status).toBe('success')
    expect(ex2.verifiedAt).not.toBeNull()
    expect(ex2.confirmedAt).not.toBeNull()

    // ex1(실패건)은 검증/확인 정보가 없어야 함
    expect(ex1.status).toBe('failed')
    // 현재 버그로 인해 ex1도 verifiedAt이 찍힐 것으로 예상됨
    expect(ex1.verifiedAt).toBeNull()
  })
})
