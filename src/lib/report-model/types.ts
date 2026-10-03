/**
 * 보고서 모델 — 화면·메일·확정본이 함께 쓰는 단 하나의 보고서 데이터.
 * 숫자는 여기서만 계산한다. 화면과 메일은 이 값을 그리기만 한다.
 * 기록이 없는 값은 0 이 아니라 null 이다(화면은 "기록 없음"으로 그린다).
 */
import type { ReportType } from './period'

export type WorkForm = 'agent' | 'human' | 'direct'
export type HeldStage = 'waiting' | 'dev' | 'dev_fail' | 'verify_waiting' | 'verifying' | 'confirm_waiting' | 'confirming'
export const HELD_STAGES: HeldStage[] = ['waiting', 'dev', 'dev_fail', 'verify_waiting', 'verifying', 'confirm_waiting', 'confirming']
export type PersonRole = 'process' | 'verify' | 'confirm'

export interface IssueRef {
  projectId: string
  projectName: string
  iid: number
  title: string | null
}

export interface HeldIssue extends IssueRef {
  stage: HeldStage
  /** 접수 후 경과 시간 */
  ageHours: number
  /** 사람 손에 있으면 그 사람 */
  personKey: string | null
  personName: string | null
  /** 사람이 확실히 식별됐는가(IVE id·공급자까지 맞춘 Git id/계정·관리자 연결). 표시 이름만으로 정했으면 false */
  personStrong: boolean
  role: PersonRole | null
}

export interface HeldPerson {
  key: string
  name: string
  role: PersonRole
  count: number
  oldestHours: number
}

export interface Held {
  /** 진행 중인 기간이면 true — 지금 이 순간의 실제 건수(issue_stages) */
  live: boolean
  /** 기간 말(진행 중이면 지금) 보유. 기록이 없으면 null */
  end: number | null
  /** 지난 기간 말 보유. 기록이 없으면 null */
  start: number | null
  inflow: number
  completed: number
  /** start + inflow − completed − end. 0 이 아니면 집계 차이(범위 밖으로 옮겨진 이슈 등). 계산 불가면 null */
  gap: number | null
  /** 지금 보유 ÷ 최근 28일 하루 평균 완료(사후 기록 제외) */
  drainDays: number | null
  byStage: { stage: HeldStage; count: number; oldestHours: number | null }[] | null
  /** 7일 넘게 보유 중인 일 — 진행 중이면 지금, 닫힌 기간이면 기간 말(기록이 없으면 null) */
  over7: number | null
  /** 지난 기간 말 7일 넘게 보유 중이던 일(기록이 없으면 null) */
  prevOver7: number | null
  people: HeldPerson[] | null
  /** 사람 손 보유 합계 */
  peopleTotal: number | null
}

/** 한 역할의 보유가 한 사람에게 몰림(그 역할 보유의 절반 이상, 3건 이상) — 역할마다 하나까지 */
export interface Concentration {
  role: PersonRole
  name: string
  count: number
  roleTotal: number
  roleHolders: number
  oldestHours: number
}

export interface ActionItems {
  failed: (IssueRef & { hours: number })[]
  aged: HeldIssue[]
  concentrations: Concentration[]
}

export interface Done {
  total: number
  prevTotal: number
  byForm: Record<WorkForm, number>
  /** 접수 → 완료 (사후 기록 제외), 시간 */
  leadMedianH: number | null
  leadP90H: number | null
  /** 그중 사람(검증·확인)을 기다린 비율 0~1, AI 처리 이슈 기준 */
  humanWaitShare: number | null
  /** AI 처리 이슈 중 재실행·반려 없이 끝난 비율 */
  firstPass: number | null
  prevFirstPass: number | null
}

export interface Trend {
  labels: string[]
  inflow: (number | null)[]
  completed: (number | null)[]
  prevInflow: number[]
  prevCompleted: number[]
  held: (number | null)[]
  prevHeld: (number | null)[]
}

export interface ProjectRow {
  id: string
  name: string
  /** 프로젝트 주제색(프로젝트 설정의 구분 색) — 프로젝트별 차트가 이 색으로 칠한다 */
  color: string
  humanHours: number
  prevHumanHours: number
  share: number
  prevShare: number | null
  completed: number
  prevCompleted: number
  held: number | null
  prevHeld: number | null
}

export interface Cost {
  humanHours: number
  people: number
  humanCost: number
  aiActual: number
  aiNotional: number
  total: number
  perCompleted: number | null
  prevPerCompleted: number | null
  humanHoursPerCompleted: number | null
  /** 사람 비용 산정 기준이 없으면(월급 미설정) false */
  humanRateSet: boolean
}

export type Grade = 'pass' | 'rerun' | 'rejected_pass' | 'rejected_repeat' | 'overturned'
export const GRADES: Grade[] = ['pass', 'rerun', 'rejected_pass', 'rejected_repeat', 'overturned']

export interface WorkerEval {
  key: string
  /** 사람 이름 또는 모델 이름. 모델이 기록되지 않았으면 CLI 이름(modelUnknown) */
  name: string
  modelUnknown?: boolean
  kind: 'agent' | 'person'
  grades: Record<Grade, number>
  n: number
  passRate: number | null
  ciLow: number | null
  ciHigh: number | null
  state: 'ok' | 'collecting'
}

export interface Evaluation {
  windowStart: string
  windowEnd: string
  groups: { key: 'agent' | 'person'; grades: Record<Grade, number>; n: number; passRate: number | null }[]
  workers: WorkerEval[]
  /** 처리 작업자 중 둘씩 비교한 판단(표본 충분한 쌍만) */
  comparisons: { a: string; b: string; aKey: string; bKey: string; state: 'clear' | 'unclear'; needMore: number | null; differentProjects: boolean }[]
  verifiers: { key: string; name: string; modelUnknown?: boolean; approved: number; laterRejected: number; rate: number | null; state: 'ok' | 'collecting' }[]
}

export interface MonthPoint {
  label: string
  start: string
  completed: number
  heldEnd: number | null
  leadMedianH: number | null
  projectShares: { id: string; name: string; color: string; share: number }[]
}

export interface Risks {
  /** 한 사람 의존 — 역할(검증 판정·사람 처리 완료)마다 한 사람 비중 50% 이상(10건 이상) */
  concentrations: { role: PersonRole; name: string; share: number; count: number; total: number }[]
  rejectRate: number | null
  prevRejectRate: number | null
  rejectTopProject: { name: string; rate: number } | null
}

export interface CompletedItem extends IssueRef {
  form: WorkForm
  completedAt: string
  leadH: number | null
}

export interface ReportModel {
  version: 2
  type: ReportType
  period: { start: string; end: string }
  isCurrent: boolean
  /** 확정본이면 확정 시각 */
  snapshotAt?: string
  /** 기간은 끝났지만 아직 확정 전(늦게 들어오는 사후 기록을 기다리는 중) — 숫자가 바뀔 수 있다 */
  provisional?: boolean
  /** 보유 기록(held_daily)이 시작된 날짜 — 그 이전 기간은 보유가 "기록 없음" */
  heldTrackingSince: string | null
  held: Held
  actions: ActionItems | null
  done: Done
  trend: Trend
  projects: ProjectRow[]
  cost: Cost
  completedList: CompletedItem[]
  /** 월간·연간 */
  months?: MonthPoint[]
  risks?: Risks
  evaluation?: Evaluation
  /** 사람 키(u:<id>) → 아바타(av-XX | 'photo' | URL). 사람 줄에 아바타를 그린다 */
  avatars?: Record<string, string>
}
