import { NextResponse } from 'next/server'
import { getCurrentUser } from '@/lib/auth'
import { getMailBroadcastLog, deleteMailBroadcastLog } from '@/lib/db'
import { logActivity } from '@/lib/activity'

export async function GET(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  const user = await getCurrentUser()
  if (!user?.isAdmin) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const { id } = await ctx.params
  const log = getMailBroadcastLog(id)
  if (!log) return NextResponse.json({ error: 'Not Found' }, { status: 404 })
  return NextResponse.json({ log })
}

export async function DELETE(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const user = await getCurrentUser()
  if (!user?.isAdmin) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const { id } = await ctx.params
  const existing = getMailBroadcastLog(id)
  deleteMailBroadcastLog(id)
  logActivity({
    userId: user.id,
    category: 'admin',
    action: 'delete_mail_log',
    detail: `메일 발송이력 삭제: "${existing?.subject || id}"`,
    targetType: 'mail_broadcast',
    targetId: id,
    req,
  })
  return NextResponse.json({ ok: true })
}
