import { NextResponse } from 'next/server'
import { getCurrentUser } from '@/lib/auth'
import { getSlackWorkspace, deleteSlackWorkspace } from '@/lib/db'
import { logActivity } from '@/lib/activity'

export const runtime = 'nodejs'

/** 본인이 소유한 워크스페이스만 제거 가능 (셀프서비스) */
export async function DELETE(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const user = await getCurrentUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { id } = await params
  const ws = getSlackWorkspace(id)
  if (!ws) return NextResponse.json({ error: 'Not found' }, { status: 404 })
  if (ws.defaultUserId !== user.id) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  deleteSlackWorkspace(id)
  try {
    logActivity({
      userId: user.id, category: 'auth', action: 'remove_slack_workspace',
      detail: `Slack 워크스페이스 제거: ${ws.name || ws.teamId}`,
      targetType: 'slack_workspace', targetId: ws.teamId, req,
    })
  } catch { /* ignore */ }

  return NextResponse.json({ success: true })
}
