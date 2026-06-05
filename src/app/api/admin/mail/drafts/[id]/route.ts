import { NextResponse } from 'next/server'
import { getCurrentUser } from '@/lib/auth'
import { getMailDraft, updateMailDraft, deleteMailDraft } from '@/lib/db'

export async function GET(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  const user = await getCurrentUser()
  if (!user?.isAdmin) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  const { id } = await ctx.params
  const draft = getMailDraft(id)
  if (!draft) return NextResponse.json({ error: 'Not Found' }, { status: 404 })
  return NextResponse.json({ draft })
}

export async function PUT(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const user = await getCurrentUser()
  if (!user?.isAdmin) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  const { id } = await ctx.params
  const { subject, body, targetUserIds } = await req.json()
  const ok = updateMailDraft(id, {
    subject: String(subject || ''),
    body: String(body || ''),
    targetUserIds: Array.isArray(targetUserIds) ? targetUserIds.filter(Boolean) : [],
  })
  if (!ok) return NextResponse.json({ error: 'Not Found' }, { status: 404 })
  return NextResponse.json({ ok: true })
}

export async function DELETE(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  const user = await getCurrentUser()
  if (!user?.isAdmin) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  const { id } = await ctx.params
  deleteMailDraft(id)
  return NextResponse.json({ ok: true })
}
