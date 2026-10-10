import { NextResponse } from 'next/server'
import { getCurrentUser } from '@/lib/auth'
import {
  getSlackWorkspace, getSlackWorkspaceByTeamId, updateSlackWorkspace, deleteSlackWorkspace,
} from '@/lib/db'
import { encrypt } from '@/lib/crypto'
import { slackAuthTest } from '@/lib/slack'
import { logActivity } from '@/lib/activity'

const MASK = '__secret_set__'

/** 관리자: Slack 워크스페이스 수정 */
export async function PUT(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const user = await getCurrentUser()
  if (!user?.isAdmin) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const { id } = await params
  const ws = getSlackWorkspace(id)
  if (!ws) return NextResponse.json({ error: '워크스페이스를 찾을 수 없습니다' }, { status: 404 })

  const body = await req.json()
  const { name, botToken, signingSecret, defaultUserId, enabled } = body

  const patch: Parameters<typeof updateSlackWorkspace>[1] = {}
  if (name !== undefined) patch.name = String(name).trim()
  if (defaultUserId !== undefined) patch.defaultUserId = defaultUserId || null
  if (enabled !== undefined) patch.enabled = !!enabled

  // 봇 토큰이 새로 들어오면 재검증 + team_id/bot_user_id 갱신
  const newBotToken = botToken && botToken !== MASK ? botToken : null
  if (newBotToken) {
    const auth = await slackAuthTest(newBotToken)
    if (!auth.ok || !auth.teamId || !auth.botUserId) {
      return NextResponse.json({ error: `Slack에서 Bot Token을 확인하지 못했습니다 (${auth.error || 'auth_test_failed'}). 토큰을 다시 복사해 넣어 주세요.` }, { status: 400 })
    }
    // 다른 워크스페이스가 같은 team_id를 이미 쓰고 있으면 충돌
    const dup = getSlackWorkspaceByTeamId(auth.teamId)
    if (dup && dup.id !== id) {
      return NextResponse.json({ error: `다른 워크스페이스가 이미 같은 Slack 워크스페이스를 사용 중입니다` }, { status: 409 })
    }
    patch.botTokenEncrypted = encrypt(newBotToken)
    patch.teamId = auth.teamId
    patch.teamName = auth.teamName || ''
    patch.botUserId = auth.botUserId
  }
  if (signingSecret && signingSecret !== MASK) {
    patch.signingSecretEncrypted = encrypt(signingSecret)
  }

  updateSlackWorkspace(id, patch)

  logActivity({
    userId: user.id, category: 'admin', action: 'update_slack_workspace',
    detail: `Slack 워크스페이스 수정: ${ws.name}`,
    targetType: 'slack_workspace', targetId: id, req,
  })

  return NextResponse.json({ success: true })
}

/** 관리자: Slack 워크스페이스 삭제 (채널/스레드/매핑 정리 포함) */
export async function DELETE(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const user = await getCurrentUser()
  if (!user?.isAdmin) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const { id } = await params
  const ws = getSlackWorkspace(id)
  if (!ws) return NextResponse.json({ error: '워크스페이스를 찾을 수 없습니다' }, { status: 404 })

  deleteSlackWorkspace(id)

  logActivity({
    userId: user.id, category: 'admin', action: 'delete_slack_workspace',
    detail: `Slack 워크스페이스 삭제: ${ws.name}`,
    targetType: 'slack_workspace', targetId: id, req,
  })

  return NextResponse.json({ success: true })
}
