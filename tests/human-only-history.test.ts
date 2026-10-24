// 에이전트가 처리한 적 없이 사람이 처리·검증·확인해 온 이슈는 반려로 대기에 돌아와도 사람이 이어 맡는다 (운영 메타샵 2325).
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { createExecution, hasOnlyHumanHistory } from '@/lib/db'
import { setupTestDb, teardownTestDb, seedUser, seedProject } from './helpers/test-db'

const PROJ = 'proj-1'
const base = { projectId: PROJ, issueTitle: 't', logPath: '', inputTokens: 0, outputTokens: 0, costUsd: 0, turns: 0 }

describe('hasOnlyHumanHistory', () => {
  beforeEach(() => {
    const db = setupTestDb()
    seedUser(db, 'user-1', '사람')
    seedProject(db, PROJ, 'user-1', 'P')
  })
  afterEach(() => teardownTestDb())

  const human = (id: string, iid: number) =>
    createExecution({ ...base, id, agentId: '', issueIid: iid, status: 'success', startedAt: new Date().toISOString(), assigneeType: 'user', userId: 'user-1', userName: '사람' } as any)
  const agent = (id: string, iid: number) =>
    createExecution({ ...base, id, agentId: 'ag-1', issueIid: iid, status: 'success', startedAt: new Date().toISOString(), assigneeType: 'agent' } as any)

  it('실행 기록이 아예 없으면 아니다 — 새 이슈는 종전대로 에이전트 몫', () => {
    expect(hasOnlyHumanHistory(PROJ, 1)).toBe(false)
  })

  it('사람 처리·검증 기록만 있으면 맞다', () => {
    human('ex-ext-1', 2)
    human('ex-verify-2', 2)
    expect(hasOnlyHumanHistory(PROJ, 2)).toBe(true)
  })

  it('에이전트가 처리한 적이 있으면 아니다', () => {
    human('ex-verify-3', 3)
    agent('ex-3-agent', 3)
    expect(hasOnlyHumanHistory(PROJ, 3)).toBe(false)
  })

  it('에이전트는 검증만 했고 처리는 사람이면 맞다', () => {
    human('ex-ext-4', 4)
    agent('ex-verify-4-agent', 4)
    expect(hasOnlyHumanHistory(PROJ, 4)).toBe(true)
  })

  it('AI 채팅 기록만으로는 사람 이력으로 세지 않는다', () => {
    human('exec-chat-5', 5)
    expect(hasOnlyHumanHistory(PROJ, 5)).toBe(false)
  })

  it('다른 이슈의 기록은 섞이지 않는다', () => {
    human('ex-ext-6', 6)
    expect(hasOnlyHumanHistory(PROJ, 7)).toBe(false)
  })
})
