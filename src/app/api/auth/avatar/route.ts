import { NextRequest, NextResponse } from 'next/server'
import { getCurrentUser } from '@/lib/auth'
import { updateUserAvatar } from '@/lib/db'
import { logActivity } from '@/lib/activity'

export async function PUT(req: NextRequest) {
  const user = await getCurrentUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { avatar } = await req.json()
  if (!avatar || typeof avatar !== 'string') {
    return NextResponse.json({ error: '아바타를 선택해주세요.' }, { status: 400 })
  }

  try {
    updateUserAvatar(user.id, avatar, 'upload') // 사용자가 직접 선택 → 보호(OAuth가 안 덮어씀)
  } catch (e) {
    console.error('아바타 업데이트 오류:', e)
    return NextResponse.json({ error: '아바타 저장에 실패했습니다.' }, { status: 500 })
  }
  logActivity({ userId: user.id, category: 'settings', action: 'change_avatar', detail: `아바타 변경: ${avatar}`, req })
  return NextResponse.json({ ok: true })
}
