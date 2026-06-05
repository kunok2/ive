import { NextResponse } from 'next/server'
import { getCurrentUser } from '@/lib/auth'
import { getSocialPostStats } from '@/lib/db'

/** SNS 홍보글의 채널별 유입/고유방문자/전환 통계 (관리자 전용) */
export async function GET(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  const user = await getCurrentUser()
  if (!user?.isAdmin) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const { id } = await ctx.params
  return NextResponse.json(getSocialPostStats(id))
}
