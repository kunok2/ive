import { NextRequest, NextResponse } from 'next/server'
import { getCurrentUser } from '@/lib/auth'
import { getExecutionsInRange, getAllTokenPricing } from '@/lib/db'
import { calcCost } from '@/lib/token-pricing'

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

export async function GET(req: NextRequest) {
  const user = await getCurrentUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const url = req.nextUrl
  const type = url.searchParams.get('type') || 'weekly'
  const dateStr = url.searchParams.get('date') || new Date().toISOString().slice(0, 10)
  const date = new Date(dateStr)

  let range: { start: string; end: string }
  if (type === 'monthly') range = getMonthRange(date)
  else if (type === 'yearly') range = getYearRange(date)
  else range = getWeekRange(date)

  const execs = getExecutionsInRange(user.id, range.start, range.end)
  const pricingList = getAllTokenPricing()
  const pricingMap: Record<string, { input: number; output: number }> = {}
  for (const p of pricingList) {
    pricingMap[p.cliName] = { input: p.inputPrice, output: p.outputPrice }
  }

  // Duration helper (minutes)
  function durationMin(startedAt: string, endedAt: string | null): number {
    if (!endedAt) return 0
    return (new Date(endedAt).getTime() - new Date(startedAt).getTime()) / 60000
  }

  // Summary
  const totalTasks = execs.length
  const successCount = execs.filter(e => e.status === 'success').length
  const failedCount = execs.filter(e => e.status === 'failed').length
  const runningCount = execs.filter(e => e.status === 'running').length
  const totalDurationMin = execs.reduce((s, e) => s + durationMin(e.startedAt, e.endedAt), 0)
  const finishedCount = successCount + failedCount
  const avgDurationMin = finishedCount > 0 ? totalDurationMin / finishedCount : 0
  const totalInputTokens = execs.reduce((s, e) => s + e.inputTokens, 0)
  const totalOutputTokens = execs.reduce((s, e) => s + e.outputTokens, 0)
  const totalCost = execs.reduce((s, e) => s + calcCost(pricingMap, e.cliName, e.inputTokens, e.outputTokens), 0)
  const successRate = totalTasks > 0 ? (successCount / (successCount + failedCount || 1)) * 100 : 0

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
    const pCost = pExecs.reduce((s, e) => s + calcCost(pricingMap, e.cliName, e.inputTokens, e.outputTokens), 0)

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
      const aCost = aExecs.reduce((s, e) => s + calcCost(pricingMap, e.cliName, e.inputTokens, e.outputTokens), 0)
      return {
        agentId: aid, agentName: aExecs[0].agentName, agentAvatar: aExecs[0].agentAvatar, cliName: aExecs[0].cliName,
        tasks: aExecs.length, success: aSuccess, failed: aFailed,
        durationMin: Math.round(aDur * 10) / 10,
        avgDurationMin: aFinished > 0 ? Math.round((aDur / aFinished) * 10) / 10 : 0,
        inputTokens: aExecs.reduce((s, e) => s + e.inputTokens, 0),
        outputTokens: aExecs.reduce((s, e) => s + e.outputTokens, 0),
        cost: Math.round(aCost * 100) / 100,
        avgTurns: aFinished > 0 ? Math.round(aExecs.reduce((s, e) => s + e.turns, 0) / aFinished * 10) / 10 : 0,
      }
    })

    return {
      projectId: pid, projectName: pExecs[0].projectName, projectColor: pExecs[0].projectColor, projectAvatarUrl: pExecs[0].projectAvatarUrl || '',
      tasks: pExecs.length, success: pSuccess, failed: pFailed,
      totalDurationMin: Math.round(pDur * 10) / 10,
      avgDurationMin: pFinished > 0 ? Math.round((pDur / pFinished) * 10) / 10 : 0,
      inputTokens: pExecs.reduce((s, e) => s + e.inputTokens, 0),
      outputTokens: pExecs.reduce((s, e) => s + e.outputTokens, 0),
      cost: Math.round(pCost * 100) / 100,
      byAgent,
    }
  })

  // By agent (global)
  const globalAgentMap = new Map<string, typeof execs>()
  for (const e of execs) {
    if (!globalAgentMap.has(e.agentId)) globalAgentMap.set(e.agentId, [])
    globalAgentMap.get(e.agentId)!.push(e)
  }
  const byAgent = Array.from(globalAgentMap.entries()).map(([aid, aExecs]) => {
    const aSuccess = aExecs.filter(e => e.status === 'success').length
    const aFailed = aExecs.filter(e => e.status === 'failed').length
    const aDur = aExecs.reduce((s, e) => s + durationMin(e.startedAt, e.endedAt), 0)
    const aFinished = aSuccess + aFailed
    const aCost = aExecs.reduce((s, e) => s + calcCost(pricingMap, e.cliName, e.inputTokens, e.outputTokens), 0)
    return {
      agentId: aid, agentName: aExecs[0].agentName, agentAvatar: aExecs[0].agentAvatar, cliName: aExecs[0].cliName,
      tasks: aExecs.length, success: aSuccess, failed: aFailed,
      totalDurationMin: Math.round(aDur * 10) / 10,
      avgDurationMin: aFinished > 0 ? Math.round((aDur / aFinished) * 10) / 10 : 0,
      inputTokens: aExecs.reduce((s, e) => s + e.inputTokens, 0),
      outputTokens: aExecs.reduce((s, e) => s + e.outputTokens, 0),
      cost: Math.round(aCost * 100) / 100,
      avgTurns: aFinished > 0 ? Math.round(aExecs.reduce((s, e) => s + e.turns, 0) / aFinished * 10) / 10 : 0,
    }
  })

  // Daily trend (extended with waitAvg, procAvg)
  const dayMap = new Map<string, { tasks: number; success: number; failed: number; cost: number; waitTimes: number[]; procTimes: number[] }>()
  for (const e of execs) {
    const day = e.startedAt.slice(0, 10)
    if (!dayMap.has(day)) dayMap.set(day, { tasks: 0, success: 0, failed: 0, cost: 0, waitTimes: [], procTimes: [] })
    const d = dayMap.get(day)!
    d.tasks++
    if (e.status === 'success') d.success++
    if (e.status === 'failed') d.failed++
    d.cost += calcCost(pricingMap, e.cliName, e.inputTokens, e.outputTokens)
    if ((e.status === 'success' || e.status === 'failed') && e.endedAt) {
      const proc = durationMin(e.startedAt, e.endedAt)
      if (proc > 0) d.procTimes.push(proc)
      if (e.issueCreatedAt) {
        const wait = durationMin(e.issueCreatedAt, e.startedAt)
        if (wait >= 0) d.waitTimes.push(wait)
      }
    }
  }
  const dailyTrend = Array.from(dayMap.entries())
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([date, d]) => ({
      date,
      tasks: d.tasks, success: d.success, failed: d.failed,
      cost: Math.round(d.cost * 100) / 100,
      waitAvg: d.waitTimes.length > 0 ? Math.round(d.waitTimes.reduce((a, b) => a + b, 0) / d.waitTimes.length * 10) / 10 : null,
      procAvg: d.procTimes.length > 0 ? Math.round(d.procTimes.reduce((a, b) => a + b, 0) / d.procTimes.length * 10) / 10 : null,
    }))

  // Project trend (daily breakdown per project)
  const projectDayMap = new Map<string, Map<string, { tasks: number; cost: number }>>()
  for (const e of execs) {
    const day = e.startedAt.slice(0, 10)
    if (!projectDayMap.has(e.projectId)) projectDayMap.set(e.projectId, new Map())
    const pMap = projectDayMap.get(e.projectId)!
    if (!pMap.has(day)) pMap.set(day, { tasks: 0, cost: 0 })
    const d = pMap.get(day)!
    d.tasks++
    d.cost += calcCost(pricingMap, e.cliName, e.inputTokens, e.outputTokens)
  }
  const projectTrend = Array.from(projectDayMap.entries()).map(([pid, pMap]) => {
    const pInfo = execs.find(e => e.projectId === pid)!
    return {
      projectId: pid,
      projectName: pInfo.projectName,
      projectColor: pInfo.projectColor,
      daily: Array.from(pMap.entries())
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([date, d]) => ({ date, tasks: d.tasks, cost: Math.round(d.cost * 100) / 100 })),
    }
  })

  // Agent trend (daily breakdown per agent)
  const agentDayMap = new Map<string, Map<string, { tasks: number; cost: number }>>()
  for (const e of execs) {
    const day = e.startedAt.slice(0, 10)
    if (!agentDayMap.has(e.agentId)) agentDayMap.set(e.agentId, new Map())
    const aMap = agentDayMap.get(e.agentId)!
    if (!aMap.has(day)) aMap.set(day, { tasks: 0, cost: 0 })
    const d = aMap.get(day)!
    d.tasks++
    d.cost += calcCost(pricingMap, e.cliName, e.inputTokens, e.outputTokens)
  }
  const agentTrend = Array.from(agentDayMap.entries()).map(([aid, aMap]) => {
    const aInfo = execs.find(e => e.agentId === aid)!
    return {
      agentId: aid,
      agentName: aInfo.agentName,
      agentAvatar: aInfo.agentAvatar,
      daily: Array.from(aMap.entries())
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([date, d]) => ({ date, tasks: d.tasks, cost: Math.round(d.cost * 100) / 100 })),
    }
  })

  // Resolved issues (weekly only)
  const resolvedIssues = type === 'weekly'
    ? execs
      .filter(e => e.status === 'success' || e.status === 'failed')
      .map(e => ({
        issueIid: e.issueIid,
        issueTitle: e.issueTitle ?? `#${e.issueIid}`,
        projectId: e.projectId,
        projectName: e.projectName,
        projectColor: e.projectColor,
        agentName: e.agentName,
        agentAvatar: e.agentAvatar,
        status: e.status as 'success' | 'failed',
        startedAt: e.startedAt,
        durationMin: Math.round(durationMin(e.startedAt, e.endedAt) * 10) / 10,
        cost: Math.round(calcCost(pricingMap, e.cliName, e.inputTokens, e.outputTokens) * 100) / 100,
        waitMin: e.issueCreatedAt
          ? Math.round(durationMin(e.issueCreatedAt, e.startedAt) * 10) / 10
          : null,
      }))
    : undefined

  // 이슈 생애주기 집계
  const finishedExecs = execs.filter(e => (e.status === 'success' || e.status === 'failed') && e.endedAt)

  // 대기시간: issue_created_at → started_at
  const waitTimes = finishedExecs
    .filter(e => e.issueCreatedAt)
    .map(e => durationMin(e.issueCreatedAt!, e.startedAt))
    .filter(v => v >= 0)
  // 처리시간: started_at → ended_at
  const procTimes = finishedExecs
    .map(e => durationMin(e.startedAt, e.endedAt!))
    .filter(v => v > 0)
  // 총시간: issue_created_at → ended_at
  const totalTimes = finishedExecs
    .filter(e => e.issueCreatedAt)
    .map(e => durationMin(e.issueCreatedAt!, e.endedAt!))
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
    totalAvg: round1(avg(totalTimes)),
    totalMax: round1(max(totalTimes)),
    totalCount: totalTimes.length,
    avgAttempts: execCounts.length > 0 ? round1(avg(execCounts)) : 0,
    retryRate: execCounts.length > 0 ? round1((retryIssues / execCounts.length) * 100) : 0,
    uniqueIssues: execCounts.length,
  }

  // 추이 분석 인사이트 생성
  const insights: string[] = []
  if (dailyTrend.length >= 2) {
    const mid = Math.floor(dailyTrend.length / 2)
    const firstHalf = dailyTrend.slice(0, mid)
    const secondHalf = dailyTrend.slice(mid)
    const avgArr = <T,>(arr: T[], fn: (d: T) => number) =>
      arr.length > 0 ? arr.reduce((s, d) => s + fn(d), 0) / arr.length : 0

    // 작업 건수 추이
    const taskFirst = avgArr(firstHalf, d => d.tasks)
    const taskSecond = avgArr(secondHalf, d => d.tasks)
    if (taskFirst > 0) {
      const taskChange = ((taskSecond - taskFirst) / taskFirst) * 100
      if (Math.abs(taskChange) >= 10) {
        insights.push(`작업 건수가 ${taskChange > 0 ? '증가' : '감소'} 추세입니다 (${taskChange > 0 ? '+' : ''}${Math.round(taskChange)}%)`)
      }
    }

    // 비용 추이
    const costFirst = avgArr(firstHalf, d => d.cost)
    const costSecond = avgArr(secondHalf, d => d.cost)
    if (costFirst > 0) {
      const costChange = ((costSecond - costFirst) / costFirst) * 100
      if (Math.abs(costChange) >= 10) {
        insights.push(`비용이 ${costChange > 0 ? '증가' : '감소'} 추세입니다 (${costChange > 0 ? '+' : ''}${Math.round(costChange)}%)`)
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
          insights.push(`평균 대기시간이 ${wChange > 0 ? '늘어나고' : '줄어들고'} 있습니다 (${wChange > 0 ? '+' : ''}${Math.round(wChange)}%)`)
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
          insights.push(`평균 수행시간이 ${pChange > 0 ? '늘어나고' : '줄어들고'} 있습니다 (${pChange > 0 ? '+' : ''}${Math.round(pChange)}%)`)
        }
      }
    }

    // 성공률 추이
    const srFirst = avgArr(firstHalf, d => d.tasks > 0 ? (d.success / d.tasks) * 100 : 0)
    const srSecond = avgArr(secondHalf, d => d.tasks > 0 ? (d.success / d.tasks) * 100 : 0)
    const srDiff = srSecond - srFirst
    if (Math.abs(srDiff) >= 5) {
      insights.push(`성공률이 ${srDiff > 0 ? '개선' : '하락'}되고 있습니다 (${srDiff > 0 ? '+' : ''}${Math.round(srDiff)}%p)`)
    }

    // 프로젝트별 주요 변화
    for (const pt of projectTrend) {
      if (pt.daily.length >= 2) {
        const pMid = Math.floor(pt.daily.length / 2)
        const pFirst = pt.daily.slice(0, pMid)
        const pSecond = pt.daily.slice(pMid)
        const pcFirst = avgArr(pFirst, d => d.cost)
        const pcSecond = avgArr(pSecond, d => d.cost)
        if (pcFirst > 0) {
          const pcChange = ((pcSecond - pcFirst) / pcFirst) * 100
          if (Math.abs(pcChange) >= 30) {
            insights.push(`${pt.projectName} 프로젝트 비용이 ${pcChange > 0 ? '급증' : '급감'}했습니다 (${pcChange > 0 ? '+' : ''}${Math.round(pcChange)}%)`)
          }
        }
      }
    }

    // 개발자별 주요 변화
    for (const at of agentTrend) {
      if (at.daily.length >= 2) {
        const aMid = Math.floor(at.daily.length / 2)
        const aFirst = at.daily.slice(0, aMid)
        const aSecond = at.daily.slice(aMid)
        const atFirst = avgArr(aFirst, d => d.tasks)
        const atSecond = avgArr(aSecond, d => d.tasks)
        if (atFirst > 0) {
          const atChange = ((atSecond - atFirst) / atFirst) * 100
          if (Math.abs(atChange) >= 30) {
            insights.push(`${at.agentName} 작업자의 작업량이 ${atChange > 0 ? '증가' : '감소'}했습니다 (${atChange > 0 ? '+' : ''}${Math.round(atChange)}%)`)
          }
        }
      }
    }
  }

  if (insights.length === 0 && totalTasks > 0) {
    insights.push('선택 구간 내 유의미한 변동이 없습니다. 안정적인 추세입니다.')
  }

  return NextResponse.json({
    period: { start: range.start, end: range.end, type },
    summary: {
      totalTasks,
      successCount,
      failedCount,
      runningCount,
      successRate: Math.round(successRate * 10) / 10,
      totalDurationMin: Math.round(totalDurationMin * 10) / 10,
      avgDurationMin: Math.round(avgDurationMin * 10) / 10,
      totalInputTokens,
      totalOutputTokens,
      totalCost: Math.round(totalCost * 100) / 100,
    },
    byProject,
    byAgent,
    dailyTrend,
    projectTrend,
    agentTrend,
    resolvedIssues,
    lifecycle,
    insights,
  })
}
