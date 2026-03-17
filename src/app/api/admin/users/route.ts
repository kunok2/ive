import { NextResponse } from 'next/server'
import { getCurrentUser } from '@/lib/auth'
import { getAllUsers, deleteUser, getDb } from '@/lib/db'

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

  deleteUser(userId)
  return NextResponse.json({ success: true })
}

// 사용자 설정 변경 (관리자 권한, 제한 등)
export async function PATCH(req: Request) {
  const user = await getCurrentUser()
  if (!user?.isAdmin) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const { userId, isAdmin, maxAgents, maxTurns } = await req.json()
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
  return NextResponse.json({ success: true })
}
