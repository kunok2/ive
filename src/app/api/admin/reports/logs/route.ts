import { NextResponse } from 'next/server'
import { getCurrentUser } from '@/lib/auth'
import { getReportSendLogs, getReportSendLogCount } from '@/lib/db'

export async function GET(req: Request) {
  const user = await getCurrentUser()
  if (!user?.isAdmin) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const { searchParams } = new URL(req.url)
  const limit = Math.min(Number(searchParams.get('limit')) || 50, 200)
  const offset = Number(searchParams.get('offset')) || 0

  const logs = getReportSendLogs(limit, offset)
  const total = getReportSendLogCount()

  return NextResponse.json({ logs, total })
}
