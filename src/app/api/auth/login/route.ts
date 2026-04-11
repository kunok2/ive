import { NextResponse } from 'next/server'
import { getUserByEmail } from '@/lib/db'
import { verifyPassword, setAuthCookie } from '@/lib/auth'
import { logActivity } from '@/lib/activity'

export async function POST(req: Request) {
  const { email, password } = await req.json()

  if (!email || !password) {
    return NextResponse.json({ error: '이메일과 비밀번호를 입력해주세요' }, { status: 400 })
  }

  const user = getUserByEmail(email)
  if (!user) {
    return NextResponse.json({ error: '이메일 또는 비밀번호가 올바르지 않습니다' }, { status: 401 })
  }

  // OAuth 전용 계정(password NULL)은 로컬 로그인 불가
  if (!user.password) {
    return NextResponse.json({ error: 'OAuth로 가입된 계정입니다. OAuth 로그인을 사용해주세요' }, { status: 401 })
  }

  const valid = await verifyPassword(password, user.password)
  if (!valid) {
    return NextResponse.json({ error: '이메일 또는 비밀번호가 올바르지 않습니다' }, { status: 401 })
  }

  await setAuthCookie(user.id)
  logActivity({ userId: user.id, category: 'auth', action: 'login', detail: `로그인 (${email})`, req })

  return NextResponse.json({ id: user.id, email: user.email, name: user.name })
}
