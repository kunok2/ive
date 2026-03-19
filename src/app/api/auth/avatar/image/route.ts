import { NextRequest, NextResponse } from 'next/server'
import fs from 'fs'
import path from 'path'

// GET /api/auth/avatar/image?id=userId
export async function GET(req: NextRequest) {
  const userId = req.nextUrl.searchParams.get('id')
  if (!userId) return new NextResponse('Not found', { status: 404 })

  const avatarDir = path.join(process.cwd(), 'data', 'avatars')
  const exts = ['jpg', 'jpeg', 'png', 'webp', 'gif']
  for (const ext of exts) {
    const filePath = path.join(avatarDir, `${userId}.${ext}`)
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
