import { NextResponse } from 'next/server'
import { getCurrentUser } from '@/lib/auth'
import { getAllAgents, getUserById } from '@/lib/db'

/** 관리자: 워크스페이스에 지정할 수 있는 에이전트 목록 (선택용) */
export async function GET() {
  const user = await getCurrentUser()
  if (!user?.isAdmin) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const agents = getAllAgents().map(a => ({
    id: a.id,
    name: a.name,
    cliName: a.cliName,
    ownerName: getUserById(a.userId)?.name || '',
  }))
  return NextResponse.json(agents)
}
