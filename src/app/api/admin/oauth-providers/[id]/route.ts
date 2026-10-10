import { NextResponse } from 'next/server'
import { getCurrentUser } from '@/lib/auth'
import {
  getOAuthProviderById, updateOAuthProvider, deleteOAuthProvider,
} from '@/lib/db'
import { encrypt } from '@/lib/crypto'
import { logActivity } from '@/lib/activity'

export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const user = await getCurrentUser()
  if (!user?.isAdmin) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const { id } = await params
  const provider = getOAuthProviderById(id)
  if (!provider) return NextResponse.json({ error: 'Not found' }, { status: 404 })
  return NextResponse.json(provider)
}

export async function PATCH(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const user = await getCurrentUser()
  if (!user?.isAdmin) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const { id } = await params
  const existing = getOAuthProviderById(id)
  if (!existing) return NextResponse.json({ error: 'Not found' }, { status: 404 })

  const body = await req.json()
  const patch: Parameters<typeof updateOAuthProvider>[1] = {}

  if (typeof body.name === 'string') patch.name = body.name
  if (typeof body.baseUrl === 'string') {
    try { new URL(body.baseUrl) } catch {
      return NextResponse.json({ error: '주소(URL) 형식이 올바르지 않습니다. https:// 로 시작하는 주소를 넣어 주세요.' }, { status: 400 })
    }
    patch.baseUrl = body.baseUrl.replace(/\/+$/, '')
  }
  if (typeof body.clientId === 'string') patch.clientId = body.clientId
  if (typeof body.clientSecret === 'string' && body.clientSecret.length > 0) {
    patch.clientSecretEncrypted = encrypt(body.clientSecret)
  }
  // signingSecret: slack 전용. 빈 문자열이 오면 변경 없음(기존 유지).
  if (typeof body.signingSecret === 'string' && body.signingSecret.length > 0) {
    patch.signingSecretEncrypted = encrypt(body.signingSecret)
  }
  if (typeof body.enabled === 'boolean') patch.enabled = body.enabled

  updateOAuthProvider(id, patch)

  logActivity({
    userId: user.id, category: 'admin', action: 'update_oauth_provider',
    detail: `OAuth 공급자 수정: ${id}`,
    targetType: 'oauth_provider', targetId: id, req,
  })

  return NextResponse.json(getOAuthProviderById(id))
}

export async function DELETE(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const user = await getCurrentUser()
  if (!user?.isAdmin) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const { id } = await params
  const existing = getOAuthProviderById(id)
  if (!existing) return NextResponse.json({ error: 'Not found' }, { status: 404 })

  deleteOAuthProvider(id)

  logActivity({
    userId: user.id, category: 'admin', action: 'delete_oauth_provider',
    detail: `OAuth 공급자 삭제: ${id} (${existing.name})`,
    targetType: 'oauth_provider', targetId: id, req,
  })

  return NextResponse.json({ success: true })
}
