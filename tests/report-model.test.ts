/**
 * 보고서 모델(화면·메일 공용) 불변식 — DB 는 실제 스키마(initSchema), 메일 전송만 가짜.
 *
 * R-1 기간: 주간은 월요일 시작, 끝은 미포함, 서버 시간대와 무관하다. 지난 기간·월말·연말 경계.
 * R-2 사람 작업시간: 같은 사람이 같은 시간에 연 작업은 한 번만 세고, 그 시간은 프로젝트끼리 나눈다.
 * R-3 통계: 중앙값·분위수·Wilson 구간·필요 표본 수·결과 등급·모델 이름 정규화.
 * R-4 보유 식: 기초 + 유입 − 완료 = 기말 이 맞는 데이터에서 gap = 0. 진행 중 기간은 지금 건수(issue_stages)를 쓴다.
 * R-5 일의 형태: 에이전트 처리 / 사람 처리 / 직접 처리(사후 기록)를 구분하고, 처리 기간에서 사후 기록은 뺀다.
 * R-6 범위: 공유받지 않은 프로젝트는 보고서에 나오지 않는다(메일도 같은 범위).
 * R-7 지금 손쓸 것: AI 실패·7일 넘은 일·한 사람 쏠림(같은 역할 2명 이상, 절반 이상, 3건 이상).
 * R-8 메일 = 화면: 메일의 모든 숫자 칸(data-metric)이 보고서 모델의 값과 같다.
 * R-9 발송: IVE 계정이 없는 주소에는 보내지 않고 기록만 남긴다. 팀장/팀원 메일 구분.
 * R-10 확정본: 닫힌 기간은 처음 계산한 값을 저장하고, 데이터가 바뀌어도 그 값을 돌려준다.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import Database from 'better-sqlite3'

const mailMock = vi.hoisted(() => ({ sendMail: vi.fn(async () => ({})) }))
vi.mock('@/lib/mail', () => ({ createTransporter: () => ({ sendMail: mailMock.sendMail }), getFromAddress: () => 'ive@test' }))

import { initSchema } from '@/lib/db/schema'
import { periodOf, previousPeriod, isClosed, buckets, kstDayStartISO } from '@/lib/report-model/period'
import { allocateWork, median, quantile, wilson, requiredSamplePerGroup, gradeOf, normalizeModel, businessSegmentsKST } from '@/lib/report-model/compute'
import { buildReportModel } from '@/lib/report-model/build'
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
    expect(park.held.issues?.some(i => i.projectId === 'p3')).toBe(false)
    const lee = buildReportModel('u-lee', 'weekly', '2026-10-02', NOW)
    expect(lee.done.byForm.direct).toBe(0) // p2(직접 처리)는 이검증에게 공유되지 않았다
  })

  it('R-7 AI 실패와 사람 손 보유', () => {
    seedWeek()
    const m = buildReportModel('u-lead', 'weekly', '2026-10-02', NOW)
    expect(m.actions?.failed.map(f => f.iid)).toEqual([3])
    expect(m.held.people).toEqual([expect.objectContaining({ name: '박개발', role: 'process', count: 1 })])
    expect(m.actions?.concentration).toBeNull() // 같은 역할에 한 사람뿐이면 쏠림으로 보지 않는다
  })
})

describe('R-8 메일 = 화면', () => {
  it('메일의 숫자 칸은 보고서 모델의 값이다', () => {
    seedWeek()
    const now = buildReportModel('u-lead', 'weekly', '2026-10-02', NOW)
    const closed = buildReportModel('u-lead', 'weekly', '2026-09-25', NOW)
    const { subject, html } = renderReportMail({ kind: 'lead', closed, now, money: v => `$${v.toFixed(2)}`, baseUrl: 'https://ive', recipient: { userId: 'u-lead', name: '정팀장', locale: 'ko' } })
    const metric = (k: string) => [...html.matchAll(new RegExp(`data-metric="${k.replace(/\./g, '\\.')}"[^>]*>([^<]*)<`, 'g'))].map(x => x[1])
    expect(metric('now.held.end')).toEqual([`${now.held.end}건`])
    expect(metric('now.actions.failed.length')).toEqual([`${now.actions!.failed.length}건`])
    expect(metric('closed.done.total')).toEqual([`${closed.done.total}건`])
    expect(subject).toContain(`안고 있는 일 ${now.held.end}건`)
    expect(subject).toContain(`지난주 완료 ${closed.done.total}건`)
  })

  it('팀원 메일은 그 사람 손에 있는 일만 담는다', () => {
    seedWeek()
    const now = buildReportModel('u-park', 'weekly', '2026-10-02', NOW)
    const closed = buildReportModel('u-park', 'weekly', '2026-09-25', NOW)
    const park = renderReportMail({ kind: 'member', closed, now, money: v => `$${v}`, baseUrl: '', recipient: { userId: 'u-park', name: '박개발', locale: 'ko' } })
    expect(park.subject).toContain('내 손에 1건')
    expect(park.html).toContain('#1 이슈 1')
    const lee = renderReportMail({ kind: 'member', closed, now, money: v => `$${v}`, baseUrl: '', recipient: { userId: 'u-lee', name: '이검증', locale: 'en' } })
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
  it('닫힌 기간은 처음 계산한 값을 돌려준다', () => {
    seedWeek()
    const first = getReportModel('u-lead', 'weekly', '2026-09-29', new Date('2026-10-06T00:00:00Z'))
    expect(first.snapshotAt).toBeTruthy()
    // 기간 안에 완료가 하나 더 생겨도 확정본은 그대로
    exec({ id: 'ex-ext-5', project_id: 'p1', issue_iid: 5, assignee_type: 'user', user_name: '박개발', status: 'success', started_at: iso(kst('2026-10-01T10:00:00')), ended_at: iso(kst('2026-10-01T11:00:00')), work_sec: 3600 })
    stage('p1', 5, 'done')
    const again = getReportModel('u-lead', 'weekly', '2026-09-29', new Date('2026-10-06T00:00:00Z'))
    expect(again.done.total).toBe(first.done.total)
    expect(again.snapshotAt).toBe(first.snapshotAt)
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
