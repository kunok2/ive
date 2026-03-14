import { NextResponse } from 'next/server'
import { getAgentsByUser, createAgent } from '@/lib/db'
import { getCurrentUser } from '@/lib/auth'

export async function GET() {
  const user = await getCurrentUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const agents = getAgentsByUser(user.id)
  return NextResponse.json(agents)
}

export async function POST(req: Request) {
  const user = await getCurrentUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const body = await req.json()
  if (!body.name?.trim()) {
    return NextResponse.json({ error: 'Agent 이름을 입력해주세요' }, { status: 400 })
  }
  if (!body.cliPath?.trim()) {
    return NextResponse.json({ error: 'CLI 경로를 입력해주세요' }, { status: 400 })
  }

  const agent = { ...body, userId: user.id }
  createAgent(agent)
  return NextResponse.json(agent, { status: 201 })
}
