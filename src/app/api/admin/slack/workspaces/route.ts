import { NextResponse } from 'next/server'
import crypto from 'crypto'
import { getCurrentUser } from '@/lib/auth'
import {
  getAllSlackWorkspaces, getSlackWorkspaceByTeamId, createSlackWorkspace,
} from '@/lib/db'
import { encrypt } from '@/lib/crypto'
import { slackAuthTest } from '@/lib/slack'
import { logActivity } from '@/lib/activity'

/** 관리자: Slack 워크스페이스 목록 (토큰 제외) */
export async function GET() {
  const user = await getCurrentUser()
  if (!user?.isAdmin) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  return NextResponse.json(getAllSlackWorkspaces())
}

/** 관리자: Slack 워크스페이스 신규 등록. 봇 토큰으로 team_id/bot_user_id 자동 발견. */
export async function POST(req: Request) {
  const user = await getCurrentUser()
  if (!user?.isAdmin) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const body = await req.json()
  const { name, botToken, signingSecret, defaultUserId, enabled } = body

  if (!botToken || !signingSecret) {
    return NextResponse.json({ error: 'Bot Token과 Signing Secret이 필요합니다' }, { status: 400 })
  }

  // 봇 토큰 검증 + team_id/bot_user_id 발견
  const auth = await slackAuthTest(botToken)
  if (!auth.ok || !auth.teamId || !auth.botUserId) {
    return NextResponse.json({ error: `Slack 토큰 검증 실패: ${auth.error || 'auth_test_failed'}` }, { status: 400 })
  }

  if (getSlackWorkspaceByTeamId(auth.teamId)) {
    return NextResponse.json({ error: `이미 등록된 워크스페이스입니다 (${auth.teamName || auth.teamId})` }, { status: 409 })
  }

  const id = `sw-${crypto.randomUUID().slice(0, 8)}`
  createSlackWorkspace({
    id,
    teamId: auth.teamId,
    teamName: auth.teamName || '',
    name: name?.trim() || auth.teamName || auth.teamId,
    botTokenEncrypted: encrypt(botToken),
    signingSecretEncrypted: encrypt(signingSecret),
    botUserId: auth.botUserId,
    defaultUserId: defaultUserId || null,
    enabled: enabled !== false,
  })

  logActivity({
    userId: user.id, category: 'admin', action: 'create_slack_workspace',
    detail: `Slack 워크스페이스 등록: ${auth.teamName || auth.teamId}`,
    targetType: 'slack_workspace', targetId: id, req,
  })

  return NextResponse.json({ success: true, id, teamId: auth.teamId, teamName: auth.teamName })
}
