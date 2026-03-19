import { NextRequest, NextResponse } from 'next/server'
import { getCurrentUser } from '@/lib/auth'
import { updateUserAvatar } from '@/lib/db'

export async function PUT(req: NextRequest) {
  const user = await getCurrentUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { avatar } = await req.json()
  if (!avatar || typeof avatar !== 'string') {
    return NextResponse.json({ error: '아바타를 선택해주세요.' }, { status: 400 })
  }

  updateUserAvatar(user.id, avatar)
  return NextResponse.json({ ok: true })
}
