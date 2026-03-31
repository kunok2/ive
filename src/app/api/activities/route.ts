import { NextResponse } from 'next/server'
import { getAllActivities } from '@/lib/tool-activity'
import { getCurrentUser } from '@/lib/auth'

export const dynamic = 'force-dynamic'

export async function GET() {
  const user = await getCurrentUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  return NextResponse.json(getAllActivities())
}
