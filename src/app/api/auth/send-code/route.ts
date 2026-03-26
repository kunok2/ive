import crypto from 'crypto'
import { NextResponse } from 'next/server'
import { getUserByEmail } from '@/lib/db'
import { sendVerificationEmail } from '@/lib/mail'

// 인증 코드 저장 (메모리) — {email: {code, expiresAt}}
const verificationCodes = new Map<string, { code: string; expiresAt: number }>()

// 만료된 인증 코드 주기적 정리 (메모리 누수 방지)
setInterval(() => {
  const now = Date.now()
  for (const [email, entry] of verificationCodes) {
    if (now > entry.expiresAt) {
      verificationCodes.delete(email)
    }
  }
}, 60_000)

export function getVerificationCode(email: string) {
  const entry = verificationCodes.get(email)
  if (!entry) return null
  if (Date.now() > entry.expiresAt) {
    verificationCodes.delete(email)
    return null
  }
  return entry.code
}

export function clearVerificationCode(email: string) {
  verificationCodes.delete(email)
}

export async function POST(req: Request) {
  const { email, purpose } = await req.json()
  if (!email) {
    return NextResponse.json({ error: '이메일을 입력해주세요' }, { status: 400 })
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
  verificationCodes.set(email, { code, expiresAt: Date.now() + 10 * 60 * 1000 }) // 10분

  try {
    await sendVerificationEmail(email, code)
    return NextResponse.json({ success: true })
  } catch (err) {
    console.error('[send-code] 메일 전송 실패:', err)
    return NextResponse.json({ error: '인증 메일 전송에 실패했습니다' }, { status: 500 })
  }
}
