import { NextResponse } from 'next/server'
import { getAllActivities } from '@/lib/tool-activity'

export const dynamic = 'force-dynamic'

export async function GET() {
  return NextResponse.json(getAllActivities())
}
