import { NextResponse } from 'next/server'
import { setSystemSetting } from '@/lib/db'
import { locales, Locale } from '@/i18n/config'

export async function PUT(req: Request) {
  const { locale } = await req.json()
  if (!locales.includes(locale as Locale)) {
    return NextResponse.json({ error: 'Invalid locale' }, { status: 400 })
  }
  setSystemSetting('locale', locale)
  return NextResponse.json({ ok: true })
}
