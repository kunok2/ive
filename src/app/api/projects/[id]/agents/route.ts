import { NextResponse } from 'next/server'
import { getProjectAssignments, assignAgentToProject, unassignAgentFromProject, getAgentProjectId, updateAssignmentToken, clearPreferredAgentRefs } from '@/lib/db'
import { getCurrentUser } from '@/lib/auth'
import { encrypt, decrypt } from '@/lib/crypto'

export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const user = await getCurrentUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { id } = await params
  const assignments = getProjectAssignments(id)
  // 토큰 유무만 표시 (실제 값은 노출하지 않음)
  const safe = assignments.map(a => ({
    ...a,
    accessToken: a.accessToken ? '••••••' : '',
    hasOwnToken: !!a.accessToken,
  }))
  return NextResponse.json(safe)
}

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const user = await getCurrentUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { id } = await params
  const { agentId, accessToken } = await req.json()

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
    accessToken: accessToken ? encrypt(accessToken) : '',
    assignedAt: new Date().toISOString(),
  })

  return NextResponse.json({ success: true }, { status: 201 })
}

// 개발자별 토큰 업데이트
export async function PATCH(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const user = await getCurrentUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { id } = await params
  const { agentId, accessToken } = await req.json()

  if (!agentId) {
    return NextResponse.json({ error: 'agentId가 필요합니다' }, { status: 400 })
  }

  // accessToken이 빈 문자열이면 토큰 제거 (프로젝트 토큰으로 복귀)
  const encryptedToken = accessToken ? encrypt(accessToken) : ''
  updateAssignmentToken(id, agentId, encryptedToken)

  return NextResponse.json({ success: true })
}

export async function DELETE(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const user = await getCurrentUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { id } = await params
  const { agentId } = await req.json()
  clearPreferredAgentRefs(agentId)
  unassignAgentFromProject(id, agentId)
  return NextResponse.json({ success: true })
}
