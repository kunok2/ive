/**
 * 보고서 유입(inflow) / 유출(outflow) 골든 테스트.
 *
 * 핵심 정의 (사용자 관점):
 *   - 유입 = 작업의 시작 = 이슈가 처음 시작된 시각이 기간 내인 이슈 (이슈 단위 1회).
 *   - 유출 = 작업의 완료 = 이슈가 파이프라인 밖으로 빠진 시각이 기간 내인 이슈.
 *           검증/확인은 중간 단계, rejected/retry 는 완료 아님.
 *
 * 완료 시각 (우선순위):
 *   1) issue_stages.confirmed_at (확인 단계 거친 이슈)
 *   2) MAX(task_executions.verified_at) (검증 단계 거친 이슈)
 *   3) MAX(task_executions.ended_at WHERE status IN ('success','failed')) (외부 종료 fallback)
 *
 * 완료 조건: cached_stage 가 'done'/NULL/blank 이고, 진행 중인 exec 가 없음.
 *
 * 본 테스트는 운영에서 발견된 버그(2026-05-07, 사용자 보고)에 대한 회귀 방지:
 *   - "지난주 유입 == 지난주 유출"으로 잡혀 미처리분이 안 보였던 문제.
 *   - 주 경계를 넘어 시작/완료된 이슈가 보고서에 안 잡혔던 문제.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import Database from 'better-sqlite3'
import {
  setupTestDb, teardownTestDb,
  seedUser, seedProject, seedAgent, seedExecution, seedIssueStage,
} from './helpers/test-db'
import {
  getIssuesStartedInRange,
  getIssuesCompletedInRange,
  getIssueCompletionTimes,
  getGlobalIssuesStartedInRange,
  getGlobalIssuesCompletedInRange,
} from '@/lib/db/reports'
import { resetIssueCycleMarkers } from '@/lib/db/executions'

// KST 주차 경계 (월~일).
// 2026-04-27 (월) ~ 2026-05-03 (일) — 지난주
// 2026-05-04 (월) ~ 2026-05-10 (일) — 이번주
const LAST_WEEK_START = '2026-04-27'
const LAST_WEEK_END   = '2026-05-04' // exclusive
const THIS_WEEK_START = '2026-05-04'
const THIS_WEEK_END   = '2026-05-11' // exclusive

// KST 시각을 UTC ISO 로 (DB 저장용).
function kstToUtcIso(kst: string): string {
  // 'YYYY-MM-DD HH:mm:ss' KST → 'YYYY-MM-DDTHH:mm:ss.000Z' UTC (-9h)
  const m = kst.match(/^(\d{4})-(\d{2})-(\d{2}) (\d{2}):(\d{2}):(\d{2})$/)
  if (!m) throw new Error(`bad kst: ${kst}`)
  const [, y, mo, d, h, mi, s] = m
  const utc = new Date(Date.UTC(+y, +mo - 1, +d, +h - 9, +mi, +s)).toISOString()
  return utc
}

describe('Report flow: 유입(inflow) / 유출(outflow)', () => {
  let db: Database.Database
  const USER = 'user-koj'
  const PROJ = 'proj-ive'

  beforeEach(() => {
    db = setupTestDb()
    seedUser(db, USER, '정균옥')
    seedProject(db, PROJ, USER, 'IVE')
    seedAgent(db, 'agent-claude', USER, 'Claude')
  })

  afterEach(() => teardownTestDb())

  // ── 유입 (시작) ──

  it('유입은 이슈가 처음 시작된 시각이 기간 내인 이슈 (이슈 단위 1회)', () => {
    // 이슈 #1: 지난주 시작 → 이번주 retry. 이번주에 retry exec 있어도 "유입"은 지난주에만.
    seedExecution(db, { id: 'e1a', projectId: PROJ, agentId: 'agent-claude', issueIid: 1, status: 'success', startedAt: kstToUtcIso('2026-04-29 10:00:00'), endedAt: kstToUtcIso('2026-04-29 10:30:00') })
    seedExecution(db, { id: 'e1b', projectId: PROJ, agentId: 'agent-claude', issueIid: 1, status: 'success', startedAt: kstToUtcIso('2026-05-05 10:00:00'), endedAt: kstToUtcIso('2026-05-05 10:30:00') })

    const lastWeekInflow = getIssuesStartedInRange(USER, LAST_WEEK_START, LAST_WEEK_END)
    const thisWeekInflow = getIssuesStartedInRange(USER, THIS_WEEK_START, THIS_WEEK_END)

    expect(lastWeekInflow.size).toBe(1)
    expect(lastWeekInflow.has(`${PROJ}:1`)).toBe(true)
    expect(thisWeekInflow.size).toBe(0) // retry는 유입 아님
  })

  // ── 유출 (완료) ──

  it('유출 우선순위 1: confirmed_at (확인 단계 거친 이슈)', () => {
    seedExecution(db, { id: 'e1', projectId: PROJ, agentId: 'agent-claude', issueIid: 1, status: 'success', startedAt: kstToUtcIso('2026-05-05 09:00:00'), endedAt: kstToUtcIso('2026-05-05 09:30:00'), verifiedAt: kstToUtcIso('2026-05-05 11:00:00') })
    seedIssueStage(db, { projectId: PROJ, issueIid: 1, cachedStage: 'done', confirmedAt: kstToUtcIso('2026-05-06 14:00:00') })

    const out = getIssuesCompletedInRange(USER, THIS_WEEK_START, THIS_WEEK_END)
    expect(out.size).toBe(1)
    // confirmed_at 이 verified_at 보다 우선
    expect(out.get(`${PROJ}:1`)).toBe(kstToUtcIso('2026-05-06 14:00:00'))
  })

  it('유출 우선순위 2: MAX(verified_at) — confirmed_at 없을 때', () => {
    // 두 번 검증된 케이스: 첫 검증은 reject, 재시도 후 두 번째 검증 통과 → 두 번째 시각이 완료.
    seedExecution(db, { id: 'e1a', projectId: PROJ, agentId: 'agent-claude', issueIid: 1, status: 'success', startedAt: kstToUtcIso('2026-05-04 09:00:00'), endedAt: kstToUtcIso('2026-05-04 09:30:00'), rejectedAt: kstToUtcIso('2026-05-04 10:00:00') })
    seedExecution(db, { id: 'e1b', projectId: PROJ, agentId: 'agent-claude', issueIid: 1, status: 'success', startedAt: kstToUtcIso('2026-05-05 09:00:00'), endedAt: kstToUtcIso('2026-05-05 09:30:00'), verifiedAt: kstToUtcIso('2026-05-06 11:00:00') })
    seedIssueStage(db, { projectId: PROJ, issueIid: 1, cachedStage: 'done' })

    const out = getIssuesCompletedInRange(USER, THIS_WEEK_START, THIS_WEEK_END)
    expect(out.size).toBe(1)
    expect(out.get(`${PROJ}:1`)).toBe(kstToUtcIso('2026-05-06 11:00:00'))
  })

  it('유출 우선순위 3: MAX(ended_at) fallback — 외부 종료 (verified_at/confirmed_at 모두 없음)', () => {
    // IVE 검증 거치지 않고 외부에서 종료된 이슈 (cached_stage가 빈/null로 되거나 done으로 직행).
    seedExecution(db, { id: 'e1', projectId: PROJ, agentId: 'agent-claude', issueIid: 1, status: 'success', startedAt: kstToUtcIso('2026-05-05 09:00:00'), endedAt: kstToUtcIso('2026-05-05 09:30:00') })
    seedIssueStage(db, { projectId: PROJ, issueIid: 1, cachedStage: 'done' })

    const out = getIssuesCompletedInRange(USER, THIS_WEEK_START, THIS_WEEK_END)
    expect(out.size).toBe(1)
    expect(out.get(`${PROJ}:1`)).toBe(kstToUtcIso('2026-05-05 09:30:00'))
  })

  it('유출에 잡히지 않음: cached_stage 가 활성 단계(verifying/dev/...)', () => {
    seedExecution(db, { id: 'e1', projectId: PROJ, agentId: 'agent-claude', issueIid: 1, status: 'success', startedAt: kstToUtcIso('2026-05-05 09:00:00'), endedAt: kstToUtcIso('2026-05-05 09:30:00'), verifiedAt: kstToUtcIso('2026-05-05 11:00:00') })
    seedIssueStage(db, { projectId: PROJ, issueIid: 1, cachedStage: 'verifying' })

    const out = getIssuesCompletedInRange(USER, THIS_WEEK_START, THIS_WEEK_END)
    expect(out.size).toBe(0) // 아직 진행 중
  })

  it('유출에 잡히지 않음: 진행 중인 exec(running) 가 있으면', () => {
    seedExecution(db, { id: 'e1a', projectId: PROJ, agentId: 'agent-claude', issueIid: 1, status: 'success', startedAt: kstToUtcIso('2026-05-05 09:00:00'), endedAt: kstToUtcIso('2026-05-05 09:30:00'), verifiedAt: kstToUtcIso('2026-05-05 11:00:00') })
    seedExecution(db, { id: 'e1b', projectId: PROJ, agentId: 'agent-claude', issueIid: 1, status: 'running', startedAt: kstToUtcIso('2026-05-06 09:00:00') })
    seedIssueStage(db, { projectId: PROJ, issueIid: 1, cachedStage: 'done' })

    const out = getIssuesCompletedInRange(USER, THIS_WEEK_START, THIS_WEEK_END)
    expect(out.size).toBe(0) // 재실행 중
  })

  it('유출에 잡힘: cached_stage 가 NULL/blank 이고 success exec 있음 (외부 종료)', () => {
    seedExecution(db, { id: 'e1', projectId: PROJ, agentId: 'agent-claude', issueIid: 1, status: 'success', startedAt: kstToUtcIso('2026-05-05 09:00:00'), endedAt: kstToUtcIso('2026-05-05 09:30:00') })
    // cached_stage 가 null → 외부에서 IVE 레이블 떼고 종료된 케이스
    seedIssueStage(db, { projectId: PROJ, issueIid: 1, cachedStage: null })

    const out = getIssuesCompletedInRange(USER, THIS_WEEK_START, THIS_WEEK_END)
    expect(out.size).toBe(1)
  })

  // ── 주 경계 시나리오 (사용자 보고 케이스의 핵심 회귀 테스트) ──

  it('주 경계 1: W1 시작 → W2 완료 이슈는 W1 유입 + W2 유출 (W1 유출에 안 잡힘)', () => {
    // 이슈 #1: 지난주 시작, 이번주 검증 통과
    seedExecution(db, {
      id: 'e1', projectId: PROJ, agentId: 'agent-claude', issueIid: 1,
      status: 'success',
      startedAt: kstToUtcIso('2026-04-30 10:00:00'),
      endedAt:   kstToUtcIso('2026-04-30 10:30:00'),
      verifiedAt: kstToUtcIso('2026-05-05 14:00:00'),
    })
    seedIssueStage(db, { projectId: PROJ, issueIid: 1, cachedStage: 'done' })

    const lastIn = getIssuesStartedInRange(USER, LAST_WEEK_START, LAST_WEEK_END)
    const lastOut = getIssuesCompletedInRange(USER, LAST_WEEK_START, LAST_WEEK_END)
    const thisIn = getIssuesStartedInRange(USER, THIS_WEEK_START, THIS_WEEK_END)
    const thisOut = getIssuesCompletedInRange(USER, THIS_WEEK_START, THIS_WEEK_END)

    expect(lastIn.size).toBe(1)  // 지난주 유입 +1
    expect(lastOut.size).toBe(0) // 지난주 시점엔 미완료 → 유출 0 (소급되어 유출로 잡히면 안 됨)
    expect(thisIn.size).toBe(0)  // 이번주 신규 유입 아님
    expect(thisOut.size).toBe(1) // 이번주에 완료 → 유출 +1
  })

  it('주 경계 2 (사용자 시나리오): 지난주 유입=지난주 유출 + 3건 carry-over', () => {
    // 지난주 유입 5건 — 그중 2건 지난주 완료, 3건 이번주 완료
    for (let i = 1; i <= 5; i++) {
      seedExecution(db, {
        id: `e${i}`, projectId: PROJ, agentId: 'agent-claude', issueIid: i, status: 'success',
        startedAt: kstToUtcIso(`2026-04-28 1${i}:00:00`),
        endedAt:   kstToUtcIso(`2026-04-28 1${i}:30:00`),
        verifiedAt: i <= 2
          ? kstToUtcIso(`2026-04-29 1${i}:00:00`) // 지난주 완료
          : kstToUtcIso(`2026-05-05 1${i}:00:00`), // 이번주 완료 (carry-over 3건)
      })
      seedIssueStage(db, { projectId: PROJ, issueIid: i, cachedStage: 'done' })
    }

    const lastIn = getIssuesStartedInRange(USER, LAST_WEEK_START, LAST_WEEK_END)
    const lastOut = getIssuesCompletedInRange(USER, LAST_WEEK_START, LAST_WEEK_END)
    const thisIn = getIssuesStartedInRange(USER, THIS_WEEK_START, THIS_WEEK_END)
    const thisOut = getIssuesCompletedInRange(USER, THIS_WEEK_START, THIS_WEEK_END)

    expect(lastIn.size).toBe(5)  // 지난주 신규 5건
    expect(lastOut.size).toBe(2) // 지난주에 완료된 건 2건만 (3건은 이번주로 넘어감)
    expect(thisIn.size).toBe(0)  // 이번주 신규 0
    expect(thisOut.size).toBe(3) // 이번주에 carry-over 3건 완료

    // 사용자 의문 핵심: 지난주 유입(5) > 유출(2) — 3건이 미완료로 넘어감이 보고서에 보여야 함.
    expect(lastIn.size - lastOut.size).toBe(3)
  })

  it('주 경계 3: rejected_at 으로 끝난 이슈는 유출 아님 (반려는 완료가 아님)', () => {
    // 이슈가 검증에서 반려됨 → cached_stage 는 dev 로 돌아감 → 완료 아님
    seedExecution(db, {
      id: 'e1', projectId: PROJ, agentId: 'agent-claude', issueIid: 1, status: 'success',
      startedAt: kstToUtcIso('2026-05-05 09:00:00'),
      endedAt:   kstToUtcIso('2026-05-05 09:30:00'),
      rejectedAt: kstToUtcIso('2026-05-05 11:00:00'),
    })
    seedIssueStage(db, { projectId: PROJ, issueIid: 1, cachedStage: 'dev' })

    const out = getIssuesCompletedInRange(USER, THIS_WEEK_START, THIS_WEEK_END)
    expect(out.size).toBe(0)
  })

  // ── 권한 격리 ──

  it('권한 격리: 다른 사용자 프로젝트의 이슈는 안 잡힘', () => {
    seedUser(db, 'user-other', '다른')
    seedProject(db, 'proj-other', 'user-other', 'Other')
    seedExecution(db, {
      id: 'e1', projectId: 'proj-other', agentId: null, issueIid: 1, status: 'success',
      startedAt: kstToUtcIso('2026-05-05 09:00:00'),
      endedAt:   kstToUtcIso('2026-05-05 09:30:00'),
    })
    seedIssueStage(db, { projectId: 'proj-other', issueIid: 1, cachedStage: 'done' })

    const inflow = getIssuesStartedInRange(USER, THIS_WEEK_START, THIS_WEEK_END)
    const outflow = getIssuesCompletedInRange(USER, THIS_WEEK_START, THIS_WEEK_END)

    expect(inflow.size).toBe(0)
    expect(outflow.size).toBe(0)

    // 글로벌 스코프(메일 보고서 용)는 모든 프로젝트 포함
    const globalIn = getGlobalIssuesStartedInRange(THIS_WEEK_START, THIS_WEEK_END)
    const globalOut = getGlobalIssuesCompletedInRange(THIS_WEEK_START, THIS_WEEK_END)
    expect(globalIn.size).toBe(1)
    expect(globalOut.size).toBe(1)
  })

  // ── 불변식 ──

  it('불변식: 대기건 0 일 때 누적 유입 == 누적 유출', () => {
    // 4 이슈 모두 시작·완료. 진행 중 0.
    for (let i = 1; i <= 4; i++) {
      seedExecution(db, {
        id: `e${i}`, projectId: PROJ, agentId: 'agent-claude', issueIid: i, status: 'success',
        startedAt: kstToUtcIso(`2026-04-28 1${i}:00:00`),
        endedAt:   kstToUtcIso(`2026-04-28 1${i}:30:00`),
        verifiedAt: kstToUtcIso(`2026-05-0${(i % 5) + 1} 14:00:00`),
      })
      seedIssueStage(db, { projectId: PROJ, issueIid: i, cachedStage: 'done' })
    }
    // 누적 (지난주~이번주 끝)
    const inflowAll = getIssuesStartedInRange(USER, '2026-04-20', '2026-05-11')
    const outflowAll = getIssuesCompletedInRange(USER, '2026-04-20', '2026-05-11')
    expect(inflowAll.size).toBe(outflowAll.size)
  })

  it('불변식: 미완료 1건 있으면 누적 유입 = 누적 유출 + 1', () => {
    // 3개는 완료, 1개는 진행 중
    for (let i = 1; i <= 3; i++) {
      seedExecution(db, {
        id: `e${i}`, projectId: PROJ, agentId: 'agent-claude', issueIid: i, status: 'success',
        startedAt: kstToUtcIso(`2026-04-28 1${i}:00:00`),
        endedAt:   kstToUtcIso(`2026-04-28 1${i}:30:00`),
        verifiedAt: kstToUtcIso(`2026-04-30 14:00:00`),
      })
      seedIssueStage(db, { projectId: PROJ, issueIid: i, cachedStage: 'done' })
    }
    seedExecution(db, {
      id: 'e4', projectId: PROJ, agentId: 'agent-claude', issueIid: 4, status: 'running',
      startedAt: kstToUtcIso('2026-05-05 10:00:00'),
    })
    seedIssueStage(db, { projectId: PROJ, issueIid: 4, cachedStage: 'dev' })

    const inflowAll = getIssuesStartedInRange(USER, '2026-04-20', '2026-05-11')
    const outflowAll = getIssuesCompletedInRange(USER, '2026-04-20', '2026-05-11')
    expect(inflowAll.size).toBe(4)
    expect(outflowAll.size).toBe(3)
    expect(inflowAll.size - outflowAll.size).toBe(1)
  })

  // ── getIssueCompletionTimes (이슈 키 지정 조회) ──

  it('getIssueCompletionTimes: 지정한 이슈 키들에 대한 완료 시각 반환', () => {
    seedExecution(db, { id: 'e1', projectId: PROJ, agentId: 'agent-claude', issueIid: 1, status: 'success', startedAt: kstToUtcIso('2026-05-05 09:00:00'), endedAt: kstToUtcIso('2026-05-05 09:30:00'), verifiedAt: kstToUtcIso('2026-05-05 11:00:00') })
    seedIssueStage(db, { projectId: PROJ, issueIid: 1, cachedStage: 'done' })
    seedExecution(db, { id: 'e2', projectId: PROJ, agentId: 'agent-claude', issueIid: 2, status: 'running', startedAt: kstToUtcIso('2026-05-06 09:00:00') })
    seedIssueStage(db, { projectId: PROJ, issueIid: 2, cachedStage: 'dev' })

    const times = getIssueCompletionTimes(USER, [
      { projectId: PROJ, issueIid: 1 },
      { projectId: PROJ, issueIid: 2 },
    ])
    expect(times.size).toBe(1) // 미완료 이슈는 제외
    expect(times.has(`${PROJ}:1`)).toBe(true)
    expect(times.has(`${PROJ}:2`)).toBe(false)
  })

  // ── 재오픈: 한 번 완료(확인 완료)된 이슈를 다시 열어 재작업 ──
  it('재오픈 1: 완료를 떠나 새 사이클이면 옛 confirmed_at 이 지워져 재작업 완료가 그 주 유출에 잡힌다', () => {
    // 지난주: 개발·검증 → 확인 완료(confirmed_at 지난주)
    seedExecution(db, { id: 'e1a', projectId: PROJ, agentId: 'agent-claude', issueIid: 1, status: 'success', startedAt: kstToUtcIso('2026-04-28 09:00:00'), endedAt: kstToUtcIso('2026-04-28 09:30:00'), verifiedAt: kstToUtcIso('2026-04-28 11:00:00') })
    seedIssueStage(db, { projectId: PROJ, issueIid: 1, cachedStage: 'done', confirmedAt: kstToUtcIso('2026-04-29 14:00:00') })
    expect(getIssuesCompletedInRange(USER, LAST_WEEK_START, LAST_WEEK_END).has(`${PROJ}:1`)).toBe(true)

    // 이번주: 다시 열어 재작업 → 진행 중인 동안은 어느 주에도 유출 아님
    resetIssueCycleMarkers(PROJ, 1)
    db.prepare("UPDATE issue_stages SET cached_stage = 'verify_waiting' WHERE project_id = ? AND issue_iid = 1").run(PROJ)
    seedExecution(db, { id: 'e1b', projectId: PROJ, agentId: 'agent-claude', issueIid: 1, status: 'success', startedAt: kstToUtcIso('2026-05-05 09:00:00'), endedAt: kstToUtcIso('2026-05-05 09:30:00') })
    expect(getIssuesCompletedInRange(USER, THIS_WEEK_START, THIS_WEEK_END).size).toBe(0)

    // 이번주 검증 통과 → 완료. 완료 시각은 이번 사이클(옛 confirmed_at 에 고정되지 않음)
    db.prepare("UPDATE task_executions SET verified_at = ? WHERE id = 'e1b'").run(kstToUtcIso('2026-05-06 11:00:00'))
    db.prepare("UPDATE issue_stages SET cached_stage = 'done' WHERE project_id = ? AND issue_iid = 1").run(PROJ)
    const thisOut = getIssuesCompletedInRange(USER, THIS_WEEK_START, THIS_WEEK_END)
    expect(thisOut.get(`${PROJ}:1`)).toBe(kstToUtcIso('2026-05-06 11:00:00'))
  })

  it('재오픈 2: 이전 사이클 확인 기록(ex-confirm 행)은 지우지 않는다', () => {
    seedExecution(db, { id: 'ex-confirm-1', projectId: PROJ, agentId: null, issueIid: 1, status: 'success', startedAt: kstToUtcIso('2026-04-29 13:00:00'), endedAt: kstToUtcIso('2026-04-29 14:00:00'), assigneeType: 'user' })
    seedIssueStage(db, { projectId: PROJ, issueIid: 1, cachedStage: 'done', confirmedAt: kstToUtcIso('2026-04-29 14:00:00') })
    resetIssueCycleMarkers(PROJ, 1)
    const row = db.prepare("SELECT confirmed_at FROM issue_stages WHERE project_id = ? AND issue_iid = 1").get(PROJ) as any
    expect(row.confirmed_at).toBeNull()
    expect(db.prepare("SELECT COUNT(*) c FROM task_executions WHERE id = 'ex-confirm-1'").get()).toEqual({ c: 1 })
  })
})
