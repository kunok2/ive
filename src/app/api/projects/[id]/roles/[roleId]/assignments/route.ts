import { NextResponse } from 'next/server'
import { getProject, getRolesByProject, getRoleAssignments, assignAgentToRole, unassignAgentFromRole, countRoleAgents, getAgent } from '@/lib/db'
import { getCurrentUser } from '@/lib/auth'

export async function GET(_req: Request, { params }: { params: Promise<{ id: string; roleId: string }> }) {
  const user = await getCurrentUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { roleId } = await params
  const assignments = getRoleAssignments(roleId)
  return NextResponse.json(assignments)
}

export async function POST(req: Request, { params }: { params: Promise<{ id: string; roleId: string }> }) {
  const user = await getCurrentUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { id, roleId } = await params

  const project = getProject(id)
  if (!project || project.userId !== user.id) {
    return NextResponse.json({ error: 'Not found' }, { status: 404 })
  }

  const roles = getRolesByProject(id)
  const role = roles.find(r => r.id === roleId)
  if (!role) {
    return NextResponse.json({ error: '역할을 찾을 수 없습니다' }, { status: 404 })
  }

  const body = await req.json()
  const { agentId } = body

  if (!agentId) {
    return NextResponse.json({ error: 'Agent ID가 필요합니다' }, { status: 400 })
  }

  const agent = getAgent(agentId)
  if (!agent || agent.userId !== user.id) {
    return NextResponse.json({ error: 'Agent를 찾을 수 없습니다' }, { status: 404 })
  }

  const currentCount = countRoleAgents(roleId)
  if (currentCount >= role.maxAgents) {
    return NextResponse.json(
      { error: `이 역할의 최대 Agent 수(${role.maxAgents}개)를 초과합니다` },
      { status: 409 }
    )
  }

  try {
    const assignment = {
      id: `ra-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      roleId,
      agentId,
      status: 'active' as const,
      assignedAt: new Date().toISOString(),
    }
    assignAgentToRole(assignment)
    return NextResponse.json(assignment, { status: 201 })
  } catch (err: unknown) {
    if (err instanceof Error && err.message.includes('UNIQUE')) {
      return NextResponse.json({ error: '이미 배정된 Agent입니다' }, { status: 409 })
    }
    throw err
  }
}

export async function DELETE(req: Request, { params }: { params: Promise<{ id: string; roleId: string }> }) {
  const user = await getCurrentUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { id, roleId } = await params

  const project = getProject(id)
  if (!project || project.userId !== user.id) {
    return NextResponse.json({ error: 'Not found' }, { status: 404 })
  }

  const { agentId } = await req.json()
  if (!agentId) {
    return NextResponse.json({ error: 'Agent ID가 필요합니다' }, { status: 400 })
  }

  unassignAgentFromRole(roleId, agentId)
  return NextResponse.json({ success: true })
}
