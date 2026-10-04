// CLI 사용량 읽기 — 처리 실행(cli-runner)과 AI 대화(chat-agent)가 같은 규칙을 쓴다.
// 대화는 종전에 토큰·비용을 0 으로만 남겼다. 이제 답마다 대화 실행 기록에 더한다.
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { accumulateCliUsage, emptyCliUsage } from '@/lib/cli-usage'
import { getDb, addExecutionUsage } from '@/lib/db'
import { setupTestDb, teardownTestDb, seedUser, seedProject, seedExecution } from './helpers/test-db'

describe('accumulateCliUsage', () => {
  it('claude — result 의 usage·비용, 입력은 캐시 포함', () => {
    const u = emptyCliUsage()
    accumulateCliUsage(u, { type: 'system', model: 'claude-opus-5' }, 'claude')
    accumulateCliUsage(u, { type: 'result', usage: { input_tokens: 10, cache_creation_input_tokens: 5, cache_read_input_tokens: 100, output_tokens: 7 }, total_cost_usd: 0.25 }, 'claude')
    expect(u).toEqual({ input: 115, output: 7, cacheRead: 100, cacheCreation: 5, cost: 0.25, model: 'claude-opus-5' })
  })
  it('codex — turn.completed 마다 더하고 추론은 출력에', () => {
    const u = emptyCliUsage()
    for (let i = 0; i < 2; i++) accumulateCliUsage(u, { type: 'turn.completed', usage: { input_tokens: 50, cached_input_tokens: 20, output_tokens: 3, reasoning_output_tokens: 2 } }, 'codex')
    expect(u).toMatchObject({ input: 100, cacheRead: 40, output: 10, cost: 0 })
  })
  it('opencode — step_finish 의 순수치에 캐시·추론을 합친다', () => {
    const u = emptyCliUsage()
    accumulateCliUsage(u, { type: 'step_finish', part: { tokens: { input: 10, output: 4, reasoning: 1, cache: { read: 30, write: 6 } }, cost: 0.01 } }, 'opencode')
    expect(u).toMatchObject({ input: 46, output: 5, cacheRead: 30, cacheCreation: 6, cost: 0.01 })
  })
  it('agy — result.usage', () => {
    const u = emptyCliUsage()
    accumulateCliUsage(u, { event: 'result', result: { usage: { input_tokens: 80, cache_read_tokens: 60, output_tokens: 9 } } }, 'agy')
    expect(u).toMatchObject({ input: 80, cacheRead: 60, output: 9 })
  })
  it('사용량이 아닌 이벤트는 무시', () => {
    const u = emptyCliUsage()
    accumulateCliUsage(u, { type: 'assistant', message: { content: [] } }, 'claude')
    accumulateCliUsage(u, null, 'claude')
    expect(u).toEqual(emptyCliUsage())
  })
})

describe('addExecutionUsage — 대화 실행 기록에 답마다 누적', () => {
  beforeEach(() => {
    const db = setupTestDb()
    seedUser(db, 'u', 'U'); seedProject(db, 'p', 'u', 'P')
    seedExecution(db, { id: 'exec-chat-1', projectId: 'p', issueIid: 1, status: 'running', startedAt: new Date().toISOString(), assigneeType: 'agent' })
  })
  afterEach(() => teardownTestDb())

  it('덮어쓰지 않고 더하며, 모델은 처음 값을 유지', () => {
    addExecutionUsage('exec-chat-1', { input: 100, output: 10, cacheRead: 50, cacheCreation: 5, cost: 0.1, turns: 1 }, 'claude-opus-5')
    addExecutionUsage('exec-chat-1', { input: 20, output: 2, cacheRead: 0, cacheCreation: 0, cost: 0.02, turns: 1 }, 'other')
    const r = getDb().prepare('SELECT * FROM task_executions WHERE id = ?').get('exec-chat-1') as any
    expect(r).toMatchObject({ input_tokens: 120, output_tokens: 12, cache_read_input_tokens: 50, cache_creation_input_tokens: 5, turns: 2, model_name: 'claude-opus-5' })
    expect(r.cost_usd).toBeCloseTo(0.12)
  })
})
