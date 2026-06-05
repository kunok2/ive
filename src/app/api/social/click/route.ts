import { NextResponse } from 'next/server'
import { cookies } from 'next/headers'
import { getSocialPostLink, recordSocialClick } from '@/lib/db'
import { resolveRedirectBase } from '@/lib/oauth'
import { SOCIAL_VISITOR_COOKIE, genVisitorId, socialVisitorCookieOptions } from '@/lib/social-tracking'

/**
 * SNS 홍보 글의 채널별 추적 링크. 비로그인·공개.
 * 클릭을 기록하고(익명 방문자 쿠키 발급) IVE로 리다이렉트한다.
 * 잘못된 링크여도 IVE 루트로 보낸다(기록만 생략).
 */
export async function GET(req: Request) {
  const base = resolveRedirectBase(req) || new URL(req.url).origin
  const linkId = new URL(req.url).searchParams.get('l')
  const link = linkId ? getSocialPostLink(linkId) : null

  // 방문자 쿠키 — 있으면 재사용(전환 귀속용으로 클릭~가입을 잇는다), 없으면 새로 발급.
  const existing = (await cookies()).get(SOCIAL_VISITOR_COOKIE)?.value
  const visitorId = existing || genVisitorId()

  if (link) {
    try {
      const h = req.headers
      recordSocialClick({
        linkId: link.id,
        postId: link.postId,
        channel: link.channel,
        visitorId,
        ip: h.get('x-forwarded-for')?.split(',')[0]?.trim() || null,
        userAgent: h.get('user-agent') || null,
        referrer: h.get('referer') || null,
      })
    } catch (e) {
      console.error('[social/click] 기록 실패:', e)
    }
  }

  const res = NextResponse.redirect(base, { status: 302 })
  res.cookies.set(SOCIAL_VISITOR_COOKIE, visitorId, socialVisitorCookieOptions)
  return res
}
