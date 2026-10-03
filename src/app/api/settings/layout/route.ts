import { NextResponse } from 'next/server'
import { getCurrentUser } from '@/lib/auth'
import { updateUserNavPosition } from '@/lib/db'
import { NAV_POSITIONS, type NavPosition } from '@/types'
import { logActivity } from '@/lib/activity'

/** 화면 배치 — PC 폭의 주 메뉴 위치(왼쪽·오른쪽·아래). 본인 설정만 바꾼다 */
export async function PUT(req: Request) {
  const user = await getCurrentUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const { navPosition } = await req.json().catch(() => ({}))
  if (!NAV_POSITIONS.includes(navPosition as NavPosition)) {
    return NextResponse.json({ error: 'navPosition 은 left|right|bottom' }, { status: 400 })
  }
  updateUserNavPosition(user.id, navPosition as NavPosition)
  logActivity({ userId: user.id, category: 'settings', action: 'update_layout', detail: `메뉴 위치: ${navPosition}`, req })
  return NextResponse.json({ ok: true })
}
