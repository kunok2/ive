/**
 * 보고서 진단 엔진
 * 흐름(Flow) 기반 자원 수급 진단 + 주의 카드 생성 + 브리핑 텍스트 생성
 */

// ─── 타입 ───

export interface ReportData {
  period: { start: string; end: string; type: string }
  prevPeriod: { start: string; end: string }
  summary: { totalTasks: number; successCount: number; failedCount: number; runningCount: number; successRate: number; totalDurationMin: number; avgDurationMin: number; totalInputTokens: number; totalOutputTokens: number; totalCost: number }
  prevSummary: { totalTasks: number; successCount: number; failedCount: number; successRate: number; totalDurationMin: number; avgDurationMin: number; totalCost: number }
  byProject: ProjectStat[]
  byAgent: AgentStat[]
  byVerifier: VerifierStat[]
  byUser: UserStat[]
  prevByProject: { projectId: string; projectName: string; tasks: number; cost: number }[]
  prevByAgent: { agentId: string; agentName: string; tasks: number; cost: number }[]
  prevByVerifier: { verifierName: string; tasks: number }[]
  prevByUser: { userId: string; userName: string; tasks: number; issueCount: number; cost: number }[]
  dailyTrend: DailyTrend[]
  prevDailyTrend: { date: string; tasks: number; cost: number }[]
  agentTrend: { agentId: string; agentName: string; agentAvatar: string; daily: { date: string; tasks: number; cost: number }[] }[]
  projectTrend: { projectId: string; projectName: string; projectColor: string; daily: { date: string; tasks: number; cost: number }[] }[]
  lifecycle: Lifecycle
  prevLifecycle: { waitAvg: number; waitCount: number; procAvg: number; procCount: number; verifyAvg: number; verifyCount: number; totalAvg: number; totalCount: number }
  waitingTrend: WaitingDay[]
  prevWaitingTrend: WaitingDay[]
  agentWaitingTrend: AgentWaitingDay[]
  prevAgentWaitingTrend: AgentWaitingDay[]
  resolvedIssues?: ResolvedIssue[]
}

export interface ProjectStat {
  projectId: string; projectName: string; projectColor: string; projectAvatarUrl: string; projectProvider: string
  tasks: number; success: number; failed: number
  totalDurationMin: number; avgDurationMin: number
  inputTokens: number; outputTokens: number; cost: number
  assignedAgentCount: number
  byAgent: { agentId: string; agentName: string; agentAvatar: string; cliName: string; tasks: number; success: number; failed: number; durationMin: number; avgDurationMin: number; cost: number; avgTurns: number }[]
}

export interface AgentStat {
  agentId: string; agentName: string; agentAvatar: string; cliName: string
  tasks: number; success: number; failed: number
  totalDurationMin: number; avgDurationMin: number
  inputTokens: number; outputTokens: number; cost: number; avgTurns: number
  assignedProjectId: string; assignedProjectName: string; currentStatus: string
}

export interface VerifierStat { verifierName: string; verifierAvatar: string; tasks: number; avgVerifyMin: number; avgWaitMin?: number }
export interface UserStat { userId: string; userName: string; tasks: number; issueCount: number; projectCount: number; avgDurationMin: number; avgWaitMin: number; cost: number }
export interface DailyTrend { date: string; tasks: number | null; success: number | null; failed: number | null; cost: number | null; waitAvg: number | null; procAvg: number | null; verifyAvg: number | null }
export interface WaitingDay { date: string; total: number; byProject: { projectId: string; projectName: string; projectColor: string; waiting: number }[] }
export interface AgentWaitingDay { date: string; total: number; byAgent: { agentId: string; agentName: string; agentAvatar: string; waiting: number }[] }
export interface Lifecycle { waitAvg: number; waitMax: number; waitCount: number; procAvg: number; procMax: number; procCount: number; verifyAvg: number; verifyMax: number; verifyCount: number; totalAvg: number; totalMax: number; totalCount: number; avgAttempts: number; retryRate: number; uniqueIssues: number }
export interface ResolvedIssue { issueIid: number; issueTitle: string; projectId: string; projectName: string; projectColor: string; agentName: string; agentAvatar: string; status: string; startedAt: string; durationMin: number; cost: number; waitMin: number | null; turns: number; attempts: number; attemptNo: number }

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
export interface SurplusItem { agentId: string; agentName: string; projectId: string; projectName: string; agentCapacity: number; savingsPerMonth: number }

export interface ProjectFlow {
  projectId: string; projectName: string; projectColor: string; projectAvatarUrl: string; projectProvider: string
  inflow: number; throughput: number; waitingDelta: number; currentWaiting: number
  cost: number; costPerTask: number; prevCostPerTask: number
  assignedAgents: number; utilization: number; healthLevel: HealthLevel
  retryRate: number
  annotation: string | null
}

export interface AgentLoad {
  agentId: string; agentName: string; agentAvatar: string; cliName: string
  assignedProjectId: string; assignedProjectName: string; currentStatus: string
  tasks: number; dailyCapacity: number; currentWaiting: number; cost: number
  annotation: string | null
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

function healthFromUtil(u: number): HealthLevel {
  if (u < 0.40) return 'idle'
  if (u < 0.65) return 'relaxed'
  if (u < 0.85) return 'optimal'
  if (u < 0.95) return 'tight'
  return 'overloaded'
}

function fmtDur(min: number): string {
  if (min < 60) return `${min.toFixed(1)}분`
  const h = Math.floor(min / 60), m = Math.round(min % 60)
  return m > 0 ? `${h}시간 ${m}분` : `${h}시간`
}

function fmtCost(n: number): string { return n.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 }) }
function pctChange(cur: number, prev: number): number | null { return prev === 0 ? null : Math.round(((cur - prev) / prev) * 100) }

// ─── 메인 진단 함수 ───

export function diagnose(data: ReportData, prevWeeklyData?: ReportData[]): DiagnosisResult {
  const { period, summary, prevSummary, byProject, byAgent, byVerifier, lifecycle, prevLifecycle, waitingTrend, agentWaitingTrend, dailyTrend } = data

  const periodDays = getPeriodDays(period.start, period.end, period.type)
  const elapsedDays = getElapsedDays(period.start, period.type)
  const today = getKSTToday()

  // ─── 1. 흐름 지표 ───

  const pastWaiting = waitingTrend.filter(d => d.date <= today)
  const startWaiting = pastWaiting.length > 0 ? pastWaiting[0].total : 0
  const endWaiting = pastWaiting.length > 0 ? pastWaiting[pastWaiting.length - 1].total : 0
  const totalInflow = summary.totalTasks + (endWaiting - startWaiting)
  const dailyInflow = elapsedDays > 0 ? totalInflow / elapsedDays : 0

  // 에이전트별 일일 처리량 계산
  const agentCapacities: { agentId: string; dailyCap: number; cost: number }[] = []
  for (const a of byAgent) {
    const trend = data.agentTrend?.find(t => t.agentId === a.agentId)
    const activeDays = trend ? trend.daily.filter(d => d.date <= today && d.tasks > 0).length : elapsedDays
    const cap = activeDays > 0 ? a.tasks / activeDays : 0
    agentCapacities.push({ agentId: a.agentId, dailyCap: cap, cost: a.cost })
  }
  const dailyCapacity = agentCapacities.reduce((s, a) => s + a.dailyCap, 0)
  const utilization = dailyCapacity > 0 ? dailyInflow / dailyCapacity : (dailyInflow > 0 ? Infinity : 0)
  const healthLevel = healthFromUtil(utilization)

  const costPerTask = summary.totalTasks > 0 ? summary.totalCost / summary.totalTasks : 0
  const prevCostPerTask = prevSummary.totalTasks > 0 ? prevSummary.totalCost / prevSummary.totalTasks : 0
  const prevStartWaiting = data.prevWaitingTrend.length > 0 ? data.prevWaitingTrend[0].total : 0
  const prevEndWaiting = data.prevWaitingTrend.length > 0 ? data.prevWaitingTrend[data.prevWaitingTrend.length - 1].total : 0
  const prevInflow = prevSummary.totalTasks + (prevEndWaiting - prevStartWaiting)

  const flow: FlowMetrics = {
    inflow: totalInflow,
    throughput: summary.totalTasks,
    currentWaiting: endWaiting,
    dailyInflow,
    dailyCapacity,
    utilization,
    healthLevel,
    totalCost: summary.totalCost,
    costPerTask: Math.round(costPerTask * 100) / 100,
    prevCostPerTask: Math.round(prevCostPerTask * 100) / 100,
    resolutionTimeAvg: lifecycle.totalAvg || 0,
    prevResolutionTimeAvg: prevLifecycle.totalAvg || 0,
  }

  // ─── 2. 자원 진단 ───

  const avgAgentCap = agentCapacities.length > 0
    ? agentCapacities.reduce((s, a) => s + a.dailyCap, 0) / agentCapacities.length
    : 2 // 기본값
  const currentAgents = byAgent.length || 1
  const optimalAgents = dailyInflow > 0 ? Math.ceil(dailyInflow / avgAgentCap / 0.75) : 1
  const gap = currentAgents - optimalAgents
  const queueDrainDays = dailyCapacity > dailyInflow && endWaiting > 0
    ? Math.round(endWaiting / (dailyCapacity - dailyInflow) * 10) / 10
    : dailyCapacity <= dailyInflow && endWaiting > 0 ? null : 0

  // 프로젝트별 수급
  const projectFlows: ProjectFlow[] = byProject.map(p => {
    const pTrend = waitingTrend.map(d => d.byProject.find(bp => bp.projectId === p.projectId)?.waiting ?? 0)
    const pStartW = pTrend.length > 0 ? pTrend[0] : 0
    const pEndW = pTrend.length > 0 ? pTrend[pTrend.length - 1] : 0
    const pInflow = p.tasks + (pEndW - pStartW)
    const pAgentCaps = p.byAgent.map(a => {
      const ac = agentCapacities.find(c => c.agentId === a.agentId)
      return ac?.dailyCap ?? 0
    })
    const pCapacity = pAgentCaps.reduce((s, c) => s + c, 0)
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

    let annotation: string | null = null
    if (pUtil >= 0.95 && p.assignedAgentCount > 0) {
      const needed = Math.ceil((pInflow / elapsedDays) / avgAgentCap / 0.75)
      const addNeeded = Math.max(1, needed - p.assignedAgentCount)
      const urgency = pCapacity > 0 && pCapacity < pInflow / elapsedDays
        ? Math.round((10 - pEndW) / ((pInflow / elapsedDays) - pCapacity))
        : null
      annotation = `부족 — ${addNeeded}대 추가 필요` + (urgency != null && urgency > 0 ? ` (${urgency}일 내)` : '')
    } else if (pUtil < 0.40 && p.assignedAgentCount >= 2) {
      annotation = `과잉 — ${Math.max(1, p.assignedAgentCount - Math.ceil((pInflow / elapsedDays) / avgAgentCap / 0.75))}대 재배치 가능`
    } else if (pRetryRate >= 30) {
      annotation = `재시도율 ${Math.round(pRetryRate)}% — 이슈 품질 점검`
    } else if (pEndW >= 5) {
      annotation = `대기 ${pEndW}건 — 처리 지연 중`
    }

    return {
      projectId: p.projectId, projectName: p.projectName, projectColor: p.projectColor, projectAvatarUrl: p.projectAvatarUrl, projectProvider: p.projectProvider,
      inflow: pInflow, throughput: p.tasks, waitingDelta: pEndW - pStartW, currentWaiting: pEndW,
      cost: p.cost, costPerTask: p.tasks > 0 ? Math.round(p.cost / p.tasks * 100) / 100 : 0, prevCostPerTask: Math.round(pPrevCPT * 100) / 100,
      assignedAgents: p.assignedAgentCount, utilization: Math.round(pUtil * 100) / 100, healthLevel: healthFromUtil(pUtil),
      retryRate: Math.round(pRetryRate * 10) / 10,
      annotation,
    }
  })

  // 재배치 / 충원 / 감축 판단
  const shortageProjects = projectFlows.filter(p => p.utilization >= 0.95 && p.assignedAgents > 0)
  const surplusProjects = projectFlows.filter(p => p.utilization < 0.40 && p.assignedAgents >= 2)
  const unassigned = projectFlows.filter(p => p.assignedAgents === 0 && p.currentWaiting > 0)

  let scenario: ResourceDiagnosis['scenario'] = 'optimal'
  const rebalancePlan: RebalanceItem[] = []
  const shortagePlan: ShortageItem[] = []
  const surplusPlan: SurplusItem[] = []

  if (shortageProjects.length > 0 && surplusProjects.length > 0) {
    scenario = 'rebalance'
    // 과잉 프로젝트에서 유휴 에이전트 찾기
    for (const sp of surplusProjects) {
      const surplus = sp.assignedAgents - Math.max(1, Math.ceil((sp.inflow / elapsedDays) / avgAgentCap / 0.75))
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
      const needed = Math.ceil((sp.inflow / elapsedDays) / avgAgentCap / 0.75)
      const add = Math.max(1, needed - sp.assignedAgents)
      const capNow = agentCapacities.filter(c => byAgent.find(a => a.agentId === c.agentId && a.assignedProjectId === sp.projectId)).reduce((s, c) => s + c.dailyCap, 0)
      const urgency = capNow > 0 && capNow < sp.inflow / elapsedDays ? Math.round((10 - sp.currentWaiting) / ((sp.inflow / elapsedDays) - capNow)) : null
      shortagePlan.push({
        projectId: sp.projectId, projectName: sp.projectName, needed: add,
        currentUtil: Math.round(sp.utilization * 100), targetUtil: needed > 0 ? Math.round((sp.inflow / elapsedDays) / (needed * avgAgentCap) * 100) : 0,
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
        surplusPlan.push({ agentId: a.agentId, agentName: a.agentName, projectId: sp.projectId, projectName: sp.projectName, agentCapacity: agentCapacities.find(c => c.agentId === a.agentId)?.dailyCap ?? 0, savingsPerMonth: monthCost })
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

    let annotation: string | null = null
    if (lastAW >= 6) {
      annotation = '과부하 — 지원 필요'
    } else if (totalWaiting > 0 && lastAW / totalWaiting >= 0.6 && lastAW >= 3) {
      annotation = `전체 대기의 ${Math.round(lastAW / totalWaiting * 100)}%가 집중`
    } else if (zeroPct >= 0.7 && a.tasks <= (byAgent.reduce((s, b) => s + b.tasks, 0) / byAgent.length) * 0.25) {
      const target = shortageProjects.length > 0 ? shortageProjects[0].projectName : null
      annotation = target ? `유휴 — ${target}(으)로 재배치 검토` : '유휴 — 재배치 검토'
    }

    return {
      agentId: a.agentId, agentName: a.agentName, agentAvatar: a.agentAvatar, cliName: a.cliName,
      assignedProjectId: a.assignedProjectId, assignedProjectName: a.assignedProjectName, currentStatus: a.currentStatus,
      tasks: a.tasks, dailyCapacity: Math.round(dailyCap * 10) / 10, currentWaiting: lastAW, cost: a.cost,
      annotation,
    }
  })

  // ─── 4. 검증자 진단 ───

  let verifier: VerifierDiagnosis | null = null
  if (byVerifier && byVerifier.length > 0 && lifecycle.verifyCount > 0) {
    const verifierCount = byVerifier.length
    const dailyVerifyInflow = elapsedDays > 0 ? lifecycle.verifyCount / elapsedDays : 0
    const dailyVerifyCap = byVerifier.reduce((s, v) => s + (v.tasks / elapsedDays), 0)
    const verifyUtil = dailyVerifyCap > 0 ? dailyVerifyInflow / dailyVerifyCap : 0
    // 검증 대기 = 전체 대기 중 verify_waiting 부분 (근사: 검증 유입 - 검증 완료 비율로 추정)
    const verifyWaiting = 0 // 정확한 값은 별도 API 필요, 일단 0

    let ann: string | null = null
    if (verifyUtil >= 0.90) ann = `검증자 부족 — 1명 추가 시 안정`
    else if (prevLifecycle.verifyCount > 0 && lifecycle.verifyAvg > prevLifecycle.verifyAvg * 1.5) ann = `검증 시간 증가 — 확인 필요`

    verifier = { verifierCount, dailyVerifyInflow: Math.round(dailyVerifyInflow * 10) / 10, dailyVerifyCapacity: Math.round(dailyVerifyCap * 10) / 10, verifyUtilization: Math.round(verifyUtil * 100) / 100, verifyWaiting, annotation: ann }
  }

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

  // 7-2. 적체 (유입 > 처리 3일 연속)
  const pastDays = dailyTrend.filter(d => d.tasks !== null && d.date <= today)
  if (pastDays.length >= 3) {
    const last3 = pastDays.slice(-3)
    const last3Inflow: number[] = []
    for (let i = 0; i < last3.length; i++) {
      const wIdx = waitingTrend.findIndex(w => w.date === last3[i].date)
      if (wIdx > 0) {
        last3Inflow.push((last3[i].tasks ?? 0) + waitingTrend[wIdx].total - waitingTrend[wIdx - 1].total)
      }
    }
    if (last3Inflow.length >= 3 && last3Inflow.every((inf, i) => inf > (last3[i].tasks ?? 0))) {
      alerts.push({ severity: 'critical', title: '유입 대비 처리 부족', detail: '3일 연속 유입이 처리를 초과하고 있습니다. 대기가 계속 늘어나고 있습니다.', action: '에이전트 추가 배정', actionTarget: '/agents' })
    }
  }

  // 7-3. 유입 급증
  if (prevInflow > 0 && totalInflow > prevInflow * 1.5) {
    alerts.push({ severity: 'warning', title: '유입 급증', detail: `유입 ${totalInflow}건 (전기 ${prevInflow}건 대비 ${Math.round((totalInflow / prevInflow - 1) * 100)}% 증가)`, action: '프로젝트별 유입 확인' })
  }

  // 7-4. 자원 유휴
  const idleAgents = agentLoads.filter(a => a.annotation?.includes('유휴'))
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

  // 7-8. 검증 병목
  if (verifier?.annotation?.includes('부족')) {
    alerts.push({ severity: 'warning', title: '검증 병목', detail: `검증 가동률 ${Math.round(verifier.verifyUtilization * 100)}%`, action: '검증자 추가 배정 검토' })
  }

  // ─── 8. 브리핑 텍스트 ───

  const briefingLines: string[] = []

  // 흐름 상태
  if (summary.totalTasks === 0 && totalInflow === 0) {
    briefingLines.push('이번 기간에는 유입된 작업이 없습니다.')
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
    briefingLines.push(`에이전트 ${surplusPlan.length}대 감축 시 월 ~$${fmtCost(surplusPlan.reduce((s, p) => s + p.savingsPerMonth, 0))} 절감 가능합니다.`)
  }

  // 비용 이상
  if (costPerTask > 0 && prevCostPerTask > 0 && costPerTask > prevCostPerTask * 1.3) {
    briefingLines.push(`건당 비용이 $${fmtCost(costPerTask)}로 전기 대비 ${Math.round((costPerTask / prevCostPerTask - 1) * 100)}% 높습니다.`)
  }

  // 추세 예측
  if (trendForecast) briefingLines.push(trendForecast.message)

  return {
    flow, resource, alerts, projects: projectFlows, agents: agentLoads, verifier,
    briefing: briefingLines.join(' '),
    retryCostRatio: Math.round(retryCostRatio * 100) / 100,
    retryCostAmount,
    highRetryProject,
    trendForecast,
  }
}
