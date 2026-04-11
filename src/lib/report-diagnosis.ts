/**
 * 보고서 진단 엔진
 * 흐름(Flow) 기반 자원 수급 진단 + 주의 카드 생성 + 브리핑 텍스트 생성
 */

// ─── 타입 ───

export interface ReportData {
  period: { start: string; end: string; type: string }
  prevPeriod: { start: string; end: string }
  summary: { totalTasks: number; uniqueInflow: number; verifiedCount: number; successCount: number; failedCount: number; runningCount: number; successRate: number; totalDurationMin: number; avgDurationMin: number; totalInputTokens: number; totalOutputTokens: number; totalCost: number; totalCostAi?: number; totalCostHuman?: number; humanMinutes?: number; humanMonthlySalary?: number }
  prevSummary: { totalTasks: number; successCount: number; failedCount: number; successRate: number; totalDurationMin: number; avgDurationMin: number; totalCost: number }
  byProject: ProjectStat[]
  byAgent: AgentStat[]
  byUser: UserStat[]
  byVerifier: VerifierStat[]
  prevByProject: { projectId: string; projectName: string; tasks: number; cost: number }[]
  prevByAgent: { agentId: string; agentName: string; tasks: number; cost: number }[]
  prevByUser: { userId: string; userName: string; tasks: number; issueCount: number; cost: number }[]
  prevByVerifier: { verifierName: string; tasks: number }[]
  dailyTrend: DailyTrend[]
  prevDailyTrend: { date: string; tasks: number; inflow: number; verified: number; cost: number }[]
  agentTrend: { agentId: string; agentName: string; agentAvatar: string; daily: { date: string; tasks: number; cost: number }[] }[]
  projectTrend: { projectId: string; projectName: string; projectColor: string; daily: { date: string; tasks: number; cost: number }[] }[]
  userTrend?: { userId: string; userName: string; userAvatar: string; daily: { date: string; tasks: number | null; cost: number | null; verified: number | null }[] }[]
  lifecycle: Lifecycle
  prevLifecycle: { waitAvg: number; waitCount: number; procAvg: number; procCount: number; verifyAvg: number; verifyCount: number; totalAvg: number; totalCount: number }
  waitingTrend: WaitingDay[]
  prevWaitingTrend: WaitingDay[]
  agentWaitingTrend: AgentWaitingDay[]
  prevAgentWaitingTrend: AgentWaitingDay[]
  resolvedIssues?: ResolvedIssue[]
  totalAssignedAgents?: number
  verifierBacklog?: VerifierBacklogRow[]
}

/** Git assignee 기반 현재 검증 대기 스냅샷 (API route에서 DB 조회로 채워짐) */
export interface VerifierBacklogRow {
  username: string
  name: string
  avatar: string
  provider: string
  verifyWaiting: number
  verifying: number
  oldestWaitMin: number
  assignedProjectNames: string[]
}

export interface ProjectStat {
  projectId: string; projectName: string; projectColor: string; projectAvatarUrl: string; projectProvider: string
  tasks: number; uniqueIssues: number; verified: number; success: number; failed: number
  totalDurationMin: number; avgDurationMin: number
  inputTokens: number; outputTokens: number; cost: number
  assignedAgentCount: number
  assignedAgentIds: string[]
  byAgent: { agentId: string; agentName: string; agentAvatar: string; cliName: string; tasks: number; success: number; failed: number; durationMin: number; avgDurationMin: number; cost: number; avgTurns: number }[]
}

export interface AgentStat {
  agentId: string; agentName: string; agentAvatar: string; cliName: string
  tasks: number; success: number; failed: number
  totalDurationMin: number; avgDurationMin: number
  inputTokens: number; outputTokens: number; cost: number; avgTurns: number
  assignedProjectId: string; assignedProjectName: string; currentStatus: string
}

export interface UserStat { userId: string; userName: string; userAvatar: string; tasks: number; success: number; failed: number; issueCount: number; avgDurationMin: number; cost: number; avgWaitMin: number; verifyTasks: number; avgVerifyMin: number; verifyAvgWaitMin: number; verifyWaiting: number; verifyApproved: number; verifyRejected: number; annotation?: UserAnnotation | null }
export interface VerifierStat { verifierName: string; verifierAvatar: string; tasks: number; avgVerifyMin: number; avgWaitMin?: number }
export interface DailyTrend { date: string; tasks: number | null; inflow: number | null; verified: number | null; success: number | null; failed: number | null; cost: number | null; waitAvg: number | null; procAvg: number | null; verifyAvg: number | null }
export interface WaitingDay { date: string; total: number; totalWaiting: number; totalVerifyWaiting: number; byProject: { projectId: string; projectName: string; projectColor: string; waiting: number; verifyWaiting: number }[] }
export interface AgentWaitingDay { date: string; total: number; byAgent: { agentId: string; agentName: string; agentAvatar: string; waiting: number }[] }
export interface Lifecycle { waitAvg: number; waitMax: number; waitCount: number; procAvg: number; procMax: number; procCount: number; verifyAvg: number; verifyMax: number; verifyCount: number; totalAvg: number; totalMax: number; totalCount: number; avgAttempts: number; retryRate: number; uniqueIssues: number }
export interface ResolvedIssue { issueIid: number; issueTitle: string; projectId: string; projectName: string; projectColor: string; projectProvider: 'gitlab' | 'github'; agentName: string; agentAvatar: string; verifierName: string | null; verifierAvatar: string | null; verifierUserId: string | null; status: string; startedAt: string; durationMin: number; verifyMin: number | null; totalMin: number; cost: number; waitMin: number | null; turns: number; attempts: number; attemptNo: number }

// ─── 진단 결과 타입 ───

export type HealthLevel = 'idle' | 'relaxed' | 'optimal' | 'tight' | 'overloaded'
export type AlertSeverity = 'critical' | 'warning' | 'info'

export interface FlowMetrics {
  inflow: number            // 기간 총 유입
  throughput: number        // 기간 총 처리
  currentWaiting: number    // 현재 대기
  dailyInflow: number       // 일 평균 유입
  dailyCapacity: number     // 일 평균 처리 능력
  utilization: number       // 가동률 (0~∞)
  healthLevel: HealthLevel
  totalCost: number
  totalCostAi: number       // AI 모델 토큰 비용만
  totalCostHuman: number    // 사람 시간 비용만
  humanMinutes: number      // 집계된 사람 작업 시간 (분)
  humanMonthlySalary: number // 적용된 월급 기준값 (USD)
  costPerTask: number
  prevCostPerTask: number
  resolutionTimeAvg: number // 평균 해결시간 (분)
  prevResolutionTimeAvg: number
}

export interface ResourceDiagnosis {
  currentAgents: number
  optimalAgents: number
  gap: number               // +면 과잉, -면 부족
  avgAgentCapacity: number  // 에이전트 평균 일일 처리량
  queueDrainDays: number | null  // null=해소불가
  scenario: 'shortage' | 'surplus' | 'rebalance' | 'optimal'
  rebalancePlan: RebalanceItem[]
  shortagePlan: ShortageItem[]
  surplusPlan: SurplusItem[]
}

export interface RebalanceItem { agentId: string; agentName: string; fromProject: string; fromProjectName: string; toProject: string; toProjectName: string; agentCapacity: number; resultFromUtil: number; resultToUtil: number }
export interface ShortageItem { projectId: string; projectName: string; needed: number; currentUtil: number; targetUtil: number; urgencyDays: number | null }
/**
 * SurplusItem: 에이전트가 과잉 배정된 케이스.
 * 주의: 에이전트를 제거해도 토큰 기반 AI 비용은 줄지 않는다 (일의 양이 같으면 비용 같음).
 * 이 항목은 "재배치 가능성"을 알리는 용도이지 비용 절감 제안이 아니다.
 * monthlyTokenCost는 참고용 — 이 에이전트가 월 기준으로 돌아갔을 때의 추정 토큰 비용.
 */
export interface SurplusItem { agentId: string; agentName: string; projectId: string; projectName: string; agentCapacity: number; monthlyTokenCost: number }

export type AnnotationSeverity = 'critical' | 'warning' | 'info'
/** 구조화된 진단 메시지 — UI에서 i18n 키 + params로 렌더링 */
export type ProjectAnnotationKey =
  | 'noAgent'         // 배정된 에이전트 없음
  | 'shortage'        // 에이전트 부족
  | 'shortageUrgent'  // 에이전트 부족 (긴급일 내)
  | 'surplus'         // 에이전트 과잉
  | 'highRetry'       // 재시도율 높음
  | 'backlog'         // 대기 적체
export interface ProjectAnnotation {
  key: ProjectAnnotationKey
  params?: Record<string, string | number>
  severity: AnnotationSeverity
}
export interface ProjectFlow {
  projectId: string; projectName: string; projectColor: string; projectAvatarUrl: string; projectProvider: string
  inflow: number; throughput: number; waitingDelta: number; currentWaiting: number
  cost: number; costPerTask: number; prevCostPerTask: number
  assignedAgents: number; utilization: number; healthLevel: HealthLevel
  retryRate: number
  hasBacklog: boolean
  annotation: ProjectAnnotation | null
}

/** AI 에이전트 카드용 구조화 진단 */
export type AgentAnnotationKey =
  | 'overload'        // 처리 능력보다 대기가 많음
  | 'concentrated'    // 전체 대기의 대부분이 이 에이전트에 몰림
  | 'idle'            // 일이 거의 없음
  | 'idleReassign'    // 유휴 + 재배치 추천 프로젝트 있음
  | 'lowSuccess'      // 실패율이 높음
export interface AgentAnnotation {
  key: AgentAnnotationKey
  params?: Record<string, string | number>
  severity: AnnotationSeverity
}
export interface AgentLoad {
  agentId: string; agentName: string; agentAvatar: string; cliName: string
  assignedProjectId: string; assignedProjectName: string; currentStatus: string
  tasks: number; dailyCapacity: number; currentWaiting: number; cost: number
  successRate: number          // 성공률 (0~100)
  annotation: AgentAnnotation | null
}

/** Git assignee 기반 검증자 부하 카드용 구조화 진단 */
export type VerifierAnnotationKey =
  | 'overload'        // 검증 대기가 많음
  | 'delayed'         // 오래된 대기 존재
  | 'concentrated'    // 전체 검증 대기가 이 검증자에 몰림
  | 'tooFast'         // 검증이 너무 빨라 형식 검증 의심
  | 'highReject'      // 반려율이 높음
export interface VerifierAnnotation {
  key: VerifierAnnotationKey
  params?: Record<string, string | number>
  severity: AnnotationSeverity
}
export interface VerifierLoad {
  username: string
  name: string
  avatar: string
  provider: string
  approved: number              // 기간 내 총 승인 건수
  rejected: number              // 기간 내 총 반려 건수
  verifyWaiting: number         // 현재 검증 대기
  verifying: number             // 현재 검증 중
  avgVerifyMin: number          // 평균 검증 소요 (분)
  dailyCapacity: number         // 일 평균 처리 능력 (승인+반려)
  oldestWaitMin: number         // 현재 가장 오래된 대기 경과 (분)
  assignedProjectNames: string[]
  annotation: VerifierAnnotation | null
}

/** 담당자별 검증 현황 카드용 구조화 진단 */
export type UserAnnotationKey =
  | 'bottleneck'      // 대기 많음 + 검증 느림 = 병목
  | 'tooFast'         // 검증 시간이 비정상적으로 짧음 = 형식 검증 의심
  | 'highReject'      // 반려율 높음
  | 'backlog'         // 앞에 대기가 많이 쌓임
  | 'idle'            // 최근 활동 거의 없음
export interface UserAnnotation {
  key: UserAnnotationKey
  params?: Record<string, string | number>
  severity: AnnotationSeverity
}

export interface AlertCard {
  severity: AlertSeverity
  title: string
  detail: string
  action: string
  actionTarget?: string  // 이동할 페이지 경로
}

export interface VerifierDiagnosis {
  verifierCount: number
  dailyVerifyInflow: number
  dailyVerifyCapacity: number
  verifyUtilization: number
  verifyWaiting: number
  annotation: string | null
}

export interface DiagnosisResult {
  flow: FlowMetrics
  resource: ResourceDiagnosis
  alerts: AlertCard[]
  projects: ProjectFlow[]
  agents: AgentLoad[]
  verifier: VerifierDiagnosis | null
  verifierLoads: VerifierLoad[]
  briefing: string
  retryCostRatio: number       // 재시도 비용 비율 (0~1)
  retryCostAmount: number
  highRetryProject: { name: string; rate: number } | null
  trendForecast: TrendForecast | null
}

export interface TrendForecast {
  weeklyGrowthRate: number     // 주간 유입 증가율
  weeksUntilShortage: number | null  // 부족 시점까지 주
  message: string
}

// ─── 유틸 ───

function getPeriodDays(start: string, end: string, type: string): number {
  if (type === 'yearly') return 365
  const s = new Date(start), e = new Date(end)
  return Math.max(1, Math.round((e.getTime() - s.getTime()) / 86400000))
}

function getKSTToday(): string {
  return new Date(Date.now() + 9 * 60 * 60 * 1000).toISOString().slice(0, 10)
}

function getElapsedDays(start: string, type: string): number {
  const today = getKSTToday()
  const s = new Date(start)
  const t = new Date(today)
  const days = Math.max(1, Math.round((t.getTime() - s.getTime()) / 86400000) + 1)
  const totalDays = type === 'yearly' ? 365 : type === 'monthly' ? 30 : 7
  return Math.min(days, totalDays)
}

// peak 기반 capacity에서는 정상 가동 시 util ≈ 0.3~0.6
// (capacity = 최대 관측 처리량이므로 평균 운영 시 자연히 낮음)
function healthFromUtil(u: number): HealthLevel {
  if (u < 0.25) return 'idle'
  if (u < 0.50) return 'relaxed'
  if (u < 0.75) return 'optimal'
  if (u < 0.90) return 'tight'
  return 'overloaded'
}

function fmtDur(min: number): string {
  if (min < 60) return `${min.toFixed(1)}분`
  const h = Math.floor(min / 60), m = Math.round(min % 60)
  return m > 0 ? `${h}시간 ${m}분` : `${h}시간`
}

function fmtCost(n: number): string { return n.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 }) }
function pctChange(cur: number, prev: number): number | null { return prev === 0 ? null : Math.round(((cur - prev) / prev) * 100) }

/**
 * 적정 에이전트 수 계산: "1대씩 빼면서 남은 능력이 유입을 감당하는지" 확인
 * @param caps  에이전트별 dailyCap 배열 (오름차순 정렬됨)
 * @param dailyInflow  일일 유입량
 * @param margin  여유 마진 (기본 1.2 = 20% 버퍼)
 * @returns 적정 에이전트 수 (최소 1)
 */
function calcOptimalAgents(caps: number[], dailyInflow: number, margin = 1.2): number {
  if (dailyInflow <= 0) return Math.min(caps.length, 1)
  const sorted = [...caps].sort((a, b) => a - b)  // 한가한 에이전트부터
  const required = dailyInflow * margin
  let total = sorted.reduce((s, c) => s + c, 0)
  let count = sorted.length
  // 가장 한가한 에이전트부터 하나씩 빼면서 감당 가능한지 확인
  for (const cap of sorted) {
    if (count <= 1) break
    if (total - cap >= required) {
      total -= cap
      count--
    } else {
      break
    }
  }
  return Math.max(1, count)
}

// ─── 메인 진단 함수 ───

export function diagnose(data: ReportData, prevWeeklyData?: ReportData[]): DiagnosisResult {
  const { period, summary, prevSummary, byProject, byAgent, byVerifier, lifecycle, prevLifecycle, waitingTrend, agentWaitingTrend, dailyTrend } = data

  const periodDays = getPeriodDays(period.start, period.end, period.type)
  const elapsedDays = getElapsedDays(period.start, period.type)
  const today = getKSTToday()

  // ─── 1. 흐름 지표 ───

  const pastWaiting = waitingTrend.filter(d => d.date <= today)
  // 표시용 대기 (처리대기 + 검증대기)
  const startWaiting = pastWaiting.length > 0 ? pastWaiting[0].total : 0
  const endWaiting = pastWaiting.length > 0 ? pastWaiting[pastWaiting.length - 1].total : 0
  // 유입 = 고유 이슈 수(재시도 제외) + 처리대기 변화분
  // 처리 = 검증까지 마무리된 고유 이슈 수 (verified_at 또는 rejected_at)
  const startProcWaiting = pastWaiting.length > 0 ? pastWaiting[0].totalWaiting : 0
  const endProcWaiting = pastWaiting.length > 0 ? pastWaiting[pastWaiting.length - 1].totalWaiting : 0
  const totalInflow = summary.uniqueInflow + (endProcWaiting - startProcWaiting)
  const totalThroughput = summary.verifiedCount
  const dailyInflow = elapsedDays > 0 ? totalInflow / elapsedDays : 0

  // 에이전트별 일일 처리 능력 (capacity) 계산
  // 실측 peak 기반: 관측된 일일 최대 처리량 = "이만큼은 처리 가능하다"는 하한 증거
  // (평균 기반은 자기참조 — throughput과 같아져서 대기 없어도 util≈1이 나옴)
  const agentCapacities: { agentId: string; dailyCap: number; cost: number }[] = []
  for (const a of byAgent) {
    const trend = data.agentTrend?.find(t => t.agentId === a.agentId)
    const dailyTasks = trend ? trend.daily.filter(d => d.date <= today).map(d => d.tasks ?? 0) : []
    const peak = dailyTasks.length > 0 ? Math.max(...dailyTasks) : 0
    // peak이 0이면(이 에이전트가 드물게 실행됨) 전체 기간 평균으로 폴백
    const cap = peak > 0 ? peak : (elapsedDays > 0 ? a.tasks / elapsedDays : 0)
    agentCapacities.push({ agentId: a.agentId, dailyCap: cap, cost: a.cost })
  }
  // 전체 에이전트 수: 실행 이력이 있는 에이전트뿐 아니라 배정된 유휴 에이전트도 포함
  const totalAssigned = data.totalAssignedAgents ?? byAgent.length
  const idleGlobalAgents = Math.max(0, totalAssigned - byAgent.length)

  // avgAgentCap을 먼저 계산 (유휴 에이전트 capacity 추정에 필요)
  const avgAgentCap = agentCapacities.length > 0
    ? agentCapacities.reduce((s, a) => s + a.dailyCap, 0) / agentCapacities.length
    : 2 // 기본값

  // 전체 dailyCapacity에 유휴 에이전트 용량 포함
  const activeCapacity = agentCapacities.reduce((s, a) => s + a.dailyCap, 0)
  const dailyCapacity = activeCapacity + idleGlobalAgents * avgAgentCap
  const utilization = dailyCapacity > 0 ? dailyInflow / dailyCapacity : (dailyInflow > 0 ? Infinity : 0)
  const healthLevel = healthFromUtil(utilization)

  const costPerTask = summary.totalTasks > 0 ? summary.totalCost / summary.totalTasks : 0
  const prevCostPerTask = prevSummary.totalTasks > 0 ? prevSummary.totalCost / prevSummary.totalTasks : 0
  const prevStartWaiting = data.prevWaitingTrend.length > 0 ? (data.prevWaitingTrend[0].totalWaiting ?? 0) : 0
  const prevEndWaiting = data.prevWaitingTrend.length > 0 ? (data.prevWaitingTrend[data.prevWaitingTrend.length - 1].totalWaiting ?? 0) : 0
  const prevInflow = prevSummary.totalTasks + (prevEndWaiting - prevStartWaiting)

  const flow: FlowMetrics = {
    inflow: totalInflow,
    throughput: totalThroughput,
    currentWaiting: endWaiting,
    dailyInflow,
    dailyCapacity,
    utilization,
    healthLevel,
    totalCost: summary.totalCost,
    totalCostAi: summary.totalCostAi ?? 0,
    totalCostHuman: summary.totalCostHuman ?? 0,
    humanMinutes: summary.humanMinutes ?? 0,
    humanMonthlySalary: summary.humanMonthlySalary ?? 0,
    costPerTask: Math.round(costPerTask * 100) / 100,
    prevCostPerTask: Math.round(prevCostPerTask * 100) / 100,
    resolutionTimeAvg: lifecycle.totalAvg || 0,
    prevResolutionTimeAvg: prevLifecycle.totalAvg || 0,
  }

  // ─── 2. 자원 진단 ───

  const currentAgents = Math.max(totalAssigned, byAgent.length) || 1
  // 전체 에이전트 능력 목록 (유휴 에이전트는 avgAgentCap으로 추정)
  const allAgentCaps = [
    ...agentCapacities.map(a => a.dailyCap),
    ...Array(idleGlobalAgents).fill(avgAgentCap),
  ]
  const optimalAgents = calcOptimalAgents(allAgentCaps, dailyInflow)
  const gap = currentAgents - optimalAgents
  const queueDrainDays = dailyCapacity > dailyInflow && endWaiting > 0
    ? Math.round(endWaiting / (dailyCapacity - dailyInflow) * 10) / 10
    : dailyCapacity <= dailyInflow && endWaiting > 0 ? null : 0

  // 프로젝트별 수급
  const projectFlows: ProjectFlow[] = byProject.map(p => {
    // 미래 날짜 제외. 처리대기(waiting)와 검증대기(verifyWaiting)를 분리 추적
    const pastDays = waitingTrend.filter(d => d.date <= today)
    const pProcTrend = pastDays.map(d => d.byProject.find(bp => bp.projectId === p.projectId)?.waiting ?? 0)
    const pVerifyTrend = pastDays.map(d => d.byProject.find(bp => bp.projectId === p.projectId)?.verifyWaiting ?? 0)
    // 처리대기만 유입 공식에 사용
    const pStartProcW = pProcTrend.length > 0 ? pProcTrend[0] : 0
    const pEndProcW = pProcTrend.length > 0 ? pProcTrend[pProcTrend.length - 1] : 0
    // 화면 표시용 대기건(처리+검증) — 이 값이 프로젝트 카드에 노출됨
    const pStartW = pStartProcW + (pVerifyTrend.length > 0 ? pVerifyTrend[0] : 0)
    const pEndW = pEndProcW + (pVerifyTrend.length > 0 ? pVerifyTrend[pVerifyTrend.length - 1] : 0)
    const pInflow = p.uniqueIssues + (pEndProcW - pStartProcW)
    // 프로젝트 처리 능력은 "현재 배정된" 에이전트들의 dailyCap 합으로 계산해야 함
    // (과거 실행 이력이 있더라도 지금 다른 프로젝트로 재배정된 에이전트는 제외)
    // 배정은 됐지만 실측 데이터가 없는 에이전트는 avgAgentCap으로 대체
    const pCapacity = p.assignedAgentIds.length > 0
      ? p.assignedAgentIds.reduce((s, aid) => {
          const ac = agentCapacities.find(c => c.agentId === aid)
          return s + (ac?.dailyCap ?? avgAgentCap)
        }, 0)
      : 0
    const pUtil = pCapacity > 0 ? (pInflow / elapsedDays) / pCapacity : (pInflow > 0 ? Infinity : 0)
    const prevP = data.prevByProject?.find(pp => pp.projectId === p.projectId)
    const pPrevCPT = prevP && prevP.tasks > 0 ? prevP.cost / prevP.tasks : 0

    // 프로젝트별 재시도율 (byAgent 합산에서)
    const issueMap = new Map<string, number>()
    if (data.resolvedIssues) {
      for (const ri of data.resolvedIssues) {
        if (ri.projectId === p.projectId) {
          issueMap.set(`${ri.issueIid}`, Math.max(issueMap.get(`${ri.issueIid}`) ?? 0, ri.attempts))
        }
      }
    }
    const pIssues = Array.from(issueMap.values())
    const pRetryRate = pIssues.length > 0 ? (pIssues.filter(a => a > 1).length / pIssues.length) * 100 : 0

    // 프로젝트 에이전트 caps 배열 (calcOptimalAgents용)
    const pAgentCaps = p.assignedAgentIds.map(aid => {
      const ac = agentCapacities.find(c => c.agentId === aid)
      return ac?.dailyCap ?? avgAgentCap
    })
    const pDailyInflow = elapsedDays > 0 ? pInflow / elapsedDays : 0
    const pOptimal = calcOptimalAgents(pAgentCaps, pDailyInflow)

    // 실제 적체 신호: 대기가 의미있게 쌓여 있거나 증가 중
    const hasBacklog = pEndW >= 3 || (pEndW - pStartW) >= 2

    let annotation: ProjectAnnotation | null = null
    if (p.assignedAgentCount === 0 && pInflow > 0) {
      annotation = { key: 'noAgent', severity: 'critical' }
    } else if (hasBacklog && p.assignedAgentCount > 0 && pCapacity < pDailyInflow) {
      const addNeeded = Math.max(1, Math.ceil((pDailyInflow * 1.2 - pCapacity) / avgAgentCap))
      const urgency = pCapacity > 0
        ? Math.round((10 - pEndW) / (pDailyInflow - pCapacity))
        : null
      if (urgency != null && urgency > 0) {
        annotation = { key: 'shortageUrgent', params: { count: addNeeded, days: urgency }, severity: 'critical' }
      } else {
        annotation = { key: 'shortage', params: { count: addNeeded }, severity: 'critical' }
      }
    } else if (pOptimal < p.assignedAgentCount && pInflow > 0 && pEndW === 0) {
      const removable = p.assignedAgentCount - pOptimal
      annotation = { key: 'surplus', params: { count: removable }, severity: 'info' }
    } else if (pRetryRate >= 30) {
      annotation = { key: 'highRetry', params: { percent: Math.round(pRetryRate) }, severity: 'warning' }
    } else if (pEndW >= 5) {
      annotation = { key: 'backlog', params: { count: pEndW }, severity: 'warning' }
    }

    // utilization이 Infinity(배정 에이전트 0 + 유입 있음)면 -1로 마킹해 UI에서 특수 처리
    const safeUtil = !isFinite(pUtil) ? -1 : Math.round(pUtil * 100) / 100
    return {
      projectId: p.projectId, projectName: p.projectName, projectColor: p.projectColor, projectAvatarUrl: p.projectAvatarUrl, projectProvider: p.projectProvider,
      inflow: pInflow, throughput: p.verified, waitingDelta: pEndW - pStartW, currentWaiting: pEndW,
      cost: p.cost, costPerTask: p.tasks > 0 ? Math.round(p.cost / p.tasks * 100) / 100 : 0, prevCostPerTask: Math.round(pPrevCPT * 100) / 100,
      assignedAgents: p.assignedAgentCount, utilization: safeUtil, healthLevel: healthFromUtil(pUtil),
      retryRate: Math.round(pRetryRate * 10) / 10,
      hasBacklog,
      annotation,
    }
  })

  // 재배치 / 충원 / 감축 판단 — annotation.key 기반으로 필터링
  const shortageProjects = projectFlows.filter(p =>
    p.annotation?.key === 'shortage' || p.annotation?.key === 'shortageUrgent'
  )
  const surplusProjects = projectFlows.filter(p => p.annotation?.key === 'surplus')
  const unassigned = projectFlows.filter(p => p.assignedAgents === 0 && p.currentWaiting > 0)

  let scenario: ResourceDiagnosis['scenario'] = 'optimal'
  const rebalancePlan: RebalanceItem[] = []
  const shortagePlan: ShortageItem[] = []
  const surplusPlan: SurplusItem[] = []

  if (shortageProjects.length > 0 && surplusProjects.length > 0) {
    scenario = 'rebalance'
    for (const sp of surplusProjects) {
      const spP = byProject.find(bp => bp.projectId === sp.projectId)
      const spCaps = spP?.assignedAgentIds.map(aid => {
        const ac = agentCapacities.find(c => c.agentId === aid)
        return ac?.dailyCap ?? avgAgentCap
      }) ?? []
      const spOptimal = calcOptimalAgents(spCaps, sp.inflow / elapsedDays)
      const surplus = sp.assignedAgents - spOptimal
      const agents = byAgent.filter(a => a.assignedProjectId === sp.projectId).sort((a, b) => a.tasks - b.tasks)
      for (let i = 0; i < Math.min(surplus, agents.length, shortageProjects.length); i++) {
        const target = shortageProjects[i]
        const ac = agentCapacities.find(c => c.agentId === agents[i].agentId)
        const cap = ac?.dailyCap ?? avgAgentCap
        const fromCap = agentCapacities.filter(c => byAgent.find(a => a.agentId === c.agentId && a.assignedProjectId === sp.projectId)).reduce((s, c) => s + c.dailyCap, 0) - cap
        const toCap = agentCapacities.filter(c => byAgent.find(a => a.agentId === c.agentId && a.assignedProjectId === target.projectId)).reduce((s, c) => s + c.dailyCap, 0) + cap
        rebalancePlan.push({
          agentId: agents[i].agentId, agentName: agents[i].agentName,
          fromProject: sp.projectId, fromProjectName: sp.projectName,
          toProject: target.projectId, toProjectName: target.projectName,
          agentCapacity: Math.round(cap * 10) / 10,
          resultFromUtil: fromCap > 0 ? Math.round((sp.inflow / elapsedDays) / fromCap * 100) : 0,
          resultToUtil: toCap > 0 ? Math.round((target.inflow / elapsedDays) / toCap * 100) : 0,
        })
      }
    }
  } else if (shortageProjects.length > 0 || unassigned.length > 0) {
    scenario = 'shortage'
    for (const sp of [...unassigned, ...shortageProjects]) {
      const spDailyInflow = sp.inflow / elapsedDays
      const add = Math.max(1, Math.ceil((spDailyInflow * 1.2 - (sp.assignedAgents > 0 ? sp.utilization * spDailyInflow / (sp.utilization || 1) : 0)) / avgAgentCap) || 1)
      const capNow = agentCapacities.filter(c => byAgent.find(a => a.agentId === c.agentId && a.assignedProjectId === sp.projectId)).reduce((s, c) => s + c.dailyCap, 0)
      const urgency = capNow > 0 && capNow < spDailyInflow ? Math.round((10 - sp.currentWaiting) / (spDailyInflow - capNow)) : null
      const afterCap = capNow + add * avgAgentCap
      shortagePlan.push({
        projectId: sp.projectId, projectName: sp.projectName, needed: add,
        currentUtil: Math.round(sp.utilization * 100), targetUtil: afterCap > 0 ? Math.round(spDailyInflow / afterCap * 100) : 0,
        urgencyDays: urgency != null && urgency > 0 ? urgency : null,
      })
    }
  } else if (surplusProjects.length > 0) {
    scenario = 'surplus'
    for (const sp of surplusProjects) {
      const agents = byAgent.filter(a => a.assignedProjectId === sp.projectId).sort((a, b) => a.tasks - b.tasks)
      if (agents.length > 0) {
        const a = agents[0]
        const monthCost = a.cost > 0 && elapsedDays > 0 ? Math.round(a.cost / elapsedDays * 30 * 100) / 100 : 0
        surplusPlan.push({ agentId: a.agentId, agentName: a.agentName, projectId: sp.projectId, projectName: sp.projectName, agentCapacity: agentCapacities.find(c => c.agentId === a.agentId)?.dailyCap ?? 0, monthlyTokenCost: monthCost })
      }
    }
  }

  const resource: ResourceDiagnosis = {
    currentAgents, optimalAgents, gap, avgAgentCapacity: Math.round(avgAgentCap * 10) / 10,
    queueDrainDays, scenario, rebalancePlan, shortagePlan, surplusPlan,
  }

  // ─── 3. 에이전트 부하 ───

  const agentLoads: AgentLoad[] = byAgent.map(a => {
    const ac = agentCapacities.find(c => c.agentId === a.agentId)
    const dailyCap = ac?.dailyCap ?? 0
    const awt = agentWaitingTrend.filter(d => d.date <= today)
    const lastAW = awt.length > 0 ? (awt[awt.length - 1].byAgent.find(ba => ba.agentId === a.agentId)?.waiting ?? 0) : 0
    const zeroDays = awt.filter(d => (d.byAgent.find(ba => ba.agentId === a.agentId)?.waiting ?? 0) === 0).length
    const zeroPct = awt.length > 0 ? zeroDays / awt.length : 0
    const totalWaiting = awt.length > 0 ? awt[awt.length - 1].total : 0
    const finished = a.success + a.failed
    const successRate = finished > 0 ? Math.round((a.success / finished) * 100) : 0

    let annotation: AgentAnnotation | null = null
    if (finished >= 5 && successRate < 60) {
      annotation = { key: 'lowSuccess', params: { rate: successRate }, severity: 'critical' }
    } else if (lastAW >= 6 || (dailyCap > 0 && lastAW > dailyCap * 1.5)) {
      annotation = { key: 'overload', params: { waiting: lastAW }, severity: 'critical' }
    } else if (totalWaiting > 0 && lastAW / totalWaiting >= 0.6 && lastAW >= 3) {
      annotation = { key: 'concentrated', params: { percent: Math.round(lastAW / totalWaiting * 100) }, severity: 'warning' }
    } else if (zeroPct >= 0.7 && a.tasks <= (byAgent.reduce((s, b) => s + b.tasks, 0) / byAgent.length) * 0.25) {
      const target = shortageProjects.length > 0 ? shortageProjects[0].projectName : null
      annotation = target
        ? { key: 'idleReassign', params: { target }, severity: 'info' }
        : { key: 'idle', severity: 'info' }
    }

    return {
      agentId: a.agentId, agentName: a.agentName, agentAvatar: a.agentAvatar, cliName: a.cliName,
      assignedProjectId: a.assignedProjectId, assignedProjectName: a.assignedProjectName, currentStatus: a.currentStatus,
      tasks: a.tasks, dailyCapacity: Math.round(dailyCap * 10) / 10, currentWaiting: lastAW, cost: a.cost,
      successRate,
      annotation,
    }
  })

  // ─── 4. 검증자 진단 ───

  let verifier: VerifierDiagnosis | null = null
  if (byVerifier && byVerifier.length > 0 && lifecycle.verifyCount > 0) {
    const verifierCount = byVerifier.length
    const dailyVerifyInflow = elapsedDays > 0 ? lifecycle.verifyCount / elapsedDays : 0
    // 검증자 capacity는 throughput에서 역산 불가 (자기참조: cap≈throughput → util≈1.0 항상)
    // 표시용 수치로만 사용
    const dailyVerifyCap = elapsedDays > 0 ? byVerifier.reduce((s, v) => s + (v.tasks / elapsedDays), 0) : 0
    const verifyUtil = 0 // 실제 가동률은 대기 데이터 없이 측정 불가
    const verifyWaiting = 0

    let ann: string | null = null
    // 검증 시간이 전기 대비 50% 이상 증가하면 실질적 병목 신호
    if (prevLifecycle.verifyCount > 0 && lifecycle.verifyAvg > prevLifecycle.verifyAvg * 1.5) {
      ann = `검증 시간 ${Math.round((lifecycle.verifyAvg / prevLifecycle.verifyAvg - 1) * 100)}% 증가 — 확인 필요`
    }

    verifier = { verifierCount, dailyVerifyInflow: Math.round(dailyVerifyInflow * 10) / 10, dailyVerifyCapacity: Math.round(dailyVerifyCap * 10) / 10, verifyUtilization: Math.round(verifyUtil * 100) / 100, verifyWaiting, annotation: ann }
  }

  // ─── 4-b. 검증자별 부하 ───

  const verifierLoads: VerifierLoad[] = (() => {
    const backlog = data.verifierBacklog || []
    // username → 기간 내 처리량 + 평균 검증시간 (byVerifier는 verifierName 기반이라 매칭 신뢰 낮음)
    // 정확한 건 API route에서 verifier_username으로 계산해 verifierBacklog에 같이 담아주는 게 이상적이나,
    // 여기서는 byVerifier에서 verifierName 유사 매칭으로 보완.
    const byNameMap = new Map<string, VerifierStat>()
    for (const v of byVerifier) byNameMap.set(v.verifierName, v)

    const usernames = new Set<string>()
    for (const b of backlog) usernames.add(b.username)

    const loads: VerifierLoad[] = []
    for (const username of usernames) {
      const b = backlog.find(x => x.username === username)!
      const byName = byNameMap.get(b.name) // fallback: 이름으로 매칭
      const approved = byName?.tasks ?? 0
      const rejected = 0 // byVerifier 구조상 분리 정보 없음 — 0으로 둠
      const avgVerifyMin = byName?.avgVerifyMin ?? 0
      const dailyCap = elapsedDays > 0 && approved > 0 ? approved / elapsedDays : 0

      const current = b.verifyWaiting + b.verifying
      let annotation: VerifierAnnotation | null = null
      // 진단 우선순위: 과부하 > 지연 > 너무 빠름 > 반려 많음 > 집중
      if (b.verifyWaiting >= 6) {
        annotation = { key: 'overload', params: { waiting: b.verifyWaiting }, severity: 'critical' }
      } else if (b.oldestWaitMin > 60 * 24) {
        annotation = { key: 'delayed', params: { hours: Math.round(b.oldestWaitMin / 60) }, severity: 'warning' }
      } else if (approved >= 3 && avgVerifyMin > 0 && avgVerifyMin < 1) {
        // 평균 검증 시간이 1분 미만 + 최소 3건 이상 검증 = 형식 검증 의심
        annotation = { key: 'tooFast', params: { seconds: Math.round(avgVerifyMin * 60) }, severity: 'warning' }
      } else if (approved + rejected >= 5 && rejected / (approved + rejected) >= 0.3) {
        const pct = Math.round((rejected / (approved + rejected)) * 100)
        annotation = { key: 'highReject', params: { percent: pct }, severity: 'warning' }
      } else {
        const totalVerifyBacklog = backlog.reduce((s, x) => s + x.verifyWaiting + x.verifying, 0)
        if (current >= 3 && totalVerifyBacklog >= 3 && (current / totalVerifyBacklog) >= 0.6) {
          annotation = { key: 'concentrated', params: { percent: Math.round(current / totalVerifyBacklog * 100) }, severity: 'warning' }
        }
      }

      loads.push({
        username,
        name: b.name,
        avatar: b.avatar,
        provider: b.provider,
        approved,
        rejected,
        verifyWaiting: b.verifyWaiting,
        verifying: b.verifying,
        avgVerifyMin,
        dailyCapacity: Math.round(dailyCap * 10) / 10,
        oldestWaitMin: b.oldestWaitMin,
        assignedProjectNames: b.assignedProjectNames || [],
        annotation,
      })
    }
    return loads.sort((a, b) => (b.verifyWaiting + b.verifying) - (a.verifyWaiting + a.verifying) || b.approved - a.approved)
  })()

  // ─── 5. 재시도 비용 ───

  const retryCostRatio = lifecycle.avgAttempts > 1 ? 1 - 1 / lifecycle.avgAttempts : 0
  const retryCostAmount = Math.round(summary.totalCost * retryCostRatio * 100) / 100
  let highRetryProject: { name: string; rate: number } | null = null
  const maxRetry = projectFlows.reduce((best, p) => p.retryRate > (best?.retryRate ?? 0) ? p : best, null as ProjectFlow | null)
  if (maxRetry && maxRetry.retryRate >= 25) {
    highRetryProject = { name: maxRetry.projectName, rate: maxRetry.retryRate }
  }

  // ─── 6. 추세 예측 ───

  let trendForecast: TrendForecast | null = null
  if (prevWeeklyData && prevWeeklyData.length >= 2 && period.type === 'weekly') {
    const weeklyInflows: number[] = []
    for (const wd of prevWeeklyData) {
      const wt = wd.waitingTrend || []
      const wStart = wt.length > 0 ? wt[0].total : 0
      const wEnd = wt.length > 0 ? wt[wt.length - 1].total : 0
      weeklyInflows.push(wd.summary.totalTasks + (wEnd - wStart))
    }
    weeklyInflows.push(totalInflow)
    if (weeklyInflows.length >= 3) {
      const recent3 = weeklyInflows.slice(-3)
      const growthRate = recent3[0] > 0 ? ((recent3[2] - recent3[0]) / recent3[0] / 2) : 0
      if (growthRate > 0.05) { // 5% 이상 증가 추세
        let weeksUntil: number | null = null
        const weeklyCapacity = dailyCapacity * 7
        if (weeklyCapacity > 0) {
          for (let w = 1; w <= 12; w++) {
            const projected = totalInflow * Math.pow(1 + growthRate, w)
            if (projected > weeklyCapacity) { weeksUntil = w; break }
          }
        }
        trendForecast = {
          weeklyGrowthRate: Math.round(growthRate * 100),
          weeksUntilShortage: weeksUntil,
          message: weeksUntil
            ? `유입이 ${prevWeeklyData.length + 1}주 연속 증가 중입니다. ${weeksUntil}주 내 에이전트 추가가 필요합니다.`
            : `유입이 증가 추세이나 현재 처리 능력으로 당분간 감당 가능합니다.`,
        }
      }
    }
  }

  // ─── 7. 주의 카드 ───

  const alerts: AlertCard[] = []

  // 7-1. 무배정 프로젝트 (최우선)
  for (const p of projectFlows) {
    if (p.assignedAgents === 0 && p.currentWaiting > 0) {
      alerts.push({ severity: 'critical', title: `${p.projectName}에 에이전트 미배정`, detail: `대기 ${p.currentWaiting}건이 처리되지 못하고 있습니다.`, action: '에이전트 배정하기', actionTarget: `/projects` })
    }
  }

  // 7-1-b. 방치된 대기 — 기간 내 유입/처리 모두 0인데 대기가 쌓여있음
  if (totalInflow === 0 && totalThroughput === 0 && endWaiting > 0) {
    alerts.push({
      severity: 'critical',
      title: '대기 방치',
      detail: `이번 기간 유입·처리 모두 0건인데 대기 ${endWaiting}건이 그대로 남아있습니다. 일주일째 아무도 손대지 않은 상태입니다.`,
      action: '검증자 확인',
      actionTarget: '/agents',
    })
  }

  // 7-2. 적체 — 대기가 3일 연속 의미 있게 증가 (스냅샷 노이즈 제외)
  // 기존 로직은 inflow=tasks+delta를 tasks와 비교하여 delta>0이면 항상 true였음
  // 수정: 실제 대기 수치가 3일 연속 순증가하고, 마지막 날 대기가 2건 이상일 때만 알림
  const pastWaitingDays = waitingTrend.filter(d => d.date <= today)
  if (pastWaitingDays.length >= 4) {
    const last4 = pastWaitingDays.slice(-4) // 3일간의 변화를 보려면 4개 포인트 필요
    const deltas = [last4[1].total - last4[0].total, last4[2].total - last4[1].total, last4[3].total - last4[2].total]
    const lastWaiting = last4[3].total
    if (deltas.every(d => d >= 1) && lastWaiting >= 2) {
      alerts.push({ severity: 'critical', title: '유입 대비 처리 부족', detail: `3일 연속 대기가 증가하여 현재 ${lastWaiting}건입니다.`, action: '에이전트 추가 배정', actionTarget: '/agents' })
    }
  }

  // 7-3. 유입 급증
  if (prevInflow > 0 && totalInflow > prevInflow * 1.5) {
    alerts.push({ severity: 'warning', title: '유입 급증', detail: `유입 ${totalInflow}건 (전기 ${prevInflow}건 대비 ${Math.round((totalInflow / prevInflow - 1) * 100)}% 증가)`, action: '프로젝트별 유입 확인' })
  }

  // 7-4. 자원 유휴
  const idleAgents = agentLoads.filter(a => a.annotation?.key === 'idle' || a.annotation?.key === 'idleReassign')
  if (idleAgents.length > 0 && byAgent.length >= 3) {
    alerts.push({ severity: 'info', title: '유휴 자원 감지', detail: `에이전트 ${byAgent.length}대 중 ${idleAgents.length}대가 유휴 상태입니다.`, action: '자원 조정 검토', actionTarget: '/agents' })
  }

  // 7-5. 에이전트 편중
  const totalW = endWaiting
  if (totalW >= 3) {
    for (const a of agentLoads) {
      if (a.currentWaiting >= totalW * 0.6 && a.currentWaiting >= 3) {
        alerts.push({ severity: 'warning', title: `${a.agentName}에 부하 집중`, detail: `전체 대기 ${totalW}건 중 ${a.currentWaiting}건 (${Math.round(a.currentWaiting / totalW * 100)}%)이 집중`, action: '부하 분산 필요' })
        break
      }
    }
  }

  // 7-6. 비용 급증
  if (costPerTask > 0 && prevCostPerTask > 0 && costPerTask > prevCostPerTask * 1.5) {
    alerts.push({ severity: 'warning', title: '건당 비용 급증', detail: `건당 $${fmtCost(costPerTask)} (전기 $${fmtCost(prevCostPerTask)} 대비 ${Math.round((costPerTask / prevCostPerTask - 1) * 100)}% 증가)`, action: '재시도율 및 프로젝트별 비용 확인' })
  }

  // 7-7. 처리 지연
  if (prevLifecycle.procCount > 0 && lifecycle.procAvg > prevLifecycle.procAvg * 1.5) {
    alerts.push({ severity: 'warning', title: '처리 시간 증가', detail: `평균 ${fmtDur(lifecycle.procAvg)} (전기 ${fmtDur(prevLifecycle.procAvg)} 대비 ${Math.round((lifecycle.procAvg / prevLifecycle.procAvg - 1) * 100)}% 증가)`, action: '이슈 복잡도 확인' })
  }

  // 7-8. 검증 병목 (검증 시간 증가 기반)
  if (verifier?.annotation) {
    alerts.push({ severity: 'warning', title: '검증 병목', detail: verifier.annotation, action: '검증 프로세스 확인' })
  }

  // 7-9. 검증자 개별 병목 (대기 집중 / 장기 미처리)
  const overloadedVerifiers = verifierLoads.filter(v => v.annotation?.key === 'overload')
  if (overloadedVerifiers.length > 0) {
    const v = overloadedVerifiers[0]
    alerts.push({
      severity: 'critical',
      title: `${v.name}에 검증 대기 집중`,
      detail: `검증 대기 ${v.verifyWaiting}건${v.verifying > 0 ? ` + 검증 중 ${v.verifying}건` : ''}`,
      action: '검증자 분산 또는 지원',
      actionTarget: '/agents',
    })
  }
  const stalledVerifiers = verifierLoads.filter(v => v.annotation?.key === 'delayed')
  if (stalledVerifiers.length > 0 && overloadedVerifiers.length === 0) {
    const v = stalledVerifiers[0]
    alerts.push({
      severity: 'warning',
      title: '검증 지연',
      detail: `${v.name}: 오래된 검증 대기 존재`,
      action: '검증자 확인',
      actionTarget: '/agents',
    })
  }

  // ─── 8. 브리핑 텍스트 ───

  const briefingLines: string[] = []

  // 흐름 상태
  if (summary.totalTasks === 0 && totalInflow === 0) {
    if (endWaiting > 0) {
      briefingLines.push(`이번 기간에는 유입·처리 모두 0건입니다. 이전부터 대기 중인 ${endWaiting}건이 그대로 남아있습니다.`)
    } else {
      briefingLines.push('이번 기간에는 유입된 작업이 없습니다.')
    }
  } else {
    const utilPct = Math.round(utilization * 100)
    const levelKo: Record<HealthLevel, string> = { overloaded: '과부하 상태', tight: '빠듯한 상태', optimal: '적정', relaxed: '여유 있는 상태', idle: '자원이 남는 상태' }
    briefingLines.push(`가동률 ${utilPct}%로 ${levelKo[healthLevel]}입니다.`)
    briefingLines.push(`${totalInflow}건이 유입되어 ${summary.totalTasks}건을 처리했고, 비용은 $${fmtCost(summary.totalCost)}입니다.`)
  }

  // 체감 해결시간
  if (lifecycle.totalAvg > 0) {
    const prevStr = prevLifecycle.totalAvg > 0 ? ` (전기 ${fmtDur(prevLifecycle.totalAvg)})` : ''
    briefingLines.push(`이슈 해결까지 평균 ${fmtDur(lifecycle.totalAvg)}${prevStr}`)
  }

  // 자원 진단 처방
  if (scenario === 'shortage' && shortagePlan.length > 0) {
    const total = shortagePlan.reduce((s, p) => s + p.needed, 0)
    briefingLines.push(`에이전트 ${total}대 추가 시 안정화됩니다.`)
  } else if (scenario === 'rebalance' && rebalancePlan.length > 0) {
    briefingLines.push(`${rebalancePlan[0].agentName}을 ${rebalancePlan[0].fromProjectName}에서 ${rebalancePlan[0].toProjectName}(으)로 재배치하면 추가 비용 없이 정상화됩니다.`)
  } else if (scenario === 'surplus' && surplusPlan.length > 0) {
    // 에이전트 감축은 토큰 기반 비용을 줄이지 않는다. 재배치 제안만 한다.
    briefingLines.push(`에이전트 ${surplusPlan.length}대가 여유 있습니다. 다른 바쁜 프로젝트로 재배치를 검토해보세요.`)
  }

  // 비용 이상
  if (costPerTask > 0 && prevCostPerTask > 0 && costPerTask > prevCostPerTask * 1.3) {
    briefingLines.push(`건당 비용이 $${fmtCost(costPerTask)}로 전기 대비 ${Math.round((costPerTask / prevCostPerTask - 1) * 100)}% 높습니다.`)
  }
  // 실제 비용 감소 경로: 재시도율이 높으면 품질 개선이 토큰 비용을 줄입니다
  if (highRetryProject && highRetryProject.rate >= 40) {
    briefingLines.push(`${highRetryProject.name}의 재시도율 ${Math.round(highRetryProject.rate)}%를 낮추면 토큰 비용이 실제로 줄어듭니다 (이슈 지시사항·테스트 품질 점검).`)
  }

  // 추세 예측
  if (trendForecast) briefingLines.push(trendForecast.message)

  return {
    flow, resource, alerts, projects: projectFlows, agents: agentLoads, verifier,
    verifierLoads,
    briefing: briefingLines.join(' '),
    retryCostRatio: Math.round(retryCostRatio * 100) / 100,
    retryCostAmount,
    highRetryProject,
    trendForecast,
  }
}
