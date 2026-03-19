import { NextRequest, NextResponse } from 'next/server'
import { getCurrentUser } from '@/lib/auth'
import { updateUserAvatar } from '@/lib/db'
import fs from 'fs'
import path from 'path'

export async function POST(req: NextRequest) {
  const user = await getCurrentUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const formData = await req.formData()
  const file = formData.get('file') as File | null
  if (!file) return NextResponse.json({ error: '파일을 선택해주세요.' }, { status: 400 })

  // 5MB 제한
  if (file.size > 5 * 1024 * 1024) {
    return NextResponse.json({ error: '파일 크기는 5MB 이하여야 합니다.' }, { status: 400 })
  }

  const allowedTypes = ['image/jpeg', 'image/png', 'image/webp', 'image/gif']
  if (!allowedTypes.includes(file.type)) {
    return NextResponse.json({ error: 'JPG, PNG, WebP, GIF 파일만 가능합니다.' }, { status: 400 })
  }

  const ext = file.type === 'image/jpeg' ? 'jpg'
    : file.type === 'image/png' ? 'png'
    : file.type === 'image/webp' ? 'webp'
    : 'gif'

  const avatarDir = path.join(process.cwd(), 'data', 'avatars')
  if (!fs.existsSync(avatarDir)) fs.mkdirSync(avatarDir, { recursive: true })

  // 기존 아바타 파일 삭제
  for (const e of ['jpg', 'jpeg', 'png', 'webp', 'gif']) {
    const old = path.join(avatarDir, `${user.id}.${e}`)
    if (fs.existsSync(old)) fs.unlinkSync(old)
  }

  const buf = Buffer.from(await file.arrayBuffer())
  const filePath = path.join(avatarDir, `${user.id}.${ext}`)
  fs.writeFileSync(filePath, buf)

  // avatar 필드를 'photo' 로 변경
  updateUserAvatar(user.id, 'photo')

  return NextResponse.json({ ok: true, avatar: 'photo' })
}
