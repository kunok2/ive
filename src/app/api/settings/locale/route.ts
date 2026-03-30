import { NextResponse } from 'next/server'
import { setSystemSetting, updateUserLocale } from '@/lib/db'
import { locales, Locale } from '@/i18n/config'
import { getCurrentUser } from '@/lib/auth'

export async function PUT(req: Request) {
  const { locale } = await req.json()
  if (!locales.includes(locale as Locale)) {
    return NextResponse.json({ error: 'Invalid locale' }, { status: 400 })
  }
  // 서버 전역 설정 업데이트 (초기 설정 및 비로그인 상태 대비용 호환성)
  setSystemSetting('locale', locale)

  // 현재 로그인된 사용자가 있다면, 해당 사용자만의 언어 설정을 DB에 저장
  const user = await getCurrentUser()
  if (user) {
    updateUserLocale(user.id, locale)
  }

  return NextResponse.json({ ok: true })
}
