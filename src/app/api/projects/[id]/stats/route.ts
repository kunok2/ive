import { NextRequest, NextResponse } from 'next/server'
import { getCurrentUser } from '@/lib/auth'
import { getProject, getTodayExecutionsByProject, getYesterdayCompletedCount, getProjectAccess } from '@/lib/db'
import { getKSTTodayStart } from '@/lib/date-utils'

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const user = await getCurrentUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { id } = await params
  const project = getProject(id)
  if (!project || !getProjectAccess(id, user.id)) {
    return NextResponse.json({ error: 'Not found' }, { status: 404 })
  }

  const todayExecs = getTodayExecutionsByProject(id)
  const running = todayExecs.filter(e => e.status === 'running')
  const completed = todayExecs.filter(e => e.status === 'success')
  const failed = todayExecs.filter(e => e.status === 'failed')

  const totalTokens = todayExecs.reduce((sum, e) => sum + e.inputTokens + e.outputTokens, 0)
  const totalCost = todayExecs.reduce((sum, e) => sum + e.costUsd, 0)
  const yesterdayCount = getYesterdayCompletedCount('project', id)

  // 건/h 계산
  const now = new Date()
  const todayStart = getKSTTodayStart(now)
  const hoursElapsed = Math.max(0.5, (now.getTime() - todayStart.getTime()) / 3600000)
  const tasksPerHour = (completed.length + failed.length) / hoursElapsed

  return NextResponse.json({
    running: running.length,
    completed: completed.length,
    failed: failed.length,
    waiting: project.lastScannedIssueCount ?? 0,
    conflictCount: project.conflictCount ?? 0,
    totalTokens,
    totalCost,
    yesterdayCompleted: yesterdayCount,
    tasksPerHour: Math.round(tasksPerHour * 10) / 10,
  })
}
