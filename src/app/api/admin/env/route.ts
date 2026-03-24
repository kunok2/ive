import { NextResponse } from 'next/server'
import { getCurrentUser } from '@/lib/auth'
import { getSystemSettings, setSystemSettings } from '@/lib/db'
import { logActivity } from '@/lib/activity'

export async function GET() {
  const user = await getCurrentUser()
  if (!user?.isAdmin) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const settings = getSystemSettings()
  return NextResponse.json({ settings })
}

export async function POST(req: Request) {
  const user = await getCurrentUser()
  if (!user?.isAdmin) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const { settings } = await req.json()
  if (!settings || typeof settings !== 'object') {
    return NextResponse.json({ error: '설정 데이터가 필요합니다' }, { status: 400 })
  }

  setSystemSettings(settings)
  logActivity({ userId: user.id, category: 'admin', action: 'update_settings', detail: `시스템 설정 변경 (${Object.keys(settings).length}개 항목)`, req })
  return NextResponse.json({ success: true })
}
