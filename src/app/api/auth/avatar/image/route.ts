import { NextRequest, NextResponse } from 'next/server'
import fs from 'fs'
import path from 'path'

// GET /api/auth/avatar/image?id=userId
export async function GET(req: NextRequest) {
  const userId = req.nextUrl.searchParams.get('id')
  if (!userId) return new NextResponse('Not found', { status: 404 })

  // Path Traversal 방지: userId에 허용되지 않는 문자가 있으면 거부
  if (!/^[a-zA-Z0-9_-]+$/.test(userId)) {
    return new NextResponse('Invalid id', { status: 400 })
  }

  const avatarDir = path.join(process.cwd(), 'data', 'avatars')
  const exts = ['jpg', 'jpeg', 'png', 'webp', 'gif']
  for (const ext of exts) {
    const filePath = path.join(avatarDir, `${userId}.${ext}`)
    // 최종 경로가 avatarDir 내에 있는지 검증
    if (!filePath.startsWith(avatarDir)) {
      return new NextResponse('Invalid id', { status: 400 })
    }
    if (fs.existsSync(filePath)) {
      const buf = fs.readFileSync(filePath)
      const mime = ext === 'jpg' || ext === 'jpeg' ? 'image/jpeg'
        : ext === 'png' ? 'image/png'
        : ext === 'webp' ? 'image/webp'
        : 'image/gif'
      return new NextResponse(buf, {
        headers: {
          'Content-Type': mime,
          'Cache-Control': 'public, max-age=3600',
        },
      })
    }
  }
  return new NextResponse('Not found', { status: 404 })
}
