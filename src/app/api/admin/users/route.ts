import { NextResponse } from 'next/server'
import { getCurrentUser } from '@/lib/auth'
import { getAllUsers, deleteUser, getDb, getUserById } from '@/lib/db'
import { logActivity } from '@/lib/activity'

export async function GET() {
  const user = await getCurrentUser()
  if (!user?.isAdmin) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const users = getAllUsers()
  return NextResponse.json(users)
}

export async function DELETE(req: Request) {
  const user = await getCurrentUser()
  if (!user?.isAdmin) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const { userId } = await req.json()
  if (!userId) return NextResponse.json({ error: '사용자 ID가 필요합니다' }, { status: 400 })
  if (userId === user.id) return NextResponse.json({ error: '본인은 삭제할 수 없습니다' }, { status: 400 })

  const targetUser = getUserById(userId)
  deleteUser(userId)
  logActivity({ userId: user.id, category: 'admin', action: 'delete_user', detail: `사용자 삭제: ${targetUser?.name || userId}`, targetType: 'user', targetId: userId, req })
  return NextResponse.json({ success: true })
}

// 사용자 설정 변경 (관리자 권한, 제한 등)
export async function PATCH(req: Request) {
  const user = await getCurrentUser()
  if (!user?.isAdmin) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const { userId, isAdmin, maxAgents, maxTurns, allowedClis, rateMultiplier } = await req.json()
  if (!userId) return NextResponse.json({ error: '사용자 ID가 필요합니다' }, { status: 400 })

  if (typeof isAdmin === 'boolean') {
    if (userId === user.id) return NextResponse.json({ error: '본인의 권한은 변경할 수 없습니다' }, { status: 400 })
    getDb().prepare('UPDATE users SET is_admin = ? WHERE id = ?').run(isAdmin ? 1 : 0, userId)
  }
  if (typeof maxAgents === 'number') {
    getDb().prepare('UPDATE users SET max_agents = ? WHERE id = ?').run(maxAgents, userId)
  }
  if (typeof maxTurns === 'number') {
    getDb().prepare('UPDATE users SET max_turns = ? WHERE id = ?').run(maxTurns, userId)
  }
  if (Array.isArray(allowedClis)) {
    const cliStr = allowedClis.filter(Boolean).join(',') || 'opencode'
    getDb().prepare('UPDATE users SET allowed_clis = ? WHERE id = ?').run(cliStr, userId)
  }
  if (typeof rateMultiplier === 'number' && Number.isFinite(rateMultiplier) && rateMultiplier > 0) {
    // 사람단가 배수. 소수 허용(예: 1.8). 0/음수/NaN은 거부, 과도한 값은 상한.
    const m = Math.min(Math.round(rateMultiplier * 100) / 100, 100)
    getDb().prepare('UPDATE users SET rate_multiplier = ? WHERE id = ?').run(m, userId)
  }
  const changes: string[] = []
  if (typeof isAdmin === 'boolean') changes.push(`관리자=${isAdmin ? '지정' : '해제'}`)
  if (typeof maxAgents === 'number') changes.push(`최대개발자=${maxAgents}`)
  if (typeof maxTurns === 'number') changes.push(`최대턴=${maxTurns}`)
  if (Array.isArray(allowedClis)) changes.push(`CLI=${allowedClis.join(',')}`)
  if (typeof rateMultiplier === 'number' && Number.isFinite(rateMultiplier) && rateMultiplier > 0) changes.push(`단가배수=${Math.min(Math.round(rateMultiplier * 100) / 100, 100)}`)
  const targetUser = getUserById(userId)
  logActivity({ userId: user.id, category: 'admin', action: 'update_user', detail: `사용자 설정 변경 (${targetUser?.name || userId}): ${changes.join(', ')}`, targetType: 'user', targetId: userId, req })
  return NextResponse.json({ success: true })
}
