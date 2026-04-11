import { NextResponse } from 'next/server'
import { getCurrentUser } from '@/lib/auth'
import {
  getAllOAuthProviders, createOAuthProvider, getOAuthProviderById,
} from '@/lib/db'
import { encrypt } from '@/lib/crypto'
import { logActivity } from '@/lib/activity'

/** 관리자: OAuth 공급자 전체 목록 (client_secret 제외) */
export async function GET() {
  const user = await getCurrentUser()
  if (!user?.isAdmin) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  return NextResponse.json(getAllOAuthProviders())
}

/** 관리자: OAuth 공급자 신규 등록 */
export async function POST(req: Request) {
  const user = await getCurrentUser()
  if (!user?.isAdmin) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const body = await req.json()
  const { id, type, name, baseUrl, clientId, clientSecret, enabled } = body

  // 검증
  if (!id || typeof id !== 'string' || !/^[a-z0-9][a-z0-9-]*$/i.test(id)) {
    return NextResponse.json({ error: 'ID는 영숫자와 하이픈만 허용 (예: gh-main, gitlab-com)' }, { status: 400 })
  }
  if (type !== 'github' && type !== 'gitlab') {
    return NextResponse.json({ error: 'type은 github 또는 gitlab이어야 합니다' }, { status: 400 })
  }
  if (!name || !baseUrl || !clientId || !clientSecret) {
    return NextResponse.json({ error: '필수 필드 누락 (name, baseUrl, clientId, clientSecret)' }, { status: 400 })
  }
  try {
    new URL(baseUrl)
  } catch {
    return NextResponse.json({ error: 'baseUrl이 유효한 URL이 아닙니다' }, { status: 400 })
  }
  if (getOAuthProviderById(id)) {
    return NextResponse.json({ error: `이미 존재하는 ID: ${id}` }, { status: 409 })
  }

  createOAuthProvider({
    id,
    type,
    name,
    baseUrl: baseUrl.replace(/\/+$/, ''),
    clientId,
    clientSecretEncrypted: encrypt(clientSecret),
    enabled: enabled !== false,
  })

  logActivity({
    userId: user.id, category: 'admin', action: 'create_oauth_provider',
    detail: `OAuth 공급자 등록: ${type}/${id} (${name})`,
    targetType: 'oauth_provider', targetId: id, req,
  })

  return NextResponse.json(getOAuthProviderById(id))
}
