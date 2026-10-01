import { NextResponse } from 'next/server'
import { getCurrentUser } from '@/lib/auth'
import { getProject, getProjectAccess } from '@/lib/db'
import { listEvidence } from '@/lib/evidence'

/** 이슈의 단계 증적 목록 (재현·검증·확인 실행별 스크린샷·결과) — 최신순 */
export async function GET(_req: Request, { params }: { params: Promise<{ id: string; iid: string }> }) {
  const user = await getCurrentUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const { id, iid } = await params
  if (!getProject(id) || !getProjectAccess(id, user.id)) return NextResponse.json({ error: 'Not found' }, { status: 404 })
  return NextResponse.json({ runs: listEvidence(id, Number(iid)) })
}
