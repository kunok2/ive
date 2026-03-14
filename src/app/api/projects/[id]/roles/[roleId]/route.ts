import { NextResponse } from 'next/server'
import { updateRole, deleteRole, getProject } from '@/lib/db'
import { getCurrentUser } from '@/lib/auth'
import { encrypt } from '@/lib/crypto'

export async function PUT(req: Request, { params }: { params: Promise<{ id: string; roleId: string }> }) {
  const user = await getCurrentUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { id, roleId } = await params
  const project = getProject(id)
  if (!project || project.userId !== user.id) {
    return NextResponse.json({ error: 'Not found' }, { status: 404 })
  }

  const body = await req.json()
  const role = {
    ...body,
    id: roleId,
    projectId: id,
    accessToken: body.accessToken?.trim() ? encrypt(body.accessToken.trim()) : undefined,
  }
  updateRole(role)
  return NextResponse.json({ ...role, accessToken: body.accessToken?.trim() || undefined })
}

export async function DELETE(_req: Request, { params }: { params: Promise<{ id: string; roleId: string }> }) {
  const user = await getCurrentUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { id, roleId } = await params
  const project = getProject(id)
  if (!project || project.userId !== user.id) {
    return NextResponse.json({ error: 'Not found' }, { status: 404 })
  }

  deleteRole(roleId)
  return NextResponse.json({ success: true })
}
