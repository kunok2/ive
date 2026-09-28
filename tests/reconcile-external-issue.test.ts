/**
 * reconcileExternalIssue 골든 테스트.
 *
 * 검증하는 불변식 (외부 도구 이슈 재조정):
 *   R-1: 외부 도구 execution(agent_id 빈값 + assignee_type='user' + user_id NULL)은
 *        본문 ive-meta 가 바뀌면 그 값으로 "덮어쓴다"(set). → 추가 작업 반영.
 *   R-2: 같은 본문으로 두 번 호출해도 결과가 동일하다 (멱등 — 중복집계 없음).
 *   R-3: 본문에 ive-meta 가 없으면(빈 메타) 기존 DB 값을 지우지 않는다.
 *   R-4: 에이전트 실행(agent_id 존재)·담당자 모드 실행(user_id 존재)은 절대 건드리지 않는다.
 *   R-5: done/verify_waiting 이면 closeFn 을 호출하고, 그 외(dev_fail)는 호출하지 않는다.
 *   R-8: 외부 등록(완료) 뒤 재태깅돼 IVE 가 직접 실행을 돌린 이슈는 verify_waiting 이어도 닫지 않는다.
 *        (다시 열어도 스캔마다 또 닫혀 대기 목록·통계에서 사라지던 회귀 방지)
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import Database from 'better-sqlite3'
import { setupTestDb, teardownTestDb, seedUser, seedProject, seedExecution } from './helpers/test-db'
import { reconcileExternalIssue } from '@/lib/scanner'
import type { Project } from '@/types'

let db: Database.Database

const project = { id: 'p1', userId: 'u1', name: 'T', provider: 'gitlab' } as unknown as Project

function extMetaBody(opts: { input: number; output: number; cost: number; turns: number; model?: string }) {
  return `작업 요약
<!-- ive-meta
model: ${opts.model ?? 'claude-opus-4-8'}
input_tokens: ${opts.input}
output_tokens: ${opts.output}
cost_usd: ${opts.cost}
turns: ${opts.turns}
-->`
}

function getExec(id: string) {
  return db.prepare('SELECT input_tokens, output_tokens, cost_usd, turns, model_name FROM task_executions WHERE id = ?').get(id) as any
}

beforeEach(() => {
  db = setupTestDb()
  seedUser(db, 'u1', 'Owner')
  seedProject(db, 'p1', 'u1', 'T')
})
afterEach(() => teardownTestDb())

// 외부 도구 execution: agent_id 빈값, assignee_type='user', user_id NULL
function seedExternalExec(id: string, iid: number, tokens = { i: 0, o: 0, c: 0, t: 0 }, model: string | null = null) {
  seedExecution(db, {
    id, projectId: 'p1', agentId: null, issueIid: iid, status: 'success',
    startedAt: '2026-05-01T00:00:00.000Z', assigneeType: 'user', userId: null,
    inputTokens: tokens.i, outputTokens: tokens.o, costUsd: tokens.c, turns: tokens.t, modelName: model,
  })
}

describe('reconcileExternalIssue', () => {
  it('R-1: 본문 ive-meta 가 바뀌면 외부 exec 를 그 값으로 덮어쓴다', async () => {
    seedExternalExec('ex1', 10, { i: 0, o: 0, c: 0, t: 0 })
    const close = vi.fn().mockResolvedValue(undefined)
    const r = await reconcileExternalIssue(
      project,
      { iid: 10, description: extMetaBody({ input: 1000, output: 2000, cost: 0.5, turns: 3 }), title: 'X' },
      'done', close,
    )
    expect(r.resynced).toBe(true)
    const row = getExec('ex1')
    expect(row.input_tokens).toBe(1000)
    expect(row.output_tokens).toBe(2000)
    expect(row.cost_usd).toBeCloseTo(0.5)
    expect(row.turns).toBe(3)
    expect(row.model_name).toBe('claude-opus-4-8')
  })

  it('R-2: 같은 본문으로 두 번 호출하면 두 번째는 변화 없음 (멱등)', async () => {
    seedExternalExec('ex1', 10)
    const body = extMetaBody({ input: 1000, output: 2000, cost: 0.5, turns: 3 })
    const close = vi.fn().mockResolvedValue(undefined)
    const first = await reconcileExternalIssue(project, { iid: 10, description: body, title: 'X' }, 'done', close)
    const second = await reconcileExternalIssue(project, { iid: 10, description: body, title: 'X' }, 'done', close)
    expect(first.resynced).toBe(true)
    expect(second.resynced).toBe(false) // 이미 같은 값 → 갱신 안 함
    const row = getExec('ex1')
    expect(row.input_tokens).toBe(1000) // 누적이 아니라 set
  })

  it('R-3: 본문에 ive-meta 가 없으면 기존 값을 지우지 않는다', async () => {
    seedExternalExec('ex1', 10, { i: 1000, o: 2000, c: 0.5, t: 3 }, 'claude-opus-4-8')
    const close = vi.fn().mockResolvedValue(undefined)
    const r = await reconcileExternalIssue(project, { iid: 10, description: '메타 없는 본문', title: 'X' }, 'done', close)
    expect(r.resynced).toBe(false)
    const row = getExec('ex1')
    expect(row.input_tokens).toBe(1000) // 보존
    expect(row.cost_usd).toBeCloseTo(0.5)
  })

  it('R-4a: 에이전트 실행(agent_id 존재)은 건드리지 않는다', async () => {
    seedExecution(db, {
      id: 'exAgent', projectId: 'p1', agentId: 'a1', issueIid: 10, status: 'success',
      startedAt: '2026-05-01T00:00:00.000Z', assigneeType: 'agent',
      inputTokens: 500, outputTokens: 600, costUsd: 0.1, turns: 1, modelName: 'claude-opus-4-8',
    })
    const close = vi.fn().mockResolvedValue(undefined)
    const r = await reconcileExternalIssue(
      project, { iid: 10, description: extMetaBody({ input: 9999, output: 9999, cost: 9, turns: 9 }), title: 'X' }, 'done', close,
    )
    expect(r.resynced).toBe(false) // 외부 exec 가 없으니 아무것도 안 함
    const row = getExec('exAgent')
    expect(row.input_tokens).toBe(500) // 그대로
    expect(close).not.toHaveBeenCalled() // 외부 exec 없으면 닫기도 안 함
  })

  it('R-4b: 담당자 모드 실행(user_id 존재)은 건드리지 않는다', async () => {
    seedExecution(db, {
      id: 'exUser', projectId: 'p1', agentId: null, issueIid: 10, status: 'success',
      startedAt: '2026-05-01T00:00:00.000Z', assigneeType: 'user', userId: 'u-assignee',
      inputTokens: 500, outputTokens: 600, costUsd: 0.1, turns: 1, modelName: 'claude-opus-4-8',
    })
    const close = vi.fn().mockResolvedValue(undefined)
    const r = await reconcileExternalIssue(
      project, { iid: 10, description: extMetaBody({ input: 9999, output: 9999, cost: 9, turns: 9 }), title: 'X' }, 'done', close,
    )
    expect(r.resynced).toBe(false)
    const row = getExec('exUser')
    expect(row.input_tokens).toBe(500)
    expect(close).not.toHaveBeenCalled()
  })

  it('R-5a: done 이면 닫기를 시도한다', async () => {
    seedExternalExec('ex1', 10, { i: 1000, o: 2000, c: 0.5, t: 3 }, 'claude-opus-4-8')
    const close = vi.fn().mockResolvedValue(undefined)
    const r = await reconcileExternalIssue(project, { iid: 10, description: '', title: 'X' }, 'done', close)
    expect(close).toHaveBeenCalledOnce()
    expect(close).toHaveBeenCalledWith(project, 10)
    expect(r.closed).toBe(true)
  })

  it('R-5b: verify_waiting 도 닫기를 시도한다', async () => {
    seedExternalExec('ex1', 10, { i: 1, o: 1, c: 0.1, t: 1 }, 'm')
    const close = vi.fn().mockResolvedValue(undefined)
    await reconcileExternalIssue(project, { iid: 10, description: '', title: 'X' }, 'verify_waiting', close)
    expect(close).toHaveBeenCalledOnce()
  })

  it('R-5c: dev_fail 은 닫지 않는다 (재동기화만)', async () => {
    seedExternalExec('ex1', 10, { i: 1, o: 1, c: 0.1, t: 1 }, 'm')
    const close = vi.fn().mockResolvedValue(undefined)
    const r = await reconcileExternalIssue(project, { iid: 10, description: '', title: 'X' }, 'dev_fail', close)
    expect(close).not.toHaveBeenCalled()
    expect(r.closed).toBe(false)
  })

  it('R-5d: 닫기 API 실패해도 예외를 던지지 않고 closed=false', async () => {
    seedExternalExec('ex1', 10, { i: 1, o: 1, c: 0.1, t: 1 }, 'm')
    const close = vi.fn().mockRejectedValue(new Error('403 forbidden'))
    const r = await reconcileExternalIssue(project, { iid: 10, description: '', title: 'X' }, 'done', close)
    expect(r.closed).toBe(false) // 실패 → 다음 스캔에 재시도
  })

  // ── 다세션(다일 작업): ive-meta 블록을 세션마다 쌓으면 행도 세션마다 생성 ──
  function rowsOf(iid: number) {
    return db.prepare(
      `SELECT id, started_at, ended_at, input_tokens, output_tokens, cost_usd, work_sec
         FROM task_executions WHERE issue_iid = ? AND assignee_type = 'user'
           AND (agent_id IS NULL OR agent_id = '') AND user_id IS NULL
         ORDER BY started_at ASC`
    ).all(iid) as any[]
  }
  function twoSessionBody() {
    return `작업
<!-- ive-meta
model: claude-opus-4-8
input_tokens: 8000000
output_tokens: 200000
cost_usd: 48
turns: 120
started_at: 2026-06-17T09:17:00+09:00
ended_at: 2026-06-18T03:11:00+09:00
-->
추가 작업 (다음 주)
<!-- ive-meta
model: claude-opus-4-8
input_tokens: 2000000
output_tokens: 50000
cost_usd: 12
turns: 40
started_at: 2026-06-22T11:00:00+09:00
ended_at: 2026-06-22T16:00:00+09:00
-->`
  }

  it('R-6: 기존 단일행 이슈에 새 세션 블록이 추가되면 새 행이 INSERT 된다 (주 경계 분배)', async () => {
    // 첫 세션(6/17~6/18)만 가진 기존 외부 행. started_at 을 첫 세션 시각으로 시드.
    seedExecution(db, {
      id: 'ex1', projectId: 'p1', agentId: null, issueIid: 10, status: 'success',
      startedAt: '2026-06-17T00:17:00.000Z', endedAt: '2026-06-17T18:11:00.000Z',
      assigneeType: 'user', userId: null,
      inputTokens: 8000000, outputTokens: 200000, costUsd: 48, turns: 120, modelName: 'claude-opus-4-8',
    })
    const close = vi.fn().mockResolvedValue(undefined)
    const r = await reconcileExternalIssue(project, { iid: 10, description: twoSessionBody(), title: 'X' }, 'done', close)
    expect(r.resynced).toBe(true)
    const rows = rowsOf(10)
    expect(rows).toHaveLength(2) // 기존 6/17 행 + 신규 6/22 행
    // 첫 행은 제자리 유지(6/17), 둘째 행은 다른 주(6/22) → 각 주에 집계됨
    expect(rows[0].started_at).toBe('2026-06-17T00:17:00.000Z')
    expect(rows[0].input_tokens).toBe(8000000)
    expect(rows[1].started_at).toBe('2026-06-22T02:00:00.000Z')
    expect(rows[1].input_tokens).toBe(2000000)
    expect(rows[1].cost_usd).toBeCloseTo(12)
    // 각 세션 work_sec 은 그 세션 구간만 (6/22 세션 = 5시간 = 18000초)
    expect(rows[1].work_sec).toBe(5 * 3600)
  })

  it('R-7: 같은 다세션 본문을 두 번 호출해도 행은 2개 그대로 (멱등)', async () => {
    seedExternalExec('ex1', 10, { i: 8000000, o: 200000, c: 48, t: 120 }, 'claude-opus-4-8')
    // 시드 행의 started_at 을 첫 세션에 맞춤
    db.prepare("UPDATE task_executions SET started_at = '2026-06-17T00:17:00.000Z' WHERE id = 'ex1'").run()
    const close = vi.fn().mockResolvedValue(undefined)
    const body = twoSessionBody()
    await reconcileExternalIssue(project, { iid: 10, description: body, title: 'X' }, 'done', close)
    const second = await reconcileExternalIssue(project, { iid: 10, description: body, title: 'X' }, 'done', close)
    expect(second.resynced).toBe(false) // 2번째는 변화 없음
    const rows = rowsOf(10)
    expect(rows).toHaveLength(2) // 중복 INSERT 없음
    const totalCost = rows.reduce((s, r) => s + r.cost_usd, 0)
    expect(totalCost).toBeCloseTo(60) // 48 + 12, 누적 중복 아님
  })

  // ── 재태깅: 외부 도구로 완료 등록 → 사용자가 다시 열고 IVE-S → 에이전트 개발 → IVE-W ──
  it('R-8a: 외부 행 뒤에 에이전트 실행이 있으면 verify_waiting 에서 닫지 않는다', async () => {
    seedExternalExec('ex-ext-1', 10, { i: 1, o: 1, c: 0.1, t: 1 }, 'm')
    seedExecution(db, {
      id: 'ex-agent-1', projectId: 'p1', agentId: 'a1', issueIid: 10, status: 'success',
      startedAt: '2026-05-02T00:00:00.000Z', assigneeType: 'agent',
    })
    const close = vi.fn().mockResolvedValue(undefined)
    const r = await reconcileExternalIssue(project, { iid: 10, description: '', title: 'X' }, 'verify_waiting', close)
    expect(close).not.toHaveBeenCalled()
    expect(r.closed).toBe(false)
  })

  it('R-8b: 재태깅 이슈도 IVE-E(done) 에 도달하면 닫는다', async () => {
    seedExternalExec('ex-ext-1', 10, { i: 1, o: 1, c: 0.1, t: 1 }, 'm')
    seedExecution(db, {
      id: 'ex-agent-1', projectId: 'p1', agentId: 'a1', issueIid: 10, status: 'success',
      startedAt: '2026-05-02T00:00:00.000Z', assigneeType: 'agent',
    })
    const close = vi.fn().mockResolvedValue(undefined)
    await reconcileExternalIssue(project, { iid: 10, description: '', title: 'X' }, 'done', close)
    expect(close).toHaveBeenCalledOnce()
  })

  it('R-8c: 담당자 모드 실행(user_id 존재)이 있어도 verify_waiting 에서 닫지 않는다', async () => {
    seedExternalExec('ex-ext-1', 10, { i: 1, o: 1, c: 0.1, t: 1 }, 'm')
    seedExecution(db, {
      id: 'ex-user-1', projectId: 'p1', agentId: null, issueIid: 10, status: 'success',
      startedAt: '2026-05-02T00:00:00.000Z', assigneeType: 'user', userId: 'u-assignee',
    })
    const close = vi.fn().mockResolvedValue(undefined)
    await reconcileExternalIssue(project, { iid: 10, description: '', title: 'X' }, 'verify_waiting', close)
    expect(close).not.toHaveBeenCalled()
  })

  it('R-8d: 행위자 미매칭 검증 기록(ex-verify-, user_id NULL)은 외부 행이 아니다', async () => {
    // 외부 행 없이 라벨 전이 검증 기록만 있는 일반 이슈 → 외부 도구 이슈로 오인해 닫으면 안 된다
    seedExecution(db, {
      id: 'ex-verify-1', projectId: 'p1', agentId: null, issueIid: 10, status: 'failed',
      startedAt: '2026-05-02T00:00:00.000Z', assigneeType: 'user', userId: null,
    })
    const close = vi.fn().mockResolvedValue(undefined)
    const r = await reconcileExternalIssue(
      project, { iid: 10, description: extMetaBody({ input: 9, output: 9, cost: 9, turns: 9 }), title: 'X' }, 'verify_waiting', close,
    )
    expect(close).not.toHaveBeenCalled()
    expect(r.resynced).toBe(false) // 검증 기록을 개발 세션 값으로 덮어쓰지 않는다
  })
})
