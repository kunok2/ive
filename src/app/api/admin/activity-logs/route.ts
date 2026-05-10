import { NextRequest, NextResponse } from 'next/server'
import { getCurrentUser } from '@/lib/auth'
import { getActivityLogs } from '@/lib/db'

const KST_OFFSET_MS = 9 * 60 * 60 * 1000

// YYYY-MM-DD(KST 날짜)를 해당 KST 자정의 UTC datetime 문자열로 변환.
// DB가 datetime('now') 포맷("YYYY-MM-DD HH:MM:SS" UTC)으로 저장하므로 동일 포맷으로 비교.
// 예: "2026-05-10" → "2026-05-09 15:00:00" (KST 2026-05-10 00:00 = UTC 2026-05-09 15:00)
function kstDateToUtcDatetime(kstDate: string): string {
  return new Date(new Date(kstDate).getTime() - KST_OFFSET_MS)
    .toISOString().replace('T', ' ').slice(0, 19)
}

export async function GET(req: NextRequest) {
  const user = await getCurrentUser()
  if (!user?.isAdmin) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const sp = req.nextUrl.searchParams
  const limit = Math.min(parseInt(sp.get('limit') || '50', 10), 200)
  const offset = parseInt(sp.get('offset') || '0', 10)
  const sortBy = sp.get('sortBy') || undefined
  const sortOrder = (sp.get('sortOrder') === 'ASC' ? 'ASC' : 'DESC') as 'ASC' | 'DESC'
  // userId / category 모두 다중 선택을 지원 — 콤마로 구분된 값 또는 반복 파라미터.
  const splitCsv = (s: string | null): string[] | undefined => {
    if (!s) return undefined
    const arr = s.split(',').map(x => x.trim()).filter(Boolean)
    return arr.length > 0 ? arr : undefined
  }
  const userIds = splitCsv(sp.get('userId'))
  const categories = splitCsv(sp.get('category'))
  // YYYY-MM-DD 형식의 날짜는 KST 자정 기준 UTC datetime으로 변환해서 DB와 비교.
  // KST 자정 = UTC 전날 15:00이므로 단순 날짜 문자열 비교로는 00:00~08:59 KST 구간이 누락됨.
  let startDate = sp.get('startDate') || undefined
  let endDate = sp.get('endDate') || undefined
  if (startDate && /^\d{4}-\d{2}-\d{2}$/.test(startDate)) {
    startDate = kstDateToUtcDatetime(startDate)
  }
  if (endDate && /^\d{4}-\d{2}-\d{2}$/.test(endDate)) {
    // endDate 하루 끝 = 다음 날 KST 자정
    const nextKstDay = new Date(new Date(endDate).getTime() + 86400000).toISOString().slice(0, 10)
    endDate = kstDateToUtcDatetime(nextKstDay)
  }

  const result = getActivityLogs({ limit, offset, userIds, categories, startDate, endDate, sortBy, sortOrder })
  return NextResponse.json(result)
}
