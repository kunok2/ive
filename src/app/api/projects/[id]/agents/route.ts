import { NextResponse } from 'next/server'
import { getProjectAssignments, assignAgentToProject, unassignAgentFromProject, getAgentProjectId } from '@/lib/db'
import { getCurrentUser } from '@/lib/auth'

export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const user = await getCurrentUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { id } = await params
  const assignments = getProjectAssignments(id)
  return NextResponse.json(assignments)
}

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const user = await getCurrentUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { id } = await params
  const { agentId } = await req.json()

  // 이미 다른 프로젝트에 배정된 에이전트인지 확인
  const existingProjectId = getAgentProjectId(agentId)
  if (existingProjectId && existingProjectId !== id) {
    return NextResponse.json({ error: '이 Agent는 이미 다른 프로젝트에 배정되어 있습니다' }, { status: 400 })
  }
  if (existingProjectId === id) {
    return NextResponse.json({ error: '이미 이 프로젝트에 배정된 Agent입니다' }, { status: 400 })
  }

  assignAgentToProject({
    id: `pa-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
    projectId: id,
    agentId,
    assignedAt: new Date().toISOString(),
  })

  return NextResponse.json({ success: true }, { status: 201 })
}

export async function DELETE(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const user = await getCurrentUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { id } = await params
  const { agentId } = await req.json()
  unassignAgentFromProject(id, agentId)
  return NextResponse.json({ success: true })
}
