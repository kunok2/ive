import { NextResponse } from 'next/server'
import { getCurrentUser } from '@/lib/auth'
import { getMailClickStats } from '@/lib/db'

/** 단일 발송의 IVE 접속(클릭)을 사용자별로 집계해 반환 (관리자 전용) */
export async function GET(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  const user = await getCurrentUser()
  if (!user?.isAdmin) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const { id } = await ctx.params
  const stats = getMailClickStats(id)
  const totalClicks = stats.reduce((s, r) => s + r.count, 0)
  return NextResponse.json({ stats, totalClicks, userCount: stats.length })
}
