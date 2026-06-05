import crypto from 'crypto'
import { cookies } from 'next/headers'
import { attributeSocialConversion } from '@/lib/db'

/**
 * SNS 홍보 링크의 익명 방문자 추적 쿠키.
 * 클릭 시 발급하고, 이후 가입/로그인 때 읽어 전환(클릭→가입)을 귀속한다.
 */
export const SOCIAL_VISITOR_COOKIE = 'ive_vid'
export const SOCIAL_VISITOR_MAX_AGE = 60 * 60 * 24 * 90 // 90일

export function genVisitorId(): string {
  return crypto.randomBytes(16).toString('hex')
}

export const socialVisitorCookieOptions = {
  httpOnly: true,
  secure: process.env.NODE_ENV === 'production',
  sameSite: 'lax' as const,
  maxAge: SOCIAL_VISITOR_MAX_AGE,
  path: '/',
}

/**
 * 가입/로그인 시 호출. 요청의 방문자 쿠키를 읽어 SNS 클릭→전환을 귀속한다.
 * 쿠키/미전환 클릭이 없으면 조용히 무시한다. 인증 흐름을 막지 않도록 실패는 삼킨다.
 */
export async function attributeConversionFromCookie(userId: string, type: 'register' | 'login') {
  try {
    const vid = (await cookies()).get(SOCIAL_VISITOR_COOKIE)?.value
    if (vid) attributeSocialConversion(vid, userId, type)
  } catch (e) {
    console.error('[social] 전환 귀속 실패:', e)
  }
}
