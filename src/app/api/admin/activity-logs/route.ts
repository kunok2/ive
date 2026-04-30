import { NextRequest, NextResponse } from 'next/server'
import { getCurrentUser } from '@/lib/auth'
import { getActivityLogs } from '@/lib/db'

export async function GET(req: NextRequest) {
  const user = await getCurrentUser()
  if (!user?.isAdmin) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const sp = req.nextUrl.searchParams
  const limit = Math.min(parseInt(sp.get('limit') || '50', 10), 200)
  const offset = parseInt(sp.get('offset') || '0', 10)
  // userId / category 모두 다중 선택을 지원 — 콤마로 구분된 값 또는 반복 파라미터.
  const splitCsv = (s: string | null): string[] | undefined => {
    if (!s) return undefined
    const arr = s.split(',').map(x => x.trim()).filter(Boolean)
    return arr.length > 0 ? arr : undefined
  }
  const userIds = splitCsv(sp.get('userId'))
  const categories = splitCsv(sp.get('category'))
  const startDate = sp.get('startDate') || undefined
  let endDate = sp.get('endDate') || undefined
  // endDate가 날짜만(YYYY-MM-DD) 전달된 경우 해당 날짜를 포함하도록 다음 날로 조정
  if (endDate && /^\d{4}-\d{2}-\d{2}$/.test(endDate)) {
    const d = new Date(endDate + 'T00:00:00Z')
    d.setUTCDate(d.getUTCDate() + 1)
    endDate = d.toISOString().slice(0, 10)
  }

  const result = getActivityLogs({ limit, offset, userIds, categories, startDate, endDate })
  return NextResponse.json(result)
}
