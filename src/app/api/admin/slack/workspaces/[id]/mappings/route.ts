import { NextResponse } from 'next/server'
import { getCurrentUser } from '@/lib/auth'
import {
  getSlackWorkspace, getSlackUserMapsByWorkspace, upsertSlackUserMap, deleteSlackUserMap,
} from '@/lib/db'

/** 관리자: 워크스페이스의 Slack 유저 ↔ IVE 유저 개인 매핑 목록 */
export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const user = await getCurrentUser()
  if (!user?.isAdmin) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  const { id } = await params
  if (!getSlackWorkspace(id)) return NextResponse.json({ error: 'Not found' }, { status: 404 })
  return NextResponse.json(getSlackUserMapsByWorkspace(id))
}

/** 관리자: 개인 매핑 추가/수정 */
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const user = await getCurrentUser()
  if (!user?.isAdmin) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  const { id } = await params
  if (!getSlackWorkspace(id)) return NextResponse.json({ error: 'Not found' }, { status: 404 })

  const { slackUserId, iveUserId } = await req.json()
  if (!slackUserId || !iveUserId) {
    return NextResponse.json({ error: 'slackUserId와 iveUserId가 필요합니다' }, { status: 400 })
  }
  upsertSlackUserMap({ workspaceId: id, slackUserId: String(slackUserId).trim(), iveUserId })
  return NextResponse.json({ success: true })
}

/** 관리자: 개인 매핑 삭제 (?slackUserId=) */
export async function DELETE(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const user = await getCurrentUser()
  if (!user?.isAdmin) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  const { id } = await params
  const slackUserId = new URL(req.url).searchParams.get('slackUserId')
  if (!slackUserId) return NextResponse.json({ error: 'slackUserId 필요' }, { status: 400 })
  deleteSlackUserMap(id, slackUserId)
  return NextResponse.json({ success: true })
}
