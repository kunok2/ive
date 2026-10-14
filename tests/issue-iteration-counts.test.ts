/**
 * 진행 막대 정/역방향 횟수(getIssueRetryCounts·getIssueForwardCounts·getIssueIterationCountsMap).
 *
 * C-1: 에이전트 검증 반려·확인 실패(단계 작업자 경로 — 활동 로그 없이 사건 로그만 남김)도 되돌림으로 센다.
 * C-2: 확인 실패 → 처리(4→2)처럼 이웃하지 않은 칸으로 되돌아간 이동도 그대로 남는다.
 * C-3: 화면 버튼은 활동 로그·사건 로그 둘 다 남기므로 두 번 세지 않는다.
 * C-4: 사건 로그가 생기기 전 활동 로그는 그 이슈의 첫 단계 사건 이전 것만 보충한다.
 * C-5: 목록용 맵도 같은 값을 낸다.
 * C-6: 라벨 교체 중 「단계 없음」으로 읽힌 순간을 사이에 둔 두 기록은 한 번의 이동이다(운영 spider-framework #1419).
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import Database from 'better-sqlite3'
import { initSchema } from '@/lib/db/schema'
import { recordStageEvent, getIssueRetryCounts, getIssueForwardCounts, getIssueIterationCountsMap } from '@/lib/db'

let db: Database.Database

beforeEach(() => {
  db = new Database(':memory:')
  initSchema(db)
  ;(globalThis as any).db = db
  db.prepare(`INSERT INTO users (id, email, name) VALUES ('u1', 'a@x.com', '사람')`).run()
})
afterEach(() => { db.close(); (globalThis as any).db = undefined })

const agent = { type: 'agent' as const, agentId: 'a1' }
let t = Date.parse('2026-10-02T00:00:00Z')
function move(iid: number, from: string | null, to: string | null, action: string | null, source: 'worker' | 'ui' | 'scanner' = 'worker') {
  t += 60_000
  recordStageEvent({ projectId: 'p', issueIid: iid, fromStage: from, toStage: to, action, source, actor: agent, occurredAt: new Date(t).toISOString() })
}
function activity(iid: number, action: string, at: string) {
  db.prepare(`INSERT INTO user_activity_logs (id, user_id, category, action, detail, target_type, target_id, created_at)
              VALUES (?, 'u1', 'task', ?, '', 'issue', ?, ?)`).run(`al-${Math.random()}`, action, `p:${iid}`, at)
}

describe('진행 막대 횟수', () => {
  it('C-1·C-2: 에이전트 반려(3→2)·확인 실패(4→2)를 되돌림으로, 승인·완료를 정방향으로 센다', () => {
    // 처리 → 검증 반려 2회 → 통과 → 확인 실패 1회 → 다시 검증 통과 → 확인 통과
    for (let i = 0; i < 2; i++) {
      move(1, 'waiting', 'dev', 'start_dev'); move(1, 'dev', 'verify_waiting', 'complete')
      move(1, 'verify_waiting', 'verifying', 'start_verification'); move(1, 'verifying', 'waiting', 'reject')
    }
    move(1, 'waiting', 'dev', 'start_dev'); move(1, 'dev', 'verify_waiting', 'complete')
    move(1, 'verify_waiting', 'verifying', 'start_verification'); move(1, 'verifying', 'confirm_waiting', 'approve')
    move(1, 'confirm_waiting', 'confirming', 'start_confirmation'); move(1, 'confirming', 'waiting', 'retry')
    move(1, 'waiting', 'dev', 'start_dev'); move(1, 'dev', 'verify_waiting', 'complete')
    move(1, 'verify_waiting', 'verifying', 'start_verification'); move(1, 'verifying', 'confirm_waiting', 'approve')
    move(1, 'confirm_waiting', 'confirming', 'start_confirmation'); move(1, 'confirming', 'done', 'accept')

    expect(getIssueRetryCounts('p', 1)).toEqual(expect.arrayContaining([
      { from: 3, to: 2, count: 2 },
      { from: 4, to: 2, count: 1 },
    ]))
    expect(getIssueRetryCounts('p', 1)).toHaveLength(2)
    expect(getIssueForwardCounts('p', 1)).toMatchObject({ toConfirm: 2, toDone: 1 })
  })

  it('C-3: 화면 버튼 반려는 활동 로그·사건 로그 둘 다 있어도 한 번만 센다', () => {
    move(2, 'verify_waiting', 'verifying', 'start_verification', 'ui')
    move(2, 'verifying', 'waiting', 'reject', 'ui')
    activity(2, 'task_reject', '2026-10-02 23:00:00')
    expect(getIssueRetryCounts('p', 2)).toEqual([{ from: 3, to: 2, count: 1 }])
  })

  it('C-4: 사건 로그 이전 활동 로그는 보충하고, 사건 로그가 없는 이슈는 활동 로그로만 센다', () => {
    activity(3, 'task_reject', '2026-09-20 10:00:00')      // 사건 로그 이전 → 센다
    activity(3, 'task_return_to_dev', '2026-09-21 10:00:00')
    move(3, 'verifying', 'waiting', 'reject', 'ui')        // 사건 로그 시작
    activity(3, 'task_reject', '2026-10-05 10:00:00')      // 이후 → 사건 로그가 이미 셈
    expect(getIssueRetryCounts('p', 3)).toEqual(expect.arrayContaining([
      { from: 3, to: 2, count: 2 },
      { from: 4, to: 3, count: 1 },
    ]))
    activity(4, 'task_reopen', '2026-09-20 10:00:00')
    activity(4, 'task_accept', '2026-09-19 10:00:00')
    expect(getIssueRetryCounts('p', 4)).toEqual([{ from: 5, to: 4, count: 1 }])
    expect(getIssueForwardCounts('p', 4).toDone).toBe(1)
  })

  it('C-6: 검증 중 → (단계 없음) → 확인대기는 검증 → 유입 되돌림이 아니라 검증 → 확인 정방향 한 번이다', () => {
    move(6, 'verify_waiting', 'verifying', null, 'scanner')
    move(6, 'verifying', null, null, 'scanner')
    move(6, null, 'confirm_waiting', null, 'scanner')   // 1분 넘게 지나 이어짐
    move(6, 'confirm_waiting', 'confirming', null, 'scanner')
    expect(getIssueRetryCounts('p', 6)).toEqual([])
    expect(getIssueForwardCounts('p', 6)).toMatchObject({ toConfirm: 1 })
  })

  it('C-5: 목록용 맵도 단건 조회와 같다', () => {
    move(5, 'verifying', 'waiting', 'reject')
    move(5, 'waiting', 'none', null, 'scanner')            // 2→1 (Git 에서 IVE-S 를 뗌)
    activity(6, 'task_reject', '2026-09-20 10:00:00')
    const map = getIssueIterationCountsMap('p')
    expect(map.get(5)?.retry).toEqual(getIssueRetryCounts('p', 5))
    expect(map.get(5)?.retry).toEqual(expect.arrayContaining([{ from: 3, to: 2, count: 1 }, { from: 2, to: 1, count: 1 }]))
    expect(map.get(6)?.retry).toEqual([{ from: 3, to: 2, count: 1 }])
  })
})
