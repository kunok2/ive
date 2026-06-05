import { NextResponse } from 'next/server'
import { recordMailClick, getUserById } from '@/lib/db'
import { verifyClickToken } from '@/lib/mail-broadcast'
import { resolveRedirectBase } from '@/lib/oauth'

/**
 * 브로드캐스트 메일의 'IVE 접속하기' 링크. 비로그인.
 * 토큰(logId+userId, 서명)을 검증해 접속(클릭)을 기록한 뒤 IVE로 리다이렉트한다.
 * 토큰이 무효여도 링크는 동작해야 하므로 항상 IVE 루트로 보낸다(기록만 생략).
 */
export async function GET(req: Request) {
  const base = resolveRedirectBase(req)
  const token = new URL(req.url).searchParams.get('t')
  const verified = token ? verifyClickToken(token) : null

  if (verified) {
    try {
      const u = getUserById(verified.userId)
      const h = req.headers
      recordMailClick({
        broadcastLogId: verified.logId,
        userId: verified.userId,
        email: u?.email ?? null,
        ip: h.get('x-forwarded-for')?.split(',')[0]?.trim() || null,
        userAgent: h.get('user-agent') || null,
      })
    } catch (e) {
      console.error('[mail/click] 기록 실패:', e)
    }
  }

  return NextResponse.redirect(base || new URL(req.url).origin, { status: 302 })
}
