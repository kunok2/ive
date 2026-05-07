/**
 * 가동률(utilization) 골든 테스트.
 *
 * 사용자 보고 (2026-05-07):
 *   - 주초엔 가동률이 거의 무한대로 나오다 주 후반에 줄어든다
 *   - 월별로 보면 더 줄고, 연도로 보면 0에 수렴
 *   - 의사결정에 못 쓰는 수치
 *
 * 원인 (이전 구현):
 *   - capacity 가 현재 보고 기간 daily peak 기반 → 샘플이 1~2일이면 폭발/축소
 *   - yearly 보고서는 trend 버킷이 월별이라 peak 가 월간 합 → dimension mismatch
 *   - 분자는 일일 유입(+큐 변화량 노이즈), 분모는 월간 합 → 비율이 0 근처
 *
 * 새 정의:
 *   - capacity(에이전트별) = 직전 30일 historical 활동일 평균 처리 건수 (보고 기간 무관, 안정)
 *   - utilization = (기간 throughput / elapsedDays) / sum(capacity)
 *   - 신뢰도 'low' = 경과일 < 3 또는 평균 활동일 < 3 → UI 가드
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import Database from 'better-sqlite3'
import { setupTestDb, teardownTestDb, seedUser, seedProject, seedAgent, seedExecution, seedIssueStage } from './helpers/test-db'
import { getAgentHistoricalDailyCapacity } from '@/lib/db/reports'

function kstToUtcIso(kst: string): string {
  const m = kst.match(/^(\d{4})-(\d{2})-(\d{2}) (\d{2}):(\d{2}):(\d{2})$/)
  if (!m) throw new Error(`bad kst: ${kst}`)
  const [, y, mo, d, h, mi, s] = m
  return new Date(Date.UTC(+y, +mo - 1, +d, +h - 9, +mi, +s)).toISOString()
}

// 이번 테스트는 "오늘 기준 직전 N일" 룩백 윈도우라 시간 기준이 필요.
// SQLite datetime('now', '-30 days') 가 실시간 기준이므로, 시드 데이터는 '지금'으로부터 상대적으로 배치.
function nowMinusDaysIso(days: number, hour: number = 12): string {
  const d = new Date(Date.now() - days * 86400000)
  d.setUTCHours(hour, 0, 0, 0)
  return d.toISOString()
}

describe('Agent historical daily capacity', () => {
  let db: Database.Database
  const USER = 'user-koj'
  const PROJ = 'proj-ive'
  const AGENT = 'agent-A'

  beforeEach(() => {
    db = setupTestDb()
    seedUser(db, USER, '정균옥')
    seedProject(db, PROJ, USER, 'IVE')
    seedAgent(db, AGENT, USER, 'Claude')
  })

  afterEach(() => teardownTestDb())

  it('단일 활동일에 여러 작업 처리 → dailyCap = 작업수 (활동일 1)', () => {
    // 5일 전에 3건 처리
    for (let i = 1; i <= 3; i++) {
      seedExecution(db, {
        id: `e${i}`, projectId: PROJ, agentId: AGENT, issueIid: i, status: 'success',
        startedAt: nowMinusDaysIso(5), endedAt: nowMinusDaysIso(5, 13),
      })
    }
    const r = getAgentHistoricalDailyCapacity(AGENT, 30)
    expect(r.dailyCap).toBe(3)
    expect(r.samples).toBe(1) // 활동 distinct 일수 1 → samples<3 → 신뢰 부족 신호
  })

  it('여러 활동일 → 활동일당 평균', () => {
    // 5일 전에 4건, 3일 전에 2건, 1일 전에 6건 → 총 12건, 활동일 3, 평균 4
    for (let i = 1; i <= 4; i++) seedExecution(db, { id: `a${i}`, projectId: PROJ, agentId: AGENT, issueIid: i, status: 'success', startedAt: nowMinusDaysIso(5), endedAt: nowMinusDaysIso(5, 13) })
    for (let i = 5; i <= 6; i++) seedExecution(db, { id: `a${i}`, projectId: PROJ, agentId: AGENT, issueIid: i, status: 'success', startedAt: nowMinusDaysIso(3), endedAt: nowMinusDaysIso(3, 13) })
    for (let i = 7; i <= 12; i++) seedExecution(db, { id: `a${i}`, projectId: PROJ, agentId: AGENT, issueIid: i, status: 'success', startedAt: nowMinusDaysIso(1), endedAt: nowMinusDaysIso(1, 13) })

    const r = getAgentHistoricalDailyCapacity(AGENT, 30)
    expect(r.dailyCap).toBe(4) // 12 / 3
    expect(r.samples).toBe(3)
  })

  it('30일 윈도우 밖 작업은 제외', () => {
    // 60일 전 5건 (윈도우 밖), 5일 전 2건 (윈도우 안)
    for (let i = 1; i <= 5; i++) seedExecution(db, { id: `old${i}`, projectId: PROJ, agentId: AGENT, issueIid: i, status: 'success', startedAt: nowMinusDaysIso(60), endedAt: nowMinusDaysIso(60, 13) })
    for (let i = 6; i <= 7; i++) seedExecution(db, { id: `new${i}`, projectId: PROJ, agentId: AGENT, issueIid: i, status: 'success', startedAt: nowMinusDaysIso(5), endedAt: nowMinusDaysIso(5, 13) })

    const r = getAgentHistoricalDailyCapacity(AGENT, 30)
    expect(r.dailyCap).toBe(2)
    expect(r.samples).toBe(1)
  })

  it('진행 중(running)/할당(assigned) exec 은 capacity 산정에서 제외', () => {
    seedExecution(db, { id: 'a1', projectId: PROJ, agentId: AGENT, issueIid: 1, status: 'success', startedAt: nowMinusDaysIso(5), endedAt: nowMinusDaysIso(5, 13) })
    seedExecution(db, { id: 'a2', projectId: PROJ, agentId: AGENT, issueIid: 2, status: 'running', startedAt: nowMinusDaysIso(2) })
    seedExecution(db, { id: 'a3', projectId: PROJ, agentId: AGENT, issueIid: 3, status: 'assigned', startedAt: nowMinusDaysIso(1) })

    const r = getAgentHistoricalDailyCapacity(AGENT, 30)
    expect(r.dailyCap).toBe(1) // success 1건 / 활동일 1
    expect(r.samples).toBe(1)
  })

  it('failed 도 처리한 일수에 포함됨 (capacity 는 처리 시도 능력)', () => {
    seedExecution(db, { id: 'a1', projectId: PROJ, agentId: AGENT, issueIid: 1, status: 'success', startedAt: nowMinusDaysIso(5), endedAt: nowMinusDaysIso(5, 13) })
    seedExecution(db, { id: 'a2', projectId: PROJ, agentId: AGENT, issueIid: 2, status: 'failed', startedAt: nowMinusDaysIso(3), endedAt: nowMinusDaysIso(3, 13) })

    const r = getAgentHistoricalDailyCapacity(AGENT, 30)
    expect(r.dailyCap).toBe(1) // 2 작업 / 2 활동일
    expect(r.samples).toBe(2)
  })

  it('데이터 없음 → 0', () => {
    const r = getAgentHistoricalDailyCapacity(AGENT, 30)
    expect(r.dailyCap).toBe(0)
    expect(r.samples).toBe(0)
  })

  it('lookback 인자 변경 가능 (예: 7일 윈도우)', () => {
    seedExecution(db, { id: 'a1', projectId: PROJ, agentId: AGENT, issueIid: 1, status: 'success', startedAt: nowMinusDaysIso(20), endedAt: nowMinusDaysIso(20, 13) })
    seedExecution(db, { id: 'a2', projectId: PROJ, agentId: AGENT, issueIid: 2, status: 'success', startedAt: nowMinusDaysIso(3), endedAt: nowMinusDaysIso(3, 13) })

    const r30 = getAgentHistoricalDailyCapacity(AGENT, 30)
    expect(r30.samples).toBe(2)

    const r7 = getAgentHistoricalDailyCapacity(AGENT, 7)
    expect(r7.samples).toBe(1) // 7일 안엔 3일 전 1건만
  })

  it('보고 기간이 짧아도 30일 윈도우는 그대로 — 주초/월초/연초 가동률이 안정적', () => {
    // 직전 25일에 걸쳐 매일 1건 처리 → dailyCap = 1, samples = 25
    for (let d = 1; d <= 25; d++) {
      seedExecution(db, {
        id: `e${d}`, projectId: PROJ, agentId: AGENT, issueIid: d, status: 'success',
        startedAt: nowMinusDaysIso(d), endedAt: nowMinusDaysIso(d, 13),
      })
    }
    const r = getAgentHistoricalDailyCapacity(AGENT, 30)
    expect(r.dailyCap).toBe(1)
    expect(r.samples).toBe(25)
    // 주초 보고서(elapsedDays=1)에서도 capacity 는 안정값 1 — 분모 폭발/축소 없음.
  })
})
