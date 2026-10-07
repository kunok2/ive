/**
 * 반려 고리(핑퐁) 끊기 — getReworkStreak 불변식.
 *
 * R-1: 검증 중 → 스케줄(반려)만 센다. 처리 미완(처리 중 → 스케줄)은 세지 않는다.
 * R-2: 확인대기·완료에 닿으면 처음부터 다시 센다.
 * R-3: 반려 고리로 사람에게 넘긴 뒤(rework_loop)에도 처음부터 다시 센다.
 * R-4: 확인 반려(확인 중 → 검증대기)는 세지 않는다. 사람이 확인 중에서 바로 스케줄로 보낸 것은 센다.
 * 실사고: dazzlepf #1961·#1962·#1963 — 처리 환경에 없는 화면 검수를 검증이 거듭 요구해 처리 → 반려가 끝없이 돌았다.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import Database from 'better-sqlite3'
import { initSchema } from '@/lib/db/schema'
import { recordStageEvent, getReworkStreak, SYSTEM_ACTOR } from '@/lib/db'
import { MAX_REWORK_STREAK } from '@/lib/scanner'

let db: Database.Database
beforeEach(() => { db = new Database(':memory:'); initSchema(db); (globalThis as any).db = db })
afterEach(() => { db.close(); (globalThis as any).db = undefined })

const go = (from: string, to: string, action: string | null = null) =>
  recordStageEvent({ projectId: 'p', issueIid: 1, fromStage: from, toStage: to, action, actor: SYSTEM_ACTOR, source: 'scanner' })
/** 처리 → 검증 → 반려 한 바퀴 */
const rejectRound = () => { go('waiting', 'dev'); go('dev', 'verify_waiting'); go('verify_waiting', 'verifying'); go('verifying', 'waiting', 'reject') }

describe('getReworkStreak', () => {
  it('R-1: 검증 반려만 세고 처리 미완은 세지 않는다', () => {
    go(null as any, 'waiting', 'schedule')
    go('waiting', 'dev'); go('dev', 'waiting', 'incomplete')
    expect(getReworkStreak('p', 1)).toBe(0)
    rejectRound()
    expect(getReworkStreak('p', 1)).toBe(1)
    rejectRound()
    expect(getReworkStreak('p', 1)).toBe(2)
    expect(getReworkStreak('p', 1) >= MAX_REWORK_STREAK).toBe(true)
  })

  it('R-2: 확인대기에 닿으면 다시 센다', () => {
    rejectRound(); rejectRound()
    go('waiting', 'dev'); go('dev', 'verify_waiting'); go('verify_waiting', 'verifying'); go('verifying', 'confirm_waiting', 'complete')
    expect(getReworkStreak('p', 1)).toBe(0)
  })

  it('R-3: 사람에게 넘긴(rework_loop) 뒤 다시 센다', () => {
    rejectRound(); rejectRound()
    go('waiting', 'verify_waiting', 'rework_loop')
    expect(getReworkStreak('p', 1)).toBe(0)
    go('verify_waiting', 'verifying'); go('verifying', 'waiting', 'reject')
    expect(getReworkStreak('p', 1)).toBe(1)
  })

  it('R-4: 확인 반려는 검증대기로 가므로 세지 않고, 이어진 검증 반려부터 센다', () => {
    go('waiting', 'dev'); go('dev', 'verify_waiting'); go('verify_waiting', 'verifying'); go('verifying', 'confirm_waiting')
    go('confirm_waiting', 'confirming'); go('confirming', 'verify_waiting', 'return_to_dev')
    expect(getReworkStreak('p', 1)).toBe(0)
    go('verify_waiting', 'verifying'); go('verifying', 'waiting', 'reject')
    expect(getReworkStreak('p', 1)).toBe(1)
    // 사람이 확인 중에서 바로 스케줄로 보낸 것(retry)은 반려로 센다
    go('waiting', 'dev'); go('dev', 'verify_waiting'); go('verify_waiting', 'verifying'); go('verifying', 'confirm_waiting')
    go('confirm_waiting', 'confirming'); go('confirming', 'waiting', 'retry')
    expect(getReworkStreak('p', 1)).toBe(1)
  })
})
