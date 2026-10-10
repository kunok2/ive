/**
 * 카드 「완료」·전일 대비 증감·오늘 완료 목록 — 보고서와 같은 완료 사이클로 센다.
 * 운영: 60건을 처리했는데 보드가 실행 기록(오늘 시작·최근 N건)으로 세서 「오늘 완료 1」(2026-10-03).
 * 운영(#563): 어제 15건을 끝냈는데 카드의 어제 몫이 14 — 단계 스냅샷(issue_stages.updated_at)으로 세어,
 *   단계가 그대로여도 스냅샷을 다시 쓴 이슈가 오늘로 넘어갔다. 보고서(완료 사이클)는 15.
 *   D-1: 어제 끝낸 일은 스냅샷을 오늘 다시 써도 어제 완료다 — 보고서의 그날 완료와 같은 숫자
 *   D-2: 좁혀 읽어도(activeSince) 전체 이력으로 센 것과 같다
 *   D-3: 머지 없이 닫힌(버려진) 일은 완료가 아니다, 다시 열렸다 다시 끝난 일은 사이클마다 한 건
 *   D-4: 목록은 숫자와 건수가 같고, 시각은 ISO(Z), 확인자 > 담당자 순으로 처리한 사람
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import Database from 'better-sqlite3'
import { initSchema } from '@/lib/db/schema'
import { listTodayDoneIssues, recordStageEvent, upsertIssueStageSnapshot } from '@/lib/db'
import { countTodayStageTransitions } from '@/lib/db/issues'
import { completedOnDays, completedInRange, loadIssueHistory } from '@/lib/report-model/load'

const YESTERDAY = '2026-10-02', TODAY = '2026-10-03', TOMORROW = '2026-10-04'
const TODAY_START = '2026-10-02T15:00:00.000Z' // KST 10/03 00:00
const at = (s: string) => new Date(`${s}+09:00`).toISOString()
let d: Database.Database

beforeEach(() => {
  d = new Database(':memory:')
  initSchema(d)
  d.pragma('foreign_keys = OFF') // 프로젝트 행 없이 이력만 본다
  global.db = d
})
afterEach(() => { global.db?.close(); global.db = undefined })

function stage(iid: number, cached: string, extra: Record<string, unknown> = {}) {
  const row = { project_id: 'p', issue_iid: iid, cached_stage: cached, issue_title: `이슈 ${iid}`, ...extra }
  const cols = Object.keys(row)
  d.prepare(`INSERT INTO issue_stages (${cols.join(',')}) VALUES (${cols.map(() => '?').join(',')})`).run(...cols.map(c => (row as any)[c]))
}
const ev = (iid: number, from: string | null, to: string, when: string) =>
  recordStageEvent({ projectId: 'p', issueIid: iid, fromStage: from, toStage: to, source: 'scanner', occurredAt: at(when) })
function exec(id: string, iid: number, status: string, started: string, ended: string | null) {
  d.prepare(`INSERT INTO task_executions (id, project_id, agent_id, assignee_type, issue_iid, status, started_at, ended_at) VALUES (?, 'p', 'a1', 'agent', ?, ?, ?, ?)`)
    .run(id, iid, status, at(started), ended ? at(ended) : null)
}
/** 처리 → 완료까지 한 번에 끝난 이슈 */
function finished(iid: number, doneAt: string, updatedAt: string) {
  exec(`ex-${iid}`, iid, 'success', `${doneAt.slice(0, 10)}T09:00:00`, `${doneAt.slice(0, 10)}T09:30:00`)
  ev(iid, null, 'dev', `${doneAt.slice(0, 10)}T09:00:00`)
  ev(iid, 'dev', 'done', doneAt)
  stage(iid, 'done', { updated_at: updatedAt })
}
const snapshot = (iid: number, cachedStage: string) => upsertIssueStageSnapshot('p', iid, {
  cachedStage, assigneeUsername: null, assigneeName: null, assigneeAvatar: null, assigneeProvider: 'gitlab', assigneeGitUserId: null, issueTitle: `이슈 ${iid}`,
})
const counts = () => {
  const cycles = completedOnDays('p', YESTERDAY, TOMORROW)
  const today = cycles.filter(c => c.at >= TODAY_START).length
  return { today, yesterday: cycles.length - today }
}

describe('카드 완료 수 = 보고서 완료 수 (#563)', () => {
  it('D-1: 어제 끝낸 15건 — 한 건의 스냅샷을 오늘 다시 써도 어제 15건, 오늘 0건', () => {
    for (let i = 1; i <= 15; i++) finished(i, `${YESTERDAY}T1${i % 10}:00:00`, '2026-10-02 05:00:00')
    snapshot(7, 'done') // 단계는 그대로인데 updated_at 이 지금으로 바뀐다
    // 예전 기준(단계 스냅샷의 updated_at)은 그 한 건을 오늘로 넘긴다
    expect(countTodayStageTransitions('p', 'done', TODAY_START)).toBe(1)
    expect(counts()).toEqual({ today: 0, yesterday: 15 })
    // 보고서가 쓰는 계산(전체 이력의 completedInRange)과 같은 숫자
    expect(completedInRange(loadIssueHistory(['p']), YESTERDAY, TODAY).length).toBe(15)
  })

  it('D-2: 좁혀 읽어도 전체 이력으로 센 것과 같다 — 그제 끝난 일·경계 시각 포함', () => {
    finished(1, '2026-10-01T23:59:59', '2026-10-01 14:59:59') // 그제
    finished(2, `${YESTERDAY}T00:00:00`, '2026-10-01 15:00:00') // 어제 00:00
    finished(3, `${YESTERDAY}T23:59:59`, '2026-10-02 14:59:59') // 어제 23:59
    finished(4, `${TODAY}T00:00:00`, '2026-10-02 15:00:00')     // 오늘 00:00
    // 확인 완료 시각만 있는 일(단계 사건 없음) — 옛 형식 시각
    exec('ex-5', 5, 'success', '2026-09-30T09:00:00', '2026-09-30T10:00:00')
    stage(5, 'done', { confirmed_at: '2026-10-02 16:00:00' }) // KST 10/03 01:00
    const full = completedInRange(loadIssueHistory(['p']), YESTERDAY, TOMORROW)
    expect(completedOnDays('p', YESTERDAY, TOMORROW)).toEqual(full)
    expect(counts()).toEqual({ today: 2, yesterday: 2 })
  })

  it('D-3: 버려진 일은 완료가 아니고, 다시 열렸다 다시 끝난 일은 사이클마다 한 건', () => {
    // 처리에 성공했지만 머지 없이 닫힘 — 스캐너가 스냅샷을 done 으로 정리해도 완료가 아니다
    exec('ex-1', 1, 'success', `${TODAY}T09:00:00`, `${TODAY}T09:30:00`)
    ev(1, null, 'dev', `${TODAY}T09:00:00`)
    ev(1, 'dev', 'closed', `${TODAY}T10:00:00`)
    snapshot(1, 'done')
    // 어제 끝났다가 오늘 다시 열려 다시 끝남 — 어제 1건, 오늘 1건
    finished(2, `${YESTERDAY}T10:00:00`, '2026-10-02 01:00:00')
    ev(2, 'done', 'dev', `${TODAY}T09:00:00`)
    exec('ex-2b', 2, 'success', `${TODAY}T09:00:00`, `${TODAY}T09:30:00`)
    ev(2, 'dev', 'done', `${TODAY}T11:00:00`)
    expect(counts()).toEqual({ today: 1, yesterday: 1 })
  })
})

describe('listTodayDoneIssues', () => {
  const todayDone = () => completedOnDays('p', TODAY, TOMORROW).map(c => ({ iid: Number(c.key.slice(c.key.lastIndexOf(':') + 1)), at: c.at }))

  it('D-4: 오늘 완료·반려만 — 카드 숫자와 건수가 같고, ISO 시각과 처리한 사람', () => {
    finished(1, `${TODAY}T08:50:27`, '2026-10-02 23:50:27')
    d.prepare(`UPDATE issue_stages SET confirmer_name = '확인자', confirmer_user_id = 'u1', assignee_name = '담당' WHERE issue_iid = 1`).run()
    stage(2, 'rejected', { updated_at: '2026-10-03 01:00:00', assignee_name: '담당' })
    finished(3, `${YESTERDAY}T23:59:59`, '2026-10-02 14:59:59')
    snapshot(3, 'done') // 어제 완료 — 스냅샷을 다시 써도 오늘 목록에 들어오지 않는다
    stage(4, 'verifying', { updated_at: '2026-10-03 02:00:00' })

    const list = listTodayDoneIssues('p', TODAY_START, todayDone())
    expect(list.map(x => [x.iid, x.stage])).toEqual([[2, 'rejected'], [1, 'done']])
    expect(list.length).toBe(counts().today + countTodayStageTransitions('p', 'rejected', TODAY_START))
    const [rejected, done] = list
    expect(rejected.at).toBe('2026-10-03T01:00:00Z')
    expect(rejected.who?.name).toBe('담당')
    expect(done.at).toBe(at(`${TODAY}T08:50:27`))
    expect(done.who).toEqual({ name: '확인자', avatar: null, userId: 'u1' })
  })
})
