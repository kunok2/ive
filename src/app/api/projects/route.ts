import { NextResponse } from 'next/server'
import { getProjectsByUser, createProject, getSlotsByProject } from '@/lib/db'
import { getCurrentUser } from '@/lib/auth'
import { decrypt } from '@/lib/crypto'

export async function GET() {
  const user = await getCurrentUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const projects = getProjectsByUser(user.id)
  const data = projects.map(p => ({
    ...p,
    slots: getSlotsByProject(p.id).map(s => ({
      ...s,
      accessToken: safeDecrypt(s.accessToken),
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
  const project = { ...body, userId: user.id }
  createProject(project)
  return NextResponse.json(project, { status: 201 })
}
