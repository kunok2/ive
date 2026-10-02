import { NextResponse } from 'next/server'
import { getCurrentUser } from '@/lib/auth'
import { getSystemSettings, setSystemSettings, getSystemSetting, recordConfigChanges } from '@/lib/db'
import { logActivity } from '@/lib/activity'
import { reloadLogger, normalizeConfig } from '@/lib/logger'

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

  // 설정 변경 로그 — 결과에 영향을 주는 칸(CLI 기본 모델·단계 동시 실행 수 등)만. 비밀값 칸은 남기지 않는다
  const trackedKeys = Object.keys(filteredSettings).filter(k => (k.startsWith('cli.') || k.startsWith('stage.') || k.startsWith('report.')) && !PASSWORD_KEYS.includes(k))
  const beforeTracked: Record<string, unknown> = {}
  for (const k of trackedKeys) beforeTracked[k] = getSystemSetting(k)

  setSystemSettings(filteredSettings)

  if (trackedKeys.length > 0) {
    const afterTracked: Record<string, unknown> = {}
    for (const k of trackedKeys) afterTracked[k] = getSystemSetting(k)
    recordConfigChanges('system', 'system', beforeTracked, afterTracked, trackedKeys, { actorUserId: user.id })
  }

  // If any log.* setting changed, hot-reload the logger so new policy
  // takes effect without a restart.
  const hasLogChange = Object.keys(filteredSettings).some(k => k.startsWith('log.'))
  if (hasLogChange) {
    const all = getSystemSettings('log.')
    reloadLogger(normalizeConfig({
      level: all['log.level'],
      fileEnabled: all['log.file_enabled'],
      dir: all['log.dir'],
      frequency: all['log.frequency'],
      maxSizeMb: all['log.max_size_mb'],
      maxFiles: all['log.max_files'],
    }))
  }

  logActivity({ userId: user.id, category: 'admin', action: 'update_settings', detail: `시스템 설정 변경 (${Object.keys(filteredSettings).length}개 항목)`, req })
  return NextResponse.json({ success: true })
}
