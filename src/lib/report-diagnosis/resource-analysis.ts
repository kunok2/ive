/**
 * 보고서 진단 엔진 — 자원/수급/용량 분석 함수
 */

import type {
  HealthLevel, ReportData, ProjectFlow, ProjectAnnotation,
  AgentLoad, AgentAnnotation, VerifierDiagnosis, VerifierLoad,
  VerifierAnnotation, VerifierStat, ResourceDiagnosis,
  RebalanceItem, ShortageItem, SurplusItem, I18nMessage,
} from './types'

// ─── 유틸 ───

export function getPeriodDays(start: string, end: string, type: string): number {
  if (type === 'yearly') return 365
  const s = new Date(start), e = new Date(end)
  return Math.max(1, Math.round((e.getTime() - s.getTime()) / 86400000))
}

export function getKSTToday(): string {
  return new Date(Date.now() + 9 * 60 * 60 * 1000).toISOString().slice(0, 10)
}

export function getElapsedDays(start: string, type: string): number {
  const today = getKSTToday()
  const s = new Date(start)
  const t = new Date(today)
  const days = Math.max(1, Math.round((t.getTime() - s.getTime()) / 86400000) + 1)
  const totalDays = type === 'yearly' ? 365 : type === 'monthly' ? 30 : 7
  return Math.min(days, totalDays)
}

// peak 기반 capacity에서는 정상 가동 시 util ≈ 0.3~0.6
// (capacity = 최대 관측 처리량이므로 평균 운영 시 자연히 낮음)
export function healthFromUtil(u: number): HealthLevel {
  if (u < 0.25) return 'idle'
  if (u < 0.50) return 'relaxed'
  if (u < 0.75) return 'optimal'
  if (u < 0.90) return 'tight'
  return 'overloaded'
}

/** 기본 duration 포매터 — 다국어가 필요 없는 컨텍스트(서버 로그 등)용 폴백. */
export function defaultFmtDur(min: number): string {
  if (min < 60) return `${min.toFixed(1)}m`
  const h = Math.floor(min / 60), m = Math.round(min % 60)
  return m > 0 ? `${h}h ${m}m` : `${h}h`
}

export function fmtCost(n: number): string { return n.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 }) }
export function pctChange(cur: number, prev: number): number | null { return prev === 0 ? null : Math.round(((cur - prev) / prev) * 100) }

/**
 * 적정 에이전트 수 계산: "1대씩 빼면서 남은 능력이 유입을 감당하는지" 확인
 * @param caps  에이전트별 dailyCap 배열 (오름차순 정렬됨)
 * @param dailyInflow  일일 유입량
 * @param margin  여유 마진 (기본 1.2 = 20% 버퍼)
 * @returns 적정 에이전트 수 (최소 1)
 */
export function calcOptimalAgents(caps: number[], dailyInflow: number, margin = 1.2): number {
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

// ─── 에이전트 용량 계산 ───

export interface AgentCapacity {
  agentId: string
  dailyCap: number
  cost: number
}

export function computeAgentCapacities(
  data: ReportData,
  elapsedDays: number,
  today: string,
): { agentCapacities: AgentCapacity[]; avgAgentCap: number; idleGlobalAgents: number; totalAssigned: number } {
  const { byAgent } = data
  const agentCapacities: AgentCapacity[] = []
  for (const a of byAgent) {
    const trend = data.agentTrend?.find(t => t.agentId === a.agentId)
    const dailyTasks = trend ? trend.daily.filter(d => d.date <= today).map(d => d.tasks ?? 0) : []
    const peak = dailyTasks.length > 0 ? Math.max(...dailyTasks) : 0
    const cap = peak > 0 ? peak : (elapsedDays > 0 ? a.tasks / elapsedDays : 0)
    agentCapacities.push({ agentId: a.agentId, dailyCap: cap, cost: a.cost })
  }
  const totalAssigned = data.totalAssignedAgents ?? byAgent.length
  const idleGlobalAgents = Math.max(0, totalAssigned - byAgent.length)
  const avgAgentCap = agentCapacities.length > 0
    ? agentCapacities.reduce((s, a) => s + a.dailyCap, 0) / agentCapacities.length
    : 2 // 기본값

  return { agentCapacities, avgAgentCap, idleGlobalAgents, totalAssigned }
}

// ─── 프로젝트별 흐름 분석 ───

export function computeProjectFlows(
  data: ReportData,
  agentCapacities: AgentCapacity[],
  avgAgentCap: number,
  elapsedDays: number,
  today: string,
): ProjectFlow[] {
  const { byProject, waitingTrend } = data

  return byProject.map(p => {
    const pastDays = waitingTrend.filter(d => d.date <= today)
    const pProcTrend = pastDays.map(d => d.byProject.find(bp => bp.projectId === p.projectId)?.waiting ?? 0)
    const pVerifyTrend = pastDays.map(d => d.byProject.find(bp => bp.projectId === p.projectId)?.verifyWaiting ?? 0)
    const pStartProcW = pProcTrend.length > 0 ? pProcTrend[0] : 0
    const pEndProcW = pProcTrend.length > 0 ? pProcTrend[pProcTrend.length - 1] : 0
    const pStartW = pStartProcW + (pVerifyTrend.length > 0 ? pVerifyTrend[0] : 0)
    const pEndW = pEndProcW + (pVerifyTrend.length > 0 ? pVerifyTrend[pVerifyTrend.length - 1] : 0)
    const pInflow = p.uniqueIssues + (pEndProcW - pStartProcW)
    const pCapacity = p.assignedAgentIds.length > 0
      ? p.assignedAgentIds.reduce((s, aid) => {
          const ac = agentCapacities.find(c => c.agentId === aid)
          return s + (ac?.dailyCap ?? avgAgentCap)
        }, 0)
      : 0
    const pUtil = pCapacity > 0 ? (pInflow / elapsedDays) / pCapacity : (pInflow > 0 ? Infinity : 0)
    const prevP = data.prevByProject?.find(pp => pp.projectId === p.projectId)
    const pPrevCPT = prevP && prevP.tasks > 0 ? prevP.cost / prevP.tasks : 0

    // 프로젝트별 재시도율
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

    const pAgentCaps = p.assignedAgentIds.map(aid => {
      const ac = agentCapacities.find(c => c.agentId === aid)
      return ac?.dailyCap ?? avgAgentCap
    })
    const pDailyInflow = elapsedDays > 0 ? pInflow / elapsedDays : 0
    const pOptimal = calcOptimalAgents(pAgentCaps, pDailyInflow)

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
}

// ─── 자원 진단 (재배치/충원/감축) ───

export function computeResourceDiagnosis(
  data: ReportData,
  projectFlows: ProjectFlow[],
  agentCapacities: AgentCapacity[],
  avgAgentCap: number,
  idleGlobalAgents: number,
  totalAssigned: number,
  dailyInflow: number,
  dailyCapacity: number,
  endWaiting: number,
  elapsedDays: number,
): ResourceDiagnosis {
  const { byAgent } = data
  const currentAgents = Math.max(totalAssigned, byAgent.length) || 1
  const allAgentCaps = [
    ...agentCapacities.map(a => a.dailyCap),
    ...Array(idleGlobalAgents).fill(avgAgentCap),
  ]
  const optimalAgents = calcOptimalAgents(allAgentCaps, dailyInflow)
  const gap = currentAgents - optimalAgents
  const queueDrainDays = dailyCapacity > dailyInflow && endWaiting > 0
    ? Math.round(endWaiting / (dailyCapacity - dailyInflow) * 10) / 10
    : dailyCapacity <= dailyInflow && endWaiting > 0 ? null : 0

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
      const spP = data.byProject.find(bp => bp.projectId === sp.projectId)
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

  return {
    currentAgents, optimalAgents, gap, avgAgentCapacity: Math.round(avgAgentCap * 10) / 10,
    queueDrainDays, scenario, rebalancePlan, shortagePlan, surplusPlan,
  }
}

// ─── 에이전트 부하 분석 ───

export function computeAgentLoads(
  data: ReportData,
  agentCapacities: AgentCapacity[],
  shortageProjects: ProjectFlow[],
  today: string,
): AgentLoad[] {
  const { byAgent, agentWaitingTrend } = data

  return byAgent.map(a => {
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
      agentId: a.agentId, agentName: a.agentName, agentAvatar: a.agentAvatar, agentDeleted: a.agentDeleted, cliName: a.cliName,
      assignedProjectId: a.assignedProjectId, assignedProjectName: a.assignedProjectName, currentStatus: a.currentStatus,
      tasks: a.tasks, dailyCapacity: Math.round(dailyCap * 10) / 10, currentWaiting: lastAW, cost: a.cost,
      successRate,
      annotation,
    }
  })
}

// ─── 검증자 진단 ───

export function computeVerifierDiagnosis(
  data: ReportData,
  elapsedDays: number,
): VerifierDiagnosis | null {
  const { byVerifier, lifecycle, prevLifecycle } = data

  if (!byVerifier || byVerifier.length === 0 || lifecycle.verifyCount === 0) return null

  const verifierCount = byVerifier.length
  const dailyVerifyInflow = elapsedDays > 0 ? lifecycle.verifyCount / elapsedDays : 0
  const dailyVerifyCap = elapsedDays > 0 ? byVerifier.reduce((s, v) => s + (v.tasks / elapsedDays), 0) : 0
  const verifyUtil = 0
  const verifyWaiting = 0

  let ann: I18nMessage | null = null
  if (prevLifecycle.verifyCount > 0 && lifecycle.verifyAvg > prevLifecycle.verifyAvg * 1.5) {
    ann = {
      key: 'verifierDiagBottleneck',
      params: { pct: Math.round((lifecycle.verifyAvg / prevLifecycle.verifyAvg - 1) * 100) },
    }
  }

  return { verifierCount, dailyVerifyInflow: Math.round(dailyVerifyInflow * 10) / 10, dailyVerifyCapacity: Math.round(dailyVerifyCap * 10) / 10, verifyUtilization: Math.round(verifyUtil * 100) / 100, verifyWaiting, annotation: ann }
}

// ─── 검증자별 부하 ───

export function computeVerifierLoads(
  data: ReportData,
  byVerifier: VerifierStat[],
  elapsedDays: number,
): VerifierLoad[] {
  const backlog = data.verifierBacklog || []
  const byNameMap = new Map<string, VerifierStat>()
  for (const v of byVerifier) byNameMap.set(v.verifierName, v)

  const usernames = new Set<string>()
  for (const b of backlog) usernames.add(b.username)

  const loads: VerifierLoad[] = []
  for (const username of usernames) {
    const b = backlog.find(x => x.username === username)!
    const byName = byNameMap.get(b.name)
    const approved = byName?.tasks ?? 0
    const rejected = 0
    const avgVerifyMin = byName?.avgVerifyMin ?? 0
    const dailyCap = elapsedDays > 0 && approved > 0 ? approved / elapsedDays : 0

    const current = b.verifyWaiting + b.verifying
    let annotation: VerifierAnnotation | null = null
    if (b.verifyWaiting >= 6) {
      annotation = { key: 'overload', params: { waiting: b.verifyWaiting }, severity: 'critical' }
    } else if (b.oldestWaitMin > 60 * 24) {
      annotation = { key: 'delayed', params: { hours: Math.round(b.oldestWaitMin / 60) }, severity: 'warning' }
    } else if (approved >= 3 && avgVerifyMin > 0 && avgVerifyMin < 1) {
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
}
