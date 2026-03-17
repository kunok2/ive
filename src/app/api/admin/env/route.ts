import { NextResponse } from 'next/server'
import { getCurrentUser } from '@/lib/auth'
import fs from 'fs'
import path from 'path'

const envPath = path.join(process.cwd(), '.env')

export async function GET() {
  const user = await getCurrentUser()
  if (!user?.isAdmin) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  try {
    const content = fs.existsSync(envPath) ? fs.readFileSync(envPath, 'utf-8') : ''
    return NextResponse.json({ content })
  } catch {
    return NextResponse.json({ content: '' })
  }
}

export async function POST(req: Request) {
  const user = await getCurrentUser()
  if (!user?.isAdmin) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const { content } = await req.json()
  if (typeof content !== 'string') {
    return NextResponse.json({ error: '내용이 필요합니다' }, { status: 400 })
  }

  try {
    fs.writeFileSync(envPath, content, 'utf-8')
    return NextResponse.json({ success: true, message: '저장 완료. 서버 재시작 후 적용됩니다.' })
  } catch (err) {
    return NextResponse.json({ error: '파일 저장 실패' }, { status: 500 })
  }
}
