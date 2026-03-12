import { NextResponse } from 'next/server'
import { getUserByEmail, createUser } from '@/lib/db'
import { hashPassword, setAuthCookie } from '@/lib/auth'

export async function POST(req: Request) {
  const { email, name, password } = await req.json()

  if (!email || !name || !password) {
    return NextResponse.json({ error: '모든 필드를 입력해주세요' }, { status: 400 })
  }

  if (password.length < 6) {
    return NextResponse.json({ error: '비밀번호는 6자 이상이어야 합니다' }, { status: 400 })
  }

  const existing = getUserByEmail(email)
  if (existing) {
    return NextResponse.json({ error: '이미 사용 중인 이메일입니다' }, { status: 409 })
  }

  const id = `user-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
  const passwordHash = await hashPassword(password)

  createUser(id, email, name, passwordHash)
  await setAuthCookie(id)

  return NextResponse.json({ id, email, name }, { status: 201 })
}
