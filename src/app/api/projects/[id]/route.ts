import { NextResponse } from 'next/server'
import { getProject, updateProject, deleteProject, getProjectAssignments, getProjectAccess } from '@/lib/db'
import { getCurrentUser } from '@/lib/auth'
import { encrypt } from '@/lib/crypto'
import { logActivity } from '@/lib/activity'

export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const user = await getCurrentUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { id } = await params
  const project = getProject(id)
  const access = project ? getProjectAccess(id, user.id) : null
  if (!project || !access) {
    return NextResponse.json({ error: 'Not found' }, { status: 404 })
  }

  const assignedAgents = getProjectAssignments(id)

  return NextResponse.json({
    ...project,
    accessToken: access === 'owner' ? project.accessToken : '', // 공유 사용자에게 토큰 숨김
    assignedAgents,
    shareRole: access === 'owner' ? null : access,
  })
}

export async function PUT(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const user = await getCurrentUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { id } = await params
  const body = await req.json()
  
  const updatedProject = {
    ...body,
    id,
    userId: user.id,
    accessToken: encrypt(body.accessToken || '')
  }
  
  updateProject(updatedProject)
  logActivity({ userId: user.id, category: 'project', action: 'update_project', detail: `프로젝트 수정: ${body.name || id}`, targetType: 'project', targetId: id, req })
  return NextResponse.json({ ...updatedProject })
}

export async function DELETE(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const user = await getCurrentUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { id } = await params
  const project = getProject(id)
  deleteProject(id, user.id)
  logActivity({ userId: user.id, category: 'project', action: 'delete_project', detail: `프로젝트 삭제: ${project?.name || id}`, targetType: 'project', targetId: id, req: _req })
  return NextResponse.json({ success: true })
}
