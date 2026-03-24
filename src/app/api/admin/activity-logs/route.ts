import { NextRequest, NextResponse } from 'next/server'
import { getCurrentUser } from '@/lib/auth'
import { getActivityLogs } from '@/lib/db'

export async function GET(req: NextRequest) {
  const user = await getCurrentUser()
  if (!user?.isAdmin) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const sp = req.nextUrl.searchParams
  const limit = Math.min(parseInt(sp.get('limit') || '50', 10), 200)
  const offset = parseInt(sp.get('offset') || '0', 10)
  const userId = sp.get('userId') || undefined
  const category = sp.get('category') || undefined
  const startDate = sp.get('startDate') || undefined
  const endDate = sp.get('endDate') || undefined

  const result = getActivityLogs({ limit, offset, userId, category, startDate, endDate })
  return NextResponse.json(result)
}
