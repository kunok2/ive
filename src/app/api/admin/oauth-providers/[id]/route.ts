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
      return NextResponse.json({ error: 'baseUrl 형식 오류' }, { status: 400 })
    }
    patch.baseUrl = body.baseUrl.replace(/\/+$/, '')
  }
  if (typeof body.clientId === 'string') patch.clientId = body.clientId
  if (typeof body.clientSecret === 'string' && body.clientSecret.length > 0) {
    patch.clientSecretEncrypted = encrypt(body.clientSecret)
  }
  if (body.redirectBase !== undefined) {
    const rb = typeof body.redirectBase === 'string' ? body.redirectBase.trim() : ''
    if (rb === '') {
      patch.redirectBase = null // 비우면 자동 감지로 폴백
    } else {
      try {
        const u = new URL(rb)
        if (u.protocol !== 'http:' && u.protocol !== 'https:') throw new Error('scheme')
        patch.redirectBase = rb.replace(/\/+$/, '')
      } catch {
        return NextResponse.json({ error: 'redirectBase는 http(s):// 로 시작하는 URL이어야 합니다' }, { status: 400 })
      }
    }
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
