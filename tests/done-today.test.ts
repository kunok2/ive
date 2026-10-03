/**
 * 오늘 완료 목록 — 카드 「완료」 숫자와 같은 근거(issue_stages)여야 한다.
 * 운영: 60건을 처리했는데 보드가 실행 기록(오늘 시작·최근 N건)으로 세서 「오늘 완료 1」(2026-10-03).
 *   D-1: 오늘 done/rejected 로 바뀐 이슈만, 숫자(countTodayStageTransitions 합)와 건수가 같다
 *   D-2: 시각은 ISO(Z), 확인자 > 담당자 순으로 처리한 사람
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import Database from 'better-sqlite3'
import { initSchema } from '@/lib/db/schema'
import { listTodayDoneIssues } from '@/lib/db'
import { countTodayStageTransitions } from '@/lib/db/issues'

const TODAY = '2026-10-02T15:00:00.000Z' // KST 10/03 00:00

beforeEach(() => {
  const d = new Database(':memory:')
  initSchema(d)
  d.pragma('foreign_keys = OFF') // 프로젝트 행 없이 단계 기록만 본다
  const ins = d.prepare(`INSERT INTO issue_stages (project_id, issue_iid, cached_stage, issue_title, updated_at, confirmer_name, confirmer_user_id, assignee_name) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`)
  ins.run('p', 1, 'done', '닫힌 이슈(오늘 완료)', '2026-10-03 08:50:27', '확인자', 'u1', '담당')
  ins.run('p', 2, 'rejected', '오늘 반려', '2026-10-03 01:00:00', null, null, '담당')
  ins.run('p', 3, 'done', '어제 완료', '2026-10-02 14:59:59', null, null, null)
  ins.run('p', 4, 'verifying', '진행 중', '2026-10-03 02:00:00', null, null, null)
  global.db = d
})
afterEach(() => { global.db?.close(); global.db = undefined })

describe('listTodayDoneIssues', () => {
  it('D-1: 오늘 완료·반려만 — 카드 숫자와 같다', () => {
    const list = listTodayDoneIssues('p', TODAY)
    expect(list.map(x => x.iid)).toEqual([1, 2])
    expect(list.length).toBe(countTodayStageTransitions('p', 'done', TODAY) + countTodayStageTransitions('p', 'rejected', TODAY))
  })
  it('D-2: ISO 시각과 처리한 사람', () => {
    const [a, b] = listTodayDoneIssues('p', TODAY)
    expect(a.at).toBe('2026-10-03T08:50:27Z')
    expect(a.who).toEqual({ name: '확인자', avatar: null, userId: 'u1' })
    expect(b.who?.name).toBe('담당')
  })
})
