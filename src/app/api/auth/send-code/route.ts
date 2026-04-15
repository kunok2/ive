import crypto from 'crypto'
import { NextResponse } from 'next/server'
import { getUserByEmail, getVerificationCode, saveVerificationCode, deleteVerificationCode, cleanExpiredVerificationCodes } from '@/lib/db'
import { sendVerificationEmail } from '@/lib/mail'
import { isRateLimited, getClientIp } from '@/lib/rate-limit'

// 만료된 인증 코드 주기적 정리
setInterval(() => cleanExpiredVerificationCodes(), 60_000)

export function clearVerificationCode(email: string) {
  deleteVerificationCode(email)
}

export { getVerificationCode }

export async function POST(req: Request) {
  // IP당 5분에 5회, 이메일당 5분에 3회 제한
  const ip = getClientIp(req)
  if (isRateLimited(`send-code-ip:${ip}`, 5, 5 * 60 * 1000)) {
    return NextResponse.json({ error: '잠시 후 다시 시도해주세요' }, { status: 429 })
  }

  const { email, purpose } = await req.json()
  if (!email) {
    return NextResponse.json({ error: '이메일을 입력해주세요' }, { status: 400 })
  }

  if (isRateLimited(`send-code-email:${email}`, 3, 5 * 60 * 1000)) {
    return NextResponse.json({ error: '잠시 후 다시 시도해주세요' }, { status: 429 })
  }

  const existing = getUserByEmail(email)

  if (purpose === 'change-password') {
    if (!existing) {
      return NextResponse.json({ error: '가입되지 않은 이메일입니다' }, { status: 404 })
    }
  } else if (purpose === 'change-email') {
    if (existing) {
      return NextResponse.json({ error: '이미 사용 중인 이메일입니다' }, { status: 409 })
    }
  } else {
    if (existing) {
      return NextResponse.json({ error: '이미 사용 중인 이메일입니다' }, { status: 409 })
    }
  }

  // 암호학적으로 안전한 6자리 숫자 코드 생성
  const code = String(crypto.randomInt(100000, 999999))
  saveVerificationCode(email, code, Date.now() + 10 * 60 * 1000) // 10분

  try {
    await sendVerificationEmail(email, code)
    return NextResponse.json({ success: true })
  } catch (err) {
    console.error('[send-code] 메일 전송 실패:', err)
    deleteVerificationCode(email)
    return NextResponse.json({ error: '인증 메일 전송에 실패했습니다' }, { status: 500 })
  }
}
