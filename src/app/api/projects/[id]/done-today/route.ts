import { NextResponse } from 'next/server'
import { getCurrentUser } from '@/lib/auth'
import { getProject, getProjectAccess, listTodayDoneIssues } from '@/lib/db'
import { getKSTTodayStartISO } from '@/lib/date-utils'

/**
 * 오늘(KST) 완료·반려로 바뀐 이슈 목록 — 카드 「완료」 숫자(stats.completed + failed)와 같은 근거(issue_stages).
 * 실행 기록 기반으로 세면 어제 시작한 일·사후 등록·최근 N건 밖의 일이 빠져 숫자와 목록이 어긋났다(60건 처리에 「오늘 완료 1」).
 */
export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const user = await getCurrentUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const { id } = await params
  if (!getProject(id) || !getProjectAccess(id, user.id)) return NextResponse.json({ error: 'Not found' }, { status: 404 })
  return NextResponse.json(listTodayDoneIssues(id, getKSTTodayStartISO()))
}
