import { NextResponse } from 'next/server'
import { getCurrentUser } from '@/lib/auth'
import { getSystemSettings, setSystemSettings } from '@/lib/db'
import { logActivity } from '@/lib/activity'

// 마스킹할 비밀번호 키 목록
const PASSWORD_KEYS = ['mail.smtp_password']
const PASSWORD_MASK = '__password_set__'

export async function GET() {
  const user = await getCurrentUser()
  if (!user?.isAdmin) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const settings = getSystemSettings()
  // 비밀번호 값은 마스킹하여 반환 (보안)
  for (const key of PASSWORD_KEYS) {
    if (settings[key]) {
      settings[key] = PASSWORD_MASK
    }
  }
  return NextResponse.json({ settings })
}

export async function POST(req: Request) {
  const user = await getCurrentUser()
  if (!user?.isAdmin) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const { settings } = await req.json()
  if (!settings || typeof settings !== 'object') {
    return NextResponse.json({ error: '설정 데이터가 필요합니다' }, { status: 400 })
  }

  // 비밀번호 필드가 마스크값이거나 비어있으면 DB 값을 유지 (덮어쓰지 않음)
  const filteredSettings = { ...settings }
  for (const key of PASSWORD_KEYS) {
    if (!filteredSettings[key] || filteredSettings[key] === PASSWORD_MASK) {
      delete filteredSettings[key]
    }
  }

  setSystemSettings(filteredSettings)
  logActivity({ userId: user.id, category: 'admin', action: 'update_settings', detail: `시스템 설정 변경 (${Object.keys(filteredSettings).length}개 항목)`, req })
  return NextResponse.json({ success: true })
}
