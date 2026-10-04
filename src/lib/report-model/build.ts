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
  overturnedKeys, personOf, resetPersonCache, avatarsOfPersonKeys, receivedInRange, verifyDecisions, confirmRejections,
  loadIssueHistory, heldReceipts, receiptBefore, isExternalRow, byIssue,
  type Scope, type IssueFacts, type IssueExec, type HeldRow, type ScopedProject, type IssueHistory, type CycleEvent,
} from './load'
import {
  median, quantile, wilson, requiredSamplePerGroup, gradeOf, normalizeModel, allocateWork, businessSegmentsKST,
  type WorkSegment,
} from './compute'
import {
  GRADES, HELD_STAGES, FLOW_STAGES,
  type ReportModel, type WorkForm, type HeldIssue, type HeldPerson, type Held, type ActionItems, type Concentration,
  type Done, type Trend, type ProjectRow, type Cost, type PersonRole, type Grade, type Evaluation, type WorkerEval,
  type MonthPoint, type Risks, type CompletedItem, type FlowStage, type StageTime,
} from './types'
import { AGED_HOURS, MIN_SAMPLE, DEFAULT_PROJECT_COLOR } from './format'

const HOUR = 3_600_000
const MATURITY_DAYS = 30
const EVAL_WINDOW_DAYS = 90
const ALL_TIME = '1970-01-01T00:00:00.000Z'

// 프로젝트 → Git 공급자 (사람 식별에 쓴다). buildReportModel·liveHeldAll 이 요청마다 범위의 프로젝트로 채운다
const providerByProject = new Map<string, string>()
const projectProvider = (projectId: string): string | null => providerByProject.get(projectId) ?? null
function setProviders(projects: ScopedProject[]) {
  providerByProject.clear()
  for (const p of projects) providerByProject.set(p.id, p.provider)
}

// ─── 실행·이슈 판정 ───

const isStageRow = (id: string) => id.startsWith('ex-verify') || id.startsWith('ex-confirm')
const isProcessExec = (e: { id: string }) =>
  !isStageRow(e.id) && !e.id.startsWith('ex-conflict') && !e.id.startsWith('exec-chat') && !e.id.startsWith('ex-reproduce')
const isAgentProcess = (e: IssueExec) => isProcessExec(e) && !!e.agentId && e.assigneeType !== 'user'
const isExternal = (e: IssueExec) => isProcessExec(e) && isExternalRow(e)

function formOf(f: IssueFacts): WorkForm {
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

function hoursBetween(a: string | null, b: string | null): number | null {
  if (!a || !b) return null
  const d = (new Date(b).getTime() - new Date(a).getTime()) / HOUR
  return Number.isFinite(d) && d >= 0 ? d : null
}

// ─── 사람 작업시간·비용 ───

function personForExec(e: ReportExecution) {
  return personOf(e.userId, e.userName, e.id.startsWith('ex-verify') ? e.verifierUsername : null, e.projectProvider)
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
  // 구독료 배부는 KST 0시의 UTC 시각으로 받는다(날짜 문자열을 넘기면 끝 날짜까지 하루가 더 배부된다)
  const policy = buildAiCostPolicy(execs, kstDayStartISO(period.start), kstDayStartISO(period.end))
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

function personOfHeld(r: HeldRow): { key: string; name: string; strong: boolean; role: PersonRole } | null {
  if (r.stage === 'dev') {
    if (r.activeAssigneeType !== 'user') return null // 에이전트가 처리 중
    const p = personOf(r.activeUserId, r.activeUserName, r.assigneeUsername, r.provider)
    return p ? { ...p, role: 'process' } : null
  }
  if (r.stage === 'waiting') {
    if (r.assignMode !== 'assignee') return null // 에이전트 배정 대기
    const p = personOf(r.assigneeGitUserId, r.assigneeName, r.assigneeUsername, r.provider)
    return p ? { ...p, role: 'process' } : null
  }
  if (r.stage === 'dev_fail') return null
  if (r.stage === 'verify_waiting' || r.stage === 'verifying') {
    if (r.presetVerifierMode === 'agent') return null
    const p = personOf(r.assigneeGitUserId, r.assigneeName, r.assigneeUsername, r.provider)
    return p ? { ...p, role: 'verify' } : null
  }
  if (r.presetConfirmerMode === 'agent') return null
  const p = r.stage === 'confirming' && (r.confirmerUserId || r.confirmerName)
    ? personOf(r.confirmerUserId, r.confirmerName, null, r.provider)
    : personOf(r.assigneeGitUserId, r.assigneeName, r.assigneeUsername, r.provider)
  return p ? { ...p, role: 'confirm' } : null
}

/** 지금 보유 중인 일 — 나이는 이번 사이클 접수(마지막 재오픈, 없으면 처음 접수)부터 */
function liveHeld(pids: string[], projects: Map<string, ScopedProject>, now: Date): HeldIssue[] {
  const receipts = heldReceipts(pids)
  return heldNow(pids).map(r => {
    const who = personOfHeld(r)
    const at = receipts.get(`${r.projectId}:${r.iid}`)
    const age = at ? Math.max(0, (now.getTime() - new Date(at).getTime()) / HOUR) : 0
    return {
      projectId: r.projectId, projectName: projects.get(r.projectId)?.name ?? r.projectId, iid: r.iid, title: r.title,
      stage: r.stage, ageHours: age, personKey: who?.key ?? null, personName: who?.name ?? null, personStrong: who?.strong ?? false, role: who?.role ?? null,
    }
  })
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
  // 역할마다: 그 역할 보유의 절반 이상(3건 이상)을 한 사람이 들고 있으면 몰림
  const concentrations: Concentration[] = []
  for (const role of ['process', 'verify', 'confirm'] as PersonRole[]) {
    const holders = people.filter(p => p.role === role) // 건수 많은 순
    if (holders.length === 0) continue
    const total = holders.reduce((s, p) => s + p.count, 0)
    const top = holders[0]
    // 같은 건수로 둘 이상이 들고 있으면 "한 사람"에게 몰린 것이 아니다
    if (top.count >= 3 && top.count / total >= 0.5 && holders[1]?.count !== top.count) {
      concentrations.push({ role, name: top.name, count: top.count, roleTotal: total, roleHolders: holders.length, oldestHours: top.oldestHours })
    }
  }
  return { failed, aged, concentrations }
}

/** 날짜(KST)의 하루 마감 보유. 그날 기록이 하나도 없으면 null. over7 은 그날 모든 줄에 기록이 있을 때만 */
function heldOnDay(pids: string[], day: string, byProject?: Map<string, number>): { total: number; over7: number | null } | null {
  const rows = heldDaily(pids, day, addDays(day, 1))
  if (rows.length === 0) return null
  for (const r of rows) byProject?.set(r.projectId, r.total)
  return {
    total: rows.reduce((s, r) => s + r.total, 0),
    over7: rows.every(r => r.over7 != null) ? rows.reduce((s, r) => s + (r.over7 ?? 0), 0) : null,
  }
}

// ─── 완료 ───

interface DoneCalc {
  done: Omit<Done, 'prevTotal' | 'prevFirstPass'>
  list: CompletedItem[]
  byProject: Map<string, number>
}

/** 끝낸 일 — 완료한 사이클마다(다시 열렸다 다시 끝난 일은 그때마다 한 건) */
function doneOf(completed: CycleEvent[], facts: Map<string, IssueFacts>, history: Map<string, IssueHistory>, projects: Map<string, ScopedProject>, confirmRej: Map<string, string[]>): DoneCalc {
  const byForm: Record<WorkForm, number> = { agent: 0, human: 0, direct: 0 }
  const leads: number[] = []
  let humanH = 0, totalH = 0, fpPass = 0, fpN = 0
  const list: CompletedItem[] = []
  const byProject = new Map<string, number>()
  for (const { key, at } of completed) {
    const f = facts.get(key)
    if (!f) continue
    const form = formOf(f)
    byForm[form]++
    byProject.set(f.projectId, (byProject.get(f.projectId) ?? 0) + 1)
    // 처리 기간 = 이번 사이클 접수 → 완료 (직접 처리·사후 기록은 접수 시각이 없으므로 재지 않는다)
    const lead = form !== 'direct' ? hoursBetween(receiptBefore(history.get(key), at), at) : null
    if (lead != null) leads.push(lead)
    if (form === 'agent') {
      const runs = processRuns(f)
      const devEnd = runs.map(e => e.endedAt).filter((t): t is string => !!t && t <= at).sort().pop() ?? null
      const humanPart = hoursBetween(devEnd, at)
      if (lead != null && humanPart != null && lead > 0) { totalH += lead; humanH += Math.min(humanPart, lead) }
      fpN++
      // 작업 결과 평가의 "한 번에 통과"와 같은 기준 — 확인 단계 반려도 반려다
      if (runs.length <= 1 && rejectCount(f, confirmRej.get(key)) === 0) fpPass++
    }
    list.push({ projectId: f.projectId, projectName: projects.get(f.projectId)?.name ?? f.projectId, iid: f.iid, title: f.title, form, completedAt: at, leadH: lead })
  }
  list.sort((a, b) => (a.completedAt < b.completedAt ? 1 : -1))
  return {
    done: {
      total: completed.length, byForm,
      leadMedianH: median(leads), leadP90H: quantile(leads, 0.9),
      humanWaitShare: totalH > 0 ? humanH / totalH : null,
      firstPass: fpN > 0 ? fpPass / fpN : null,
    },
    list, byProject,
  }
}

// ─── 단계별 시간 ───

type Activity = { kind: 'dev' | 'verifying' | 'confirming'; start: number; end: number; ok: boolean }

/**
 * 한 사이클(접수 lo → 완료 hi)을 단계로 나눈 시간(시).
 * 처리 실행·검증 기록(ex-verify)·확인 기록(ex-confirm)이 열려 있던 동안은 그 단계(겹치면 나중에 시작한 쪽),
 * 아무것도 열려 있지 않은 동안은 마지막으로 끝난 일이 정한 대기 —
 * 처리 성공 → 검증 대기, 검증 승인 → 확인 대기, 처리 실패·반려(검증·확인) 또는 아직 아무것도 없음 → 처리 대기.
 */
export function stageHoursOf(execs: IssueExec[], lo: number, hi: number): Record<FlowStage, number> {
  const out = Object.fromEntries(FLOW_STAGES.map(s => [s, 0])) as Record<FlowStage, number>
  const acts: Activity[] = []
  for (const e of execs) {
    const kind = e.id.startsWith('ex-verify') ? 'verifying' : e.id.startsWith('ex-confirm') ? 'confirming' : isProcessExec(e) ? 'dev' : null
    if (!kind) continue
    const start = new Date(e.startedAt).getTime()
    const end = e.endedAt ? new Date(e.endedAt).getTime() : hi
    if (!Number.isFinite(start) || !Number.isFinite(end) || end <= lo || start >= hi) continue
    acts.push({ kind, start, end: Math.max(start, end), ok: e.status === 'success' })
  }
  const cuts = [...new Set([lo, hi, ...acts.flatMap(a => [a.start, a.end]).filter(t => t > lo && t < hi)])].sort((a, b) => a - b)
  for (let i = 0; i + 1 < cuts.length; i++) {
    const a = cuts[i], b = cuts[i + 1]
    const open = acts.filter(x => x.start <= a && x.end >= b && x.end > x.start).sort((x, y) => y.start - x.start)[0]
    let st: FlowStage
    if (open) st = open.kind
    else {
      const last = acts.filter(x => x.end <= a).sort((x, y) => y.end - x.end || y.start - x.start)[0]
      st = !last || !last.ok ? 'waiting'
        : last.kind === 'dev' ? 'verify_waiting'
        : last.kind === 'verifying' ? 'confirm_waiting'
        : 'confirming' // 확인을 마친 뒤 완료 시각까지 남은 틈
    }
    out[st] += (b - a) / HOUR
  }
  return out
}

/** 끝낸 일들의 단계별 합계 — 접수 시각이 없는 일(직접 처리·사후 기록)은 재지 않는다 */
function stageTotalsOf(completed: CycleEvent[], facts: Map<string, IssueFacts>, history: Map<string, IssueHistory>): { n: number; sum: Record<FlowStage, number> } {
  const sum = Object.fromEntries(FLOW_STAGES.map(s => [s, 0])) as Record<FlowStage, number>
  let n = 0
  for (const { key, at } of completed) {
    const f = facts.get(key)
    if (!f || formOf(f) === 'direct') continue
    const receipt = receiptBefore(history.get(key), at)
    if (!receipt) continue
    const lo = new Date(receipt).getTime(), hi = new Date(at).getTime()
    if (!(hi > lo)) continue
    const h = stageHoursOf(f.execs, lo, hi)
    for (const s of FLOW_STAGES) sum[s] += h[s]
    n++
  }
  return { n, sum }
}

function stageRows(t: { n: number; sum: Record<FlowStage, number> }) {
  const total = FLOW_STAGES.reduce((s, k) => s + t.sum[k], 0)
  return FLOW_STAGES.map(stage => ({ stage, avgH: t.n > 0 ? t.sum[stage] / t.n : 0, share: total > 0 ? t.sum[stage] / total : 0 }))
}

/** 단계별 시간 — 화면·메일의 「어디서 시간이 걸렸나」 */
export function stageTimeOf(completed: CycleEvent[], prevCompleted: CycleEvent[], facts: Map<string, IssueFacts>, history: Map<string, IssueHistory>): StageTime {
  const cur = stageTotalsOf(completed, facts, history)
  const prev = stageTotalsOf(prevCompleted, facts, history)
  return {
    n: cur.n,
    avgH: cur.n > 0 ? FLOW_STAGES.reduce((s, k) => s + cur.sum[k], 0) / cur.n : null,
    stages: stageRows(cur),
    prevN: prev.n,
    prevStages: prev.n > 0 ? stageRows(prev) : null,
  }
}

/**
 * 단계별 시간만 따로 — 이 항목이 생기기 전에 확정된 보고서를 읽을 때 채운다.
 * 실행 기록은 지난 기간에 대해 바뀌지 않으므로 확정 당시 계산과 같은 값이다.
 */
export function stageTimeForPeriod(scope: Scope, type: ReportType, day: string): StageTime {
  const pids = scopedProjects(scope).map(p => p.id)
  const period = periodOf(type, day)
  const prev = previousPeriod(period)
  const history = loadIssueHistory(pids)
  const completed = completedInRange(history, period.start, period.end)
  const prevCompleted = completedInRange(history, prev.start, prev.end)
  const facts = issueFacts([...new Set([...completed, ...prevCompleted].map(x => x.key))])
  return stageTimeOf(completed, prevCompleted, facts, history)
}

// ─── 추이 ───

function bucketKey(type: ReportType, iso: string): string {
  const d = kstDayOf(iso)
  return type === 'yearly' ? `${d.slice(0, 7)}-01` : d
}

function countBy(type: ReportType, events: CycleEvent[], keys: string[]): number[] {
  const idx = new Map(keys.map((k, i) => [k, i]))
  const out = keys.map(() => 0)
  for (const { at } of events) {
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

/** 조립 중 여러 섹션이 함께 쓰는 데이터 — 한 번만 읽는다 */
interface Ctx {
  pids: string[]
  projects: Map<string, ScopedProject>
  history: Map<string, IssueHistory>
  /** 확인 반려(전 기간) — 완료의 "한 번에 통과"와 평가 등급이 같은 기준을 쓴다 */
  confirmRej: Map<string, string[]>
  today: string
}

const emptyGrades = (): Record<Grade, number> => ({ pass: 0, rerun: 0, rejected_pass: 0, rejected_repeat: 0, overturned: 0 })

/** 모델이 기록된 에이전트는 모델 이름, 없으면 CLI 이름(모델 미기록 표시) */
function agentWorker(model: string | null | undefined, cli: string | null | undefined): { key: string; name: string; modelUnknown: boolean } {
  const m = normalizeModel(model)
  return m ? { key: `m:${m}`, name: m, modelUnknown: false } : { key: `m:?${cli || 'agent'}`, name: cli || 'agent', modelUnknown: true }
}

function evaluationOf(c: Ctx, periodEnd: string): Evaluation {
  const windowEnd = addDays(periodEnd < c.today ? periodEnd : c.today, -MATURITY_DAYS)
  const windowStart = addDays(windowEnd, -EVAL_WINDOW_DAYS)
  // 평가는 이슈마다 한 번(그 이슈의 처리 이력 전체로 등급을 매긴다)
  const completed = byIssue(completedInRange(c.history, windowStart, windowEnd))
  const facts = issueFacts(Array.from(completed.keys()))
  const sinceISO = kstDayStartISO(windowStart)
  const overturned = overturnedKeys(c.pids, sinceISO)

  const workers = new Map<string, WorkerEval & { projects: Set<string> }>()
  const groups = { agent: emptyGrades(), person: emptyGrades() }
  for (const key of completed.keys()) {
    const f = facts.get(key)
    if (!f || !wasReviewed(f)) continue
    const form = formOf(f)
    if (form === 'direct') continue
    const runs = processRuns(f)
    const grade = gradeOf({ runs: runs.length, rejects: rejectCount(f, c.confirmRej.get(key)), overturned: overturned.has(key) })
    let who: { key: string; name: string; modelUnknown?: boolean }, kind: 'agent' | 'person'
    if (form === 'agent') {
      const firstAgent = runs.find(isAgentProcess) ?? runs[0]
      who = agentWorker(firstAgent?.modelName, firstAgent?.cliName)
      kind = 'agent'
    } else {
      const p = personOf(runs[0]?.userId, runs[0]?.userName, null, projectProvider(f.projectId))
      if (!p) continue
      who = { key: p.key, name: p.name }
      kind = 'person'
    }
    groups[kind][grade]++
    const w = workers.get(who.key) ?? {
      key: who.key, name: who.name, ...(who.modelUnknown ? { modelUnknown: true } : {}), kind,
      grades: emptyGrades(), n: 0, passRate: null, ciLow: null, ciHigh: null, state: 'collecting' as const, projects: new Set<string>(),
    }
    w.grades[grade]++
    w.n++
    w.projects.add(f.projectId)
    workers.set(who.key, w)
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
        a: a.name, b: b.name, aKey: a.key, bKey: b.key, state: overlap ? 'unclear' : 'clear',
        needMore: overlap && need != null ? Math.max(0, need - Math.min(a.n, b.n)) : null,
        differentProjects: union > 0 && inter / union < 0.5,
      })
    }
  }

  // 검증자: 승인한 일이 확인 단계에서 반려된 비율
  const decisions = verifyDecisions(c.pids, sinceISO, kstDayStartISO(windowEnd))
  const vmap = new Map<string, { key: string; name: string; modelUnknown?: boolean; approved: number; laterRejected: number }>()
  for (const d of decisions) {
    if (!d.approvedAt) continue
    // 에이전트 검증자는 모델 단위(에이전트 이름으로 나누지 않는다), 사람은 통합 식별자
    const p = d.byAgent ? agentWorker(d.model, null) : personOf(d.userId, d.userName, d.username, projectProvider(d.projectId))
    if (!p) continue
    const cur = vmap.get(p.key) ?? { key: p.key, name: p.name, ...('modelUnknown' in p && p.modelUnknown ? { modelUnknown: true } : {}), approved: 0, laterRejected: 0 }
    cur.approved++
    const rej = c.confirmRej.get(`${d.projectId}:${d.iid}`) ?? []
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

function risksOf(c: Ctx, period: Period, prev: Period, completed: CycleEvent[], facts: Map<string, IssueFacts>): Risks {
  const decisionsIn = (p: Period) => verifyDecisions(c.pids, kstDayStartISO(p.start), kstDayStartISO(p.end))
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
    if (!d.approvedAt && !d.rejectedAt) continue // 판단 불가·오류는 판정이 아니다
    const v = byP.get(d.projectId) ?? { n: 0, r: 0 }
    v.n++; if (d.rejectedAt) v.r++
    byP.set(d.projectId, v)
  }
  for (const [pid, v] of byP) {
    if (v.n < 5) continue
    const r = v.r / v.n
    if (!rejectTopProject || r > rejectTopProject.rate) rejectTopProject = { name: c.projects.get(pid)?.name ?? pid, rate: r }
  }
  // 한 사람 의존: 역할(검증 판정 · 사람 처리 완료)마다 한 사람 비중 50% 이상(10건 이상)
  const concentrations: Risks['concentrations'] = []
  const check = (role: PersonRole, counts: Map<string, { name: string; n: number }>) => {
    const total = Array.from(counts.values()).reduce((s, v) => s + v.n, 0)
    if (total < 10) return
    const [top, second] = Array.from(counts.values()).sort((a, b) => b.n - a.n)
    const share = top.n / total
    if (share >= 0.5 && second?.n !== top.n) concentrations.push({ role, name: top.name, share, count: top.n, total })
  }
  const vc = new Map<string, { name: string; n: number }>()
  for (const d of cur) {
    if (d.byAgent) continue // 검증 에이전트는 사람 의존도가 아니다
    const p = personOf(d.userId, d.userName, d.username, projectProvider(d.projectId))
    if (!p) continue
    const v = vc.get(p.key) ?? { name: p.name, n: 0 }
    v.n++; vc.set(p.key, v)
  }
  check('verify', vc)
  const pc = new Map<string, { name: string; n: number }>()
  for (const { key } of completed) {
    const f = facts.get(key)
    if (!f || formOf(f) !== 'human') continue
    const first = processRuns(f)[0]
    const p = personOf(first?.userId, first?.userName, null, projectProvider(f.projectId))
    if (!p) continue
    const v = pc.get(p.key) ?? { name: p.name, n: 0 }
    v.n++; pc.set(p.key, v)
  }
  check('process', pc)
  return { concentrations, rejectRate: rate(cur), prevRejectRate: rate(prevD), rejectTopProject }
}

// ─── 월별 묶음(월간·연간) ───

function monthPoint(c: Ctx, scope: Scope, m: Period, liveNow: number | null): MonthPoint {
  const completed = completedInRange(c.history, m.start, m.end)
  const facts = issueFacts(completed.map(x => x.key))
  const d = { ...doneOf(completed, facts, c.history, c.projects, c.confirmRej), facts }
  const cost = costOf(execsInRange(scope, m.start, m.end), m)
  const totalMin = Array.from(cost.projectMinutes.values()).reduce((s, v) => s + v, 0)
  const lastDay = addDays(m.end, -1)
  const heldEnd = m.start <= c.today && c.today <= lastDay && liveNow != null ? liveNow
    : lastDay < c.today ? heldOnDay(c.pids, lastDay)?.total ?? null : null
  return {
    label: m.start.slice(0, 7), start: m.start,
    completed: completed.length, heldEnd,
    leadMedianH: d.done.leadMedianH,
    stageShares: (() => {
      const t = stageTotalsOf(completed, d.facts, c.history)
      return t.n > 0 ? stageRows(t).map(({ stage, share }) => ({ stage, share })) : null
    })(),
    projectShares: Array.from(cost.projectMinutes.entries())
      .map(([id, min]) => ({ id, name: c.projects.get(id)?.name ?? id, color: c.projects.get(id)?.color ?? DEFAULT_PROJECT_COLOR, share: totalMin > 0 ? min / totalMin : 0 }))
      .sort((a, b) => b.share - a.share),
  }
}

// ─── 조립 ───

export function buildReportModel(scope: Scope, type: ReportType, day: string, now: Date = new Date()): ReportModel {
  resetPersonCache()
  const projectList = scopedProjects(scope)
  setProviders(projectList)
  const period = periodOf(type, day)
  const prev = previousPeriod(period)
  const today = kstToday(now)
  const isCurrent = !isClosed(period, now) && today >= period.start
  const pids = projectList.map(p => p.id)
  const c: Ctx = {
    pids, projects: new Map(projectList.map(p => [p.id, p])),
    history: loadIssueHistory(pids), confirmRej: confirmRejections(pids, ALL_TIME), today,
  }

  // 접수·완료
  const completed = completedInRange(c.history, period.start, period.end)
  const prevCompleted = completedInRange(c.history, prev.start, prev.end)
  const facts = issueFacts([...new Set([...completed, ...prevCompleted].map(x => x.key))])
  const received = receivedInRange(c.history, period.start, period.end)
  const prevReceived = receivedInRange(c.history, prev.start, prev.end)
  const cur = doneOf(completed, facts, c.history, c.projects, c.confirmRej)
  const prevDone = doneOf(prevCompleted, facts, c.history, c.projects, c.confirmRej)

  // 보유 — 진행 중이면 지금, 닫힌 기간이면 기간 말 마감 기록. 기초 = 지난 기간 말 마감 기록
  const liveIssues = isCurrent ? liveHeld(pids, c.projects, now) : null
  const endByProject = new Map<string, number>()
  let end: number | null, over7: number | null
  if (liveIssues) {
    end = liveIssues.length
    over7 = liveIssues.filter(i => i.ageHours >= AGED_HOURS).length
    for (const i of liveIssues) endByProject.set(i.projectId, (endByProject.get(i.projectId) ?? 0) + 1)
  } else {
    const e = heldOnDay(pids, addDays(period.end, -1), endByProject)
    end = e?.total ?? null
    over7 = e?.over7 ?? null
  }
  const startByProject = new Map<string, number>()
  const s = heldOnDay(pids, addDays(period.start, -1), startByProject)
  const start = s?.total ?? null
  const people = liveIssues ? peopleOf(liveIssues) : null
  let drainDays: number | null = null
  if (liveIssues) {
    // 최근 28일 하루 평균 완료(직접 처리·사후 기록 제외 — 보유를 거치지 않은 일이다)
    const n = completedInRange(c.history, addDays(today, -28), addDays(today, 1)).filter(x => !c.history.get(x.key)?.direct).length
    drainDays = n > 0 ? liveIssues.length / (n / 28) : null
  }
  const held: Held = {
    live: !!liveIssues, end, start,
    inflow: received.length, completed: completed.length,
    gap: start != null && end != null ? start + received.length - completed.length - end : null,
    leftUndone: liveIssues
      ? (() => {
        const heldKeys = new Set(liveIssues.map(i => `${i.projectId}:${i.iid}`))
        return received.filter(r => !heldKeys.has(r.key) && !(c.history.get(r.key)?.completions ?? []).some(at => at >= r.at)).length
      })()
      : null,
    drainDays,
    byStage: liveIssues
      ? HELD_STAGES.map(stage => {
        const xs = liveIssues.filter(i => i.stage === stage)
        return { stage, count: xs.length, oldestHours: xs.length ? Math.max(...xs.map(i => i.ageHours)) : null }
      })
      : null,
    over7, prevOver7: s?.over7 ?? null,
    people,
    peopleTotal: people ? people.reduce((sum, p) => sum + p.count, 0) : null,
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
  }

  // 비용·사람 시간·프로젝트
  const cc = costOf(execsInRange(scope, period.start, period.end), period)
  const pc = costOf(execsInRange(scope, prev.start, prev.end), prev)
  const totalMin = Array.from(cc.projectMinutes.values()).reduce((sum, v) => sum + v, 0)
  const prevTotalMin = Array.from(pc.projectMinutes.values()).reduce((sum, v) => sum + v, 0)
  const projectRows: ProjectRow[] = projectList.map(p => ({
    id: p.id, name: p.name, color: p.color,
    humanHours: (cc.projectMinutes.get(p.id) ?? 0) / 60,
    prevHumanHours: (pc.projectMinutes.get(p.id) ?? 0) / 60,
    share: totalMin > 0 ? (cc.projectMinutes.get(p.id) ?? 0) / totalMin : 0,
    prevShare: prevTotalMin > 0 ? (pc.projectMinutes.get(p.id) ?? 0) / prevTotalMin : null,
    completed: cur.byProject.get(p.id) ?? 0,
    prevCompleted: prevDone.byProject.get(p.id) ?? 0,
    held: end != null ? endByProject.get(p.id) ?? 0 : null,
    prevHeld: start != null ? startByProject.get(p.id) ?? 0 : null,
  })).filter(r => r.humanHours > 0 || r.prevHumanHours > 0 || r.completed > 0 || r.prevCompleted > 0 || (r.held ?? 0) > 0)
    .sort((a, b) => b.humanHours - a.humanHours || b.completed - a.completed)

  const cost: Cost = {
    ...cc.cost,
    perCompleted: completed.length > 0 ? cc.cost.total / completed.length : null,
    prevPerCompleted: prevCompleted.length > 0 ? pc.cost.total / prevCompleted.length : null,
    humanHoursPerCompleted: completed.length > 0 && cc.cost.humanHours > 0 ? cc.cost.humanHours / completed.length : null,
  }

  const model: ReportModel = {
    version: 2, type,
    period: { start: period.start, end: period.end },
    isCurrent,
    heldTrackingSince: heldTrackingSince(pids),
    held,
    actions: liveIssues && people ? actionsOf(liveIssues, people) : null,
    done: { ...cur.done, prevTotal: prevCompleted.length, prevFirstPass: prevDone.done.firstPass },
    stageTime: stageTimeOf(completed, prevCompleted, facts, c.history),
    trend, projects: projectRows, cost,
    completedList: cur.list,
  }

  if (type !== 'weekly') {
    const months = type === 'monthly' ? lastMonths(period, 6) : buckets(period).map(d => periodOf('monthly', d))
    model.months = months.filter(m => m.start <= today).map(m => monthPoint(c, scope, m, liveIssues ? liveIssues.length : null))
    model.risks = risksOf(c, period, prev, completed, facts)
    model.evaluation = evaluationOf(c, period.end)
  }
  model.avatars = avatarsOfPersonKeys([
    ...(model.held.people ?? []).map(p => p.key),
    ...(model.evaluation?.workers ?? []).filter(w => w.kind === 'person').map(w => w.key),
    ...(model.evaluation?.verifiers ?? []).map(v => v.key),
  ])
  return model
}

/**
 * 지금 보유 중인 일 전부(전체 범위, 자르지 않음) — "내 손에 있는 일"(메일·화면)용.
 * 받는 사람의 공유 범위와 무관하게 그 사람이 확실히 식별되어 들고 있는 일만 골라 쓴다(personStrong).
 */
export function liveHeldAll(now: Date = new Date()): HeldIssue[] {
  resetPersonCache()
  const all = scopedProjects(null)
  setProviders(all)
  return liveHeld(all.map(p => p.id), new Map(all.map(p => [p.id, p])), now)
}

/** 그 사람 손에 있는 일 — 확실히 식별된 담당만(표시 이름만 같은 다른 사람의 일은 넣지 않는다). 오래된 순 */
export function mineFrom(all: HeldIssue[], userId: string): HeldIssue[] {
  return all.filter(i => i.personStrong && i.personKey === `u:${userId}`).sort((a, b) => b.ageHours - a.ageHours)
}
