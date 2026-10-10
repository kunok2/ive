/**
 * 프로젝트 카드 "완료(오늘)" 카운트 회귀 테스트 (#448).
 *
 * 사고: "오늘 두 건 처리했는데 프로젝트 카드 완료 부분이 0으로 나온다."
 *
 * 원인: /api/projects/[id]/stats 가 오늘 완료/반려 수를 셀 때
 *   `issue_stages.updated_at >= todayStartISO` 로 단순 문자열 비교했다.
 *   - updated_at  : datetime('now') 포맷 → 'YYYY-MM-DD HH:MM:SS' (공백 구분, 0x20)
 *   - todayStartISO: toISOString() 포맷 → 'YYYY-MM-DDTHH:MM:SS.sssZ' ('T' 구분, 0x54)
 *   날짜 부분이 같은 행을 비교하면 공백(0x20) < 'T'(0x54) 이라 항상 false 가 되어,
 *   KST 자정~오전 09시(=UTC 같은 날짜) 사이에 완료된 건이 통째로 누락됐다.
 *
 * 수정: countTodayStageTransitions 가 datetime() 로 양변을 정규화해 포맷 차이를 흡수.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import Database from 'better-sqlite3'
import { setupTestDb, teardownTestDb, seedUser, seedProject } from './helpers/test-db'
import { countTodayStageTransitions } from '@/lib/db/issues'

/** issue_stages 행을 cached_stage / updated_at(SQLite datetime 포맷) 지정해 직접 삽입 */
function insertStageRow(db: Database.Database, projectId: string, iid: number, cachedStage: string, updatedAt: string) {
  db.prepare(`
    INSERT INTO issue_stages (project_id, issue_iid, stage, cached_stage, updated_at)
    VALUES (?, ?, '', ?, ?)
  `).run(projectId, iid, cachedStage, updatedAt)
}

describe('countTodayStageTransitions — 포맷 불일치 방어 (#448)', () => {
  let db: Database.Database
  // KST 2026-06-05 00:00 = UTC 2026-06-04 15:00 → todayStartISO 의 형태
  const todayStartISO = '2026-06-04T15:00:00.000Z'

  beforeEach(() => {
    db = setupTestDb()
    seedUser(db, 'u1', '정균옥')
    seedProject(db, 'p1', 'u1', 'IVE')
  })
  afterEach(() => teardownTestDb())

  it('KST 오전(=UTC 같은 날짜)에 완료된 done 건도 오늘 완료로 집계된다', () => {
    // UTC 2026-06-04 23:30 = KST 2026-06-05 08:30 → 분명한 "오늘" 완료 건.
    // updated_at 은 datetime('now') 와 동일한 공백 구분 포맷.
    insertStageRow(db, 'p1', 101, 'done', '2026-06-04 23:30:00')
    expect(countTodayStageTransitions('p1', 'done', todayStartISO)).toBe(1)
  })

  it('단순 문자열 비교였다면 누락됐을 행이 datetime() 정규화로 잡힌다 (골든)', () => {
    insertStageRow(db, 'p1', 101, 'done', '2026-06-04 23:30:00')
    // 회귀 전 동작 재현: 공백 구분 포맷 < 'T' 구분 포맷 → false → 0 건
    const buggy = db.prepare(
      "SELECT COUNT(*) c FROM issue_stages WHERE project_id='p1' AND cached_stage='done' AND updated_at >= ?"
    ).get(todayStartISO) as any
    expect(buggy.c).toBe(0) // 옛 버그 동작 (누락)
    // 수정 후 동작: datetime() 정규화 → 정상 집계
    expect(countTodayStageTransitions('p1', 'done', todayStartISO)).toBe(1)
  })

  it('UTC 다음 날짜(KST 오전 9시 이후) 완료 건도 집계된다', () => {
    // UTC 2026-06-05 02:00 = KST 2026-06-05 11:00
    insertStageRow(db, 'p1', 102, 'done', '2026-06-05 02:00:00')
    expect(countTodayStageTransitions('p1', 'done', todayStartISO)).toBe(1)
  })

  it('어제 완료 건은 제외된다', () => {
    // UTC 2026-06-04 14:00 = KST 2026-06-04 23:00 → 어제
    insertStageRow(db, 'p1', 103, 'done', '2026-06-04 14:00:00')
    expect(countTodayStageTransitions('p1', 'done', todayStartISO)).toBe(0)
  })

  it('두 건 처리 시 정확히 2로 집계된다 (이슈 재현 시나리오)', () => {
    insertStageRow(db, 'p1', 201, 'done', '2026-06-04 23:00:00') // KST 08:00
    insertStageRow(db, 'p1', 202, 'done', '2026-06-05 01:00:00') // KST 10:00
    expect(countTodayStageTransitions('p1', 'done', todayStartISO)).toBe(2)
  })

  it('rejected 단계도 동일하게 집계된다', () => {
    insertStageRow(db, 'p1', 301, 'rejected', '2026-06-04 22:00:00') // KST 07:00
    expect(countTodayStageTransitions('p1', 'rejected', todayStartISO)).toBe(1)
    // done 카운트에는 섞이지 않음
    expect(countTodayStageTransitions('p1', 'done', todayStartISO)).toBe(0)
  })
})
