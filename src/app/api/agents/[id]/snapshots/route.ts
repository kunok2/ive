import { NextRequest, NextResponse } from 'next/server'
import { getCurrentUser } from '@/lib/auth'
import { getAgent, getSnapshots, getDailyAvgSnapshots, getHourlyAvgSnapshots } from '@/lib/db'

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

  const mode = req.nextUrl.searchParams.get('mode')
  const limit = agent.sparklinePoints ?? 60
  let snapshots = mode === 'daily_avg'
    ? getDailyAvgSnapshots('agent', id, limit)
    : getSnapshots('agent', id, limit)
  // daily_avg 데이터가 2개 미만이면 시간별 평균으로 fallback
  if (mode === 'daily_avg' && snapshots.length < 2) {
    snapshots = getHourlyAvgSnapshots('agent', id, limit)
  }
  return NextResponse.json(snapshots)
}
