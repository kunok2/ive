import { NextResponse } from 'next/server'
import { getAgent, updateAgent, deleteAgent } from '@/lib/db'
import { getCurrentUser } from '@/lib/auth'
import { logActivity } from '@/lib/activity'

export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const user = await getCurrentUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { id } = await params
  const agent = getAgent(id)
  if (!agent || agent.userId !== user.id) {
    return NextResponse.json({ error: 'Not found' }, { status: 404 })
  }
  return NextResponse.json(agent)
}

export async function PUT(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const user = await getCurrentUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { id } = await params
  const body = await req.json()
  updateAgent({ ...body, id, userId: user.id })
  logActivity({ userId: user.id, category: 'agent', action: 'update_agent', detail: `개발자 수정: ${body.name || id}`, targetType: 'agent', targetId: id, req })
  return NextResponse.json({ ...body, id })
}

export async function DELETE(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const user = await getCurrentUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { id } = await params
  const agent = getAgent(id)
  deleteAgent(id, user.id)
  logActivity({ userId: user.id, category: 'agent', action: 'delete_agent', detail: `개발자 삭제: ${agent?.name || id}`, targetType: 'agent', targetId: id, req: _req })
  return NextResponse.json({ success: true })
}
