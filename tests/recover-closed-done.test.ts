/**
 * recoverClosedDoneIssues — 열린 채 스캔되기 전에 닫힌 완료(ive:done) 이슈를 사후 기록한다.
 *
 *   C-1: 본문에 ive-meta 가 없고 코멘트에만 있어도 실행 기록이 생기고, 보고서와 같은 완료 판정(completedOnDays)에 오늘 완료로 잡힌다.
 *   C-2: 본문에 ive-meta 가 있으면 코멘트를 읽지 않는다.
 *   C-3: 실행 기록이 이미 있는 이슈는 건드리지 않는다.
 *   C-4: 7일보다 오래된 이슈·완료 레이블이 없는 이슈·봇이 만든 이슈는 건너뛴다.
 *   C-5: ive-meta 가 어디에도 없으면 기록을 만들지 않고, 갱신 시각이 같으면 코멘트를 다시 받지 않는다.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import Database from 'better-sqlite3'
import { initSchema } from '@/lib/db/schema'
import { setupTestDb, teardownTestDb, seedUser, seedProject } from './helpers/test-db'
import { recoverClosedDoneIssues } from '@/lib/scanner'
import { completedOnDays } from '@/lib/report-model/load'
import { addDays, kstToday } from '@/lib/report-model/period'
import type { Project } from '@/types'

let db: Database.Database
const project = { id: 'p1', userId: 'u1', name: 'T', provider: 'github' } as unknown as Project

const NOW = Date.now()
const iso = (msAgo: number) => new Date(NOW - msAgo).toISOString()
const meta = `<!-- ive-meta
model: claude-sonnet-5-5
input_tokens: 1000
output_tokens: 200
cost_usd: 0
turns: 5
started_at: ${iso(3_600_000)}
ended_at: ${iso(60_000)}
-->`

const closed = (iid: number, over: Record<string, unknown> = {}) => ({
  iid, title: `이슈 ${iid}`, description: '원문', labels: ['ive', 'ive:done'], state: 'closed',
  created_at: iso(5 * 86_400_000), updated_at: iso(60_000), author: { username: 'alice' }, ...over,
})
const run = (issues: any[], notes: Record<number, string[]> = {}) => {
  const fetchNotes = vi.fn(async (_p: unknown, iid: number) => (notes[iid] ?? []).map(body => ({ body })))
  const fetchClosed = vi.fn(async () => ({ issues }))
  return { fetchNotes, fetchClosed, call: () => recoverClosedDoneIssues(project, 'tok', { fetchClosed, fetchNotes: fetchNotes as any, now: NOW }) }
}
const execs = (iid: number) => db.prepare('SELECT status, input_tokens, model_name FROM task_executions WHERE project_id = ? AND issue_iid = ?').all('p1', iid) as any[]

beforeEach(() => {
  db = setupTestDb()
  initSchema(db) // 완료 집계(issue_events 등)까지 보려고 전체 스키마를 갖춘다
  seedUser(db, 'u1', 'Owner')
  seedProject(db, 'p1', 'u1', 'T')
})
afterEach(() => teardownTestDb())

describe('recoverClosedDoneIssues', () => {
  it('C-1: 코멘트에만 있는 ive-meta 로 기록이 생기고 오늘 완료로 잡힌다', async () => {
    const r = run([closed(101)], { 101: ['처리 노트\n' + meta] })
    expect(await r.call()).toBe(1)
    expect(execs(101)).toEqual([{ status: 'success', input_tokens: 1000, model_name: 'claude-sonnet-5-5' }])
    const today = kstToday()
    const done = completedOnDays('p1', today, addDays(today, 1))
    expect(done.map(c => c.key)).toContain('p1:101')
  })

  it('C-2: 본문에 ive-meta 가 있으면 코멘트를 읽지 않는다', async () => {
    const r = run([closed(102, { description: '원문\n' + meta })])
    expect(await r.call()).toBe(1)
    expect(r.fetchNotes).not.toHaveBeenCalled()
    expect(execs(102)).toHaveLength(1)
  })

  it('C-3: 실행 기록이 이미 있으면 건드리지 않는다', async () => {
    db.prepare(`INSERT INTO task_executions (id, project_id, agent_id, issue_iid, status, started_at, assignee_type) VALUES ('x', 'p1', NULL, 103, 'success', ?, 'user')`).run(iso(86_400_000))
    const r = run([closed(103, { description: meta })])
    expect(await r.call()).toBe(0)
    expect(execs(103)).toHaveLength(1)
  })

  it('C-4: 오래된 이슈·완료 레이블 없는 이슈·봇이 만든 이슈는 건너뛴다', async () => {
    const r = run([
      closed(104, { description: meta, updated_at: iso(8 * 86_400_000) }),
      closed(105, { description: meta, labels: ['ive'] }),
      closed(106, { description: meta, author: { username: 'ci[bot]', type: 'Bot' } }),
    ])
    expect(await r.call()).toBe(0)
    for (const iid of [104, 105, 106]) expect(execs(iid)).toHaveLength(0)
  })

  it('C-5: ive-meta 가 없으면 만들지 않고, 같은 갱신 시각이면 코멘트를 다시 받지 않는다', async () => {
    const issue = closed(107)
    const r = run([issue], { 107: ['그냥 코멘트'] })
    expect(await r.call()).toBe(0)
    expect(await r.call()).toBe(0)
    expect(r.fetchNotes).toHaveBeenCalledTimes(1)
    expect(execs(107)).toHaveLength(0)
  })
})
