import { NextResponse } from 'next/server'
import { getProjectsByUser, createProject, getRolesByProject, getRoleAssignments } from '@/lib/db'
import { getCurrentUser } from '@/lib/auth'
import { decrypt, encrypt } from '@/lib/crypto'

export async function GET() {
  const user = await getCurrentUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const projects = getProjectsByUser(user.id)
  const data = projects.map(p => ({
    ...p,
    accessToken: safeDecrypt(p.accessToken),
    roles: getRolesByProject(p.id).map(r => ({
      ...r,
      accessToken: safeDecrypt(r.accessToken || ''),
      assignedAgents: getRoleAssignments(r.id),
    })),
  }))
  return NextResponse.json(data)
}

function safeDecrypt(token: string): string {
  try {
    return decrypt(token)
  } catch {
    return token
  }
}

export async function POST(req: Request) {
  const user = await getCurrentUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const body = await req.json()
  const project = {
    ...body,
    userId: user.id,
    accessToken: encrypt(body.accessToken || '')
  }
  createProject(project)
  return NextResponse.json(project, { status: 201 })
}
