import { NextResponse } from 'next/server'
import { getUserByEmail, createUser } from '@/lib/db'
import { hashPassword, setAuthCookie } from '@/lib/auth'
import { getVerificationCode, clearVerificationCode } from '../send-code/route'
import { logActivity } from '@/lib/activity'
import { attributeConversionFromCookie } from '@/lib/social-tracking'

export async function POST(req: Request) {
  const { email, name, password, code } = await req.json()

  if (!email || !name || !password || !code) {
    return NextResponse.json({ error: '모든 필드를 입력해주세요' }, { status: 400 })
  }

  if (password.length < 6) {
    return NextResponse.json({ error: '비밀번호는 6자 이상이어야 합니다' }, { status: 400 })
  }

  // 인증 코드 확인
  const savedCode = getVerificationCode(email)
  if (!savedCode || savedCode !== code) {
    return NextResponse.json({ error: '인증 코드가 올바르지 않거나 만료되었습니다' }, { status: 400 })
  }

  const existing = getUserByEmail(email)
  if (existing) {
    return NextResponse.json({ error: '이미 사용 중인 이메일입니다' }, { status: 409 })
  }

  const id = `user-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
  const passwordHash = await hashPassword(password)

  createUser({ id, email, name, password: passwordHash })
  clearVerificationCode(email)
  await setAuthCookie(id)
  await attributeConversionFromCookie(id, 'register')
  logActivity({ userId: id, category: 'auth', action: 'register', detail: `회원가입 (${email})`, req })

  return NextResponse.json({ id, email, name }, { status: 201 })
}
