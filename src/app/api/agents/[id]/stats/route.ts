import { NextRequest, NextResponse } from 'next/server'
import { getCurrentUser } from '@/lib/auth'
import { getAgent, getTodayExecutionsByAgent, getLatestExecutionsByAgent, getYesterdayCompletedCount } from '@/lib/db'
import { getKSTTodayStart } from '@/lib/date-utils'
import { parseProjectsParam } from '@/lib/project-filter-param'

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const user = await getCurrentUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { id } = await params
  const agent = getAgent(id)
  if (!agent || agent.userId !== user.id) {
    return NextResponse.json({ error: 'Not found' }, { status: 404 })
  }

  const projectIds = parseProjectsParam(req.url) // 개발자 탭 프로젝트 필터
  const todayExecs = getTodayExecutionsByAgent(id, projectIds)
  const running = todayExecs.filter(e => e.status === 'running')
  const completed = todayExecs.filter(e => e.status === 'success')
  const failed = todayExecs.filter(e => e.status === 'failed')

  const totalTokens = todayExecs.reduce((sum, e) => sum + e.inputTokens + e.outputTokens, 0)
  const totalCost = todayExecs.reduce((sum, e) => sum + e.costUsd, 0)
  const yesterdayCount = getYesterdayCompletedCount('agent', id, projectIds)

  // 평균 작업 시간 (최근 20건 기준)
  const recentDone = getLatestExecutionsByAgent(id, 20, projectIds).filter(e => e.endedAt && e.status !== 'running')
  let avgDurationSec = 0
  let avgTokensPerTask = 0
  let avgCostPerTask = 0
  let successRate = 0
  let avgTurnsPerTask = 0

  if (recentDone.length > 0) {
    const durations = recentDone.map(e => {
      const start = new Date(e.startedAt).getTime()
      const end = new Date(e.endedAt!).getTime()
      return (end - start) / 1000
    })
    avgDurationSec = Math.round(durations.reduce((a, b) => a + b, 0) / durations.length)
    avgTokensPerTask = Math.round(recentDone.reduce((sum, e) => sum + e.inputTokens + e.outputTokens, 0) / recentDone.length)
    avgCostPerTask = recentDone.reduce((sum, e) => sum + e.costUsd, 0) / recentDone.length
    successRate = Math.round(recentDone.filter(e => e.status === 'success').length / recentDone.length * 100)
    avgTurnsPerTask = Math.round(recentDone.reduce((sum, e) => sum + e.turns, 0) / recentDone.length * 10) / 10
  }

  // 건/h
  const now = new Date()
  const todayStart = getKSTTodayStart(now)
  const hoursElapsed = Math.max(0.5, (now.getTime() - todayStart.getTime()) / 3600000)
  const tasksPerHour = (completed.length + failed.length) / hoursElapsed

  return NextResponse.json({
    running: running.length,
    completed: completed.length,
    failed: failed.length,
    totalTokens,
    totalCost,
    yesterdayCompleted: yesterdayCount,
    tasksPerHour: Math.round(tasksPerHour * 10) / 10,
    avgDurationSec,
    avgTokensPerTask,
    avgCostPerTask: Math.round(avgCostPerTask * 10000) / 10000,
    successRate,
    avgTurnsPerTask,
  })
}
