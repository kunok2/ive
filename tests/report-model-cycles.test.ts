/**
 * 보고서 모델 — 재검증에서 찾은 결함과 요건 보완의 회귀 방지 (DB 는 실제 스키마, 메일 전송만 가짜).
 *
 * C-1 다시 열린 일의 보유 나이는 재오픈부터 잰다.
 * C-2 다시 열려도 지난 사이클의 완료는 사라지지 않는다(지난 달 추이·평가 포함). 뒤집힘으로 평가된다.
 * C-3 다시 완료될 때 이번 사이클에 검증이 없으면 지난 사이클의 검증 시각을 쓰지 않는다.
 * C-4 처리에 성공했어도 머지 없이 닫힌(버려진) 일은 완료가 아니다.
 * C-5 버려져 정리된 사람의 검증·확인 기록은 반려가 아니다.
 * C-6 옛 id 형식의 사후 기록 실행도 사후 기록이다(유입을 두 번 세지 않는다).
 * C-7 발송이 실패한 주소는 다음 확인 때 다시 보낸다.
 * C-8 보유 단계로 보였던 사후 기록 일은 그때 들어온 것으로 센다(보유 식이 기간 경계에서 맞는다).
 * D-1 막 끝나 확정 전인 기간은 잠정으로 표시하고 메일에도 밝힌다.
 * D-9 메일의 모든 숫자 칸은 모델의 그 경로 값과 같다(팀원·팀장·경영진 메일 모두).
 * B-5 프로젝트별 사람 시간은 지난 기간 값도 함께 준다.
 * C-3' 닫힌 기간의 "7일 넘은 일"은 하루 마감 기록에서 읽는다.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import Database from 'better-sqlite3'

const mailMock = vi.hoisted(() => ({ sendMail: vi.fn(async (_m: unknown) => ({})) }))
vi.mock('@/lib/mail', () => ({ createTransporter: () => ({ sendMail: mailMock.sendMail }), getFromAddress: () => 'ive@test' }))

import { initSchema } from '@/lib/db/schema'
import { recordStageEvent } from '@/lib/db'
import { buildReportModel, liveHeldAll, mineFrom } from '@/lib/report-model/build'
import { agedHeldByProject } from '@/lib/report-model/load'
import { getReportModel } from '@/lib/report-model'
import { fmtHours } from '@/lib/report-model/format'
import { renderReportMail } from '@/lib/report-mailer/render'
import { sendReport } from '@/lib/report-mailer'
import { parseIveMetaFixes } from '@/lib/scanner/formatters'
import type { ReportModel, HeldIssue } from '@/lib/report-model/types'

let db: Database.Database
const NOW = new Date('2026-10-02T06:00:00Z') // 2026-10-02(금) 15:00 KST
const iso = (ms: number) => new Date(ms).toISOString()
const kst = (s: string) => new Date(`${s}+09:00`).getTime()
const at = (s: string) => iso(kst(s))

beforeEach(() => {
  db = new Database(':memory:')
  initSchema(db)
  ;(globalThis as any).db = db
  db.pragma('foreign_keys = OFF')
  mailMock.sendMail.mockReset()
  mailMock.sendMail.mockImplementation(async () => ({}))
})
afterEach(() => { db.close(); (globalThis as any).db = undefined })

function seedBase() {
  db.prepare(`INSERT INTO users (id, email, name, is_admin, gitlab_username) VALUES ('u-lead','lead@x.com','정팀장',0,'lead'), ('u-park','park@x.com','박개발',0,'park'), ('u-lee','lee@x.com','이검증',0,'lee')`).run()
  db.prepare(`INSERT INTO projects (id, user_id, name, repo_url, access_token, provider) VALUES ('p1','u-lead','Shop','https://x','t','gitlab'), ('p2','u-lead','Portal','https://x','t','gitlab')`).run()
  db.prepare(`INSERT INTO project_shares (id, project_id, user_id, role) VALUES ('s1','p1','u-park','viewer'), ('s2','p1','u-lee','viewer')`).run()
}
function exec(row: Record<string, unknown>) {
  const cols = Object.keys(row)
  db.prepare(`INSERT INTO task_executions (${cols.join(',')}) VALUES (${cols.map(() => '?').join(',')})`).run(...cols.map(c => row[c] as any))
}
function stage(pid: string, iid: number, cached: string, extra: Record<string, unknown> = {}) {
  const row = { project_id: pid, issue_iid: iid, cached_stage: cached, issue_title: `이슈 ${iid}`, ...extra }
  const cols = Object.keys(row)
  db.prepare(`INSERT INTO issue_stages (${cols.join(',')}) VALUES (${cols.map(() => '?').join(',')})`).run(...cols.map(c => (row as any)[c]))
}
const ev = (iid: number, from: string | null, to: string, when: string, pid = 'p1') =>
  recordStageEvent({ projectId: pid, issueIid: iid, fromStage: from, toStage: to, source: 'scanner', occurredAt: at(when) })

describe('사이클(재오픈)', () => {
  it('C-1: 다시 열린 일의 보유 나이는 재오픈부터 — 몇 달 전 첫 접수로 "7일 넘은 일"이 되지 않는다', () => {
    seedBase()
    exec({ id: 'ex-1', project_id: 'p1', agent_id: 'a1', assignee_type: 'agent', issue_iid: 1, status: 'success', started_at: at('2026-01-05T10:00:00'), ended_at: at('2026-01-05T11:00:00'), verified_at: at('2026-01-06T10:00:00') })
    stage('p1', 1, 'waiting', { scheduled_at: at('2026-01-05T09:00:00') })
    ev(1, 'done', 'waiting', '2026-10-02T00:00:00')
    const m = buildReportModel('u-lead', 'weekly', '2026-10-02', NOW)
    expect(m.held.end).toBe(1)
    expect(m.held.over7).toBe(0)
    expect(m.actions?.aged).toEqual([])
    expect(m.held.byStage?.find(s => s.stage === 'waiting')?.oldestHours).toBeCloseTo(15)
    expect(agedHeldByProject(['p1'], NOW).get('p1') ?? 0).toBe(0)
  })

  it('C-2: 다시 열려 진행 중이어도 지난 사이클의 완료는 남고(지난 달 추이), 평가는 "완료 후 뒤집힘"이다', () => {
    seedBase()
    exec({ id: 'ex-2', project_id: 'p1', agent_id: 'a1', assignee_type: 'agent', issue_iid: 2, status: 'success', model_name: 'claude-opus-5-5', started_at: at('2026-08-01T10:00:00'), ended_at: at('2026-08-01T11:00:00'), verified_at: at('2026-08-02T10:00:00') })
    ev(2, null, 'verify_waiting', '2026-08-01T11:00:00')
    ev(2, 'verify_waiting', 'done', '2026-08-02T10:00:00')
    ev(2, 'done', 'dev', '2026-09-20T10:00:00')
    exec({ id: 'ex-2b', project_id: 'p1', agent_id: 'a1', assignee_type: 'agent', issue_iid: 2, status: 'running', started_at: at('2026-09-20T10:00:00') })
    stage('p1', 2, 'dev', { scheduled_at: at('2026-08-01T09:00:00') })
    const aug = buildReportModel('u-lead', 'monthly', '2026-08-15', NOW)
    expect(aug.done.total).toBe(1)
    const oct = buildReportModel('u-lead', 'monthly', '2026-10-02', NOW)
    expect(oct.months?.find(x => x.start === '2026-08-01')?.completed).toBe(1)
    const w = oct.evaluation?.workers.find(x => x.key === 'm:claude-opus-5-5')
    expect(w?.grades.overturned).toBe(1)
    // 지난 사이클의 완료 시각은 그 사이클의 완료 사건
    expect(aug.completedList[0].completedAt).toBe(at('2026-08-02T10:00:00'))
  })

  it('C-3: 이번 사이클에 검증이 없으면 지난 사이클의 검증 시각을 쓰지 않는다', () => {
    seedBase()
    exec({ id: 'ex-3a', project_id: 'p1', agent_id: 'a1', assignee_type: 'agent', issue_iid: 3, status: 'success', started_at: at('2026-09-02T10:00:00'), ended_at: at('2026-09-02T11:00:00'), verified_at: at('2026-09-23T10:00:00') })
    ev(3, null, 'dev', '2026-09-02T10:00:00')
    ev(3, 'dev', 'done', '2026-09-23T10:00:00')
    ev(3, 'done', 'dev', '2026-09-24T10:00:00')
    exec({ id: 'ex-3b', project_id: 'p1', agent_id: 'a1', assignee_type: 'agent', issue_iid: 3, status: 'success', started_at: at('2026-09-30T10:00:00'), ended_at: at('2026-10-01T11:00:00') })
    stage('p1', 3, 'done')
    const thisWeek = buildReportModel('u-lead', 'weekly', '2026-10-02', NOW)
    expect(thisWeek.completedList.map(i => [i.iid, i.completedAt])).toEqual([[3, at('2026-10-01T11:00:00')]])
    // 지난주에는 첫 사이클의 완료(9/23)가 그대로 남는다
    expect(buildReportModel('u-lead', 'weekly', '2026-09-23', NOW).done.total).toBe(1)
  })

  it('C-4: 처리에 성공했어도 머지 없이 닫힌(버려진) 일은 완료가 아니다', () => {
    seedBase()
    exec({ id: 'ex-4', project_id: 'p1', agent_id: 'a1', assignee_type: 'agent', issue_iid: 4, status: 'success', started_at: at('2026-09-30T10:00:00'), ended_at: at('2026-09-30T11:00:00') })
    ev(4, null, 'verify_waiting', '2026-09-30T11:00:00')
    ev(4, 'verify_waiting', 'closed', '2026-10-01T09:00:00')
    stage('p1', 4, 'done') // 스캐너 정리 경로는 버려진 이슈도 done 으로 둔다
    expect(buildReportModel('u-lead', 'weekly', '2026-10-02', NOW).done.total).toBe(0)
  })
})

describe('반려 판정', () => {
  it('C-5: 버려져 정리된 사람의 검증 기록(표시 또는 같은 무렵의 닫힘 사건)은 반려가 아니다', () => {
    seedBase()
    for (let i = 0; i < 5; i++) {
      exec({ id: `ex-verify-ok${i}`, project_id: 'p1', issue_iid: 500 + i, assignee_type: 'user', user_id: 'u-lee', user_name: '이검증', status: 'success', verified_at: at('2026-09-16T10:00:00'), started_at: at('2026-09-16T09:00:00'), ended_at: at('2026-09-16T10:00:00') })
    }
    exec({ id: 'ex-verify-ab1', project_id: 'p1', issue_iid: 510, assignee_type: 'user', user_id: 'u-lee', user_name: '이검증', status: 'failed', stage_verdict: 'abandoned', started_at: at('2026-09-17T09:00:00'), ended_at: at('2026-09-17T10:00:00') })
    exec({ id: 'ex-verify-ab2', project_id: 'p1', issue_iid: 511, assignee_type: 'user', user_id: 'u-lee', user_name: '이검증', status: 'failed', started_at: at('2026-09-17T09:00:00'), ended_at: at('2026-09-17T10:00:00') })
    ev(511, 'verifying', 'closed', '2026-09-17T09:59:59')
    exec({ id: 'ex-confirm-ab', project_id: 'p1', issue_iid: 500, assignee_type: 'user', user_id: 'u-lead', status: 'failed', stage_verdict: 'abandoned', started_at: at('2026-09-18T09:00:00'), ended_at: at('2026-09-18T10:00:00') })
    const m = buildReportModel('u-lead', 'monthly', '2026-09-15', NOW)
    expect(m.risks?.rejectRate).toBe(0)
  })
})

describe('사후 기록(직접 처리)', () => {
  it('C-6: 옛 id 형식(ex-<시각>)의 사후 기록 실행도 사후 기록이다 — 유입을 두 기간에 두 번 세지 않는다', () => {
    seedBase()
    exec({ id: 'ex-1727000000000', project_id: 'p1', issue_iid: 6, assignee_type: 'user', user_name: '박개발', status: 'success', started_at: at('2026-09-25T10:00:00'), ended_at: at('2026-09-29T10:00:00'), work_sec: 3600 })
    stage('p1', 6, 'done')
    expect(buildReportModel('u-lead', 'weekly', '2026-09-23', NOW).held.inflow).toBe(0)
    const cur = buildReportModel('u-lead', 'weekly', '2026-10-02', NOW)
    expect(cur.held.inflow).toBe(1)
    expect(cur.done.byForm.direct).toBe(1)
  })

  it('C-8: 보유 단계로 보였던 사후 기록 일은 그때 들어온 것 — 기간 경계를 넘어도 보유 식이 맞는다', () => {
    seedBase()
    db.prepare(`INSERT INTO held_daily (project_id, date, dev, updated_at) VALUES ('p1','2026-09-27',1,'x')`).run()
    exec({ id: 'ex-ext-8', project_id: 'p1', issue_iid: 8, assignee_type: 'user', user_name: '박개발', status: 'success', started_at: at('2026-09-26T10:00:00'), ended_at: at('2026-09-30T10:00:00'), work_sec: 3600 })
    ev(8, null, 'dev', '2026-09-26T10:05:00')
    ev(8, 'dev', 'done', '2026-09-30T10:05:00')
    stage('p1', 8, 'done')
    const prev = buildReportModel('u-lead', 'weekly', '2026-09-23', NOW)
    expect(prev.held.inflow).toBe(1)
    const cur = buildReportModel('u-lead', 'weekly', '2026-10-02', NOW)
    expect(cur.held).toMatchObject({ start: 1, inflow: 0, completed: 1, end: 0, gap: 0 })
  })
})

describe('보유 기록·프로젝트', () => {
  it("C-3': 닫힌 기간의 7일 넘은 일과 지난 기간 값은 하루 마감 기록에서 읽고, 경영진 메일에 담긴다", () => {
    seedBase()
    db.prepare(`INSERT INTO held_daily (project_id, date, waiting, over7, updated_at) VALUES ('p1','2026-08-31',2,1,'x'), ('p1','2026-09-30',4,3,'x')`).run()
    const m = buildReportModel('u-lead', 'monthly', '2026-09-15', NOW)
    expect(m.held).toMatchObject({ end: 4, start: 2, over7: 3, prevOver7: 1 })
    const { html } = renderReportMail({ kind: 'exec', closed: m, now: null, money: v => `$${v}`, baseUrl: '', recipient: { userId: 'u-lead', name: '정팀장', locale: 'ko' } })
    expect(html).toMatch(/data-metric="closed\.held\.over7" data-value="3"/)
    // 기록 전의 줄(over7 NULL)이 섞이면 "기록 없음"
    db.prepare(`INSERT INTO held_daily (project_id, date, waiting, updated_at) VALUES ('p2','2026-09-30',1,'x')`).run()
    expect(buildReportModel('u-lead', 'monthly', '2026-09-15', NOW).held.over7).toBeNull()
  })

  it('수집기용: 프로젝트별 7일 넘게 보유 중인 일', () => {
    seedBase()
    stage('p1', 70, 'waiting', { scheduled_at: at('2026-09-20T09:00:00') })
    stage('p1', 71, 'waiting', { scheduled_at: at('2026-10-01T09:00:00') })
    stage('p2', 72, 'verify_waiting', { scheduled_at: at('2026-09-01T09:00:00') })
    stage('p2', 73, 'done', { scheduled_at: at('2026-09-01T09:00:00') })
    const m = agedHeldByProject(['p1', 'p2'], NOW)
    expect([m.get('p1'), m.get('p2')]).toEqual([1, 1])
  })

  it('B-5: 프로젝트별 사람 시간은 지난 기간 값도 함께 준다', () => {
    seedBase()
    exec({ id: 'ex-ext-b1', project_id: 'p1', issue_iid: 91, assignee_type: 'user', user_name: '박개발', status: 'success', started_at: at('2026-09-22T10:00:00'), ended_at: at('2026-09-22T11:00:00'), work_sec: 3600 })
    exec({ id: 'ex-ext-b2', project_id: 'p1', issue_iid: 92, assignee_type: 'user', user_name: '박개발', status: 'success', started_at: at('2026-09-29T10:00:00'), ended_at: at('2026-09-29T12:00:00'), work_sec: 7200 })
    const p1 = buildReportModel('u-lead', 'weekly', '2026-10-02', NOW).projects.find(p => p.id === 'p1')!
    expect([p1.humanHours, p1.prevHumanHours]).toEqual([2, 1])
  })
})

describe('사람·모델 식별', () => {
  it('담당자의 Git 숫자 id(공급자 일치)로도 확실히 식별한다', () => {
    seedBase()
    db.prepare(`INSERT INTO oauth_providers (id, type, name, base_url, client_id, client_secret) VALUES ('gl','gitlab','GL','x','x','x')`).run()
    db.prepare(`UPDATE users SET oauth_provider_id = 'gl', oauth_user_id = '77' WHERE id = 'u-park'`).run()
    stage('p2', 40, 'verify_waiting', { assignee_git_user_id: '77', assignee_username: 'renamed', assignee_name: 'Park', scheduled_at: at('2026-10-01T09:00:00') })
    expect(mineFrom(liveHeldAll(NOW), 'u-park').map(i => i.iid)).toEqual([40])
  })

  it('모델이 기록되지 않은 에이전트는 CLI 이름 + 모델 미기록 표시로 묶는다(문구는 화면이 번역)', () => {
    seedBase()
    db.prepare(`INSERT INTO agents (id, user_id, name, cli_name, cli_path) VALUES ('a1','u-lead','A','codex','codex')`).run()
    exec({ id: 'ex-m', project_id: 'p1', agent_id: 'a1', assignee_type: 'agent', issue_iid: 60, status: 'success', started_at: at('2026-08-01T10:00:00'), ended_at: at('2026-08-01T11:00:00'), verified_at: at('2026-08-02T10:00:00') })
    stage('p1', 60, 'done')
    const w = buildReportModel('u-lead', 'monthly', '2026-10-02', NOW).evaluation!.workers
    expect(w).toEqual([expect.objectContaining({ key: 'm:?codex', name: 'codex', modelUnknown: true, kind: 'agent' })])
  })
})

describe('D-1 잠정', () => {
  it('막 끝나 확정 전인 기간은 잠정이고 메일에도 밝힌다. 확정본은 잠정이 아니다', () => {
    seedBase()
    const early = getReportModel('u-lead', 'weekly', '2026-09-29', new Date('2026-10-06T00:00:00Z'))
    expect(early.provisional).toBe(true)
    const mail = renderReportMail({ kind: 'lead', closed: early, now: null, money: v => `$${v}`, baseUrl: '', recipient: { userId: 'u-lead', name: '정팀장', locale: 'ko' } })
    expect(mail.html).toContain('잠정 값')
    const final = getReportModel('u-lead', 'weekly', '2026-09-29', new Date('2026-10-09T00:00:00Z'))
    expect(final.provisional).toBeUndefined()
    expect(final.snapshotAt).toBeTruthy()
    expect(getReportModel('u-lead', 'weekly', '2026-10-02', NOW).provisional).toBeUndefined() // 진행 중
  })
})

describe('D-9 메일 = 모델 (모든 숫자 칸)', () => {
  /** 메일의 모든 data-metric 경로를 모델에서 찾아 data-value 와 대조한다 */
  function parity(html: string, ctx: { now?: ReportModel | null; closed: ReportModel; mine?: HeldIssue[] }) {
    const cells = [...html.matchAll(/data-metric="([^"]+)" data-value="([^"]*)"/g)]
    expect(cells.length).toBeGreaterThan(0)
    const paths: string[] = []
    for (const [, metric, values] of cells) {
      const vs = values.split('|')
      metric.split('|').forEach((path, i) => {
        const v = path.split('.').reduce<any>((o, k) => (o == null ? undefined : o[k]), ctx)
        expect(v, path).not.toBeUndefined()
        expect(vs[i], path).toBe(v == null ? '' : String(v))
        paths.push(path)
      })
    }
    return paths
  }
  function seedRich() {
    seedBase()
    db.prepare(`INSERT INTO held_daily (project_id, date, waiting, over7, updated_at) VALUES ('p1','2026-09-27',2,0,'x'), ('p1','2026-08-31',1,0,'x'), ('p1','2026-09-30',2,1,'x')`).run()
    for (let i = 0; i < 3; i++) stage('p1', 100 + i, 'waiting', { assign_mode: 'assignee', assignee_username: 'park', assignee_name: '박개발', scheduled_at: at('2026-09-10T09:00:00') })
    exec({ id: 'ex-f', project_id: 'p1', agent_id: 'a1', assignee_type: 'agent', issue_iid: 110, status: 'failed', started_at: at('2026-09-30T10:00:00'), ended_at: at('2026-09-30T10:30:00') })
    stage('p1', 110, 'dev_fail', { scheduled_at: at('2026-09-30T09:00:00') })
    exec({ id: 'ex-d', project_id: 'p1', agent_id: 'a1', assignee_type: 'agent', issue_iid: 120, status: 'success', model_name: 'claude-opus-5-5', started_at: at('2026-09-22T10:00:00'), ended_at: at('2026-09-22T11:00:00'), verified_at: at('2026-09-23T10:00:00') })
    stage('p1', 120, 'done', { scheduled_at: at('2026-09-22T09:00:00') })
    exec({ id: 'ex-ext-h', project_id: 'p1', issue_iid: 121, assignee_type: 'user', user_name: '박개발', status: 'success', started_at: at('2026-09-23T10:00:00'), ended_at: at('2026-09-23T12:00:00'), work_sec: 7200 })
    stage('p1', 121, 'done')
  }

  it('팀장·팀원 주간 메일', () => {
    seedRich()
    const now = buildReportModel('u-lead', 'weekly', '2026-10-02', NOW)
    const closed = buildReportModel('u-lead', 'weekly', '2026-09-23', NOW)
    const lead = renderReportMail({ kind: 'lead', closed, now, money: v => `$${v}`, baseUrl: 'https://ive', recipient: { userId: 'u-lead', name: '정팀장', locale: 'ko' } })
    const paths = parity(lead.html, { now, closed })
    expect(paths).toEqual(expect.arrayContaining(['now.held.end', 'now.held.start', 'now.actions.failed.length', 'now.actions.aged.length', 'now.actions.concentrations.0.count', 'now.held.people.0.count', 'closed.projects.0.humanHours', 'closed.done.total', 'closed.done.leadMedianH']))
    const mine = mineFrom(liveHeldAll(NOW), 'u-park')
    const member = renderReportMail({ kind: 'member', closed, now, mine, money: v => `$${v}`, baseUrl: 'https://ive', recipient: { userId: 'u-park', name: '박개발', locale: 'en' } })
    expect(parity(member.html, { now, closed, mine })).toEqual(expect.arrayContaining(['mine.0.ageHours', 'mine.2.ageHours']))
    expect(member.html).toContain('https://ive/?tab=reports&amp;mine=1')
  })

  it('경영진 월간 메일', () => {
    seedRich()
    // 위험(한 사람 의존·반려율 상승)·작업 결과 평가·사람 시간 비중 추이가 모두 나오게
    for (let i = 0; i < 12; i++) {
      const rej = i < 4
      exec({ id: `ex-verify-r${i}`, project_id: 'p1', issue_iid: 800 + i, assignee_type: 'user', user_id: 'u-lee', user_name: '이검증', status: rej ? 'failed' : 'success', stage_verdict: rej ? 'fail' : null, verified_at: rej ? null : at('2026-09-10T10:00:00'), started_at: at('2026-09-10T09:00:00'), ended_at: at('2026-09-10T10:00:00') })
    }
    for (let i = 0; i < 6; i++) exec({ id: `ex-verify-a${i}`, project_id: 'p1', issue_iid: 820 + i, assignee_type: 'user', user_id: 'u-lee', status: 'success', verified_at: at('2026-08-10T10:00:00'), started_at: at('2026-08-10T09:00:00'), ended_at: at('2026-08-10T10:00:00') })
    for (let i = 0; i < 3; i++) {
      exec({ id: `ex-ev${i}`, project_id: 'p1', agent_id: 'a1', assignee_type: 'agent', issue_iid: 840 + i, status: 'success', model_name: 'claude-opus-5-5', started_at: at('2026-07-10T10:00:00'), ended_at: at('2026-07-10T11:00:00'), verified_at: at('2026-07-11T10:00:00') })
      stage('p1', 840 + i, 'done')
      exec({ id: `ex-ext-m${i}`, project_id: i ? 'p2' : 'p1', issue_iid: 860 + i, assignee_type: 'user', user_name: '박개발', status: 'success', started_at: at(`2026-0${7 + i}-15T10:00:00`), ended_at: at(`2026-0${7 + i}-15T12:00:00`), work_sec: 7200 })
    }
    const closed = buildReportModel('u-lead', 'monthly', '2026-09-15', NOW)
    const mail = renderReportMail({ kind: 'exec', closed, now: null, money: v => `$${v}`, baseUrl: '', recipient: { userId: 'u-lead', name: '정팀장', locale: 'ko' } })
    const paths = parity(mail.html, { closed })
    expect(paths).toEqual(expect.arrayContaining(['closed.done.total', 'closed.held.end', 'closed.held.start', 'closed.held.inflow', 'closed.held.over7', 'closed.cost.aiActual', 'closed.months.0.completed',
      'closed.risks.concentrations.0.share', 'closed.risks.rejectRate', 'closed.risks.prevRejectRate', 'closed.evaluation.groups.0.passRate', 'closed.months.5.projectShares.1.share']))
    expect(paths.some(p => /^closed\.evaluation\.workers\.\d+\./.test(p))).toBe(true)
    // 사람별 평가 결과는 메일에 싣지 않는다
    for (const w of closed.evaluation!.workers.filter(w => !w.key.startsWith('m:'))) expect(mail.html).not.toContain(`closed.evaluation.workers.${closed.evaluation!.workers.indexOf(w)}.`)
  })
})

describe('발송', () => {
  it('C-7: 보내지 못한 주소는 다음 확인 때 다시 보내고, 이미 보낸 주소는 건너뛴다', async () => {
    seedBase()
    vi.useFakeTimers({ now: NOW, toFake: ['Date'] })
    try {
      const schedule = { id: 'rs-retry', reportType: 'weekly', enabled: true, recipients: ['lead@x.com', 'lee@x.com'], sendDay: 1, sendHour: 9 } as any
      db.prepare(`UPDATE users SET is_admin = 1 WHERE id = 'u-lee'`).run() // 둘 다 팀장 메일(내용이 없어도 보낸다)
      mailMock.sendMail.mockImplementationOnce(async () => { throw new Error('SMTP 421') })
      const first = await sendReport(schedule)
      expect(first).toEqual({ sent: 1, skipped: 0, failed: 1 })
      const second = await sendReport(schedule)
      expect(second).toEqual({ sent: 1, skipped: 1, failed: 0 })
    } finally { vi.useRealTimers() }
  })

  it('수신을 끈 사람은 모델을 만들지 않고 건너뛴다', async () => {
    seedBase()
    db.prepare(`UPDATE users SET report_mail_unsubscribed = 1 WHERE id = 'u-lead'`).run()
    const { buildReportMailFor } = await import('@/lib/report-mailer')
    const { getUserById } = await import('@/lib/db')
    expect(buildReportMailFor(getUserById('u-lead')!, 'weekly', '2026-09-21')).toMatchObject({ skip: 'unsubscribed', html: '' })
  })
})

describe('표기', () => {
  it('시간 표기는 전체를 먼저 반올림한다(23.6시간 → 1일, 47.6시간 → 2일)', () => {
    const tr = (k: string, p?: Record<string, string | number>) => `${k}${p ? JSON.stringify(p) : ''}`
    expect(fmtHours(tr, 23.6)).toBe('durDay{"d":1}')
    expect(fmtHours(tr, 47.6)).toBe('durDay{"d":2}')
    expect(fmtHours(tr, 25.4)).toBe('durDayHour{"d":1,"h":1}')
    expect(fmtHours(tr, 0.2)).toBe('durMin{"m":12}')
    expect(fmtHours(tr, null)).toBe('noRecord')
  })

  it('후속 이슈 연결은 같은 프로젝트의 #번호만 — 다른 프로젝트 참조는 무시', () => {
    expect(parseIveMetaFixes('<!-- ive-meta\nfixes: #12, group/proj#34, other#5 (#7)\n-->')).toEqual([12, 7])
  })
})

describe('재검증 4차에서 찾은 결함', () => {
  it('지금 사이클도 실제로 완료로 옮겨진 사건 시각이 완료 시각이다(처리 끝난 금요일이 아니라 완료한 화요일)', () => {
    seedBase()
    db.prepare(`INSERT INTO held_daily (project_id, date, updated_at) VALUES ('p1','2026-09-13','x'), ('p1','2026-09-20','x'), ('p1','2026-09-27','x')`).run()
    db.prepare(`UPDATE held_daily SET verify_waiting = 1 WHERE date = '2026-09-20'`).run()
    exec({ id: 'ex-d1', project_id: 'p1', agent_id: 'a1', assignee_type: 'agent', issue_iid: 1, status: 'success', started_at: at('2026-09-18T10:00:00'), ended_at: at('2026-09-18T11:00:00') })
    ev(1, null, 'dev', '2026-09-18T09:00:00')
    ev(1, 'dev', 'verify_waiting', '2026-09-18T11:00:00')
    ev(1, 'verify_waiting', 'done', '2026-09-22T10:00:00')
    stage('p1', 1, 'done')
    expect(buildReportModel('u-lead', 'weekly', '2026-09-16', NOW).held).toMatchObject({ start: 0, inflow: 1, completed: 0, end: 1, gap: 0 })
    const w2 = buildReportModel('u-lead', 'weekly', '2026-09-23', NOW)
    expect(w2.held).toMatchObject({ start: 1, inflow: 0, completed: 1, end: 0, gap: 0 })
    expect(w2.done.leadMedianH).toBeCloseTo(4 * 24 + 1)
  })

  it('한 기간에 두 사이클(접수→완료→재오픈)이 있어도 보유 식이 맞는다', () => {
    seedBase()
    db.prepare(`INSERT INTO held_daily (project_id, date, updated_at) VALUES ('p1','2026-09-27','x')`).run()
    exec({ id: 'ex-c1', project_id: 'p1', agent_id: 'a1', assignee_type: 'agent', issue_iid: 2, status: 'success', started_at: at('2026-09-28T10:00:00'), ended_at: at('2026-09-28T11:00:00') })
    ev(2, null, 'waiting', '2026-09-28T09:00:00')
    ev(2, 'waiting', 'done', '2026-09-28T12:00:00')
    ev(2, 'done', 'waiting', '2026-09-29T09:00:00')
    stage('p1', 2, 'waiting')
    const m = buildReportModel('u-lead', 'weekly', '2026-10-02', NOW)
    expect(m.held).toMatchObject({ start: 0, inflow: 2, completed: 1, end: 1, gap: 0 })
  })

  it('사람이 취소한 검증·확인은 반려가 아니고, 까닭이 반려(fail)면 곧바로 닫혀도 반려다', () => {
    seedBase()
    for (let i = 0; i < 4; i++) exec({ id: `ex-verify-ok${i}`, project_id: 'p1', issue_iid: 600 + i, assignee_type: 'user', user_id: 'u-lee', status: 'success', verified_at: at('2026-09-16T10:00:00'), started_at: at('2026-09-16T09:00:00'), ended_at: at('2026-09-16T10:00:00') })
    exec({ id: 'ex-verify-cx', project_id: 'p1', issue_iid: 610, assignee_type: 'user', user_id: 'u-lee', status: 'failed', stage_verdict: 'cancelled', started_at: at('2026-09-17T09:00:00'), ended_at: at('2026-09-17T10:00:00') })
    exec({ id: 'ex-verify-rj', project_id: 'p1', issue_iid: 611, assignee_type: 'user', user_id: 'u-lee', status: 'failed', stage_verdict: 'fail', started_at: at('2026-09-17T09:00:00'), ended_at: at('2026-09-17T10:00:00') })
    ev(611, 'verifying', 'closed', '2026-09-17T10:01:00')
    expect(buildReportModel('u-lead', 'monthly', '2026-09-15', NOW).risks?.rejectRate).toBeCloseTo(1 / 5)
  })

  it('실행 없이 완료로 옮겨진 재작업 사이클도 완료다(유입만 남아 식이 어긋나지 않게)', () => {
    seedBase()
    exec({ id: 'ex-r1', project_id: 'p1', agent_id: 'a1', assignee_type: 'agent', issue_iid: 3, status: 'success', started_at: at('2026-09-01T10:00:00'), ended_at: at('2026-09-01T11:00:00'), verified_at: at('2026-09-02T10:00:00') })
    ev(3, null, 'verifying', '2026-09-01T11:00:00')
    ev(3, 'verifying', 'done', '2026-09-02T10:00:00')
    ev(3, 'done', 'dev', '2026-09-29T09:00:00')
    ev(3, 'dev', 'done', '2026-09-30T09:00:00')
    stage('p1', 3, 'done')
    const m = buildReportModel('u-lead', 'weekly', '2026-10-02', NOW)
    expect(m.completedList.map(i => i.completedAt)).toEqual([at('2026-09-30T09:00:00')])
    expect(m.held.inflow).toBe(1)
  })

  it("옛 형식(datetime('now'): 'YYYY-MM-DD HH:MM:SS') 시각도 읽는다", () => {
    seedBase()
    exec({ id: 'ex-old', project_id: 'p1', agent_id: 'a1', assignee_type: 'agent', issue_iid: 4, status: 'success', started_at: '2026-09-29 01:00:00', ended_at: '2026-09-29 02:00:00' })
    stage('p1', 4, 'done', { scheduled_at: '2026-09-29 00:00:00' })
    const m = buildReportModel('u-lead', 'weekly', '2026-10-02', NOW)
    expect(m.completedList.map(i => [i.iid, i.completedAt, i.leadH])).toEqual([[4, '2026-09-29T02:00:00.000Z', 2]])
  })

  it('같은 건수로 둘이 들고 있으면 한 사람 쏠림이 아니다', () => {
    seedBase()
    for (let i = 0; i < 3; i++) {
      stage('p1', 700 + i, 'waiting', { assign_mode: 'assignee', assignee_username: 'park', assignee_name: '박개발', scheduled_at: at('2026-09-30T09:00:00') })
      stage('p1', 710 + i, 'waiting', { assign_mode: 'assignee', assignee_username: 'lee', assignee_name: '이검증', scheduled_at: at('2026-09-30T09:00:00') })
    }
    expect(buildReportModel('u-lead', 'weekly', '2026-10-02', NOW).actions?.concentrations).toEqual([])
  })

  it('반려 판정·이력 쿼리는 이슈 인덱스를 탄다(사건 전체를 훑지 않는다)', () => {
    const plan = (sql: string) => (db.prepare(`EXPLAIN QUERY PLAN ${sql}`).all() as { detail: string }[]).map(r => r.detail).join(' / ')
    const sub = plan(`SELECT 1 FROM task_executions v WHERE v.id LIKE 'ex-verify-%' AND NOT EXISTS (SELECT 1 FROM issue_events ce WHERE +ce.event = 'stage' AND ce.to_stage = 'closed' AND ce.project_id = v.project_id AND ce.issue_iid = v.issue_iid)`)
    expect(sub).toContain('idx_issue_events_issue')
    expect(plan(`SELECT * FROM issue_events x WHERE +x.event = 'stage' AND project_id IN ('p1','p2') ORDER BY id`)).not.toContain('idx_issue_events_kind')
  })

  it('계정이 없는 주소의 실패는 기간마다 한 번만 기록한다', async () => {
    seedBase()
    vi.useFakeTimers({ now: NOW, toFake: ['Date'] })
    try {
      const schedule = { id: 'rs-noacct', reportType: 'weekly', enabled: true, recipients: ['nobody@else.com'], sendDay: 1, sendHour: 9 } as any
      expect(await sendReport(schedule)).toEqual({ sent: 0, skipped: 0, failed: 1 })
      expect(await sendReport(schedule)).toEqual({ sent: 0, skipped: 1, failed: 0 })
      expect((db.prepare(`SELECT COUNT(*) AS c FROM report_send_logs`).get() as { c: number }).c).toBe(1)
    } finally { vi.useRealTimers() }
  })
})

describe('재검증 5차에서 찾은 결함', () => {
  it('시간대 표기가 섞인 시각도 같은 기준(UTC)으로 맞춘다', async () => {
    const { isoTime } = await import('@/lib/report-model/load')
    expect(isoTime('2026-09-29T11:00:00+09:00')).toBe('2026-09-29T02:00:00.000Z')
    expect(isoTime('2026-09-29 02:00:00')).toBe('2026-09-29T02:00:00.000Z')
    expect(isoTime('2026-09-29T02:00:00.000Z')).toBe('2026-09-29T02:00:00.000Z')
    expect(isoTime('garbage')).toBeNull()
  })

  it('옛 형식 시각의 처리 기록도 서버 시간대와 무관하게 같은 값(사람을 기다린 비중)', () => {
    const tz = process.env.TZ
    process.env.TZ = 'Asia/Seoul'
    try {
      seedBase()
      exec({ id: 'ex-o', project_id: 'p1', agent_id: 'a1', assignee_type: 'agent', issue_iid: 5, status: 'success', started_at: '2026-09-29 01:00:00', ended_at: '2026-09-29 02:00:00', verified_at: '2026-09-29 04:00:00' })
      stage('p1', 5, 'done', { scheduled_at: '2026-09-29 00:00:00' })
      const d = buildReportModel('u-lead', 'weekly', '2026-10-02', NOW).done
      expect(d.leadMedianH).toBeCloseTo(4)
      expect(d.humanWaitShare).toBeCloseTo(2 / 4)
    } finally { process.env.TZ = tz }
  })

  it('지우지 못한 지난 사이클의 확인 완료 시각을 이번 사이클 완료로 쓰지 않는다', () => {
    seedBase()
    exec({ id: 'ex-s1', project_id: 'p1', agent_id: 'a1', assignee_type: 'agent', issue_iid: 6, status: 'success', started_at: at('2026-09-01T10:00:00'), ended_at: at('2026-09-01T11:00:00') })
    ev(6, null, 'confirming', '2026-09-01T12:00:00')
    ev(6, 'confirming', 'done', '2026-09-02T10:00:00')
    ev(6, 'done', 'dev', '2026-09-29T09:00:00')
    exec({ id: 'ex-s2', project_id: 'p1', agent_id: 'a1', assignee_type: 'agent', issue_iid: 6, status: 'success', started_at: at('2026-09-29T10:00:00'), ended_at: at('2026-09-29T11:00:00') })
    ev(6, 'dev', 'done', '2026-09-30T10:00:00')
    stage('p1', 6, 'done', { confirmed_at: at('2026-09-02T10:00:00') })
    expect(buildReportModel('u-lead', 'weekly', '2026-10-02', NOW).completedList.map(i => i.completedAt)).toEqual([at('2026-09-30T10:00:00')])
  })
})
