import { NextResponse } from 'next/server'
import { getCurrentUser, hashPassword, verifyPassword } from '@/lib/auth'
import { getUserByEmail, getDb } from '@/lib/db'
import { getVerificationCode, clearVerificationCode } from '@/app/api/auth/send-code/route'

export async function POST(req: Request) {
  const { email, currentPassword, newPassword, code } = await req.json()

  if (!newPassword || newPassword.length < 6) {
    return NextResponse.json({ error: '새 비밀번호는 6자 이상이어야 합니다' }, { status: 400 })
  }

  if (!code) {
    return NextResponse.json({ error: '이메일 인증 코드를 입력해주세요' }, { status: 400 })
  }

  // 로그인 상태: currentPassword로 확인
  const loggedInUser = await getCurrentUser()
  let targetEmail = email

  if (loggedInUser) {
    targetEmail = loggedInUser.email
  }

  if (!targetEmail || !currentPassword) {
    return NextResponse.json({ error: '이메일과 현재 비밀번호를 입력해주세요' }, { status: 400 })
  }

  // 이메일 인증 코드 검증
  const storedCode = getVerificationCode(targetEmail)
  if (!storedCode || storedCode !== code) {
    return NextResponse.json({ error: '인증 코드가 올바르지 않거나 만료되었습니다' }, { status: 400 })
  }

  const user = getUserByEmail(targetEmail)
  if (!user) {
    return NextResponse.json({ error: '사용자를 찾을 수 없습니다' }, { status: 404 })
  }

  const valid = await verifyPassword(currentPassword, user.password)
  if (!valid) {
    return NextResponse.json({ error: '현재 비밀번호가 올바르지 않습니다' }, { status: 400 })
  }

  const newHash = await hashPassword(newPassword)
  getDb().prepare('UPDATE users SET password = ? WHERE id = ?').run(newHash, user.id)
  clearVerificationCode(targetEmail)

  return NextResponse.json({ success: true })
}
