import { NextResponse } from 'next/server'
import { getRolesByProject, createRole, getProject } from '@/lib/db'
import { getCurrentUser } from '@/lib/auth'
import { encrypt, decrypt } from '@/lib/crypto'

export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const user = await getCurrentUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { id } = await params
  const project = getProject(id)
  if (!project || project.userId !== user.id) {
    return NextResponse.json({ error: 'Not found' }, { status: 404 })
  }

  const roles = getRolesByProject(id)
  const decrypted = roles.map(r => ({
    ...r,
    accessToken: safeDecrypt(r.accessToken || ''),
  }))
  return NextResponse.json(decrypted)
}

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const user = await getCurrentUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { id } = await params
  const project = getProject(id)
  if (!project || project.userId !== user.id) {
    return NextResponse.json({ error: 'Not found' }, { status: 404 })
  }

  const body = await req.json()
  if (!body.name?.trim()) {
    return NextResponse.json({ error: '역할 이름을 입력해주세요' }, { status: 400 })
  }

  const role = {
    ...body,
    projectId: id,
    accessToken: body.accessToken?.trim() ? encrypt(body.accessToken.trim()) : undefined,
  }
  createRole(role)
  return NextResponse.json({ ...role, accessToken: body.accessToken?.trim() || undefined }, { status: 201 })
}

function safeDecrypt(token: string): string {
  try {
    return decrypt(token)
  } catch {
    return token
  }
}
