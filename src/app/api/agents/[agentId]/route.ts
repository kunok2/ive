import { NextResponse } from 'next/server'
import { getAgent, updateAgent, deleteAgent } from '@/lib/db'
import { getCurrentUser } from '@/lib/auth'

export async function GET(_req: Request, { params }: { params: Promise<{ agentId: string }> }) {
  const user = await getCurrentUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { agentId } = await params
  const agent = getAgent(agentId)
  if (!agent || agent.userId !== user.id) {
    return NextResponse.json({ error: 'Not found' }, { status: 404 })
  }
  return NextResponse.json(agent)
}

export async function PUT(req: Request, { params }: { params: Promise<{ agentId: string }> }) {
  const user = await getCurrentUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { agentId } = await params
  const body = await req.json()
  updateAgent({ ...body, id: agentId, userId: user.id })
  return NextResponse.json({ ...body, id: agentId })
}

export async function DELETE(_req: Request, { params }: { params: Promise<{ agentId: string }> }) {
  const user = await getCurrentUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { agentId } = await params
  deleteAgent(agentId, user.id)
  return NextResponse.json({ success: true })
}
