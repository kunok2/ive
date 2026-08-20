/**
 * 보고서 확정 스냅샷.
 *
 * 보고서는 단가(사람 월급·AI 구독료·모델 단가·배수)를 입력으로 쓴다. 단가를 바꾸면
 * 과거 보고서가 통째로 소급 변경되어, 메일로 보낸 수치와 화면이 어긋난다.
 * 기간이 닫히면 그때 계산을 저장하고 이후 조회는 저장본을 그대로 보여준다.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import Database from 'better-sqlite3'
import { initSchema } from '../src/lib/db/schema'
import { getReportSnapshot, putReportSnapshot, deleteReportSnapshot } from '../src/lib/db/report-snapshots'

const W = { type: 'weekly', start: '2026-08-10T00:00:00.000Z', end: '2026-08-17T00:00:00.000Z' }

describe('report_snapshots', () => {
  let db: Database.Database
  beforeEach(() => {
    db = new Database(':memory:')
    initSchema(db)
    global.db = db
  })
  afterEach(() => { db.close(); global.db = undefined })

  it('저장한 응답을 그대로 돌려준다', () => {
    const payload = { summary: { totalCost: 1251.16, totalCostAi: 45.16 } }
    putReportSnapshot('u1', W.type, W.start, W.end, payload)
    expect(getReportSnapshot('u1', W.type, W.start, W.end)?.payload).toEqual(payload)
  })

  it('이미 확정된 기간은 다시 써도 덮이지 않는다 (확정은 한 번)', () => {
    putReportSnapshot('u1', W.type, W.start, W.end, { summary: { totalCost: 1251.16 } })
    putReportSnapshot('u1', W.type, W.start, W.end, { summary: { totalCost: 9999 } })  // 단가 바뀐 뒤 재계산분
    expect(getReportSnapshot('u1', W.type, W.start, W.end)?.payload).toEqual({ summary: { totalCost: 1251.16 } })
  })

  it('사용자별로 분리된다 — 보고서는 user 스코프 데이터다', () => {
    putReportSnapshot('u1', W.type, W.start, W.end, { who: 'u1' })
    putReportSnapshot('u2', W.type, W.start, W.end, { who: 'u2' })
    expect(getReportSnapshot('u1', W.type, W.start, W.end)?.payload).toEqual({ who: 'u1' })
    expect(getReportSnapshot('u2', W.type, W.start, W.end)?.payload).toEqual({ who: 'u2' })
  })

  it('기간·종류가 다르면 별개다', () => {
    putReportSnapshot('u1', 'weekly', W.start, W.end, { t: 'w' })
    expect(getReportSnapshot('u1', 'monthly', W.start, W.end)).toBeNull()
    expect(getReportSnapshot('u1', 'weekly', '2026-08-03T00:00:00.000Z', W.start)).toBeNull()
  })

  it('삭제하면 다시 확정할 수 있다 (계산 버그 수정 후 재생성)', () => {
    putReportSnapshot('u1', W.type, W.start, W.end, { v: 1 })
    deleteReportSnapshot('u1', W.type, W.start, W.end)
    expect(getReportSnapshot('u1', W.type, W.start, W.end)).toBeNull()
    putReportSnapshot('u1', W.type, W.start, W.end, { v: 2 })
    expect(getReportSnapshot('u1', W.type, W.start, W.end)?.payload).toEqual({ v: 2 })
  })

  it('저장본이 깨져 있으면 없는 것으로 보고 재계산하게 둔다', () => {
    putReportSnapshot('u1', W.type, W.start, W.end, { v: 1 })
    db.prepare('UPDATE report_snapshots SET payload = ?').run('{깨진 JSON')
    expect(getReportSnapshot('u1', W.type, W.start, W.end)).toBeNull()
  })
})
