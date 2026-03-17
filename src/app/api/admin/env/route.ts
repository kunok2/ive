import { NextResponse } from 'next/server'
import { getCurrentUser } from '@/lib/auth'
import { getSystemSettings, setSystemSettings } from '@/lib/db'

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
  return NextResponse.json({ success: true })
}
