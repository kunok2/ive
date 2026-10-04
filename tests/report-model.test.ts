/**
 * 보고서 모델(화면·메일 공용) 불변식 — DB 는 실제 스키마(initSchema), 메일 전송만 가짜.
 *
 * R-1 기간: 주간은 월요일 시작, 끝은 미포함, 서버 시간대와 무관하다. 지난 기간·월말·연말 경계.
 * R-2 사람 작업시간: 같은 사람이 같은 시간에 연 작업은 한 번만 세고, 그 시간은 프로젝트끼리 나눈다.
 * R-3 통계: 중앙값·분위수·Wilson 구간·필요 표본 수·결과 등급·모델 이름 정규화.
 * R-4 보유 식: 기초 + 유입 − 완료 = 기말 이 맞는 데이터에서 gap = 0. 진행 중 기간은 지금 건수(issue_stages)를 쓴다.
 * R-5 일의 형태: 에이전트 처리 / 사람 처리 / 직접 처리(사후 기록)를 구분하고, 처리 기간에서 사후 기록은 뺀다.
 * R-6 범위: 공유받지 않은 프로젝트는 보고서에 나오지 않는다(메일도 같은 범위).
 * R-7 지금 손쓸 것: AI 실패·7일 넘은 일·한 사람 쏠림(역할마다, 그 역할 보유의 절반 이상, 3건 이상).
 * R-8 메일 = 화면: 메일의 모든 숫자 칸(data-metric)의 값(data-value)이 보고서 모델의 그 경로 값과 같다.
 * R-9 발송: IVE 계정이 없는 주소에는 보내지 않고 기록만 남긴다. 팀장/팀원 메일 구분.
 * R-10 확정본: 끝나고 3일이 지난 기간은 처음 계산한 값을 저장하고 그 값을 돌려준다. 그 전에는 늦게 들어온 기록도 반영한다.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import Database from 'better-sqlite3'

const mailMock = vi.hoisted(() => ({ sendMail: vi.fn(async () => ({})) }))
vi.mock('@/lib/mail', () => ({ createTransporter: () => ({ sendMail: mailMock.sendMail }), getFromAddress: () => 'ive@test' }))

import { initSchema } from '@/lib/db/schema'
import { periodOf, previousPeriod, isClosed, buckets, kstDayStartISO } from '@/lib/report-model/period'
import { allocateWork, median, quantile, wilson, requiredSamplePerGroup, gradeOf, normalizeModel, businessSegmentsKST } from '@/lib/report-model/compute'
import { buildReportModel, liveHeldAll, mineFrom } from '@/lib/report-model/build'
import { getReportModel } from '@/lib/report-model'
import { renderReportMail } from '@/lib/report-mailer/render'
import { sendReport, weeklyKindFor } from '@/lib/report-mailer'
import { unresolvedPersonNames, setPersonAlias } from '@/lib/db'

let db: Database.Database
const H = 3_600_000
// 기준 시각: 2026-10-02(금) 15:00 KST — 이번 주는 9/28(월)~10/5
const NOW = new Date('2026-10-02T06:00:00Z')
const iso = (ms: number) => new Date(ms).toISOString()
const kst = (s: string) => new Date(`${s}+09:00`).getTime()

beforeEach(() => {
  db = new Database(':memory:')
  initSchema(db)
  ;(globalThis as any).db = db
  db.pragma('foreign_keys = OFF')
  mailMock.sendMail.mockClear()
})
afterEach(() => { db.close(); (globalThis as any).db = undefined })

function seedBase() {
  db.prepare(`INSERT INTO users (id, email, name, is_admin) VALUES ('u-lead','lead@x.com','정팀장',0), ('u-park','park@x.com','박개발',0), ('u-lee','lee@x.com','이검증',0), ('u-out','out@x.com','외부인',0)`).run()
  db.prepare(`INSERT INTO projects (id, user_id, name, repo_url, access_token, provider) VALUES ('p1','u-lead','Shop','https://x','t','gitlab'), ('p2','u-lead','Portal','https://x','t','gitlab'), ('p3','u-out','Secret','https://x','t','gitlab')`).run()
  db.prepare(`INSERT INTO project_shares (id, project_id, user_id, role) VALUES ('s1','p1','u-park','viewer'), ('s2','p1','u-lee','viewer'), ('s3','p2','u-park','viewer')`).run()
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

describe('R-1 기간', () => {
  it('주간은 월요일 시작이고 일요일 날짜도 같은 주에 속한다', () => {
    expect(periodOf('weekly', '2026-10-02')).toEqual({ type: 'weekly', start: '2026-09-28', end: '2026-10-05' })
    expect(periodOf('weekly', '2026-10-04')).toEqual({ type: 'weekly', start: '2026-09-28', end: '2026-10-05' })
    expect(periodOf('weekly', '2026-09-28').start).toBe('2026-09-28')
    expect(previousPeriod(periodOf('weekly', '2026-10-02'))).toMatchObject({ start: '2026-09-21', end: '2026-09-28' })
  })
  it('월·연 경계와 지난 기간', () => {
    expect(periodOf('monthly', '2026-12-15')).toMatchObject({ start: '2026-12-01', end: '2027-01-01' })
    expect(previousPeriod(periodOf('monthly', '2026-01-10'))).toMatchObject({ start: '2025-12-01', end: '2026-01-01' })
    expect(periodOf('yearly', '2026-06-01')).toMatchObject({ start: '2026-01-01', end: '2027-01-01' })
    expect(buckets(periodOf('yearly', '2026-06-01'))).toHaveLength(12)
    expect(buckets(periodOf('monthly', '2026-02-10'))).toHaveLength(28)
  })
  it('닫힘 판정은 KST 기준이다 — 일요일 23시(KST)는 아직 그 주다', () => {
    const p = periodOf('weekly', '2026-10-02')
    expect(isClosed(p, new Date('2026-10-04T14:59:00Z'))).toBe(false)
    expect(isClosed(p, new Date('2026-10-04T15:00:00Z'))).toBe(true)
    expect(kstDayStartISO('2026-10-05')).toBe('2026-10-04T15:00:00.000Z')
  })
})

describe('R-2 사람 작업시간', () => {
  it('같은 사람의 겹친 시간은 한 번만, 그 시간은 프로젝트끼리 나눈다', () => {
    const t0 = Date.UTC(2026, 9, 1, 0)
    const a = allocateWork([
      { person: 'A', projectId: 'p1', start: t0, end: t0 + 2 * H },
      { person: 'A', projectId: 'p2', start: t0 + H, end: t0 + 3 * H },
      { person: 'B', projectId: 'p1', start: t0, end: t0 + H },
    ])
    expect(a.personMinutes.get('A')).toBe(180)
    expect(a.personRawMinutes.get('A')).toBe(240)
    expect(a.personMinutes.get('B')).toBe(60)
    // p1: A 1h 단독 + 0.5h(겹친 1h 의 절반) + B 1h = 150분, p2: 0.5h + 1h = 90분
    expect(a.projectMinutes.get('p1')).toBe(150)
    expect(a.projectMinutes.get('p2')).toBe(90)
  })
  it('근무시간 조각: 평일 09~18 KST 만 남는다', () => {
    const segs = businessSegmentsKST(kst('2026-10-02T17:00:00'), kst('2026-10-05T10:00:00')) // 금 17시 ~ 월 10시
    const mins = segs.reduce((s, [a, b]) => s + (b - a) / 60000, 0)
    expect(mins).toBe(60 + 60)
  })
})

describe('R-3 통계', () => {
  it('중앙값·분위수·구간·필요 표본·등급·모델명', () => {
    expect(median([5, 1, 3])).toBe(3)
    expect(median([])).toBeNull()
    expect(quantile([1, 2, 3, 4, 5, 6, 7, 8, 9, 10], 0.9)).toBeCloseTo(9.1)
    const w = wilson(27, 37)!
    expect(w.low).toBeGreaterThan(0.55); expect(w.high).toBeLessThan(0.86)
    expect(requiredSamplePerGroup(0.72, 0.55)).toBeGreaterThan(100)
    expect(requiredSamplePerGroup(0.5, 0.5)).toBeNull()
    expect(gradeOf({ runs: 1, rejects: 0, overturned: false })).toBe('pass')
    expect(gradeOf({ runs: 2, rejects: 0, overturned: false })).toBe('rerun')
    expect(gradeOf({ runs: 1, rejects: 1, overturned: false })).toBe('rejected_pass')
    expect(gradeOf({ runs: 3, rejects: 2, overturned: false })).toBe('rejected_repeat')
    expect(gradeOf({ runs: 1, rejects: 0, overturned: true })).toBe('overturned')
    expect(normalizeModel('claude-opus-4-8[1m]')).toBe('claude-opus-4-8')
    expect(normalizeModel('')).toBeNull()
  })
})

/** 이번 주: 지난주 말 보유 2건(#1 대기, #2 검증대기) → 이번 주 #3 접수, #2 완료, #4 직접처리(접수·완료) */
function seedWeek() {
  seedBase()
  // 지난주 말(9/27) 마감 보유: p1 2건
  db.prepare(`INSERT INTO held_daily (project_id, date, waiting, verify_waiting, updated_at) VALUES ('p1','2026-09-27',1,1,'x')`).run()
  // #1 지난주 접수, 아직 처리 대기(박개발이 담당자 모드로 맡음)
  stage('p1', 1, 'waiting', { scheduled_at: iso(kst('2026-09-25T10:00:00')), assign_mode: 'assignee', assignee_username: 'park', assignee_name: '박개발' })
  // #2 지난주 에이전트 처리 → 이번 주 검증 승인·완료
  exec({ id: 'ex-2', project_id: 'p1', agent_id: 'a1', assignee_type: 'agent', issue_iid: 2, status: 'success', started_at: iso(kst('2026-09-26T10:00:00')), ended_at: iso(kst('2026-09-26T11:00:00')), model_name: 'claude-opus-5-5', verified_at: iso(kst('2026-09-29T10:00:00')) })
  exec({ id: 'ex-verify-2', project_id: 'p1', issue_iid: 2, assignee_type: 'user', user_id: 'u-lee', user_name: '이검증', status: 'success', started_at: iso(kst('2026-09-29T09:00:00')), verify_started_at: iso(kst('2026-09-29T09:00:00')), ended_at: iso(kst('2026-09-29T10:00:00')), verified_at: iso(kst('2026-09-29T10:00:00')) })
  stage('p1', 2, 'done', { scheduled_at: iso(kst('2026-09-26T09:00:00')), confirmed_at: iso(kst('2026-09-29T12:00:00')) })
  // #3 이번 주 접수, 에이전트가 실패해 멈춤
  exec({ id: 'ex-3', project_id: 'p1', agent_id: 'a1', assignee_type: 'agent', issue_iid: 3, status: 'failed', started_at: iso(kst('2026-09-30T10:00:00')), ended_at: iso(kst('2026-09-30T10:30:00')), model_name: 'claude-opus-5-5' })
  stage('p1', 3, 'dev_fail', { scheduled_at: iso(kst('2026-09-30T09:00:00')) })
  // #4 이번 주 직접 처리(사후 기록)
  exec({ id: 'ex-ext-4', project_id: 'p2', issue_iid: 4, assignee_type: 'user', user_name: '박개발', status: 'success', started_at: iso(kst('2026-10-01T10:00:00')), ended_at: iso(kst('2026-10-01T12:00:00')), work_sec: 7200, input_tokens: 1000, output_tokens: 100, cost_usd: 1, model_name: 'claude-opus-5-5' })
  stage('p2', 4, 'done')
  // 비밀 프로젝트(공유 안 됨)
  stage('p3', 9, 'waiting', { scheduled_at: iso(kst('2026-09-30T09:00:00')) })
  exec({ id: 'ex-9', project_id: 'p3', agent_id: 'a1', assignee_type: 'agent', issue_iid: 9, status: 'success', started_at: iso(kst('2026-09-30T09:00:00')), ended_at: iso(kst('2026-09-30T10:00:00')) })
}

describe('R-4·R-5·R-6 주간 모델', () => {
  it('보유 식이 맞고, 지금 건수는 issue_stages 에서 센다', () => {
    seedWeek()
    const m = buildReportModel('u-lead', 'weekly', '2026-10-02', NOW)
    expect(m.isCurrent).toBe(true)
    expect(m.held.live).toBe(true)
    expect(m.held.start).toBe(2)
    expect(m.held.inflow).toBe(2)     // #3, #4
    expect(m.held.completed).toBe(2)  // #2, #4
    expect(m.held.end).toBe(2)        // #1, #3
    expect(m.held.gap).toBe(0)
  })

  it('일의 형태를 구분하고, 처리 기간에서 사후 기록은 뺀다', () => {
    seedWeek()
    const m = buildReportModel('u-lead', 'weekly', '2026-10-02', NOW)
    expect(m.done.byForm).toEqual({ agent: 1, human: 0, direct: 1 })
    // #2: 접수 9/26 09:00 → 완료 9/29 12:00 = 75시간. 직접 처리 #4 는 빠진다
    expect(m.done.leadMedianH).toBeCloseTo(75)
    expect(m.done.firstPass).toBe(1)
  })

  it('공유받지 않은 프로젝트는 나오지 않는다', () => {
    seedWeek()
    const lead = buildReportModel('u-lead', 'weekly', '2026-10-02', NOW)
    expect(lead.projects.map(p => p.name)).not.toContain('Secret')
    const park = buildReportModel('u-park', 'weekly', '2026-10-02', NOW)
    expect(park.held.end).toBe(2) // p1 #1·#3 — p3 #9 는 공유받지 않았다
    const lee = buildReportModel('u-lee', 'weekly', '2026-10-02', NOW)
    expect(lee.done.byForm.direct).toBe(0) // p2(직접 처리)는 이검증에게 공유되지 않았다
  })

  it('R-7 AI 실패와 사람 손 보유', () => {
    seedWeek()
    const m = buildReportModel('u-lead', 'weekly', '2026-10-02', NOW)
    expect(m.actions?.failed.map(f => f.iid)).toEqual([3])
    expect(m.held.people).toEqual([expect.objectContaining({ name: '박개발', role: 'process', count: 1 })])
    expect(m.actions?.concentrations).toEqual([]) // 1건뿐이면 쏠림이 아니다(3건 이상)
  })

  it('R-7 한 사람 쏠림은 역할마다 본다 — 그 역할을 혼자 들고 있어도 3건 이상이면 쏠림', () => {
    seedBase()
    db.prepare(`UPDATE users SET gitlab_username = 'park' WHERE id = 'u-park'`).run()
    db.prepare(`UPDATE users SET gitlab_username = 'lee' WHERE id = 'u-lee'`).run()
    for (let i = 0; i < 3; i++) stage('p1', 300 + i, 'verify_waiting', { assignee_username: 'lee', assignee_name: '이검증', scheduled_at: iso(kst('2026-09-30T09:00:00')) })
    for (let i = 0; i < 4; i++) stage('p1', 310 + i, 'waiting', { assign_mode: 'assignee', assignee_username: 'park', assignee_name: '박개발', scheduled_at: iso(kst('2026-09-30T09:00:00')) })
    stage('p1', 320, 'waiting', { assign_mode: 'assignee', assignee_username: 'lead', assignee_name: '정팀장', scheduled_at: iso(kst('2026-09-30T09:00:00')) })
    const m = buildReportModel('u-lead', 'weekly', '2026-10-02', NOW)
    expect(m.actions?.concentrations.map(c => [c.role, c.name, c.count, c.roleTotal, c.roleHolders])).toEqual([
      ['process', '박개발', 4, 5, 2],
      ['verify', '이검증', 3, 3, 1],
    ])
  })
})

describe('R-8 메일 = 화면', () => {
  it('메일의 숫자 칸은 보고서 모델의 값이다', () => {
    seedWeek()
    const now = buildReportModel('u-lead', 'weekly', '2026-10-02', NOW)
    const closed = buildReportModel('u-lead', 'weekly', '2026-09-25', NOW)
    const { subject, html } = renderReportMail({ kind: 'lead', closed, now, money: v => `$${v.toFixed(2)}`, baseUrl: 'https://ive', recipient: { userId: 'u-lead', name: '정팀장', locale: 'ko' } })
    const metric = (k: string) => [...html.matchAll(new RegExp(`data-metric="${k.replace(/\./g, '\\.')}"[^>]*>([^<]*)<`, 'g'))].map(x => x[1])
    expect(metric('now.held.end')).toEqual([`${now.held.end}건`, `${now.held.end}`]) // 큰 숫자와 보유 식
    expect(metric('now.actions.failed.length')).toEqual([`${now.actions!.failed.length}건`])
    expect(metric('closed.done.total')).toEqual([`${closed.done.total}건`])
    expect(subject).toContain(`안고 있는 일 ${now.held.end}건`)
    expect(subject).toContain(`지난주 완료 ${closed.done.total}건`)
  })

  it('팀원 메일은 그 사람 손에 있는 일만 담는다', () => {
    seedWeek()
    db.prepare(`UPDATE users SET gitlab_username = 'park' WHERE id = 'u-park'`).run()
    const now = buildReportModel('u-park', 'weekly', '2026-10-02', NOW)
    const closed = buildReportModel('u-park', 'weekly', '2026-09-25', NOW)
    const all = liveHeldAll(NOW)
    const park = renderReportMail({ kind: 'member', closed, now, mine: mineFrom(all, 'u-park'), money: v => `$${v}`, baseUrl: '', recipient: { userId: 'u-park', name: '박개발', locale: 'ko' } })
    expect(park.subject).toContain('내 손에 1건')
    expect(park.html).toContain('#1 이슈 1')
    const lee = renderReportMail({ kind: 'member', closed, now, mine: mineFrom(all, 'u-lee'), money: v => `$${v}`, baseUrl: '', recipient: { userId: 'u-lee', name: '이검증', locale: 'en' } })
    expect(lee.subject).toContain('0 on your plate')
    expect(lee.html).not.toContain('#1 이슈 1')
  })
})

describe('R-9 발송', () => {
  it('IVE 계정이 없는 주소는 보내지 않고 기록하며, 팀장·팀원 메일을 구분한다', async () => {
    seedWeek()
    expect(weeklyKindFor({ id: 'u-lead', isAdmin: false })).toBe('lead')
    expect(weeklyKindFor({ id: 'u-park', isAdmin: false })).toBe('member')
    vi.useFakeTimers({ now: NOW, toFake: ['Date'] })
    try {
      const r = await sendReport({ id: 'rs-weekly', reportType: 'weekly', enabled: true, recipients: ['lead@x.com', 'park@x.com', 'nobody@else.com'], sendDay: 1, sendHour: 9 } as any, { force: true })
      expect(r).toEqual({ sent: 2, skipped: 0, failed: 1 })
      const subjects = mailMock.sendMail.mock.calls.map((c: any[]) => c[0].subject as string)
      expect(subjects.some(s => s.includes('지난주 완료'))).toBe(true)
      expect(subjects.some(s => s.includes('내 손에'))).toBe(true)
      const log = db.prepare(`SELECT status, error_message FROM report_send_logs WHERE recipient_email = 'nobody@else.com'`).get() as any
      expect(log.status).toBe('failed')
      expect(log.error_message).toContain('IVE 계정')
    } finally { vi.useRealTimers() }
  })
})

describe('R-10 확정본', () => {
  it('끝난 지 3일이 안 됐으면 확정하지 않고, 늦게 들어온 사후 기록도 반영한다', () => {
    seedWeek()
    const early = getReportModel('u-lead', 'weekly', '2026-09-29', new Date('2026-10-06T00:00:00Z'))
    expect(early.snapshotAt).toBeUndefined()
    exec({ id: 'ex-ext-6', project_id: 'p1', issue_iid: 6, assignee_type: 'user', user_name: '박개발', status: 'success', started_at: iso(kst('2026-10-02T10:00:00')), ended_at: iso(kst('2026-10-02T11:00:00')), work_sec: 3600 })
    stage('p1', 6, 'done')
    const later = getReportModel('u-lead', 'weekly', '2026-09-29', new Date('2026-10-06T01:00:00Z'))
    expect(later.done.total).toBe(early.done.total + 1)
  })

  it('닫힌 기간은 처음 계산한 값을 돌려준다', () => {
    seedWeek()
    const first = getReportModel('u-lead', 'weekly', '2026-09-29', new Date('2026-10-09T00:00:00Z'))
    expect(first.snapshotAt).toBeTruthy()
    // 기간 안에 완료가 하나 더 생겨도 확정본은 그대로
    exec({ id: 'ex-ext-5', project_id: 'p1', issue_iid: 5, assignee_type: 'user', user_name: '박개발', status: 'success', started_at: iso(kst('2026-10-01T10:00:00')), ended_at: iso(kst('2026-10-01T11:00:00')), work_sec: 3600 })
    stage('p1', 5, 'done')
    const again = getReportModel('u-lead', 'weekly', '2026-09-29', new Date('2026-10-09T00:00:00Z'))
    expect(again.done.total).toBe(first.done.total)
    expect(again.snapshotAt).toBe(first.snapshotAt)
  })

  it('프로젝트 주제색은 확정하지 않는다 — 색 도입 전 확정본도, 색을 바꾼 뒤에도 지금 색으로 그린다', () => {
    seedWeek()
    db.prepare(`UPDATE projects SET color = '#60a5fa' WHERE id = 'p1'`).run()
    const first = getReportModel('u-lead', 'weekly', '2026-09-29', new Date('2026-10-09T00:00:00Z'))
    expect(first.projects.find(p => p.id === 'p1')?.color).toBe('#60a5fa')
    // 색 도입 전에 저장된 확정본 — payload 에 color 가 없다
    const row = db.prepare(`SELECT id, payload FROM report_snapshots`).get() as { id: string; payload: string }
    const legacy = JSON.parse(row.payload)
    legacy.projects.forEach((p: any) => { delete p.color })
    db.prepare(`UPDATE report_snapshots SET payload = ? WHERE id = ?`).run(JSON.stringify(legacy), row.id)
    db.prepare(`UPDATE projects SET color = '#f472b6' WHERE id = 'p1'`).run()
    const again = getReportModel('u-lead', 'weekly', '2026-09-29', new Date('2026-10-09T00:00:00Z'))
    expect(again.snapshotAt).toBe(first.snapshotAt)
    expect(again.projects.find(p => p.id === 'p1')?.color).toBe('#f472b6')
    expect(again.projects.every(p => typeof p.color === 'string' && p.color.length > 0)).toBe(true)
  })
})

describe('사람 이름 연결 후보', () => {
  it('사용자 표나 별칭으로 정해지는 이름은 빼고, 남은 이름을 기록 수와 함께 보여준다', () => {
    seedBase()
    exec({ id: 'e1', project_id: 'p1', issue_iid: 1, assignee_type: 'user', user_name: '김외주', status: 'success', started_at: iso(NOW.getTime()) })
    exec({ id: 'e2', project_id: 'p1', issue_iid: 2, assignee_type: 'user', user_name: '김외주', status: 'success', started_at: iso(NOW.getTime()) })
    exec({ id: 'e3', project_id: 'p1', issue_iid: 3, assignee_type: 'user', user_name: '박개발', status: 'success', started_at: iso(NOW.getTime()) })
    exec({ id: 'ex-verify-4', project_id: 'p1', issue_iid: 4, assignee_type: 'user', verifier_name: 'Joung Kun-ok', status: 'success', started_at: iso(NOW.getTime()) })
    const names = unresolvedPersonNames().map(r => `${r.alias}:${r.count}`)
    expect(names).toEqual(expect.arrayContaining(['김외주:2', 'Joung Kun-ok:1']))
    expect(names.some(n => n.startsWith('박개발'))).toBe(false) // 사용자 표에 한 명뿐인 이름
    setPersonAlias('김외주', 'name', 'u-lead')
    expect(unresolvedPersonNames().map(r => r.alias)).toEqual(['Joung Kun-ok'])
  })
})

describe('팀원 메일 — 내 손에 있는 일', () => {
  it('공유받지 않은 프로젝트라도 그 사람이 담당자로 들고 있는 일은 보인다(팀 숫자는 공유 범위만)', async () => {
    seedWeek()
    db.prepare(`INSERT INTO users (id, email, name, gitlab_username) VALUES ('u-solo','solo@x.com','홀로개발','solo')`).run()
    stage('p3', 30, 'verify_waiting', { scheduled_at: iso(kst('2026-09-30T09:00:00')), assignee_username: 'solo', assignee_name: '홀로개발' })
    const { buildReportMailFor } = await import('@/lib/report-mailer')
    const { getUserById } = await import('@/lib/db')
    vi.useFakeTimers({ now: NOW, toFake: ['Date'] })
    try {
      const mail = buildReportMailFor(getUserById('u-solo')!, 'weekly', '2026-09-21')
      expect(mail.kind).toBe('member')
      expect(mail.subject).toContain('내 손에 1건')
      expect(mail.html).toContain('#30 이슈 30')
      expect(mail.subject).toContain('안고 있는 일 0건') // 공유받은 프로젝트가 없어 팀 보유는 0
    } finally { vi.useRealTimers() }
  })
})

describe('리뷰에서 찾은 결함 — 회귀 방지', () => {
  it('채팅·충돌 검사는 완료가 아니고, 채팅 한 번으로 예전 완료가 이번 기간으로 옮겨오지 않는다', () => {
    seedBase()
    // #50: 9/7 처리 완료(검증 없음), 이번 주 채팅
    exec({ id: 'ex-50', project_id: 'p1', agent_id: 'a1', assignee_type: 'agent', issue_iid: 50, status: 'success', started_at: iso(kst('2026-09-07T10:00:00')), ended_at: iso(kst('2026-09-07T11:00:00')) })
    exec({ id: 'exec-chat-1', project_id: 'p1', agent_id: 'a1', assignee_type: 'agent', issue_iid: 50, status: 'success', started_at: iso(kst('2026-09-30T10:00:00')), ended_at: iso(kst('2026-09-30T10:05:00')) })
    stage('p1', 50, 'done')
    // 충돌 검사(iid 0)
    exec({ id: 'ex-conflict-1', project_id: 'p1', agent_id: 'a1', assignee_type: 'agent', issue_iid: 0, status: 'success', started_at: iso(kst('2026-09-30T10:00:00')), ended_at: iso(kst('2026-09-30T10:05:00')) })
    const m = buildReportModel('u-lead', 'weekly', '2026-10-02', NOW)
    expect(m.completedList.map(i => i.iid)).toEqual([])
    expect(m.done.total).toBe(0)
  })

  it('머지 없이 닫혀 실패로만 끝난 이슈는 완료가 아니다', () => {
    seedBase()
    exec({ id: 'ex-70', project_id: 'p1', agent_id: 'a1', assignee_type: 'agent', issue_iid: 70, status: 'failed', started_at: iso(kst('2026-09-30T10:00:00')), ended_at: iso(kst('2026-09-30T11:00:00')) })
    stage('p1', 70, 'done') // 스캐너 정리 경로는 버려진 이슈도 done 으로 둔다
    expect(buildReportModel('u-lead', 'weekly', '2026-10-02', NOW).done.total).toBe(0)
  })

  it('다시 열렸다 완료된 이슈는 재오픈 시각에 유입으로 세고, 처리 기간도 그때부터 잰다', async () => {
    seedBase()
    const { recordStageEvent } = await import('@/lib/db')
    exec({ id: 'ex-60a', project_id: 'p1', agent_id: 'a1', assignee_type: 'agent', issue_iid: 60, status: 'success', started_at: iso(kst('2026-09-01T10:00:00')), ended_at: iso(kst('2026-09-01T11:00:00')), verified_at: iso(kst('2026-09-02T10:00:00')) })
    recordStageEvent({ projectId: 'p1', issueIid: 60, fromStage: 'done', toStage: 'waiting', source: 'scanner', occurredAt: iso(kst('2026-09-29T09:00:00')) })
    exec({ id: 'ex-60b', project_id: 'p1', agent_id: 'a1', assignee_type: 'agent', issue_iid: 60, status: 'success', started_at: iso(kst('2026-09-29T10:00:00')), ended_at: iso(kst('2026-09-29T11:00:00')), verified_at: iso(kst('2026-09-29T15:00:00')) })
    stage('p1', 60, 'done', { scheduled_at: iso(kst('2026-09-01T09:00:00')) })
    const m = buildReportModel('u-lead', 'weekly', '2026-10-02', NOW)
    expect(m.done.total).toBe(1)
    expect(m.held.inflow).toBe(1)
    expect(m.done.leadMedianH).toBeCloseTo(6) // 9/29 09:00 → 15:00
  })

  it('직접 처리(사후 기록)는 완료된 기간에 유입으로도 세어, 기간 경계를 넘어도 보유 식이 맞는다', () => {
    seedBase()
    db.prepare(`INSERT INTO held_daily (project_id, date, updated_at) VALUES ('p1','2026-09-27','x')`).run()
    exec({ id: 'ex-ext-80', project_id: 'p1', issue_iid: 80, assignee_type: 'user', user_name: '박개발', status: 'success', started_at: iso(kst('2026-09-26T22:00:00')), ended_at: iso(kst('2026-09-28T02:00:00')), work_sec: 3600 })
    stage('p1', 80, 'done')
    exec({ id: 'ex-ext-81', project_id: 'p1', issue_iid: 81, assignee_type: 'user', user_name: '박개발', status: 'success', started_at: iso(kst('2026-09-30T10:00:00')), ended_at: iso(kst('2026-09-30T12:00:00')), verified_at: iso(kst('2026-09-30T12:00:00')), work_sec: 7200 })
    stage('p1', 81, 'done')
    const m = buildReportModel('u-lead', 'weekly', '2026-10-02', NOW)
    expect(m.held.start).toBe(0)
    expect(m.held.gap).toBe(0)
    expect(m.done.byForm.direct).toBe(m.done.total)
  })

  // 화면 「— + 13 − 6 = 0 · 약 1일치」 — 지난주 말 마감 기록이 없어도(도입 첫 주) 식이 선다
  it('지난 기간 말 기록이 없으면 이력으로 다시 세고, 완료 없이 빠진 일(버려짐·유입으로 되돌림)이 식의 한 칸이 된다', async () => {
    seedBase()
    const { recordStageEvent } = await import('@/lib/db')
    // #49 지난주 접수, 아직 처리 대기 — 지난주 말 보유이자 지금 보유
    stage('p1', 49, 'waiting', { scheduled_at: iso(kst('2026-09-24T10:00:00')) })
    // #48 지난주 접수 → 이번 주 완료
    exec({ id: 'ex-48', project_id: 'p1', agent_id: 'a1', assignee_type: 'agent', issue_iid: 48, status: 'success', started_at: iso(kst('2026-09-29T10:00:00')), ended_at: iso(kst('2026-09-29T11:00:00')), verified_at: iso(kst('2026-09-29T12:00:00')) })
    stage('p1', 48, 'done', { scheduled_at: iso(kst('2026-09-25T10:00:00')) })
    // #47 오래전 접수 후 흐지부지(사건·완료 없음, 지금 보유 아님) — 지난주 말 보유로 세지 않는다
    stage('p1', 47, 'done', { scheduled_at: iso(kst('2026-06-01T10:00:00')) })
    // #50 이번 주 접수 → 처리 실패 후 버려져 정리(스캐너는 done 으로 두고 마지막 사건은 closed)
    exec({ id: 'ex-50', project_id: 'p1', agent_id: 'a1', assignee_type: 'agent', issue_iid: 50, status: 'failed', started_at: iso(kst('2026-09-29T10:00:00')), ended_at: iso(kst('2026-09-29T11:00:00')) })
    recordStageEvent({ projectId: 'p1', issueIid: 50, fromStage: 'dev_fail', toStage: 'closed', source: 'scanner', occurredAt: iso(kst('2026-09-30T09:00:00')) })
    stage('p1', 50, 'done', { scheduled_at: iso(kst('2026-09-29T09:00:00')) })
    // #51 이번 주 접수 → 유입으로 되돌림
    recordStageEvent({ projectId: 'p1', issueIid: 51, fromStage: 'none', toStage: 'waiting', source: 'ui', occurredAt: iso(kst('2026-09-30T09:00:00')) })
    recordStageEvent({ projectId: 'p1', issueIid: 51, fromStage: 'waiting', toStage: 'none', source: 'ui', occurredAt: iso(kst('2026-09-30T10:00:00')) })
    stage('p1', 51, null as any, { scheduled_at: iso(kst('2026-09-30T09:00:00')) })
    // #52 이번 주 접수·완료(직접 처리)
    exec({ id: 'ex-ext-52', project_id: 'p1', issue_iid: 52, assignee_type: 'user', user_name: '박개발', status: 'success', started_at: iso(kst('2026-10-01T10:00:00')), ended_at: iso(kst('2026-10-01T11:00:00')), work_sec: 3600 })
    stage('p1', 52, 'done')
    const m = buildReportModel('u-lead', 'weekly', '2026-10-02', NOW)
    expect(m.held.startDerived).toBe(true)
    expect(m.held.start).toBe(2)       // #49, #48 (#47 은 흐지부지)
    expect(m.held.inflow).toBe(3)      // #50, #51, #52
    expect(m.held.completed).toBe(2)   // #48, #52
    expect(m.held.end).toBe(1)         // #49
    expect(m.held.gap).toBe(2)         // 완료 없이 빠짐: #50 버려짐, #51 유입으로 되돌림 → 2 + 3 − 2 − 2 = 1
    const closed = buildReportModel('u-lead', 'weekly', '2026-09-25', NOW)
    const { html } = renderReportMail({ kind: 'member', closed, now: m, mine: [], money: v => `$${v}`, baseUrl: '', recipient: { userId: 'u-park', name: '박개발', locale: 'ko' } })
    expect(html).toContain('빠짐 — 완료하지 않고 닫혔거나')
    expect(html).toContain('이력으로 계산했습니다')
  })

  it('보유가 0이면 「약 1일치」가 아니라 「남은 일 없음」', () => {
    seedBase()
    exec({ id: 'ex-ext-53', project_id: 'p1', issue_iid: 53, assignee_type: 'user', user_name: '박개발', status: 'success', started_at: iso(kst('2026-10-01T10:00:00')), ended_at: iso(kst('2026-10-01T11:00:00')), work_sec: 3600 })
    stage('p1', 53, 'done')
    exec({ id: 'ex-54', project_id: 'p1', agent_id: 'a1', assignee_type: 'agent', issue_iid: 54, status: 'success', started_at: iso(kst('2026-09-20T10:00:00')), ended_at: iso(kst('2026-09-20T11:00:00')), verified_at: iso(kst('2026-09-20T12:00:00')) })
    stage('p1', 54, 'done')
    const m = buildReportModel('u-lead', 'weekly', '2026-10-02', NOW)
    expect(m.held.end).toBe(0)
    expect(m.held.start).toBe(0)
    expect(m.held.gap).toBe(0)
    const closed = buildReportModel('u-lead', 'weekly', '2026-09-25', NOW)
    const { html } = renderReportMail({ kind: 'member', closed, now: m, mine: [], money: v => `$${v}`, baseUrl: '', recipient: { userId: 'u-park', name: '박개발', locale: 'ko' } })
    expect(html).toContain('남은 일 없음')
    expect(html).not.toContain('1일치')
  })

  it('AI 구독료는 기간 일수만큼만 배부된다(끝 날짜를 하루 더 넣지 않는다)', () => {
    seedBase()
    db.prepare(`INSERT OR REPLACE INTO token_pricing (id, cli_name, model_name, input_price, output_price, updated_at) VALUES ('sub-claude','claude','subscription (claude)',300,0,datetime('now'))`).run()
    db.prepare(`INSERT INTO agents (id, user_id, name, cli_name, cli_path) VALUES ('a1','u-lead','A','claude','claude')`).run()
    exec({ id: 'ex-90', project_id: 'p1', agent_id: 'a1', assignee_type: 'agent', issue_iid: 90, status: 'success', started_at: iso(kst('2026-09-30T10:00:00')), ended_at: iso(kst('2026-09-30T11:00:00')), input_tokens: 1000, output_tokens: 100, cost_usd: 5 })
    const m = buildReportModel('u-lead', 'weekly', '2026-10-02', NOW)
    // 9/28~10/4 = 9월 3일(300/30) + 10월 4일(300/31)
    expect(m.cost.aiActual).toBeCloseTo(3 * 10 + 4 * 300 / 31, 5)
  })

  it('검증 에이전트는 사람 의존도에 들지 않고, 판단 불가(blocked)는 반려가 아니다', () => {
    seedBase()
    for (let i = 0; i < 8; i++) {
      exec({ id: `ex-verify-ag${i}`, project_id: 'p1', issue_iid: 100 + i, assignee_type: 'agent', user_name: 'VerifyBot', status: 'failed', stage_verdict: 'blocked', model_name: 'claude-opus-5-5', started_at: iso(kst('2026-09-15T10:00:00')), ended_at: iso(kst('2026-09-15T11:00:00')) })
    }
    for (let i = 0; i < 4; i++) {
      exec({ id: `ex-verify-h${i}`, project_id: 'p1', issue_iid: 200 + i, assignee_type: 'user', user_id: 'u-lee', user_name: '이검증', status: 'success', verified_at: iso(kst('2026-09-16T10:00:00')), started_at: iso(kst('2026-09-16T09:00:00')), ended_at: iso(kst('2026-09-16T10:00:00')) })
    }
    exec({ id: 'ex-verify-h9', project_id: 'p1', issue_iid: 209, assignee_type: 'user', user_id: 'u-lee', user_name: '이검증', status: 'failed', rejected_at: iso(kst('2026-09-16T11:00:00')), started_at: iso(kst('2026-09-16T10:30:00')), ended_at: iso(kst('2026-09-16T11:00:00')) })
    const m = buildReportModel('u-lead', 'monthly', '2026-09-15', NOW)
    expect(m.risks?.concentrations).toEqual([])
    expect(m.risks?.rejectRate).toBeCloseTo(1 / 5)
  })

  it('Git 계정·숫자 id 는 공급자까지 맞을 때만 같은 사람이고, 표시 이름만 같은 사람의 일은 "내 손에"에 넣지 않는다', async () => {
    seedBase()
    db.prepare(`INSERT INTO oauth_providers (id, type, name, base_url, client_id, client_secret) VALUES ('gl','gitlab','GL','x','x','x'), ('gh','github','GH','x','x','x')`).run()
    db.prepare(`UPDATE users SET gitlab_username = 'kim', oauth_provider_id = 'gh', oauth_user_id = '42' WHERE id = 'u-park'`).run()
    db.prepare(`INSERT INTO projects (id, user_id, name, repo_url, access_token, provider) VALUES ('pgh','u-out','GH Secret','https://x','t','github'), ('pgl','u-out','GL Secret','https://x','t','gitlab')`).run()
    // GitHub 의 다른 kim 이 담당 → 박개발(GitLab kim)의 일이 아니다
    stage('pgh', 1, 'verify_waiting', { assignee_username: 'kim', assignee_name: 'Kim GH', scheduled_at: iso(kst('2026-09-30T09:00:00')) })
    // 표시 이름만 같은 외부 담당자 → 약한 식별
    stage('pgh', 2, 'verify_waiting', { assignee_username: 'park-ext', assignee_name: '박개발', scheduled_at: iso(kst('2026-09-30T09:00:00')) })
    // GitLab 프로젝트에서 Git 숫자 id 42 (박개발의 42 는 GitHub id) → 다른 사람
    exec({ id: 'ex-gl', project_id: 'pgl', issue_iid: 3, assignee_type: 'user', user_id: '42', user_name: 'Someone', status: 'assigned', started_at: iso(kst('2026-09-30T09:00:00')) })
    stage('pgl', 3, 'dev', { assign_mode: 'assignee', scheduled_at: iso(kst('2026-09-30T09:00:00')) })
    // 진짜 박개발 일: GitLab 프로젝트에서 gitlab kim
    stage('pgl', 4, 'verify_waiting', { assignee_username: 'kim', assignee_name: 'Kim', scheduled_at: iso(kst('2026-09-30T09:00:00')) })
    const { liveHeldAll } = await import('@/lib/report-model/build')
    const mine = liveHeldAll(NOW).filter(i => i.personStrong && i.personKey === 'u:u-park').map(i => `${i.projectId}#${i.iid}`)
    expect(mine).toEqual(['pgl#4'])
  })

  it('"내 손에 있는 일"은 300건에서 자르지 않는다', async () => {
    seedBase()
    db.prepare(`UPDATE users SET gitlab_username = 'park' WHERE id = 'u-park'`).run()
    for (let i = 0; i < 320; i++) stage('p1', 1000 + i, 'waiting', { scheduled_at: iso(kst('2026-08-01T09:00:00')) })
    stage('p1', 2000, 'verify_waiting', { assignee_username: 'park', assignee_name: '박개발', scheduled_at: iso(kst('2026-10-01T09:00:00')) })
    const { liveHeldAll } = await import('@/lib/report-model/build')
    expect(liveHeldAll(NOW).filter(i => i.personKey === 'u:u-park' && i.personStrong).map(i => i.iid)).toEqual([2000])
  })

  it('사람 작업시간 계산은 구간이 많아도 빠르다(겹침 제거 스윕)', () => {
    const t0 = Date.UTC(2026, 0, 1)
    const segs = Array.from({ length: 20000 }, (_, i) => ({ person: 'A', projectId: `p${i % 3}`, start: t0 + i * 30 * 60_000, end: t0 + i * 30 * 60_000 + 45 * 60_000 }))
    const t = Date.now()
    const a = allocateWork(segs)
    expect(Date.now() - t).toBeLessThan(500)
    expect(a.personMinutes.get('A')).toBe(19999 * 30 + 45)
    const total = [...a.projectMinutes.values()].reduce((s, v) => s + v, 0)
    expect(total).toBeCloseTo(a.personMinutes.get('A')!, 5)
  })

  it('발송은 같은 스케줄·기간을 동시에 두 번 돌리지 않는다', async () => {
    seedWeek()
    vi.useFakeTimers({ now: NOW, toFake: ['Date'] })
    try {
      const schedule = { id: 'rs-lock', reportType: 'weekly', enabled: true, recipients: ['lead@x.com'], sendDay: 1, sendHour: 9 } as any
      const [a, b] = await Promise.all([sendReport(schedule), sendReport(schedule)])
      expect(a.sent + b.sent).toBe(1)
      const again = await sendReport(schedule)
      expect(again.sent).toBe(0)
    } finally { vi.useRealTimers() }
  })
})

describe('단계별 시간 — 어디서 시간이 걸렸나', () => {
  const byStage = (m: ReturnType<typeof buildReportModel>) => Object.fromEntries(m.stageTime!.stages.map(s => [s.stage, s.avgH]))

  it('접수 → 완료를 실행 기록으로 나누고, 단계 합은 처리 기간이다', () => {
    seedWeek()
    const m = buildReportModel('u-lead', 'weekly', '2026-10-02', NOW)
    // #2: 접수 9/26 09 · 처리 10~11 · 검증 9/29 09~10 · 확인 완료 12:00 (직접 처리 #4 는 재지 않는다)
    expect(m.stageTime!.n).toBe(1)
    const h = byStage(m)
    expect(h.waiting).toBeCloseTo(1)
    expect(h.dev).toBeCloseTo(1)
    expect(h.verify_waiting).toBeCloseTo(70)
    expect(h.verifying).toBeCloseTo(1)
    expect(h.confirm_waiting).toBeCloseTo(2)
    expect(h.confirming).toBeCloseTo(0)
    expect(m.stageTime!.avgH).toBeCloseTo(m.done.leadMedianH!)
    expect(m.stageTime!.stages.reduce((s, x) => s + x.share, 0)).toBeCloseTo(1)
  })

  it('반려되면 처리 대기로 돌아가고, 확인 기록이 열린 동안은 확인이다', () => {
    seedBase()
    const t = (s: string) => iso(kst(`2026-09-30T${s}:00`))
    stage('p1', 7, 'done', { scheduled_at: t('09:00'), confirmed_at: t('18:00') })
    exec({ id: 'ex-7a', project_id: 'p1', agent_id: 'a1', assignee_type: 'agent', issue_iid: 7, status: 'success', started_at: t('10:00'), ended_at: t('11:00'), rejected_at: t('12:00') })
    exec({ id: 'ex-verify-7a', project_id: 'p1', issue_iid: 7, assignee_type: 'user', user_id: 'u-lee', status: 'failed', started_at: t('11:30'), ended_at: t('12:00'), rejected_at: t('12:00') })
    exec({ id: 'ex-7b', project_id: 'p1', agent_id: 'a1', assignee_type: 'agent', issue_iid: 7, status: 'success', started_at: t('13:00'), ended_at: t('14:00'), verified_at: t('15:00') })
    exec({ id: 'ex-verify-7b', project_id: 'p1', issue_iid: 7, assignee_type: 'user', user_id: 'u-lee', status: 'success', started_at: t('14:00'), ended_at: t('15:00'), verified_at: t('15:00') })
    exec({ id: 'ex-confirm-7', project_id: 'p1', issue_iid: 7, assignee_type: 'user', user_id: 'u-lead', status: 'success', started_at: t('17:00'), ended_at: t('18:00') })
    const h = byStage(buildReportModel('u-lead', 'weekly', '2026-10-02', NOW))
    expect(h.waiting).toBeCloseTo(2)          // 09~10 접수 대기 + 12~13 반려 후
    expect(h.dev).toBeCloseTo(2)              // 10~11, 13~14
    expect(h.verify_waiting).toBeCloseTo(0.5) // 11~11:30
    expect(h.verifying).toBeCloseTo(1.5)      // 11:30~12, 14~15
    expect(h.confirm_waiting).toBeCloseTo(2)  // 15~17
    expect(h.confirming).toBeCloseTo(1)       // 17~18
  })

  it('지난 기간 값과 월별 비중을 함께 낸다', () => {
    seedWeek()
    const m = buildReportModel('u-lead', 'monthly', '2026-09-30', NOW)
    expect(m.stageTime!.n).toBe(1) // #2 (9/29 완료)
    const sep = m.months!.find(x => x.label === '2026-09')!
    expect(sep.stageShares!.find(s => s.stage === 'verify_waiting')!.share).toBeCloseTo(70 / 75)
    const next = buildReportModel('u-lead', 'monthly', '2026-10-02', NOW)
    expect(next.stageTime!.prevN).toBe(1)
    expect(next.stageTime!.prevStages!.find(s => s.stage === 'verify_waiting')!.avgH).toBeCloseTo(70)
  })

  it('메일의 단계별 숫자는 모델 값이다', () => {
    seedWeek()
    const now = buildReportModel('u-lead', 'weekly', '2026-10-02', NOW)
    const { html } = renderReportMail({ kind: 'lead', closed: now, now, money: v => `$${v}`, baseUrl: '', recipient: { userId: 'u-lead', name: '정팀장', locale: 'ko' } })
    const st = now.stageTime!
    const i = st.stages.findIndex(s => s.stage === 'verify_waiting')
    expect(html).toContain(`data-metric="closed.stageTime.stages.${i}.avgH" data-value="${st.stages[i].avgH}"`)
    expect(html).toContain(`data-metric="closed.stageTime.stages.${i}.share" data-value="${st.stages[i].share}"`)
    expect(html).toContain('가장 오래 머문 곳은 검증 대기')
  })

  it('단계별 시간이 생기기 전 확정본은 읽을 때 채운다', () => {
    seedWeek()
    const first = getReportModel('u-lead', 'weekly', '2026-09-29', new Date('2026-10-09T00:00:00Z'))
    const row = db.prepare(`SELECT id, payload FROM report_snapshots`).get() as { id: string; payload: string }
    const legacy = JSON.parse(row.payload)
    delete legacy.stageTime
    db.prepare(`UPDATE report_snapshots SET payload = ? WHERE id = ?`).run(JSON.stringify(legacy), row.id)
    const again = getReportModel('u-lead', 'weekly', '2026-09-29', new Date('2026-10-09T00:00:00Z'))
    expect(again.snapshotAt).toBe(first.snapshotAt)
    expect(again.stageTime).toEqual(first.stageTime)
  })
})
