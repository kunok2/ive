import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { getDb, createProject, setAssignMode, stageFromLabels, hasActiveExecution, hasActiveExecutionForStage, getProject, createExecution, updateExecutionStatus } from '@/lib/db'
import { setupTestDb, teardownTestDb } from './helpers/test-db'

// 운영 메타샵: 담당자(사람) 모드 작업을 시작할 때 잠깐 「처리 실패」가 떴다가 정상이 된다.
// 레이블(처리)만 먼저 붙고 사람 실행은 스캐너가 다음 스캔에 만들어 주기 때문 — 그 사이는 실패가 아니다.
describe('담당자 모드 처리 시작 — 실행이 아직 없어도 처리 실패로 보이지 않는다', () => {
  beforeEach(() => {
    setupTestDb()
    getDb().prepare("INSERT INTO users (id, email, name) VALUES (?, ?, ?)").run('u1', 'a@a.com', 'A')
    createProject({ id: 'p1', userId: 'u1', name: 'P', provider: 'gitlab', repoUrl: 'https://gitlab.com/t/t', labelTarget: 'ive', accessToken: 't', checkInterval: 1, createdAt: new Date().toISOString() } as Parameters<typeof createProject>[0])
  })
  afterEach(() => teardownTestDb())

  const stage = (iid: number, active: boolean) => stageFromLabels(['ive:doing'], getProject('p1')!, { hasActiveExec: active })

  it('에이전트(자동) 모드: 실행 기록이 한 번이라도 있었는데 지금 없으면 처리 실패', () => {
    getDb().prepare("INSERT INTO agents (id, user_id, name, cli_name) VALUES ('a1', 'u1', 'A', 'claude')").run()
    createExecution({ id: 'ex-f', projectId: 'p1', agentId: 'a1', issueIid: 1, issueTitle: 'T', startedAt: '2026-06-09T10:00:00Z', issueCreatedAt: '2026-06-09T09:00:00Z', status: 'assigned', logPath: '' })
    updateExecutionStatus('ex-f', 'failed', '2026-06-09T10:10:00Z')
    expect(hasActiveExecutionForStage('p1', 1)).toBe(false)
    expect(stage(1, hasActiveExecutionForStage('p1', 1))).toBe('dev_fail')
  })

  it('실행 기록이 한 번도 없는 건(외부 도구·사람이 Git 에서 레이블만 옮긴 처리)은 처리 실패가 아니다', () => {
    expect(hasActiveExecution('p1', 3)).toBe(false)
    expect(stage(3, hasActiveExecutionForStage('p1', 3))).toBe('dev')
  })

  it('담당자 모드: 처리 레이블만 있고 실행이 아직 없어도 처리 중', () => {
    setAssignMode('p1', 2, 'assignee')
    expect(hasActiveExecution('p1', 2)).toBe(false) // 종전 판정 — 이게 처리 실패로 보였다
    expect(stage(2, hasActiveExecution('p1', 2))).toBe('dev_fail')
    expect(stage(2, hasActiveExecutionForStage('p1', 2))).toBe('dev')
  })
})
