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

  // Daily trend
  const dayMap = new Map<string, { tasks: number; success: number; failed: number; cost: number }>()
  for (const e of execs) {
    const day = e.startedAt.slice(0, 10)
    if (!dayMap.has(day)) dayMap.set(day, { tasks: 0, success: 0, failed: 0, cost: 0 })
    const d = dayMap.get(day)!
    d.tasks++
    if (e.status === 'success') d.success++
    if (e.status === 'failed') d.failed++
    d.cost += calcCost(pricingMap, e.cliName, e.inputTokens, e.outputTokens)
  }
  const dailyTrend = Array.from(dayMap.entries())
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([date, d]) => ({ date, ...d, cost: Math.round(d.cost * 100) / 100 }))

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
      }))
    : undefined

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
    resolvedIssues,
  })
}
