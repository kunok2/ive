/**
 * 보고서 진단 엔진 — 공유 타입, 인터페이스, 상수
 */

// ─── 입력 데이터 타입 ───

export interface ReportData {
  period: { start: string; end: string; type: string }
  prevPeriod: { start: string; end: string }
  summary: { totalTasks: number; uniqueInflow: number; verifiedCount: number; successCount: number; failedCount: number; runningCount: number; successRate: number; totalDurationMin: number; avgDurationMin: number; totalInputTokens: number; totalOutputTokens: number; totalCacheReadTokens?: number; totalCacheCreationTokens?: number; totalCost: number; totalCostAi?: number; totalCostHuman?: number; humanMinutes?: number; humanMonthlySalary?: number; humanMonthlyMinutes?: number }
  prevSummary: { totalTasks: number; uniqueInflow: number; successCount: number; failedCount: number; successRate: number; totalDurationMin: number; avgDurationMin: number; totalCost: number }
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
  userTrend?: { userId: string; userName: string; userAvatar: string | null; avatarUserId?: string | null; daily: { date: string; tasks: number | null; cost: number | null; verified: number | null }[] }[]
  lifecycle: Lifecycle
  prevLifecycle: { waitAvg: number; waitCount: number; procAvg: number; procCount: number; verifyAvg: number; verifyCount: number; confirmAvg: number; confirmCount: number; totalAvg: number; totalCount: number }
  waitingTrend: WaitingDay[]
  prevWaitingTrend: WaitingDay[]
  agentWaitingTrend: AgentWaitingDay[]
  prevAgentWaitingTrend: AgentWaitingDay[]
  resolvedIssues?: ResolvedIssue[]
  verifierBacklog?: VerifierBacklogRow[]
  /**
   * 에이전트별 직전 30일 historical 일일 처리 능력 (이번 보고 기간과 무관).
   * 가동률 계산 분모로 사용해 주/월/년 보고서 간 비교 가능한 안정값을 만든다.
   * samples = 활동한 distinct 일수.
   */
  agentHistoricalCapacity?: { agentId: string; dailyCap: number; samples: number }[]
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
  inputTokens: number; outputTokens: number; cacheReadTokens?: number; cacheCreationTokens?: number; cost: number
  byAgent: { agentId: string; agentName: string; agentAvatar: string; agentDeleted?: boolean; cliName: string; tasks: number; success: number; failed: number; durationMin: number; avgDurationMin: number; inputTokens?: number; outputTokens?: number; cacheReadTokens?: number; cacheCreationTokens?: number; cost: number; avgTurns: number }[]
}

export interface AgentStat {
  agentId: string; agentName: string; agentAvatar: string; agentDeleted?: boolean; cliName: string
  tasks: number; success: number; failed: number
  totalDurationMin: number; avgDurationMin: number
  inputTokens: number; outputTokens: number; cacheReadTokens?: number; cacheCreationTokens?: number; cost: number; avgTurns: number
  currentStatus: string
}

export interface UserStat { userId: string; userName: string; userAvatar: string | null; avatarUserId?: string | null; tasks: number; success: number; failed: number; issueCount: number; totalDurationMin: number; avgDurationMin: number; cost: number; avgWaitMin: number; verifyTasks: number; avgVerifyMin: number; verifyAvgWaitMin: number; verifyWaiting: number; verifyApproved: number; verifyRejected: number; annotation?: UserAnnotation | null }
export interface VerifierStat { verifierName: string; verifierAvatar: string; tasks: number; avgVerifyMin: number; avgWaitMin?: number; rejected: number }
export interface DailyTrend { date: string; tasks: number | null; inflow: number | null; verified: number | null; success: number | null; failed: number | null; cost: number | null; waitAvg: number | null; procAvg: number | null; verifyAvg: number | null; confirmAvg: number | null }
export interface WaitingDay { date: string; total: number; totalWaiting: number; totalVerifyWaiting: number; totalConfirmWaiting: number; byProject: { projectId: string; projectName: string; projectColor: string; waiting: number; verifyWaiting: number; confirmWaiting: number }[] }
export interface AgentWaitingDay { date: string; total: number; byAgent: { agentId: string; agentName: string; agentAvatar: string; waiting: number }[] }
export interface Lifecycle { waitAvg: number; waitMax: number; waitCount: number; procAvg: number; procMax: number; procCount: number; verifyAvg: number; verifyMax: number; verifyCount: number; confirmAvg: number; confirmMax: number; confirmCount: number; totalAvg: number; totalMax: number; totalCount: number; avgAttempts: number; retryRate: number; uniqueIssues: number }
export interface ResolvedIssue { issueIid: number; issueTitle: string; projectId: string; projectName: string; projectColor: string; projectProvider: 'gitlab' | 'github'; agentName: string; agentAvatar: string; verifierName: string | null; verifierAvatar: string | null; verifierUserId: string | null; confirmerName: string | null; confirmerAvatar: string | null; confirmerUserId: string | null; status: string; startedAt: string; resolvedAt: string; durationMin: number; verifyMin: number | null; confirmMin: number | null; totalMin: number; cost: number; waitMin: number | null; turns: number; attempts: number; attemptNo: number }

// ─── 진단 결과 타입 ───

export type HealthLevel = 'idle' | 'relaxed' | 'optimal' | 'tight' | 'overloaded'
export type AlertSeverity = 'critical' | 'warning' | 'info'

export interface FlowMetrics {
  inflow: number            // 기간 총 유입
  throughput: number        // 기간 총 처리
  currentWaiting: number    // 현재 대기
  dailyInflow: number       // 일 평균 유입
  dailyCapacity: number     // 일 평균 처리 능력 (직전 30일 활성일 기준 안정값)
  utilization: number       // 가동률 = dailyThroughput / dailyCapacity (0~∞)
  utilizationConfidence: 'high' | 'low' // 'low': 샘플 부족(elapsedDays<3 또는 capacity 샘플 부족) — UI 노출 가드용
  healthLevel: HealthLevel
  totalCost: number
  totalCostAi: number       // AI 모델 토큰 비용만
  totalCostHuman: number    // 사람 시간 비용만
  humanMinutes: number      // 집계된 사람 작업 시간 (분)
  humanMonthlySalary: number // 적용된 월급 기준값 (USD)
  humanMonthlyMinutes: number // 월 환산 근무 분 (분당 비용 산정 기준; 기본 9600 = 160h)
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
  scenario: 'shortage' | 'surplus' | 'optimal'
}

export type AnnotationSeverity = 'critical' | 'warning' | 'info'
/** 구조화된 진단 메시지 — UI에서 i18n 키 + params로 렌더링.
 *  에이전트는 글로벌 풀로 운영되므로 프로젝트별 에이전트 수급 진단(noAgent/shortage/surplus)은 다루지 않는다. */
export type ProjectAnnotationKey =
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
  retryRate: number
  hasBacklog: boolean
  annotation: ProjectAnnotation | null
}

/** AI 에이전트 카드용 구조화 진단 */
export type AgentAnnotationKey =
  | 'overload'        // 처리 능력보다 대기가 많음
  | 'concentrated'    // 전체 대기의 대부분이 이 에이전트에 몰림
  | 'idle'            // 일이 거의 없음
  | 'lowSuccess'      // 실패율이 높음
export interface AgentAnnotation {
  key: AgentAnnotationKey
  params?: Record<string, string | number>
  severity: AnnotationSeverity
}
export interface AgentLoad {
  agentId: string; agentName: string; agentAvatar: string; agentDeleted?: boolean; cliName: string
  currentStatus: string
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

/** i18n 메시지 참조: key + params 조합. UI에서 tr(key, params)로 렌더링.
 *  nestedKeys — params 중 특정 필드가 다른 i18n 키를 참조할 때 사용한다.
 *  예: briefingUtilLevel의 {level} 자리에 levelOverloaded 키의 번역을 채워 넣는다.
 *  UI 리졸버는 nestedKeys를 먼저 tr()로 풀어 params에 주입한 뒤 바깥 키를 tr()로 렌더링한다. */
export interface I18nMessage {
  key: string
  params?: Record<string, string | number>
  nestedKeys?: Record<string, string>
}

export interface AlertCard {
  severity: AlertSeverity
  title: I18nMessage
  detail: I18nMessage
  action: I18nMessage
  actionTarget?: string  // 이동할 페이지 경로
}

export interface VerifierDiagnosis {
  verifierCount: number
  dailyVerifyInflow: number
  dailyVerifyCapacity: number
  verifyUtilization: number
  verifyWaiting: number
  annotation: I18nMessage | null
}

export interface DiagnosisResult {
  flow: FlowMetrics
  resource: ResourceDiagnosis
  alerts: AlertCard[]
  projects: ProjectFlow[]
  agents: AgentLoad[]
  verifier: VerifierDiagnosis | null
  verifierLoads: VerifierLoad[]
  briefing: I18nMessage[]
  retryCostRatio: number       // 재시도 비용 비율 (0~1)
  retryCostAmount: number
  highRetryProject: { name: string; rate: number } | null
  trendForecast: TrendForecast | null
}

export interface TrendForecast {
  weeklyGrowthRate: number     // 주간 유입 증가율
  weeksUntilShortage: number | null  // 부족 시점까지 주
  message: I18nMessage
}
