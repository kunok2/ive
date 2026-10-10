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
  const { type, name, clientId, clientSecret, signingSecret, enabled } = body

  // slack은 단일 인스턴스라 id/baseUrl을 고정한다 (github/gitlab은 사용자가 지정).
  const isSlack = type === 'slack'
  const effId = isSlack ? 'slack' : body.id
  const effBaseUrl = isSlack ? 'https://slack.com' : body.baseUrl

  // 검증
  if (!effId || typeof effId !== 'string' || !/^[a-z0-9][a-z0-9-]*$/i.test(effId)) {
    return NextResponse.json({ error: 'ID는 영숫자와 하이픈만 허용 (예: gh-main, gitlab-com)' }, { status: 400 })
  }
  if (type !== 'github' && type !== 'gitlab' && type !== 'slack') {
    return NextResponse.json({ error: '공급자 종류가 올바르지 않습니다. GitHub, GitLab, Slack 중에서 골라 주세요.' }, { status: 400 })
  }
  if (!name || !effBaseUrl || !clientId || !clientSecret) {
    return NextResponse.json({ error: '이름, 주소(URL), Client ID, Client Secret을 모두 입력해 주세요.' }, { status: 400 })
  }
  try {
    new URL(effBaseUrl)
  } catch {
    return NextResponse.json({ error: '주소(URL) 형식이 올바르지 않습니다. https:// 로 시작하는 주소를 넣어 주세요.' }, { status: 400 })
  }
  if (getOAuthProviderById(effId)) {
    return NextResponse.json({ error: `이미 존재하는 ID: ${effId}` }, { status: 409 })
  }

  // 타입당 최대 1개 제약
  const existingOfType = getAllOAuthProviders().filter(p => p.type === type)
  if (existingOfType.length >= MAX_PROVIDERS_PER_TYPE) {
    const label = type === 'github' ? 'GitHub' : type === 'slack' ? 'Slack' : 'GitLab'
    return NextResponse.json({
      error: `${label} 공급자는 이미 등록돼 있습니다. IVE는 타입당 1개만 지원합니다. 기존 공급자를 수정하거나 삭제 후 다시 등록하세요.`
    }, { status: 409 })
  }

  createOAuthProvider({
    id: effId,
    type,
    name,
    baseUrl: effBaseUrl.replace(/\/+$/, ''),
    clientId,
    clientSecretEncrypted: encrypt(clientSecret),
    signingSecretEncrypted: isSlack && typeof signingSecret === 'string' && signingSecret.length > 0 ? encrypt(signingSecret) : null,
    enabled: enabled !== false,
  })

  logActivity({
    userId: user.id, category: 'admin', action: 'create_oauth_provider',
    detail: `OAuth 공급자 등록: ${type}/${effId} (${name})`,
    targetType: 'oauth_provider', targetId: effId, req,
  })

  return NextResponse.json(getOAuthProviderById(effId))
}
