import { NextResponse } from 'next/server'
import { getCurrentUser } from '@/lib/auth'
import { getProject, getProjectAccess, listTodayDoneIssues } from '@/lib/db'
import { getKSTTodayStartISO } from '@/lib/date-utils'
import { completedOnDays } from '@/lib/report-model/load'
import { addDays, kstToday } from '@/lib/report-model/period'

/**
 * 오늘(KST) 완료·반려된 이슈 목록 — 카드 「완료」 숫자(stats.completed + failed)와 같은 근거.
 * 완료는 보고서와 같은 완료 사이클로 센다(#563). 실행 기록(오늘 시작·최근 N건)으로 세면 어제 시작한 일·사후 등록이 빠졌다(60건 처리에 「오늘 완료 1」).
 */
export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const user = await getCurrentUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const { id } = await params
  if (!getProject(id) || !getProjectAccess(id, user.id)) return NextResponse.json({ error: 'Not found' }, { status: 404 })
  const today = kstToday()
  const done = completedOnDays(id, today, addDays(today, 1)).map(c => ({ iid: Number(c.key.slice(c.key.lastIndexOf(':') + 1)), at: c.at }))
  return NextResponse.json(listTodayDoneIssues(id, getKSTTodayStartISO(), done))
}
