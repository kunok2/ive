import { NextResponse } from 'next/server'
import { getCurrentUser } from '@/lib/auth'
import {
  getAllOAuthProviders, createOAuthProvider, getOAuthProviderById,
} from '@/lib/db'
import { encrypt } from '@/lib/crypto'
import { logActivity } from '@/lib/activity'

// IVE 한 대 = GitLab 1개 + GitHub 1개까지. 다중 인스턴스 동시 운영은 지원하지 않음.
const MAX_PROVIDERS_PER_TYPE = 1

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
  const { id, type, name, baseUrl, clientId, clientSecret, redirectBase, enabled } = body

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
  let normalizedRedirectBase: string | null = null
  if (redirectBase && typeof redirectBase === 'string' && redirectBase.trim()) {
    try {
      const u = new URL(redirectBase.trim())
      if (u.protocol !== 'http:' && u.protocol !== 'https:') throw new Error('scheme')
      normalizedRedirectBase = redirectBase.trim().replace(/\/+$/, '')
    } catch {
      return NextResponse.json({ error: 'redirectBase는 http(s):// 로 시작하는 URL이어야 합니다' }, { status: 400 })
    }
  }
  if (getOAuthProviderById(id)) {
    return NextResponse.json({ error: `이미 존재하는 ID: ${id}` }, { status: 409 })
  }

  // 타입당 최대 1개 제약
  const existingOfType = getAllOAuthProviders().filter(p => p.type === type)
  if (existingOfType.length >= MAX_PROVIDERS_PER_TYPE) {
    return NextResponse.json({
      error: `${type === 'github' ? 'GitHub' : 'GitLab'} 공급자는 이미 등록돼 있습니다. IVE는 타입당 1개만 지원합니다. 기존 공급자를 수정하거나 삭제 후 다시 등록하세요.`
    }, { status: 409 })
  }

  createOAuthProvider({
    id,
    type,
    name,
    baseUrl: baseUrl.replace(/\/+$/, ''),
    clientId,
    clientSecretEncrypted: encrypt(clientSecret),
    redirectBase: normalizedRedirectBase,
    enabled: enabled !== false,
  })

  logActivity({
    userId: user.id, category: 'admin', action: 'create_oauth_provider',
    detail: `OAuth 공급자 등록: ${type}/${id} (${name})`,
    targetType: 'oauth_provider', targetId: id, req,
  })

  return NextResponse.json(getOAuthProviderById(id))
}
