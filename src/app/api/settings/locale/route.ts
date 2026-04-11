import { NextResponse } from 'next/server'
import { setSystemSetting, updateUserLocale, updateUserTimezone } from '@/lib/db'
import { locales, Locale } from '@/i18n/config'
import { getCurrentUser } from '@/lib/auth'

// Intl.supportedValuesOf가 지원되지 않는 환경을 위한 최소 화이트리스트
const VALID_TIMEZONES = new Set([
  'Asia/Seoul', 'Asia/Tokyo', 'Asia/Shanghai', 'Asia/Singapore', 'Asia/Kolkata', 'Asia/Dubai',
  'Europe/London', 'Europe/Paris', 'Europe/Berlin',
  'America/New_York', 'America/Chicago', 'America/Denver', 'America/Los_Angeles',
  'Pacific/Auckland', 'Australia/Sydney', 'UTC',
])

function isValidTimezone(tz: string): boolean {
  if (VALID_TIMEZONES.has(tz)) return true
  // Intl API로 추가 검증 (임의 문자열 차단)
  try { Intl.DateTimeFormat(undefined, { timeZone: tz }); return true } catch { return false }
}

export async function PUT(req: Request) {
  const body = await req.json()
  const { locale, timezone } = body

  const user = await getCurrentUser()

  // locale 업데이트
  if (locale !== undefined) {
    if (!locales.includes(locale as Locale)) {
      return NextResponse.json({ error: 'Invalid locale' }, { status: 400 })
    }
    // 서버 전역 설정 업데이트 (초기 설정 및 비로그인 상태 대비용 호환성)
    setSystemSetting('locale', locale)

    // 현재 로그인된 사용자가 있다면, 해당 사용자만의 언어 설정을 DB에 저장
    if (user) {
      updateUserLocale(user.id, locale)
    }
  }

  // timezone 업데이트 (유효성 검증 포함)
  if (timezone !== undefined && user) {
    if (typeof timezone !== 'string' || !isValidTimezone(timezone)) {
      return NextResponse.json({ error: 'Invalid timezone' }, { status: 400 })
    }
    updateUserTimezone(user.id, timezone)
  }

  return NextResponse.json({ ok: true })
}
