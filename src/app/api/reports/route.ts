import { NextRequest, NextResponse } from 'next/server'
import { getCurrentUser } from '@/lib/auth'
import { getExecutionsInRange, getDailyWaitingTrend, getDailyWaitingTrendByAgent, getProjectAssignmentCounts, getProjectAssignmentAgentIds, getAgentAssignmentInfo, getVerifierBacklogForReport } from '@/lib/db'
import { resolveExecutionCost, resolveExecutionCostBreakdown, getHumanMonthlySalary } from '@/lib/token-pricing'
import { getKSTTodayString, utcISOToKSTDate, utcISOToKSTMonth } from '@/lib/date-utils'

function getWeekRange(date: Date): { start: string; end: string } {
  const d = new Date(date)
  const day = d.getDay()
  const diff = day === 0 ? 6 : day - 1 // Monday=0
  const monday = new Date(d)
  monday.setDate(d.getDate() - diff)
  monday.setHours(0, 0, 0, 0)
  const sunday = new Date(monday)
  sunday.setDate(monday.getDate() + 7)
  return { start: monday.toISOString().slice(0, 10), end: sunday.toISOString().slice(0, 10) }
}

function getMonthRange(date: Date): { start: string; end: string } {
  const y = date.getFullYear(), m = date.getMonth()
  const start = new Date(y, m, 1).toISOString().slice(0, 10)
  const end = new Date(y, m + 1, 1).toISOString().slice(0, 10)
  return { start, end }
}

function getYearRange(date: Date): { start: string; end: string } {
  const y = date.getFullYear()
  return { start: `${y}-01-01`, end: `${y + 1}-01-01` }
}

/** 기간 내 모든 버킷 키를 생성 (yearly→월별, 그 외→일별) */
function periodKeys(start: string, end: string, type: string): string[] {
  const keys: string[] = []
  if (type === 'yearly') {
    // 월별: 2026-01, 2026-02, ...
    const s = new Date(start), e = new Date(end)
    const cur = new Date(s.getFullYear(), s.getMonth(), 1)
    while (cur < e) {
      keys.push(cur.toISOString().slice(0, 7)) // YYYY-MM
      cur.setMonth(cur.getMonth() + 1)
    }
  } else {
    // 일별
    const cur = new Date(start), e = new Date(end)
    while (cur < e) {
      keys.push(cur.toISOString().slice(0, 10))
      cur.setDate(cur.getDate() + 1)
    }
  }
  return keys
}

/** UTC ISO 날짜 → KST 기준 버킷 키 변환 */
function toBucketKey(dateStr: string, type: string): string {
  return type === 'yearly' ? utcISOToKSTMonth(dateStr) : utcISOToKSTDate(dateStr)
}

export async function GET(req: NextRequest) {
  const user = await getCurrentUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const url = req.nextUrl
  const type = url.searchParams.get('type') || 'weekly'
  const dateStr = url.searchParams.get('date') || getKSTTodayString()
  const date = new Date(dateStr)

  let range: { start: string; end: string }
  if (type === 'monthly') range = getMonthRange(date)
  else if (type === 'yearly') range = getYearRange(date)
  else range = getWeekRange(date)

  // 이전 기간 계산
  let prevRange: { start: string; end: string }
  if (type === 'monthly') {
    const pm = new Date(date)
    pm.setMonth(pm.getMonth() - 1)
    prevRange = getMonthRange(pm)
  } else if (type === 'yearly') {
    const py = new Date(date)
    py.setFullYear(py.getFullYear() - 1)
    prevRange = getYearRange(py)
  } else {
    const pw = new Date(date)
    pw.setDate(pw.getDate() - 7)
    prevRange = getWeekRange(pw)
  }

  const execs = getExecutionsInRange(user.id, range.start, range.end)
  const prevExecs = getExecutionsInRange(user.id, prevRange.start, prevRange.end)
  const projectAssignCounts = getProjectAssignmentCounts(user.id)
  const projectAssignAgentIds = getProjectAssignmentAgentIds(user.id)
  const agentAssignInfo = getAgentAssignmentInfo(user.id)
  const humanSalary = getHumanMonthlySalary()

  // Duration helper (minutes)
  function durationMin(startedAt: string, endedAt: string | null): number {
    if (!endedAt) return 0
    return Math.max(0, (new Date(endedAt).getTime() - new Date(startedAt).getTime()) / 60000)
  }

  // 대기시간 = issue_created_at(IVE-S 레이블 최초 감지 시각) → started_at(IVE-D, 에이전트 시작 시각)
  // scanner.ts가 IVE-S 감지 시각을 issue_stages.scheduled_at에 저장하고, 이를 issue_created_at에 기록

  // Summary
  const totalTasks = execs.length
  // 고유 이슈 수 (재시도는 1건으로 집계) — "유입" 계산용
  const uniqueIssueKeys = new Set(execs.map(e => `${e.projectId}:${e.issueIid}`))
  const uniqueInflow = uniqueIssueKeys.size
  // 완료된 고유 이슈 수 — "처리" 계산용 (검증 완료 또는 success/failed)
  const verifiedIssueKeys = new Set(
    execs.filter(e => e.verifiedAt || e.rejectedAt || e.status === 'success' || e.status === 'failed').map(e => `${e.projectId}:${e.issueIid}`)
  )
  const verifiedCount = verifiedIssueKeys.size
  const successCount = execs.filter(e => e.status === 'success').length
  const failedCount = execs.filter(e => e.status === 'failed').length
  const runningCount = execs.filter(e => e.status === 'running' || e.status === 'assigned').length
  const totalDurationMin = execs.reduce((s, e) => s + durationMin(e.startedAt, e.endedAt), 0)
  const finishedCount = successCount + failedCount
  const avgDurationMin = finishedCount > 0 ? totalDurationMin / finishedCount : 0
  const totalInputTokens = execs.reduce((s, e) => s + e.inputTokens, 0)
  const totalOutputTokens = execs.reduce((s, e) => s + e.outputTokens, 0)
  const totalCacheReadTokens = execs.reduce((s, e) => s + (e.cacheReadInputTokens ?? 0), 0)
  const totalCacheCreationTokens = execs.reduce((s, e) => s + (e.cacheCreationInputTokens ?? 0), 0)
  // 비용 breakdown: AI 토큰 비용과 사람 시간 비용을 분리 집계
  const costBreakdown = execs.reduce(
    (acc, e) => {
      const b = resolveExecutionCostBreakdown(e, humanSalary)
      acc.ai += b.ai; acc.human += b.human
      return acc
    },
    { ai: 0, human: 0 }
  )
  const totalCost = costBreakdown.ai + costBreakdown.human
  const totalCostAi = costBreakdown.ai
  const totalCostHuman = costBreakdown.human
  // 사람 비용 계산 메타 (왜 이 금액이 나왔는지 설명용)
  const humanMinutes = execs.reduce((s, e) => {
    if (e.assigneeType !== 'user' || !e.startedAt) return s
    const effEnd = e.endedAt || e.startedAt
    const ms = new Date(effEnd).getTime() - new Date(e.startedAt).getTime()
    return ms > 0 ? s + ms / 60000 : s
  }, 0)
  const successRate = totalTasks > 0 ? (successCount / (successCount + failedCount || 1)) * 100 : 0

  // 이전 기간 요약
  const prevTotalTasks = prevExecs.length
  const prevSuccessCount = prevExecs.filter(e => e.status === 'success').length
  const prevFailedCount = prevExecs.filter(e => e.status === 'failed').length
  const prevTotalDurationMin = prevExecs.reduce((s, e) => s + durationMin(e.startedAt, e.endedAt), 0)
  const prevFinished = prevSuccessCount + prevFailedCount
  const prevTotalCost = prevExecs.reduce((s, e) => s + resolveExecutionCost(e, humanSalary), 0)
  const prevSuccessRate = prevTotalTasks > 0 ? (prevSuccessCount / (prevFinished || 1)) * 100 : 0

  // 이전 기간 프로젝트별
  const prevProjectMap = new Map<string, typeof prevExecs>()
  for (const e of prevExecs) {
    if (!prevProjectMap.has(e.projectId)) prevProjectMap.set(e.projectId, [])
    prevProjectMap.get(e.projectId)!.push(e)
  }
  const prevByProject = Array.from(prevProjectMap.entries()).map(([pid, pExecs]) => ({
    projectId: pid, projectName: pExecs[0].projectName,
    tasks: pExecs.length,
    cost: Math.round(pExecs.reduce((s, e) => s + resolveExecutionCost(e, humanSalary), 0) * 100) / 100,
  }))

  // 이전 기간 작업자별
  const prevAgentMap = new Map<string, typeof prevExecs>()
  for (const e of prevExecs) {
    if (!prevAgentMap.has(e.agentId)) prevAgentMap.set(e.agentId, [])
    prevAgentMap.get(e.agentId)!.push(e)
  }
  const prevByAgent = Array.from(prevAgentMap.entries()).map(([aid, aExecs]) => ({
    agentId: aid, agentName: aExecs[0].agentName,
    tasks: aExecs.length,
    cost: Math.round(aExecs.reduce((s, e) => s + resolveExecutionCost(e, humanSalary), 0) * 100) / 100,
  }))

  // 이전 기간 사용자별 (담당자/검증자 — assigneeType='user'만, 현재 기간 byUser와 동일하게 userName으로 키)
  const prevUserMap = new Map<string, typeof prevExecs>()
  for (const e of prevExecs) {
    if (e.assigneeType !== 'user') continue
    const uid = (e.userName || e.userId || '').trim()
    if (!uid) continue
    if (!prevUserMap.has(uid)) prevUserMap.set(uid, [])
    prevUserMap.get(uid)!.push(e)
  }
  const prevByUser = Array.from(prevUserMap.entries()).map(([uid, uExecs]) => ({
    userId: uid, userName: uExecs[0].userName || uid,
    tasks: uExecs.length,
    issueCount: new Set(uExecs.map(e => `${e.projectId}:${e.issueIid}`)).size,
  }))

  // 이전 기간 일별 트렌드 — 전체 기간 버킷 채움 (waitAvg, procAvg 포함)
  const prevAllKeys = periodKeys(prevRange.start, prevRange.end, type)
  const prevDayMap = new Map<string, { tasks: number; cost: number; waitTimes: number[]; procTimes: number[]; verifyTimes: number[]; inflowIssues: Set<string>; verifiedIssues: Set<string> }>()
  const mkPrevBucket = () => ({ tasks: 0, cost: 0, waitTimes: [] as number[], procTimes: [] as number[], verifyTimes: [] as number[], inflowIssues: new Set<string>(), verifiedIssues: new Set<string>() })
  for (const key of prevAllKeys) prevDayMap.set(key, mkPrevBucket())
  // 이전 기간: 이슈별 최초 유입일/검증 완료일 계산
  const prevFirstStart = new Map<string, string>()
  for (const e of prevExecs) {
    const k = `${e.projectId}:${e.issueIid}`
    const pv = prevFirstStart.get(k)
    if (!pv || e.startedAt < pv) prevFirstStart.set(k, e.startedAt)
  }
  const prevVerifyDate = new Map<string, string>()
  for (const e of prevExecs) {
    const verifyEnd = e.verifiedAt || e.rejectedAt || ((e.status === 'success' || e.status === 'failed') ? (e.endedAt || e.startedAt) : null)
    if (!verifyEnd) continue
    const k = `${e.projectId}:${e.issueIid}`
    const pv = prevVerifyDate.get(k)
    if (!pv || verifyEnd < pv) prevVerifyDate.set(k, verifyEnd)
  }
  for (const e of prevExecs) {
    const key = toBucketKey(e.startedAt, type)
    if (!prevDayMap.has(key)) prevDayMap.set(key, mkPrevBucket())
    const d = prevDayMap.get(key)!
    d.tasks++
    d.cost += resolveExecutionCost(e, humanSalary)
    const ik = `${e.projectId}:${e.issueIid}`
    if (prevFirstStart.get(ik) === e.startedAt) d.inflowIssues.add(ik)
    if (e.status === 'success' || e.status === 'failed') {
      const effEnd = e.endedAt || e.startedAt
      const proc = durationMin(e.startedAt, effEnd)
      if (proc > 0) d.procTimes.push(proc)
      const ws = e.issueCreatedAt
      if (ws) {
        let wait = durationMin(ws, e.startedAt)
        if (effEnd && e.verifyStartedAt) {
          const vw = durationMin(effEnd, e.verifyStartedAt)
          if (vw >= 0) wait += vw
        }
        if (wait >= 0) d.waitTimes.push(wait)
      }
      const verifyEnd = e.verifiedAt || e.rejectedAt
      if (verifyEnd) {
        const vt = e.verifyStartedAt ? durationMin(e.verifyStartedAt, verifyEnd) : durationMin(effEnd, verifyEnd)
        if (vt >= 0) d.verifyTimes.push(vt)
      }
    }
  }
  // 검증 완료일 버킷 배정
  for (const [ik, verifyEnd] of prevVerifyDate) {
    const key = toBucketKey(verifyEnd, type)
    if (!prevDayMap.has(key)) prevDayMap.set(key, mkPrevBucket())
    prevDayMap.get(key)!.verifiedIssues.add(ik)
  }
  const prevDailyTrend = prevAllKeys.map(key => {
    const d = prevDayMap.get(key)!
    return {
      date: key,
      tasks: d.tasks,
      inflow: d.inflowIssues.size,
      verified: d.verifiedIssues.size,
      cost: Math.round(d.cost * 100) / 100,
      waitAvg: d.waitTimes.length > 0 ? Math.round(d.waitTimes.reduce((a, b) => a + b, 0) / d.waitTimes.length * 10) / 10 : null,
      procAvg: d.procTimes.length > 0 ? Math.round(d.procTimes.reduce((a, b) => a + b, 0) / d.procTimes.length * 10) / 10 : null,
      verifyAvg: d.verifyTimes.length > 0 ? Math.round(d.verifyTimes.reduce((a, b) => a + b, 0) / d.verifyTimes.length * 10) / 10 : null,
    }
  })

  // By project
  const projectMap = new Map<string, typeof execs>()
  for (const e of execs) {
    if (!projectMap.has(e.projectId)) projectMap.set(e.projectId, [])
    projectMap.get(e.projectId)!.push(e)
  }
  const byProject = Array.from(projectMap.entries()).map(([pid, pExecs]) => {
    const pSuccess = pExecs.filter(e => e.status === 'success').length
    const pFailed = pExecs.filter(e => e.status === 'failed').length
    const pDur = pExecs.reduce((s, e) => s + durationMin(e.startedAt, e.endedAt), 0)
    const pFinished = pSuccess + pFailed
    const pCostBreakdown = pExecs.reduce(
      (acc, e) => {
        const b = resolveExecutionCostBreakdown(e, humanSalary)
        acc.ai += b.ai; acc.human += b.human
        return acc
      },
      { ai: 0, human: 0 }
    )
    const pCost = pCostBreakdown.ai + pCostBreakdown.human

    // By agent within project
    const agentMap = new Map<string, typeof pExecs>()
    for (const e of pExecs) {
      if (!agentMap.has(e.agentId)) agentMap.set(e.agentId, [])
      agentMap.get(e.agentId)!.push(e)
    }
    const byAgent = Array.from(agentMap.entries()).map(([aid, aExecs]) => {
      const aSuccess = aExecs.filter(e => e.status === 'success').length
      const aFailed = aExecs.filter(e => e.status === 'failed').length
      const aDur = aExecs.reduce((s, e) => s + durationMin(e.startedAt, e.endedAt), 0)
      const aFinished = aSuccess + aFailed
      const aCost = aExecs.reduce((s, e) => s + resolveExecutionCost(e, humanSalary), 0)
      return {
        agentId: aid, agentName: aExecs[0].agentName, agentAvatar: aExecs[0].agentAvatar, cliName: aExecs[0].cliName,
        tasks: aExecs.length, success: aSuccess, failed: aFailed,
        durationMin: Math.round(aDur * 10) / 10,
        avgDurationMin: aFinished > 0 ? Math.round((aDur / aFinished) * 10) / 10 : 0,
        inputTokens: aExecs.reduce((s, e) => s + e.inputTokens, 0),
        outputTokens: aExecs.reduce((s, e) => s + e.outputTokens, 0),
        cacheReadTokens: aExecs.reduce((s, e) => s + (e.cacheReadInputTokens ?? 0), 0),
        cacheCreationTokens: aExecs.reduce((s, e) => s + (e.cacheCreationInputTokens ?? 0), 0),
        cost: Math.round(aCost * 100) / 100,
        avgTurns: aFinished > 0 ? Math.round(aExecs.reduce((s, e) => s + e.turns, 0) / aFinished * 10) / 10 : 0,
      }
    })

    const pUniqueIssues = new Set(pExecs.map(e => `${e.projectId}:${e.issueIid}`)).size
    const pVerified = new Set(pExecs.filter(e => e.verifiedAt || e.rejectedAt || e.status === 'success' || e.status === 'failed').map(e => `${e.projectId}:${e.issueIid}`)).size

    return {
      projectId: pid, projectName: pExecs[0].projectName, projectColor: pExecs[0].projectColor, projectAvatarUrl: pExecs[0].projectAvatarUrl || '', projectProvider: pExecs[0].projectProvider || 'gitlab',
      tasks: pExecs.length, uniqueIssues: pUniqueIssues, verified: pVerified, success: pSuccess, failed: pFailed,
      totalDurationMin: Math.round(pDur * 10) / 10,
      avgDurationMin: pFinished > 0 ? Math.round((pDur / pFinished) * 10) / 10 : 0,
      inputTokens: pExecs.reduce((s, e) => s + e.inputTokens, 0),
      outputTokens: pExecs.reduce((s, e) => s + e.outputTokens, 0),
      cacheReadTokens: pExecs.reduce((s, e) => s + (e.cacheReadInputTokens ?? 0), 0),
      cacheCreationTokens: pExecs.reduce((s, e) => s + (e.cacheCreationInputTokens ?? 0), 0),
      cost: Math.round(pCost * 100) / 100,
      costAi: Math.round(pCostBreakdown.ai * 100) / 100,
      costHuman: Math.round(pCostBreakdown.human * 100) / 100,
      assignedAgentCount: projectAssignCounts[pid] ?? 0,
      assignedAgentIds: projectAssignAgentIds[pid] ?? [],
      byAgent,
    }
  })

  // By agent (global) — 사람 작업(검증 등)은 제외: AI 에이전트만
  const globalAgentMap = new Map<string, typeof execs>()
  for (const e of execs) {
    if (e.assigneeType === 'user' || !e.agentId) continue
    if (!globalAgentMap.has(e.agentId)) globalAgentMap.set(e.agentId, [])
    globalAgentMap.get(e.agentId)!.push(e)
  }
  const byAgent = Array.from(globalAgentMap.entries()).map(([aid, aExecs]) => {
    const aSuccess = aExecs.filter(e => e.status === 'success').length
    const aFailed = aExecs.filter(e => e.status === 'failed').length
    const aDur = aExecs.reduce((s, e) => s + durationMin(e.startedAt, e.endedAt), 0)
    const aFinished = aSuccess + aFailed
    const aCost = aExecs.reduce((s, e) => s + resolveExecutionCost(e, humanSalary), 0)
    const aInfo = agentAssignInfo[aid]
    return {
      agentId: aid, agentName: aExecs[0].agentName, agentAvatar: aExecs[0].agentAvatar, cliName: aExecs[0].cliName,
      tasks: aExecs.length, success: aSuccess, failed: aFailed,
      totalDurationMin: Math.round(aDur * 10) / 10,
      avgDurationMin: aFinished > 0 ? Math.round((aDur / aFinished) * 10) / 10 : 0,
      inputTokens: aExecs.reduce((s, e) => s + e.inputTokens, 0),
      outputTokens: aExecs.reduce((s, e) => s + e.outputTokens, 0),
      cacheReadTokens: aExecs.reduce((s, e) => s + (e.cacheReadInputTokens ?? 0), 0),
      cacheCreationTokens: aExecs.reduce((s, e) => s + (e.cacheCreationInputTokens ?? 0), 0),
      cost: Math.round(aCost * 100) / 100,
      avgTurns: aFinished > 0 ? Math.round(aExecs.reduce((s, e) => s + e.turns, 0) / aFinished * 10) / 10 : 0,
      assignedProjectId: aInfo?.projectId ?? '',
      assignedProjectName: aInfo?.projectName ?? '',
      currentStatus: aInfo?.status ?? 'offline',
    }
  })

  // By verifier (검증자별) — byUser 합산용 먼저 계산
  const verifierMap = new Map<string, typeof execs>()
  for (const e of execs) {
    if (e.verifierName) {
      if (!verifierMap.has(e.verifierName)) verifierMap.set(e.verifierName, [])
      verifierMap.get(e.verifierName)!.push(e)
    }
  }
  // verifierName → 검증 통계 룩업맵
  const verifierLookup = new Map<string, { tasks: number; avgVerifyMin: number; avgWaitMin: number; verified: number; rejected: number; waiting: number }>()
  for (const [vName, vExecs] of verifierMap.entries()) {
    const verifyTimes = vExecs
      .filter(e => e.verifiedAt || e.rejectedAt)
      .map(e => {
        const effEnd = e.endedAt || e.startedAt
        const start = e.verifyStartedAt || effEnd
        const end = (e.verifiedAt || e.rejectedAt)!
        return (new Date(end).getTime() - new Date(start).getTime()) / 60000
      })
      .filter(t => t >= 0)
    const waitTimes = vExecs
      .filter(e => e.verifyStartedAt)
      .map(e => {
        const effEnd = e.endedAt || e.startedAt
        return (new Date(e.verifyStartedAt!).getTime() - new Date(effEnd).getTime()) / 60000
      })
      .filter(t => t >= 0 && t < 60 * 24 * 7)
    const verified = vExecs.filter(e => e.verifiedAt).length
    const rejected = vExecs.filter(e => e.rejectedAt && !e.verifiedAt).length
    const waiting = vExecs.filter(e => !e.verifiedAt && !e.rejectedAt && (e.status === 'success' || e.status === 'failed')).length
    verifierLookup.set(vName, {
      tasks: vExecs.length,
      avgVerifyMin: verifyTimes.length > 0 ? Math.round(verifyTimes.reduce((s, t) => s + t, 0) / verifyTimes.length * 10) / 10 : 0,
      avgWaitMin: waitTimes.length > 0 ? Math.round(waitTimes.reduce((s, t) => s + t, 0) / waitTimes.length * 10) / 10 : 0,
      verified, rejected, waiting,
    })
  }
  const byVerifier = Array.from(verifierLookup.entries()).map(([verifierName, v]) => {
    const vExecs = verifierMap.get(verifierName)!
    return { verifierName, verifierAvatar: vExecs[0].verifierAvatar || 'av-01', tasks: v.tasks, avgVerifyMin: v.avgVerifyMin, avgWaitMin: v.avgWaitMin }
  })

  // By user (담당자별 검증 현황) — assigneeType='user' (사람이 직접 담당)인 exec만 그룹핑.
  // 에이전트 통계는 별도(byAgent)이며 여기서는 절대 합치지 않는다.
  //
  // 중복 원인: 같은 사람의 user_id가 execution 생성 경로마다 다르게 저장됨
  //   - 외부 IVE-E 작업(scanner): userId=null,            userName="홍길동"
  //   - assignee 모드(scanner):    userId="12345"(GitLab), userName="홍길동"
  //   - 단계 전환(stage route):    userId="abc-uuid"(IVE), userName="홍길동"
  //   - 검증자 execution:          userId="abc-uuid"(IVE), userName="홍길동"
  // 기존 키(`userId || userName`) 사용 시 같은 사람이 2~3개 항목으로 분리 표시됨.
  // 해결: 모든 경로에서 일관되게 채워지는 userName을 정규화 키로 사용 (없을 때만 userId fallback).
  const userMap = new Map<string, typeof execs>()
  for (const e of execs) {
    if (e.assigneeType !== 'user') continue
    const uid = (e.userName || e.userId || '').trim()
    if (!uid) continue
    if (!userMap.has(uid)) userMap.set(uid, [])
    userMap.get(uid)!.push(e)
  }
  const byUser = Array.from(userMap.entries()).map(([uid, uExecs]) => {
    const uSuccess = uExecs.filter(e => e.status === 'success').length
    const uFailed = uExecs.filter(e => e.status === 'failed').length
    const uDur = uExecs.reduce((s, e) => s + durationMin(e.startedAt, e.endedAt), 0)
    const uFinished = uSuccess + uFailed
    const uniqueIssues = new Set(uExecs.map(e => `${e.projectId}:${e.issueIid}`))
    // 배정 → 시작까지의 대기 시간
    const waitTimes = uExecs
      .filter(e => e.issueCreatedAt && e.startedAt)
      .map(e => (new Date(e.startedAt!).getTime() - new Date(e.issueCreatedAt!).getTime()) / 60000)
      .filter(t => t >= 0 && t < 60 * 24 * 7)
    // 이름/아바타: user_* 컬럼만 사용. 아바타 우선순위: URL 형태 > 'photo'(원본 userId 보존) > null
    // 'photo'는 IVE 업로드 사진 표식 → UI가 /api/auth/avatar/image?id=<UUID>로 변환.
    // #284에서 그룹핑 키를 userName으로 통일했기 때문에 byUser.userId는 더 이상 UUID가 아니므로
    // photo 해상에 쓸 원본 UUID를 avatarUserId 필드로 별도 보존해야 한다.
    const userName = uExecs[0].userName || uid
    const urlAvatarExec = uExecs.find(e => e.userAvatar && e.userAvatar !== 'photo')
    const photoExec = uExecs.find(e => e.userAvatar === 'photo' && e.userId)
    const userAvatar = urlAvatarExec?.userAvatar ?? (photoExec ? 'photo' : null)
    const avatarUserId = urlAvatarExec ? null : (photoExec?.userId ?? null)
    const vInfo = verifierLookup.get(userName) ?? { tasks: 0, avgVerifyMin: 0, avgWaitMin: 0, verified: 0, rejected: 0, waiting: 0 }

    // 담당자 진단 (우선순위: 병목 > 반려율 > 너무 빠름 > 대기 적체 > 유휴)
    let annotation: { key: string; params?: Record<string, string | number>; severity: 'critical' | 'warning' | 'info' } | null = null
    const totalVerify = vInfo.verified + vInfo.rejected
    if (vInfo.waiting >= 5 && vInfo.avgVerifyMin >= 60) {
      annotation = { key: 'bottleneck', params: { waiting: vInfo.waiting, avgMin: Math.round(vInfo.avgVerifyMin) }, severity: 'critical' }
    } else if (totalVerify >= 5 && vInfo.rejected / totalVerify >= 0.3) {
      const pct = Math.round((vInfo.rejected / totalVerify) * 100)
      annotation = { key: 'highReject', params: { percent: pct }, severity: 'warning' }
    } else if (vInfo.verified >= 3 && vInfo.avgVerifyMin > 0 && vInfo.avgVerifyMin < 1) {
      annotation = { key: 'tooFast', params: { seconds: Math.round(vInfo.avgVerifyMin * 60) }, severity: 'warning' }
    } else if (vInfo.waiting >= 5) {
      annotation = { key: 'backlog', params: { waiting: vInfo.waiting }, severity: 'warning' }
    }
    return {
      userId: uid, userName, userAvatar, avatarUserId,
      tasks: uExecs.length, success: uSuccess, failed: uFailed,
      issueCount: uniqueIssues.size,
      avgDurationMin: uFinished > 0 ? Math.round((uDur / uFinished) * 10) / 10 : 0,
      avgWaitMin: waitTimes.length > 0 ? Math.round(waitTimes.reduce((s, t) => s + t, 0) / waitTimes.length * 10) / 10 : 0,
      verifyTasks: vInfo.tasks,
      avgVerifyMin: vInfo.avgVerifyMin,
      verifyAvgWaitMin: vInfo.avgWaitMin,
      verifyWaiting: vInfo.waiting,
      verifyApproved: vInfo.verified,
      verifyRejected: vInfo.rejected,
      annotation,
    }
  })

  // prevByVerifier
  const prevVerifierMap = new Map<string, typeof prevExecs>()
  for (const e of prevExecs) {
    if (e.verifierName) {
      if (!prevVerifierMap.has(e.verifierName)) prevVerifierMap.set(e.verifierName, [])
      prevVerifierMap.get(e.verifierName)!.push(e)
    }
  }
  const prevByVerifier = Array.from(prevVerifierMap.entries()).map(([vName, vExecs]) => ({
    verifierName: vName,
    tasks: vExecs.length,
  }))

  // User trend (daily breakdown per user) — 전체 기간 버킷 채움 (아래에서 allKeys 사용)

  // Daily trend (extended with waitAvg, procAvg) — 전체 기간 버킷 채움
  const allKeys = periodKeys(range.start, range.end, type)
  const todayKey = toBucketKey(getKSTTodayString(), type)
  type BucketData = { tasks: number; success: number; failed: number; cost: number; waitTimes: number[]; procTimes: number[]; verifyTimes: number[]; inflowIssues: Set<string>; verifiedIssues: Set<string> }
  const mkBucket = (): BucketData => ({ tasks: 0, success: 0, failed: 0, cost: 0, waitTimes: [], procTimes: [], verifyTimes: [], inflowIssues: new Set(), verifiedIssues: new Set() })
  const dayMap = new Map<string, BucketData>()
  for (const key of allKeys) dayMap.set(key, mkBucket())
  // 각 이슈를 유입일(가장 이른 started_at)에만 카운트 — 재시도로 유입 중복 방지
  const firstStartByIssue = new Map<string, string>()
  for (const e of execs) {
    const k = `${e.projectId}:${e.issueIid}`
    const prev = firstStartByIssue.get(k)
    if (!prev || e.startedAt < prev) firstStartByIssue.set(k, e.startedAt)
  }
  // 검증 완료일은 verifiedAt 또는 rejectedAt이 있는 exec 중 가장 이른 날짜로 귀속
  const verifyDateByIssue = new Map<string, string>()
  for (const e of execs) {
    const verifyEnd = e.verifiedAt || e.rejectedAt || ((e.status === 'success' || e.status === 'failed') ? (e.endedAt || e.startedAt) : null)
    if (!verifyEnd) continue
    const k = `${e.projectId}:${e.issueIid}`
    const prev = verifyDateByIssue.get(k)
    if (!prev || verifyEnd < prev) verifyDateByIssue.set(k, verifyEnd)
  }
  for (const e of execs) {
    const key = toBucketKey(e.startedAt, type)
    if (!dayMap.has(key)) dayMap.set(key, mkBucket())
    const d = dayMap.get(key)!
    d.tasks++
    if (e.status === 'success') d.success++
    if (e.status === 'failed') d.failed++
    d.cost += resolveExecutionCost(e, humanSalary)
    // 유입: 이슈별 최초 시작일에만 1회 카운트
    const ik = `${e.projectId}:${e.issueIid}`
    if (firstStartByIssue.get(ik) === e.startedAt) {
      d.inflowIssues.add(ik)
    }
    if (e.status === 'success' || e.status === 'failed') {
      const effEnd = e.endedAt || e.startedAt
      const proc = durationMin(e.startedAt, effEnd)
      if (proc > 0) d.procTimes.push(proc)
      const ws = e.issueCreatedAt
      if (ws) {
        let wait = durationMin(ws, e.startedAt)
        if (effEnd && e.verifyStartedAt) {
          const vw = durationMin(effEnd, e.verifyStartedAt)
          if (vw >= 0) wait += vw
        }
        if (wait >= 0) d.waitTimes.push(wait)
      }
      const verifyEnd = e.verifiedAt || e.rejectedAt
      if (verifyEnd) {
        const vt = e.verifyStartedAt ? durationMin(e.verifyStartedAt, verifyEnd) : durationMin(effEnd, verifyEnd)
        if (vt >= 0) d.verifyTimes.push(vt)
      }
    }
  }
  // 검증 완료 이슈를 검증 완료일 버킷에 배정 (유입·시작일과 다를 수 있음)
  for (const [ik, verifyEnd] of verifyDateByIssue) {
    const key = toBucketKey(verifyEnd, type)
    if (!dayMap.has(key)) dayMap.set(key, mkBucket())
    dayMap.get(key)!.verifiedIssues.add(ik)
  }
  const dailyTrend = allKeys.map(key => {
    const isFuture = key > todayKey
    const d = dayMap.get(key)!
    return {
      date: key,
      tasks: isFuture ? null : d.tasks,
      inflow: isFuture ? null : d.inflowIssues.size,
      verified: isFuture ? null : d.verifiedIssues.size,
      success: isFuture ? null : d.success,
      failed: isFuture ? null : d.failed,
      cost: isFuture ? null : Math.round(d.cost * 100) / 100,
      waitAvg: isFuture ? null : (d.waitTimes.length > 0 ? Math.round(d.waitTimes.reduce((a, b) => a + b, 0) / d.waitTimes.length * 10) / 10 : null),
      procAvg: isFuture ? null : (d.procTimes.length > 0 ? Math.round(d.procTimes.reduce((a, b) => a + b, 0) / d.procTimes.length * 10) / 10 : null),
      verifyAvg: isFuture ? null : (d.verifyTimes.length > 0 ? Math.round(d.verifyTimes.reduce((a, b) => a + b, 0) / d.verifyTimes.length * 10) / 10 : null),
    }
  })

  // Project trend (daily breakdown per project) — 전체 기간 버킷 채움
  const projectDayMap = new Map<string, Map<string, { tasks: number; cost: number }>>()
  for (const e of execs) {
    const key = toBucketKey(e.startedAt, type)
    if (!projectDayMap.has(e.projectId)) {
      const m = new Map<string, { tasks: number; cost: number }>()
      for (const k of allKeys) m.set(k, { tasks: 0, cost: 0 })
      projectDayMap.set(e.projectId, m)
    }
    const pMap = projectDayMap.get(e.projectId)!
    if (!pMap.has(key)) pMap.set(key, { tasks: 0, cost: 0 })
    const d = pMap.get(key)!
    d.tasks++
    d.cost += resolveExecutionCost(e, humanSalary)
  }
  const projectTrend = Array.from(projectDayMap.entries()).map(([pid, pMap]) => {
    const pInfo = execs.find(e => e.projectId === pid)!
    return {
      projectId: pid,
      projectName: pInfo.projectName,
      projectColor: pInfo.projectColor,
      daily: allKeys.map(key => {
        const isFuture = key > todayKey
        const d = pMap.get(key) ?? { tasks: 0, cost: 0 }
        return { date: key, tasks: isFuture ? null : d.tasks, cost: isFuture ? null : Math.round(d.cost * 100) / 100 }
      }),
    }
  })

  // Agent trend (daily breakdown per agent) — 전체 기간 버킷 채움
  const agentDayMap = new Map<string, Map<string, { tasks: number; cost: number }>>()
  for (const e of execs) {
    const key = toBucketKey(e.startedAt, type)
    if (!agentDayMap.has(e.agentId)) {
      const m = new Map<string, { tasks: number; cost: number }>()
      for (const k of allKeys) m.set(k, { tasks: 0, cost: 0 })
      agentDayMap.set(e.agentId, m)
    }
    const aMap = agentDayMap.get(e.agentId)!
    if (!aMap.has(key)) aMap.set(key, { tasks: 0, cost: 0 })
    const d = aMap.get(key)!
    d.tasks++
    d.cost += resolveExecutionCost(e, humanSalary)
  }
  const agentTrend = Array.from(agentDayMap.entries()).map(([aid, aMap]) => {
    const aInfo = execs.find(e => e.agentId === aid)!
    return {
      agentId: aid,
      agentName: aInfo.agentName,
      agentAvatar: aInfo.agentAvatar,
      daily: allKeys.map(key => {
        const isFuture = key > todayKey
        const d = aMap.get(key) ?? { tasks: 0, cost: 0 }
        return { date: key, tasks: isFuture ? null : d.tasks, cost: isFuture ? null : Math.round(d.cost * 100) / 100 }
      }),
    }
  })

  // User trend (담당자별 일별 추이) — 위 byUser와 동일한 정책:
  //   · assigneeType='user' (사람 담당자) exec만 포함, 에이전트는 byAgent에 별도 집계됨
  //   · userName을 정규화 키로 사용 (userId 표현 차이로 인한 중복 방지)
  // userTrend.userId 는 byUser.userId 와 1:1 매칭되어야 UserVerifySection에서 join이 됨.
  const userDayMap = new Map<string, Map<string, { tasks: number; cost: number; verified: number }>>()
  for (const e of execs) {
    if (e.assigneeType !== 'user') continue
    const uid = (e.userName || e.userId || '').trim()
    if (!uid) continue
    const key = toBucketKey(e.startedAt, type)
    if (!userDayMap.has(uid)) {
      const m = new Map<string, { tasks: number; cost: number; verified: number }>()
      for (const k of allKeys) m.set(k, { tasks: 0, cost: 0, verified: 0 })
      userDayMap.set(uid, m)
    }
    const uMap = userDayMap.get(uid)!
    if (!uMap.has(key)) uMap.set(key, { tasks: 0, cost: 0, verified: 0 })
    const d = uMap.get(key)!
    d.tasks++
    d.cost += resolveExecutionCost(e, humanSalary)
  }
  // 검증 완료 건수: verifierName이 담당자 키(userName)와 동일한 경우 해당 사용자에 가산
  for (const e of execs) {
    if (!e.verifierName) continue
    const verifyEnd = e.verifiedAt || e.rejectedAt
    if (!verifyEnd) continue
    const verifyKey = toBucketKey(verifyEnd, type)
    const uMap = userDayMap.get(e.verifierName.trim())
    if (!uMap) continue
    if (!uMap.has(verifyKey)) uMap.set(verifyKey, { tasks: 0, cost: 0, verified: 0 })
    uMap.get(verifyKey)!.verified++
  }
  const userTrend = Array.from(userDayMap.entries()).map(([uid, uMap]) => {
    const uExecs = execs.filter(ex => ex.assigneeType === 'user' && (ex.userName || ex.userId || '').trim() === uid)
    // byUser와 동일한 아바타 정책: URL > 'photo'(원본 userId 보존) > null
    const urlAvatarExec = uExecs.find(e => e.userAvatar && e.userAvatar !== 'photo')
    const photoExec = uExecs.find(e => e.userAvatar === 'photo' && e.userId)
    const userAvatar = urlAvatarExec?.userAvatar ?? (photoExec ? 'photo' : null)
    const avatarUserId = urlAvatarExec ? null : (photoExec?.userId ?? null)
    return {
      userId: uid,
      userName: uExecs[0]?.userName || uid,
      userAvatar,
      avatarUserId,
      daily: allKeys.map(key => {
        const isFuture = key > todayKey
        const d = uMap.get(key) ?? { tasks: 0, cost: 0, verified: 0 }
        return { date: key, tasks: isFuture ? null : d.tasks, cost: isFuture ? null : Math.round(d.cost * 100) / 100, verified: isFuture ? null : d.verified }
      }),
    }
  })

  // Resolved issues (weekly only)
  // 이슈별 실행 횟수 (attempts) 계산: 완료된 실행(success/failed)만 카운트
  // running/queued 등 진행 중인 실행을 포함하면 재시도율이 거짓으로 부풀어오름
  const issueAttemptMap = new Map<string, number>()
  for (const e of execs) {
    if (e.status !== 'success' && e.status !== 'failed') continue
    if (e.id.startsWith('ex-verify-')) continue
    const key = `${e.projectId}:${e.issueIid}`
    issueAttemptMap.set(key, (issueAttemptMap.get(key) || 0) + 1)
  }
  // 이슈별 현재 시도 번호를 추적하는 카운터
  const issueAttemptCounter = new Map<string, number>()
  const resolvedIssues = type === 'weekly'
    ? execs
      .filter(e => (e.status === 'success' || e.status === 'failed') && !e.id.startsWith('ex-verify-'))
      .map(e => {
        const key = `${e.projectId}:${e.issueIid}`
        const attemptNo = (issueAttemptCounter.get(key) || 0) + 1
        issueAttemptCounter.set(key, attemptNo)
        return {
          issueIid: e.issueIid,
          issueTitle: e.issueTitle ?? `#${e.issueIid}`,
          projectId: e.projectId,
          projectName: e.projectName,
          projectColor: e.projectColor,
          projectProvider: (e.projectProvider || 'gitlab') as 'gitlab' | 'github',
          agentName: e.agentName,
          agentAvatar: e.agentAvatar,
          verifierName: e.verifierName ?? null,
          verifierAvatar: e.verifierAvatar ?? null,
          verifierUserId: e.verifierUserId ?? null,
          status: e.status as 'success' | 'failed',
          startedAt: e.startedAt,
          // 처리 완료 시각 (검증 끝났으면 그 시점, 아니면 작업 종료 시점)
          resolvedAt: e.verifiedAt || e.rejectedAt || e.endedAt || e.startedAt,
          // 작업 시간 (에이전트가 코드를 만든 시간): startedAt → endedAt
          durationMin: Math.round(durationMin(e.startedAt, e.endedAt) * 10) / 10,
          // 검증 시간 (사람이 검증한 시간): verifyStartedAt → verifiedAt | rejectedAt
          verifyMin: (() => {
            const verifyEnd = e.verifiedAt || e.rejectedAt
            if (!e.verifyStartedAt || !verifyEnd) return null
            return Math.round(durationMin(e.verifyStartedAt, verifyEnd) * 10) / 10
          })(),
          // 총 소요 시간: 이슈 생성 → 최종 종료 (검증 끝났으면 그 시점, 아니면 endedAt)
          totalMin: (() => {
            const start = e.issueCreatedAt || e.startedAt
            const end = e.verifiedAt || e.rejectedAt || e.endedAt || e.startedAt
            return Math.round(durationMin(start, end) * 10) / 10
          })(),
          cost: Math.round(resolveExecutionCost(e, humanSalary) * 100) / 100,
          waitMin: (() => {
            const ws = e.issueCreatedAt
            return ws ? Math.round(durationMin(ws, e.startedAt) * 10) / 10 : null
          })(),
          turns: e.turns,
          attempts: issueAttemptMap.get(key) || 1,
          attemptNo,
        }
      })
    : undefined

  // 이슈 생애주기 집계
  const finishedExecs = execs.filter(e => e.status === 'success' || e.status === 'failed')

  // 대기시간: 개발대기(issue_created_at → started_at) + 검증대기(ended_at → verify_started_at)
  const waitTimes = finishedExecs
    .filter(e => e.issueCreatedAt)
    .map(e => {
      let wait = durationMin(e.issueCreatedAt!, e.startedAt)
      // 검증대기 시간 추가 (verify_started_at가 있으면 ended_at → verify_started_at)
      const effEnd = e.endedAt || e.startedAt
      if (effEnd && e.verifyStartedAt) {
        const verifyWait = durationMin(effEnd, e.verifyStartedAt)
        if (verifyWait >= 0) wait += verifyWait
      }
      return wait
    })
    .filter(v => v >= 0)
  // 작업시간: started_at → ended_at (ended_at 없으면 0)
  const procTimes = finishedExecs
    .filter(e => e.endedAt)
    .map(e => durationMin(e.startedAt, e.endedAt!))
    .filter(v => v > 0)
  // 검증시간: verify_started_at → verified_at/rejected_at (승인/반려 모두 포함)
  const verifyTimes = finishedExecs
    .filter(e => e.verifiedAt || e.rejectedAt)
    .map(e => {
      const verifyEnd = (e.verifiedAt || e.rejectedAt)!
      const effEnd = e.endedAt || e.startedAt
      return e.verifyStartedAt ? durationMin(e.verifyStartedAt, verifyEnd) : durationMin(effEnd, verifyEnd)
    })
    .filter(v => v >= 0)
  // 총시간: execution별 자체 생애주기 (대기 + 개발 + 검증대기 + 검증)
  const totalTimes = finishedExecs
    .filter(e => e.issueCreatedAt)
    .map(e => {
      const endPoint = e.verifiedAt || e.rejectedAt || e.endedAt || e.startedAt
      return durationMin(e.issueCreatedAt!, endPoint)
    })
    .filter(v => v >= 0)

  // 이슈별 실행 횟수
  const issueExecCounts = new Map<string, number>()
  for (const e of finishedExecs) {
    const key = `${e.projectId}:${e.issueIid}`
    issueExecCounts.set(key, (issueExecCounts.get(key) || 0) + 1)
  }
  const execCounts = [...issueExecCounts.values()]
  const retryIssues = execCounts.filter(c => c > 1).length

  const avg = (arr: number[]) => arr.length > 0 ? arr.reduce((a, b) => a + b, 0) / arr.length : 0
  const max = (arr: number[]) => arr.length > 0 ? Math.max(...arr) : 0
  const round1 = (v: number) => Math.round(v * 10) / 10

  const lifecycle = {
    waitAvg: round1(avg(waitTimes)),
    waitMax: round1(max(waitTimes)),
    waitCount: waitTimes.length,
    procAvg: round1(avg(procTimes)),
    procMax: round1(max(procTimes)),
    procCount: procTimes.length,
    verifyAvg: round1(avg(verifyTimes)),
    verifyMax: round1(max(verifyTimes)),
    verifyCount: verifyTimes.length,
    totalAvg: round1(avg(totalTimes)),
    totalMax: round1(max(totalTimes)),
    totalCount: totalTimes.length,
    avgAttempts: execCounts.length > 0 ? round1(avg(execCounts)) : 0,
    retryRate: execCounts.length > 0 ? round1((retryIssues / execCounts.length) * 100) : 0,
    uniqueIssues: execCounts.length,
  }

  // 이전 기간 생애주기 집계
  const prevFinishedExecs = prevExecs.filter(e => e.status === 'success' || e.status === 'failed')
  const prevWaitTimes = prevFinishedExecs
    .filter(e => e.issueCreatedAt)
    .map(e => {
      let wait = durationMin(e.issueCreatedAt!, e.startedAt)
      const effEnd = e.endedAt || e.startedAt
      if (effEnd && e.verifyStartedAt) {
        const vw = durationMin(effEnd, e.verifyStartedAt)
        if (vw >= 0) wait += vw
      }
      return wait
    })
    .filter(v => v >= 0)
  const prevProcTimes = prevFinishedExecs
    .filter(e => e.endedAt)
    .map(e => durationMin(e.startedAt, e.endedAt!))
    .filter(v => v > 0)
  const prevVerifyTimes = prevFinishedExecs
    .filter(e => e.verifiedAt || e.rejectedAt)
    .map(e => {
      const verifyEnd = (e.verifiedAt || e.rejectedAt)!
      const effEnd = e.endedAt || e.startedAt
      return e.verifyStartedAt ? durationMin(e.verifyStartedAt, verifyEnd) : durationMin(effEnd, verifyEnd)
    })
    .filter(v => v >= 0)
  const prevTotalTimes = prevFinishedExecs
    .filter(e => e.issueCreatedAt)
    .map(e => {
      const endPoint = e.verifiedAt || e.rejectedAt || e.endedAt || e.startedAt
      return durationMin(e.issueCreatedAt!, endPoint)
    })
    .filter(v => v >= 0)

  const prevLifecycle = {
    waitAvg: round1(avg(prevWaitTimes)),
    waitCount: prevWaitTimes.length,
    procAvg: round1(avg(prevProcTimes)),
    procCount: prevProcTimes.length,
    verifyAvg: round1(avg(prevVerifyTimes)),
    verifyCount: prevVerifyTimes.length,
    totalAvg: round1(avg(prevTotalTimes)),
    totalCount: prevTotalTimes.length,
  }

  // 추이 분석 인사이트 생성 (미래 버킷 제외)
  const pastTrend = dailyTrend.filter(d => d.tasks !== null)
  const insights: string[] = []
  if (pastTrend.length >= 2) {
    const mid = Math.floor(pastTrend.length / 2)
    const firstHalf = pastTrend.slice(0, mid)
    const secondHalf = pastTrend.slice(mid)
    const avgArr = <T,>(arr: T[], fn: (d: T) => number) =>
      arr.length > 0 ? arr.reduce((s, d) => s + fn(d), 0) / arr.length : 0

    // 작업 건수 추이
    const taskFirst = avgArr(firstHalf, d => d.tasks!)
    const taskSecond = avgArr(secondHalf, d => d.tasks!)
    if (taskFirst > 0) {
      const taskChange = ((taskSecond - taskFirst) / taskFirst) * 100
      if (Math.abs(taskChange) >= 10) {
        insights.push(`작업 건수가 ${taskChange > 0 ? '증가' : '감소'} 추세입니다 (${taskChange > 0 ? '+' : ''}${Math.round(taskChange).toLocaleString()}%)`)
      }
    }

    // 비용 추이
    const costFirst = avgArr(firstHalf, d => d.cost!)
    const costSecond = avgArr(secondHalf, d => d.cost!)
    if (costFirst > 0) {
      const costChange = ((costSecond - costFirst) / costFirst) * 100
      if (Math.abs(costChange) >= 10) {
        insights.push(`비용이 ${costChange > 0 ? '증가' : '감소'} 추세입니다 (${costChange > 0 ? '+' : ''}${Math.round(costChange).toLocaleString()}%)`)
      }
    }

    // 대기시간 추이
    const waitFirst = firstHalf.filter(d => d.waitAvg !== null)
    const waitSecond = secondHalf.filter(d => d.waitAvg !== null)
    if (waitFirst.length > 0 && waitSecond.length > 0) {
      const wFirst = avgArr(waitFirst, d => d.waitAvg ?? 0)
      const wSecond = avgArr(waitSecond, d => d.waitAvg ?? 0)
      if (wFirst > 0) {
        const wChange = ((wSecond - wFirst) / wFirst) * 100
        if (Math.abs(wChange) >= 10) {
          insights.push(`평균 대기시간이 ${wChange > 0 ? '늘어나고' : '줄어들고'} 있습니다 (${wChange > 0 ? '+' : ''}${Math.round(wChange).toLocaleString()}%)`)
        }
      }
    }

    // 수행시간 추이
    const procFirst = firstHalf.filter(d => d.procAvg !== null)
    const procSecond = secondHalf.filter(d => d.procAvg !== null)
    if (procFirst.length > 0 && procSecond.length > 0) {
      const pFirst = avgArr(procFirst, d => d.procAvg ?? 0)
      const pSecond = avgArr(procSecond, d => d.procAvg ?? 0)
      if (pFirst > 0) {
        const pChange = ((pSecond - pFirst) / pFirst) * 100
        if (Math.abs(pChange) >= 10) {
          insights.push(`평균 수행시간이 ${pChange > 0 ? '늘어나고' : '줄어들고'} 있습니다 (${pChange > 0 ? '+' : ''}${Math.round(pChange).toLocaleString()}%)`)
        }
      }
    }

    // 성공률 추이
    const srFirst = avgArr(firstHalf, d => d.tasks! > 0 ? (d.success! / d.tasks!) * 100 : 0)
    const srSecond = avgArr(secondHalf, d => d.tasks! > 0 ? (d.success! / d.tasks!) * 100 : 0)
    const srDiff = srSecond - srFirst
    if (Math.abs(srDiff) >= 5) {
      insights.push(`성공률이 ${srDiff > 0 ? '개선' : '하락'}되고 있습니다 (${srDiff > 0 ? '+' : ''}${Math.round(srDiff).toLocaleString()}%p)`)
    }

    // 프로젝트별 주요 변화
    for (const pt of projectTrend) {
      const pastDaily = pt.daily.filter(d => d.tasks !== null)
      if (pastDaily.length >= 2) {
        const pMid = Math.floor(pastDaily.length / 2)
        const pFirst = pastDaily.slice(0, pMid)
        const pSecond = pastDaily.slice(pMid)
        const pcFirst = avgArr(pFirst, d => d.cost!)
        const pcSecond = avgArr(pSecond, d => d.cost!)
        if (pcFirst > 0) {
          const pcChange = ((pcSecond - pcFirst) / pcFirst) * 100
          if (Math.abs(pcChange) >= 30) {
            insights.push(`${pt.projectName} 프로젝트 비용이 ${pcChange > 0 ? '급증' : '급감'}했습니다 (${pcChange > 0 ? '+' : ''}${Math.round(pcChange).toLocaleString()}%)`)
          }
        }
      }
    }

    // 사용자별 주요 변화
    for (const ut of userTrend) {
      const pastDaily = ut.daily.filter(d => d.tasks !== null)
      if (pastDaily.length >= 2) {
        const uMid = Math.floor(pastDaily.length / 2)
        const uFirst = pastDaily.slice(0, uMid)
        const uSecond = pastDaily.slice(uMid)
        const utFirst = avgArr(uFirst, d => d.tasks!)
        const utSecond = avgArr(uSecond, d => d.tasks!)
        if (utFirst > 0) {
          const utChange = ((utSecond - utFirst) / utFirst) * 100
          if (Math.abs(utChange) >= 30) {
            insights.push(`${ut.userName} 사용자의 이슈 생성량이 ${utChange > 0 ? '증가' : '감소'}했습니다 (${utChange > 0 ? '+' : ''}${Math.round(utChange).toLocaleString()}%)`)
          }
        }
      }
    }

    // 개발자별 주요 변화
    for (const at of agentTrend) {
      const pastDaily = at.daily.filter(d => d.tasks !== null)
      if (pastDaily.length >= 2) {
        const aMid = Math.floor(pastDaily.length / 2)
        const aFirst = pastDaily.slice(0, aMid)
        const aSecond = pastDaily.slice(aMid)
        const atFirst = avgArr(aFirst, d => d.tasks!)
        const atSecond = avgArr(aSecond, d => d.tasks!)
        if (atFirst > 0) {
          const atChange = ((atSecond - atFirst) / atFirst) * 100
          if (Math.abs(atChange) >= 30) {
            insights.push(`${at.agentName} 작업자의 작업량이 ${atChange > 0 ? '증가' : '감소'}했습니다 (${atChange > 0 ? '+' : ''}${Math.round(atChange).toLocaleString()}%)`)
          }
        }
      }
    }
  }

  if (insights.length === 0 && totalTasks > 0) {
    insights.push('선택 구간 내 유의미한 변동이 없습니다. 안정적인 추세입니다.')
  }

  // 대기건수 추이 (stat_snapshots 기반)
  // 보고서 일관성: 다른 모든 통계가 user.id로 필터링되므로 대기 트렌드도 동일 스코프로 제한
  const waitingTrend = getDailyWaitingTrend(user.id, range.start, range.end)
  const prevWaitingTrend = getDailyWaitingTrend(user.id, prevRange.start, prevRange.end)
  const agentWaitingTrend = getDailyWaitingTrendByAgent(user.id, range.start, range.end)
  const prevAgentWaitingTrend = getDailyWaitingTrendByAgent(user.id, prevRange.start, prevRange.end)

  // 대기건수 인사이트
  const waitingDays = waitingTrend.daily.filter(d => d.date <= todayKey)
  if (waitingDays.length >= 2) {
    const mid = Math.floor(waitingDays.length / 2)
    const firstHalf = waitingDays.slice(0, mid)
    const secondHalf = waitingDays.slice(mid)
    const avgFirst = firstHalf.reduce((s, d) => s + d.total, 0) / firstHalf.length
    const avgSecond = secondHalf.reduce((s, d) => s + d.total, 0) / secondHalf.length
    if (avgFirst > 0) {
      const change = ((avgSecond - avgFirst) / avgFirst) * 100
      if (Math.abs(change) >= 15) {
        insights.push(`대기 건수가 ${change > 0 ? '증가' : '감소'} 추세입니다 (${change > 0 ? '+' : ''}${Math.round(change).toLocaleString()}%)`)
      }
    }
  }

  return NextResponse.json({
    period: { start: range.start, end: range.end, type },
    prevPeriod: { start: prevRange.start, end: prevRange.end },
    summary: {
      totalTasks,
      uniqueInflow,
      verifiedCount,
      successCount,
      failedCount,
      runningCount,
      successRate: Math.round(successRate * 10) / 10,
      totalDurationMin: Math.round(totalDurationMin * 10) / 10,
      avgDurationMin: Math.round(avgDurationMin * 10) / 10,
      totalInputTokens,
      totalOutputTokens,
      totalCacheReadTokens,
      totalCacheCreationTokens,
      totalCost: Math.round(totalCost * 100) / 100,
      // 비용 내역 분리 (AI 토큰 비용 vs 사람 시간 비용)
      totalCostAi: Math.round(totalCostAi * 100) / 100,
      totalCostHuman: Math.round(totalCostHuman * 100) / 100,
      humanMinutes: Math.round(humanMinutes * 10) / 10,
      humanMonthlySalary: humanSalary,
    },
    prevSummary: {
      totalTasks: prevTotalTasks,
      successCount: prevSuccessCount,
      failedCount: prevFailedCount,
      successRate: Math.round(prevSuccessRate * 10) / 10,
      totalDurationMin: Math.round(prevTotalDurationMin * 10) / 10,
      avgDurationMin: prevFinished > 0 ? Math.round((prevTotalDurationMin / prevFinished) * 10) / 10 : 0,
      totalCost: Math.round(prevTotalCost * 100) / 100,
    },
    prevByProject,
    prevByAgent,
    prevByUser,
    prevByVerifier,
    prevDailyTrend,
    prevLifecycle,
    byProject,
    byAgent,
    byUser,
    byVerifier,
    dailyTrend,
    projectTrend,
    agentTrend,
    userTrend,
    resolvedIssues,
    lifecycle,
    insights,
    waitingTrend: waitingTrend.daily,
    prevWaitingTrend: prevWaitingTrend.daily,
    agentWaitingTrend: agentWaitingTrend.daily,
    totalAssignedAgents: Object.values(projectAssignCounts).reduce((s, c) => s + c, 0),
    prevAgentWaitingTrend: prevAgentWaitingTrend.daily,
    verifierBacklog: getVerifierBacklogForReport(user.id),
  })
}
