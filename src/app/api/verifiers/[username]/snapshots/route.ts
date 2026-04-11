import { NextRequest, NextResponse } from 'next/server'
import { getCurrentUser } from '@/lib/auth'
import { getSnapshots, getDailyAvgSnapshots, getHourlyAvgSnapshots } from '@/lib/db'

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ username: string }> }
) {
  const user = await getCurrentUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const { username } = await params
  const decoded = decodeURIComponent(username)
  const mode = req.nextUrl.searchParams.get('mode')
  const limit = 60
  let snapshots = mode === 'daily_avg'
    ? getDailyAvgSnapshots('verifier', decoded, limit)
    : getSnapshots('verifier', decoded, limit)
  if (mode === 'daily_avg' && snapshots.length < 2) {
    snapshots = getHourlyAvgSnapshots('verifier', decoded, limit)
  }
  return NextResponse.json(snapshots)
}
