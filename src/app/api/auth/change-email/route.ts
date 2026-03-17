import { NextResponse } from 'next/server'
import { getCurrentUser, verifyPassword, setAuthCookie } from '@/lib/auth'
import { getUserByEmail, getDb } from '@/lib/db'
import { getVerificationCode, clearVerificationCode } from '@/app/api/auth/send-code/route'

export async function POST(req: Request) {
  const { newEmail, currentPassword, code } = await req.json()

  if (!newEmail || !currentPassword || !code) {
    return NextResponse.json({ error: '모든 항목을 입력해주세요' }, { status: 400 })
  }

  const loggedInUser = await getCurrentUser()
  if (!loggedInUser) {
    return NextResponse.json({ error: '로그인이 필요합니다' }, { status: 401 })
  }

  // 현재 이메일과 동일한지 확인
  if (newEmail === loggedInUser.email) {
    return NextResponse.json({ error: '현재 이메일과 동일합니다' }, { status: 400 })
  }

  // 새 이메일 중복 확인
  const existingUser = getUserByEmail(newEmail)
  if (existingUser) {
    return NextResponse.json({ error: '이미 사용 중인 이메일입니다' }, { status: 409 })
  }

  // 인증 코드 검증 (새 이메일로 전송된 코드)
  const storedCode = getVerificationCode(newEmail)
  if (!storedCode || storedCode !== code) {
    return NextResponse.json({ error: '인증 코드가 올바르지 않거나 만료되었습니다' }, { status: 400 })
  }

  // 현재 비밀번호 확인
  const user = getUserByEmail(loggedInUser.email)
  if (!user) {
    return NextResponse.json({ error: '사용자를 찾을 수 없습니다' }, { status: 404 })
  }

  const valid = await verifyPassword(currentPassword, user.password)
  if (!valid) {
    return NextResponse.json({ error: '현재 비밀번호가 올바르지 않습니다' }, { status: 400 })
  }

  // 이메일 업데이트
  getDb().prepare('UPDATE users SET email = ? WHERE id = ?').run(newEmail, user.id)
  clearVerificationCode(newEmail)

  // JWT 토큰 재발급 (세션 유지)
  await setAuthCookie(user.id)

  return NextResponse.json({ success: true })
}
