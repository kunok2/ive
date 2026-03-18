import { NextRequest, NextResponse } from 'next/server'
import { getCurrentUser } from '@/lib/auth'
import { getProject, getSnapshots, getDailyAvgSnapshots, getProjectAccess } from '@/lib/db'

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

  const mode = req.nextUrl.searchParams.get('mode')
  const limit = project.sparklinePoints ?? 60
  const snapshots = mode === 'daily_avg'
    ? getDailyAvgSnapshots('project', id, limit)
    : getSnapshots('project', id, limit)
  return NextResponse.json(snapshots)
}
