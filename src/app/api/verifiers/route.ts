import { NextResponse } from 'next/server'
import { getCurrentUser } from '@/lib/auth'
import { getVerifiersList, getConfirmersList, getProcessorsList } from '@/lib/db'

/** 역할을 가진 사람 목록 — ?role=process 처리자 · ?role=confirm 확인자 · 기본은 검증자 (종전 응답 그대로) */
export async function GET(req: Request) {
  const user = await getCurrentUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const role = new URL(req.url).searchParams.get('role')
  return NextResponse.json(role === 'process' ? getProcessorsList(user.id) : role === 'confirm' ? getConfirmersList(user.id) : getVerifiersList(user.id))
}
