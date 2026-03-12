import { NextResponse } from 'next/server'
import { getSlotsByProject, createSlot, getProject } from '@/lib/db'
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

  const slots = getSlotsByProject(id)
  const decrypted = slots.map(s => ({
    ...s,
    accessToken: safeDecrypt(s.accessToken),
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
    return NextResponse.json({ error: '슬롯 이름을 입력해주세요' }, { status: 400 })
  }
  if (!body.accessToken?.trim()) {
    return NextResponse.json({ error: '액세스 토큰을 입력해주세요' }, { status: 400 })
  }

  const slot = {
    ...body,
    projectId: id,
    accessToken: encrypt(body.accessToken.trim()),
  }
  createSlot(slot)
  return NextResponse.json({ ...slot, accessToken: body.accessToken.trim() }, { status: 201 })
}

function safeDecrypt(token: string): string {
  try {
    return decrypt(token)
  } catch {
    return token
  }
}
