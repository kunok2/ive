import { NextResponse } from 'next/server'
import { getEnabledOAuthProviders } from '@/lib/db'
import { toPublicProvider } from '@/lib/oauth'

/**
 * 로그인 페이지에서 사용할 활성 OAuth provider 목록 (공개, 인증 불요).
 * github/gitlab/slack 모두 oauth_providers 테이블의 enabled 행에서 나온다.
 */
export async function GET() {
  const providers = getEnabledOAuthProviders().map(toPublicProvider)
  return NextResponse.json(providers)
}
