/**
 * 보고서 모델 조립 — 화면·메일·확정본이 함께 쓰는 단 하나의 계산.
 */
import { getHumanRate, resolveExecutionCostBreakdown, humanWorkMinutes } from '../token-pricing'
import { buildAiCostPolicy } from '../ai-subscription'
import type { ReportExecution } from '../db'
import {
  periodOf, previousPeriod, isClosed, kstToday, addDays, buckets, kstDayOf, kstDayStartISO, lastMonths,
  type ReportType, type Period,
} from './period'
import {
  scopedProjects, execsInRange, completedInRange, issueFacts, heldNow, heldDaily, heldTrackingSince,
  overturnedKeys, personOf, resetPersonCache, receivedInRange, verifyDecisions, confirmRejections,
  type Scope, type IssueFacts, type IssueExec, type HeldRow, type ScopedProject,
} from './load'
import {
  median, quantile, wilson, requiredSamplePerGroup, gradeOf, normalizeModel, allocateWork, businessSegmentsKST,
  type WorkSegment,
} from './compute'
import {
  GRADES, HELD_STAGES,
  type ReportModel, type WorkForm, type HeldIssue, type HeldPerson, type Held, type ActionItems,
  type Done, type Trend, type ProjectRow, type Cost, type PersonRole, type Grade, type Evaluation, type WorkerEval,
  type MonthPoint, type Risks, type CompletedItem,
} from './types'

const HOUR = 3_600_000
const AGED_HOURS = 7 * 24
const MATURITY_DAYS = 30
const EVAL_WINDOW_DAYS = 90
const MIN_SAMPLE = 20

// ─── 실행·이슈 판정 ───

const isStageRow = (id: string) => id.startsWith('ex-verify') || id.startsWith('ex-confirm')
const isProcessExec = (e: { id: string }) =>
  !isStageRow(e.id) && !e.id.startsWith('ex-conflict') && !e.id.startsWith('exec-chat')
const isAgentProcess = (e: IssueExec) => isProcessExec(e) && !!e.agentId && e.assigneeType !== 'user'
const isExternal = (e: IssueExec) => isProcessExec(e) && e.assigneeType === 'user' && !e.agentId && !e.userId

export function formOf(f: IssueFacts): WorkForm {
  if (f.execs.some(isAgentProcess)) return 'agent'
  const proc = f.execs.filter(isProcessExec)
  if (proc.length > 0 && proc.every(isExternal)) return 'direct'
  return 'human'
}

function processRuns(f: IssueFacts): IssueExec[] {
  return f.execs.filter(isProcessExec)
}

/** 반려 횟수 — 같은 반려가 처리 행과 검증 행에 함께 찍히므로 시각(분)으로 묶는다 */
function rejectCount(f: IssueFacts, confirmRejects: string[] | undefined): number {
  const set = new Set<string>()
  for (const e of f.execs) if (e.rejectedAt) set.add(e.rejectedAt.slice(0, 16))
  for (const r of confirmRejects ?? []) set.add(r.slice(0, 16))
  return set.size
}

function wasReviewed(f: IssueFacts): boolean {
  return f.execs.some(e => isStageRow(e.id) || !!e.verifiedAt || !!e.rejectedAt) || !!f.confirmedAt
}

function receivedAt(f: IssueFacts): string | null {
  const times = [f.scheduledAt, ...f.execs.filter(isProcessExec).map(e => e.issueCreatedAt), ...f.execs.filter(isProcessExec).map(e => e.startedAt)]
    .filter((t): t is string => !!t && !isNaN(new Date(t).getTime()))
  if (times.length === 0) return null
  return times.reduce((a, b) => (new Date(a) < new Date(b) ? a : b))
}

function hoursBetween(a: string | null, b: string | null): number | null {
  if (!a || !b) return null
  const d = (new Date(b).getTime() - new Date(a).getTime()) / HOUR
  return Number.isFinite(d) && d >= 0 ? d : null
}

// ─── 사람 작업시간·비용 ───

function personForExec(e: ReportExecution) {
  return personOf(e.userId, e.userName, e.id.startsWith('ex-verify') ? e.verifierUsername : null)
}

function segmentsOf(execs: ReportExecution[]): WorkSegment[] {
  const out: WorkSegment[] = []
  for (const e of execs) {
    if (humanWorkMinutes(e) <= 0) continue
    const p = personForExec(e)
    if (!p) continue
    if (isStageRow(e.id)) {
      const s = new Date(e.verifyStartedAt || e.startedAt).getTime()
      const end = new Date(e.verifiedAt || e.rejectedAt || e.endedAt || e.startedAt).getTime()
      for (const [a, b] of businessSegmentsKST(s, end)) out.push({ person: p.key, projectId: e.projectId, start: a, end: b })
    } else {
      const s = new Date(e.startedAt).getTime()
      if (Number.isFinite(s) && e.workSec > 0) out.push({ person: p.key, projectId: e.projectId, start: s, end: s + e.workSec * 1000 })
    }
  }
  return out
}

interface CostCalc {
  cost: Omit<Cost, 'perCompleted' | 'prevPerCompleted' | 'humanHoursPerCompleted'>
  projectMinutes: Map<string, number>
}

function costOf(execs: ReportExecution[], period: Period): CostCalc {
  const rate = getHumanRate()
  const policy = buildAiCostPolicy(execs, period.start, period.end)
  const alloc = allocateWork(segmentsOf(execs))
  let human = 0, ai = 0, aiNotional = 0
  for (const e of execs) {
    const b = resolveExecutionCostBreakdown(e, rate, policy)
    ai += b.ai
    aiNotional += b.aiNotional
    if (b.human > 0) {
      const p = personForExec(e)
      const raw = p ? alloc.personRawMinutes.get(p.key) ?? 0 : 0
      const union = p ? alloc.personMinutes.get(p.key) ?? 0 : 0
      // 같은 사람이 같은 시간에 연 작업은 한 번만 — 그 사람의 기록 합계 대비 실제 시간 비율만큼만 비용으로 잡는다
      human += raw > 0 ? b.human * Math.min(1, union / raw) : b.human
    }
  }
  const minutes = Array.from(alloc.personMinutes.values()).reduce((s, v) => s + v, 0)
  return {
    cost: {
      humanHours: minutes / 60, people: alloc.personMinutes.size, humanCost: human, aiActual: ai, aiNotional,
      total: human + ai, humanRateSet: rate.costPerMin > 0,
    },
    projectMinutes: alloc.projectMinutes,
  }
}

// ─── 보유 ───

function personOfHeld(r: HeldRow): { key: string; name: string; role: PersonRole } | null {
  if (r.stage === 'dev') {
    if (r.activeAssigneeType !== 'user') return null // 에이전트가 처리 중
    const p = personOf(r.activeUserId, r.activeUserName, r.assigneeUsername)
    return p ? { ...p, role: 'process' } : null
  }
  if (r.stage === 'waiting') {
    if (r.assignMode !== 'assignee') return null // 에이전트 배정 대기
    const p = personOf(null, r.assigneeName, r.assigneeUsername)
    return p ? { ...p, role: 'process' } : null
  }
  if (r.stage === 'dev_fail') return null
  if (r.stage === 'verify_waiting' || r.stage === 'verifying') {
    if (r.presetVerifierMode === 'agent') return null
    const p = personOf(null, r.assigneeName, r.assigneeUsername)
    return p ? { ...p, role: 'verify' } : null
  }
  if (r.presetConfirmerMode === 'agent') return null
  const p = r.stage === 'confirming' && (r.confirmerUserId || r.confirmerName)
    ? personOf(r.confirmerUserId, r.confirmerName)
    : personOf(null, r.assigneeName, r.assigneeUsername)
  return p ? { ...p, role: 'confirm' } : null
}

function liveHeld(rows: HeldRow[], projects: Map<string, ScopedProject>, now: Date): { issues: HeldIssue[] } {
  const issues: HeldIssue[] = rows.map(r => {
    const who = personOfHeld(r)
    const age = r.receivedAt ? Math.max(0, (now.getTime() - new Date(r.receivedAt).getTime()) / HOUR) : 0
    return {
      projectId: r.projectId, projectName: projects.get(r.projectId)?.name ?? r.projectId, iid: r.iid, title: r.title,
      stage: r.stage, ageHours: age, personKey: who?.key ?? null, personName: who?.name ?? null, role: who?.role ?? null,
    }
  })
  return { issues }
}

function peopleOf(issues: HeldIssue[]): HeldPerson[] {
  const map = new Map<string, HeldPerson>()
  for (const i of issues) {
    if (!i.personKey || !i.role) continue
    const k = `${i.personKey}|${i.role}`
    const cur = map.get(k) ?? { key: i.personKey, name: i.personName || i.personKey, role: i.role, count: 0, oldestHours: 0 }
    cur.count++
    cur.oldestHours = Math.max(cur.oldestHours, i.ageHours)
    map.set(k, cur)
  }
  return Array.from(map.values()).sort((a, b) => b.count - a.count || b.oldestHours - a.oldestHours)
}

function actionsOf(issues: HeldIssue[], people: HeldPerson[]): ActionItems {
  const failed = issues.filter(i => i.stage === 'dev_fail')
    .map(i => ({ projectId: i.projectId, projectName: i.projectName, iid: i.iid, title: i.title, hours: i.ageHours }))
    .sort((a, b) => b.hours - a.hours)
  const aged = issues.filter(i => i.ageHours >= AGED_HOURS).sort((a, b) => b.ageHours - a.ageHours)
  let concentration: ActionItems['concentration'] = null
  for (const role of ['process', 'verify', 'confirm'] as PersonRole[]) {
    const holders = people.filter(p => p.role === role)
    if (holders.length < 2) continue
    const total = holders.reduce((s, p) => s + p.count, 0)
    const top = holders[0]
    if (top.count >= 3 && top.count / total >= 0.5 && (!concentration || top.count / total > concentration.count / concentration.roleTotal)) {
      concentration = { role, name: top.name, count: top.count, roleTotal: total, roleHolders: holders.length, oldestHours: top.oldestHours }
    }
  }
  return { failed, aged, concentration }
}

/** 날짜(KST)의 하루 마감 보유 합계. 그날 기록이 하나도 없으면 null */
function heldOnDay(pids: string[], day: string, byProject?: Map<string, number>): number | null {
  const rows = heldDaily(pids, day, addDays(day, 1))
  if (rows.length === 0) return null
  for (const r of rows) byProject?.set(r.projectId, r.total)
  return rows.reduce((s, r) => s + r.total, 0)
}

// ─── 완료 ───

interface DoneCalc {
  done: Omit<Done, 'prevTotal' | 'prevFirstPass'>
  list: CompletedItem[]
  byProject: Map<string, number>
}

function doneOf(completed: Map<string, string>, facts: Map<string, IssueFacts>, projects: Map<string, ScopedProject>): DoneCalc {
  const byForm: Record<WorkForm, number> = { agent: 0, human: 0, direct: 0 }
  const leads: number[] = []
  let humanH = 0, totalH = 0, fpPass = 0, fpN = 0
  const list: CompletedItem[] = []
  const byProject = new Map<string, number>()
  for (const [key, at] of completed) {
    const f = facts.get(key)
    if (!f) continue
    const form = formOf(f)
    byForm[form]++
    byProject.set(f.projectId, (byProject.get(f.projectId) ?? 0) + 1)
    let lead: number | null = null
    if (form !== 'direct') {
      lead = hoursBetween(receivedAt(f), at)
      if (lead != null) leads.push(lead)
    }
    if (form === 'agent') {
      const runs = processRuns(f)
      const devEnd = runs.map(e => e.endedAt).filter((t): t is string => !!t).sort().pop() ?? null
      const total = hoursBetween(receivedAt(f), at)
      const humanPart = hoursBetween(devEnd, at)
      if (total != null && humanPart != null && total > 0) { totalH += total; humanH += Math.min(humanPart, total) }
      fpN++
      if (runs.length <= 1 && rejectCount(f, undefined) === 0) fpPass++
    }
    list.push({ projectId: f.projectId, projectName: projects.get(f.projectId)?.name ?? f.projectId, iid: f.iid, title: f.title, form, completedAt: at, leadH: lead })
  }
  list.sort((a, b) => (a.completedAt < b.completedAt ? 1 : -1))
  return {
    done: {
      total: completed.size, byForm,
      leadMedianH: median(leads), leadP90H: quantile(leads, 0.9),
      humanWaitShare: totalH > 0 ? humanH / totalH : null,
      firstPass: fpN > 0 ? fpPass / fpN : null, firstPassN: fpN,
    },
    list, byProject,
  }
}

// ─── 추이 ───

function bucketKey(type: ReportType, iso: string): string {
  const d = kstDayOf(iso)
  return type === 'yearly' ? `${d.slice(0, 7)}-01` : d
}

function countBy(type: ReportType, m: Map<string, string>, keys: string[]): number[] {
  const idx = new Map(keys.map((k, i) => [k, i]))
  const out = keys.map(() => 0)
  for (const at of m.values()) {
    const i = idx.get(bucketKey(type, at))
    if (i != null) out[i]++
  }
  return out
}

function heldSeries(type: ReportType, pids: string[], period: Period, today: string, liveNow: number | null): (number | null)[] {
  const days = buckets(period)
  if (pids.length === 0) return days.map(() => null)
  const rows = heldDaily(pids, period.start, period.end)
  const byDay = new Map<string, number>()
  for (const r of rows) byDay.set(r.date, (byDay.get(r.date) ?? 0) + r.total)
  return days.map((d, i) => {
    if (type === 'yearly') {
      const monthEnd = i + 1 < days.length ? addDays(days[i + 1], -1) : addDays(period.end, -1)
      const last = monthEnd < today ? monthEnd : today
      if (d > today) return null
      if (last === today && liveNow != null) return liveNow
      return byDay.get(last) ?? null
    }
    if (d > today) return null
    if (d === today && liveNow != null) return liveNow
    return byDay.get(d) ?? null
  })
}

// ─── 작업 결과 평가 ───

function evaluationOf(scope: Scope, pids: string[], periodEnd: string, today: string): Evaluation {
  const windowEnd = addDays(periodEnd < today ? periodEnd : today, -MATURITY_DAYS)
  const windowStart = addDays(windowEnd, -EVAL_WINDOW_DAYS)
  const completed = completedInRange(scope, windowStart, windowEnd)
  const facts = issueFacts(Array.from(completed.keys()))
  const sinceISO = kstDayStartISO(windowStart)
  const overturned = overturnedKeys(pids, sinceISO)
  const confirmRej = confirmRejections(pids, sinceISO)

  const empty = (): Record<Grade, number> => ({ pass: 0, rerun: 0, rejected_pass: 0, rejected_repeat: 0, overturned: 0 })
  const workers = new Map<string, WorkerEval & { projects: Set<string> }>()
  const groups = { agent: empty(), person: empty() }
  for (const [key] of completed) {
    const f = facts.get(key)
    if (!f || !wasReviewed(f)) continue
    const form = formOf(f)
    if (form === 'direct') continue
    const runs = processRuns(f)
    const grade = gradeOf({ runs: runs.length, rejects: rejectCount(f, confirmRej.get(key)), overturned: overturned.has(key) })
    const first = runs[0]
    let wkey: string, name: string, kind: 'agent' | 'person'
    if (form === 'agent') {
      const firstAgent = runs.find(isAgentProcess) ?? first
      const model = normalizeModel(firstAgent?.modelName)
      kind = 'agent'
      name = model ?? `${firstAgent?.cliName || 'agent'} (모델 미기록)`
      wkey = `m:${name}`
    } else {
      const p = personOf(first?.userId, first?.userName)
      if (!p) continue
      kind = 'person'; name = p.name; wkey = p.key
    }
    groups[kind][grade]++
    const w = workers.get(wkey) ?? { key: wkey, name, kind, grades: empty(), n: 0, passRate: null, ciLow: null, ciHigh: null, state: 'collecting' as const, projects: new Set<string>() }
    w.grades[grade]++
    w.n++
    w.projects.add(f.projectId)
    workers.set(wkey, w)
  }
  const list = Array.from(workers.values()).map(w => {
    const ci = wilson(w.grades.pass, w.n)
    return { ...w, passRate: w.n > 0 ? w.grades.pass / w.n : null, ciLow: ci?.low ?? null, ciHigh: ci?.high ?? null, state: (w.n >= MIN_SAMPLE ? 'ok' : 'collecting') as 'ok' | 'collecting' }
  }).sort((a, b) => (a.kind === b.kind ? b.n - a.n : a.kind === 'agent' ? -1 : 1))

  const comparisons: Evaluation['comparisons'] = []
  for (const kind of ['agent', 'person'] as const) {
    const ok = list.filter(w => w.kind === kind && w.state === 'ok').slice(0, 3)
    for (let i = 0; i < ok.length; i++) for (let j = i + 1; j < ok.length; j++) {
      const a = ok[i], b = ok[j]
      const overlap = a.ciHigh! >= b.ciLow! && b.ciHigh! >= a.ciLow!
      const need = requiredSamplePerGroup(a.passRate!, b.passRate!)
      const inter = [...a.projects].filter(p => b.projects.has(p)).length
      const union = new Set([...a.projects, ...b.projects]).size
      comparisons.push({
        a: a.name, b: b.name, state: overlap ? 'unclear' : 'clear',
        needMore: overlap && need != null ? Math.max(0, need - Math.min(a.n, b.n)) : null,
        differentProjects: union > 0 && inter / union < 0.5,
      })
    }
  }

  // 검증자: 승인한 일이 확인 단계에서 반려된 비율
  const decisions = verifyDecisions(pids, sinceISO, kstDayStartISO(windowEnd))
  const vmap = new Map<string, { key: string; name: string; approved: number; laterRejected: number }>()
  for (const d of decisions) {
    if (!d.approvedAt) continue
    const p = personOf(d.userId, d.userName, d.username)
    if (!p) continue
    const cur = vmap.get(p.key) ?? { key: p.key, name: p.name, approved: 0, laterRejected: 0 }
    cur.approved++
    const rej = confirmRej.get(`${d.projectId}:${d.iid}`) ?? []
    if (rej.some(r => r > d.approvedAt!)) cur.laterRejected++
    vmap.set(p.key, cur)
  }
  const verifiers = Array.from(vmap.values()).map(v => ({
    ...v, rate: v.approved > 0 ? v.laterRejected / v.approved : null,
    state: (v.approved >= MIN_SAMPLE ? 'ok' : 'collecting') as 'ok' | 'collecting',
  })).sort((a, b) => b.approved - a.approved)

  const groupOut = (['agent', 'person'] as const).map(k => {
    const n = GRADES.reduce((s, g) => s + groups[k][g], 0)
    return { key: k, grades: groups[k], n, passRate: n > 0 ? groups[k].pass / n : null }
  })
  return {
    windowStart, windowEnd, groups: groupOut,
    workers: list.map(({ projects: _p, ...w }) => w), comparisons, verifiers,
  }
}

// ─── 위험 ───

function risksOf(scope: Scope, pids: string[], period: Period, prev: Period, projects: Map<string, ScopedProject>, live: HeldIssue[] | null, completed: Map<string, string>, facts: Map<string, IssueFacts>): Risks {
  const decisionsIn = (p: Period) => verifyDecisions(pids, kstDayStartISO(p.start), kstDayStartISO(p.end))
  const cur = decisionsIn(period)
  const prevD = decisionsIn(prev)
  const rate = (d: typeof cur) => {
    const decided = d.filter(x => x.approvedAt || x.rejectedAt)
    return decided.length >= 5 ? decided.filter(x => x.rejectedAt).length / decided.length : null
  }
  // 반려가 많은 프로젝트(판정 5건 이상)
  let rejectTopProject: Risks['rejectTopProject'] = null
  const byP = new Map<string, { n: number; r: number }>()
  for (const d of cur) {
    const v = byP.get(d.projectId) ?? { n: 0, r: 0 }
    v.n++; if (d.rejectedAt) v.r++
    byP.set(d.projectId, v)
  }
  for (const [pid, v] of byP) {
    if (v.n < 5) continue
    const r = v.r / v.n
    if (!rejectTopProject || r > rejectTopProject.rate) rejectTopProject = { name: projects.get(pid)?.name ?? pid, rate: r }
  }
  // 한 사람 의존: 검증 판정 · 사람 처리 완료에서 한 사람 비중 50% 이상(10건 이상, 2명 이상)
  let concentration: Risks['concentration'] = null
  const check = (role: PersonRole, counts: Map<string, { name: string; n: number }>) => {
    const total = Array.from(counts.values()).reduce((s, v) => s + v.n, 0)
    if (counts.size < 2 || total < 10) return
    const top = Array.from(counts.values()).sort((a, b) => b.n - a.n)[0]
    const share = top.n / total
    if (share >= 0.5 && (!concentration || share > concentration.share)) concentration = { role, name: top.name, share, count: top.n, total }
  }
  const vc = new Map<string, { name: string; n: number }>()
  for (const d of cur) {
    const p = personOf(d.userId, d.userName, d.username)
    if (!p) continue
    const v = vc.get(p.key) ?? { name: p.name, n: 0 }
    v.n++; vc.set(p.key, v)
  }
  check('verify', vc)
  const pc = new Map<string, { name: string; n: number }>()
  for (const key of completed.keys()) {
    const f = facts.get(key)
    if (!f || formOf(f) !== 'human') continue
    const first = processRuns(f)[0]
    const p = personOf(first?.userId, first?.userName)
    if (!p) continue
    const v = pc.get(p.key) ?? { name: p.name, n: 0 }
    v.n++; pc.set(p.key, v)
  }
  check('process', pc)
  void scope
  return {
    concentration, rejectRate: rate(cur), prevRejectRate: rate(prevD), rejectTopProject,
    agedEnd: live ? live.filter(i => i.ageHours >= AGED_HOURS).length : null,
    prevAgedEnd: null,
  }
}

// ─── 월별 묶음(월간·연간) ───

function monthPoint(scope: Scope, pids: string[], m: Period, projects: Map<string, ScopedProject>, today: string, liveNow: number | null): MonthPoint {
  const completed = completedInRange(scope, m.start, m.end)
  const facts = issueFacts(Array.from(completed.keys()))
  const d = doneOf(completed, facts, projects)
  const c = costOf(execsInRange(scope, m.start, m.end), m)
  const totalMin = Array.from(c.projectMinutes.values()).reduce((s, v) => s + v, 0)
  const lastDay = addDays(m.end, -1)
  const heldEnd = m.start <= today && today <= lastDay && liveNow != null ? liveNow
    : lastDay < today ? heldOnDay(pids, lastDay) : null
  return {
    label: m.start.slice(0, 7), start: m.start,
    completed: completed.size, heldEnd,
    leadMedianH: d.done.leadMedianH,
    perCompleted: completed.size > 0 ? c.cost.total / completed.size : null,
    projectShares: Array.from(c.projectMinutes.entries())
      .map(([id, min]) => ({ id, name: projects.get(id)?.name ?? id, share: totalMin > 0 ? min / totalMin : 0 }))
      .sort((a, b) => b.share - a.share),
  }
}

// ─── 조립 ───

export function buildReportModel(scope: Scope, type: ReportType, day: string, now: Date = new Date()): ReportModel {
  resetPersonCache()
  const period = periodOf(type, day)
  const prev = previousPeriod(period)
  const today = kstToday(now)
  const isCurrent = !isClosed(period, now) && today >= period.start
  const projectList = scopedProjects(scope)
  const projects = new Map(projectList.map(p => [p.id, p]))
  const pids = projectList.map(p => p.id)

  // 접수·완료
  const received = receivedInRange(pids, period.start, period.end)
  const prevReceived = receivedInRange(pids, prev.start, prev.end)
  const completed = completedInRange(scope, period.start, period.end)
  const prevCompleted = completedInRange(scope, prev.start, prev.end)
  const facts = issueFacts([...completed.keys(), ...prevCompleted.keys()])

  const cur = doneOf(completed, facts, projects)
  const prevDone = doneOf(prevCompleted, facts, projects)

  // 보유
  const liveIssues = isCurrent ? liveHeld(heldNow(pids), projects, now).issues : null
  const endByProject = new Map<string, number>()
  let end: number | null
  if (liveIssues) {
    end = liveIssues.length
    for (const i of liveIssues) endByProject.set(i.projectId, (endByProject.get(i.projectId) ?? 0) + 1)
  } else {
    end = heldOnDay(pids, addDays(period.end, -1), endByProject)
  }
  const startByProject = new Map<string, number>()
  const start = heldOnDay(pids, addDays(period.start, -1), startByProject)
  const people = liveIssues ? peopleOf(liveIssues) : null
  let drainDays: number | null = null
  if (liveIssues) {
    const recent = completedInRange(scope, addDays(today, -28), addDays(today, 1))
    const recentFacts = issueFacts(Array.from(recent.keys()).filter(k => !facts.has(k)))
    const all = new Map([...facts, ...recentFacts])
    const n = Array.from(recent.keys()).filter(k => { const f = all.get(k); return f && formOf(f) !== 'direct' }).length
    drainDays = n > 0 ? liveIssues.length / (n / 28) : null
  }
  const held: Held = {
    live: !!liveIssues, end, start,
    inflow: received.size, completed: completed.size,
    gap: start != null && end != null ? start + received.size - completed.size - end : null,
    drainDays,
    byStage: liveIssues
      ? HELD_STAGES.map(stage => {
        const xs = liveIssues.filter(i => i.stage === stage)
        return { stage, count: xs.length, oldestHours: xs.length ? Math.max(...xs.map(i => i.ageHours)) : null }
      })
      : null,
    over7: liveIssues ? liveIssues.filter(i => i.ageHours >= AGED_HOURS).length : null,
    people,
    peopleTotal: people ? people.reduce((s, p) => s + p.count, 0) : null,
    issues: liveIssues ? [...liveIssues].sort((a, b) => b.ageHours - a.ageHours).slice(0, 300) : null,
  }

  // 추이
  const keys = buckets(period)
  const prevKeys = buckets(prev)
  const futureMask = keys.map(k => k > today)
  const trend: Trend = {
    labels: keys,
    inflow: countBy(type, received, keys).map((v, i) => (futureMask[i] ? null : v)),
    completed: countBy(type, completed, keys).map((v, i) => (futureMask[i] ? null : v)),
    prevInflow: countBy(type, prevReceived, prevKeys),
    prevCompleted: countBy(type, prevCompleted, prevKeys),
    held: heldSeries(type, pids, period, today, liveIssues ? liveIssues.length : null),
    prevHeld: heldSeries(type, pids, prev, today, null),
    prevInflowTotal: prevReceived.size,
  }

  // 비용·사람 시간·프로젝트
  const c = costOf(execsInRange(scope, period.start, period.end), period)
  const pc = costOf(execsInRange(scope, prev.start, prev.end), prev)
  const totalMin = Array.from(c.projectMinutes.values()).reduce((s, v) => s + v, 0)
  const prevTotalMin = Array.from(pc.projectMinutes.values()).reduce((s, v) => s + v, 0)
  const prevEndByProject = new Map<string, number>()
  heldOnDay(pids, addDays(prev.end, -1), prevEndByProject)
  const projectRows: ProjectRow[] = projectList.map(p => ({
    id: p.id, name: p.name, color: p.color,
    humanHours: (c.projectMinutes.get(p.id) ?? 0) / 60,
    share: totalMin > 0 ? (c.projectMinutes.get(p.id) ?? 0) / totalMin : 0,
    prevShare: prevTotalMin > 0 ? (pc.projectMinutes.get(p.id) ?? 0) / prevTotalMin : null,
    completed: cur.byProject.get(p.id) ?? 0,
    prevCompleted: prevDone.byProject.get(p.id) ?? 0,
    held: end != null ? endByProject.get(p.id) ?? 0 : null,
    prevHeld: start != null ? (startByProject.get(p.id) ?? 0) : (prevEndByProject.size ? prevEndByProject.get(p.id) ?? 0 : null),
  })).filter(r => r.humanHours > 0 || r.completed > 0 || r.prevCompleted > 0 || (r.held ?? 0) > 0)
    .sort((a, b) => b.humanHours - a.humanHours || b.completed - a.completed)

  const cost: Cost = {
    ...c.cost,
    perCompleted: completed.size > 0 ? c.cost.total / completed.size : null,
    prevPerCompleted: prevCompleted.size > 0 ? pc.cost.total / prevCompleted.size : null,
    humanHoursPerCompleted: completed.size > 0 && c.cost.humanHours > 0 ? c.cost.humanHours / completed.size : null,
  }

  const done: Done = { ...cur.done, prevTotal: prevCompleted.size, prevFirstPass: prevDone.done.firstPass }

  const model: ReportModel = {
    version: 2, type,
    period: { start: period.start, end: period.end },
    prevPeriod: { start: prev.start, end: prev.end },
    isCurrent, computedAt: now.toISOString(),
    heldTrackingSince: heldTrackingSince(),
    held,
    actions: liveIssues && people ? actionsOf(liveIssues, people) : null,
    done, trend, projects: projectRows, cost,
    completedList: cur.list,
  }

  if (type !== 'weekly') {
    const months = type === 'monthly' ? lastMonths(period, 6) : buckets(period).map(d => periodOf('monthly', d))
    model.months = months.filter(m => m.start <= today).map(m => monthPoint(scope, pids, m, projects, today, liveIssues ? liveIssues.length : null))
    model.risks = risksOf(scope, pids, period, prev, projects, liveIssues, completed, facts)
    model.evaluation = evaluationOf(scope, pids, period.end, today)
  }
  return model
}
