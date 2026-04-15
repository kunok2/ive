import jwt from 'jsonwebtoken'
import bcrypt from 'bcryptjs'
import { cookies } from 'next/headers'
import { NextResponse } from 'next/server'
import { getUserById } from './db'

const KNOWN_DEFAULT_JWT_SECRETS = [
  'spring-ive-dev-secret-change-in-production',
  'spring-ive-secret-change-me',
]
const JWT_SECRET = process.env.JWT_SECRET || 'spring-ive-dev-secret-change-in-production'
if (process.env.NODE_ENV === 'production' && KNOWN_DEFAULT_JWT_SECRETS.includes(JWT_SECRET)) {
  console.warn('[SECURITY WARNING] JWT_SECRET is set to a known default value. Set a strong, unique JWT_SECRET environment variable!')
}
const COOKIE_NAME = 'ive-token'
const TOKEN_MAX_AGE = 60 * 60 * 24 * 7 // 7일

export async function hashPassword(password: string) {
  return bcrypt.hash(password, 10)
}

export async function verifyPassword(password: string, hash: string) {
  return bcrypt.compare(password, hash)
}

export function signToken(userId: string) {
  return jwt.sign({ userId }, JWT_SECRET, { expiresIn: '7d' })
}

export function verifyToken(token: string): { userId: string } | null {
  try {
    return jwt.verify(token, JWT_SECRET) as { userId: string }
  } catch {
    return null
  }
}

const COOKIE_OPTIONS = {
  httpOnly: true,
  secure: process.env.NODE_ENV === 'production',
  // lax: 외부 링크에서 진입 시에도 쿠키 전송. OAuth 콜백 후 redirect 시 필요.
  // strict로 변경하면 안 됨 — 이전 "fix"는 근거 없이 strict로 바꾼 것으로 되돌림.
  sameSite: 'lax' as const,
  maxAge: TOKEN_MAX_AGE,
  path: '/',
}

/**
 * JWT 인증 쿠키를 발급합니다.
 * @param userId 사용자 ID
 * @param response 제공 시 해당 response.cookies에 직접 설정 (OAuth callback용)
 *                 미제공 시 Next.js cookies() API를 통해 암묵적으로 설정 (일반 login용)
 */
export async function setAuthCookie(userId: string, response?: NextResponse) {
  const token = signToken(userId)
  if (response) {
    response.cookies.set(COOKIE_NAME, token, COOKIE_OPTIONS)
  } else {
    const cookieStore = await cookies()
    cookieStore.set(COOKIE_NAME, token, COOKIE_OPTIONS)
  }
}

export async function clearAuthCookie() {
  const cookieStore = await cookies()
  cookieStore.delete(COOKIE_NAME)
}

export async function getCurrentUser() {
  const cookieStore = await cookies()
  const token = cookieStore.get(COOKIE_NAME)?.value
  if (!token) return null

  const payload = verifyToken(token)
  if (!payload) return null

  // 슬라이딩 세션: 토큰 수명의 절반이 지났으면 자동 갱신
  try {
    const decoded = jwt.decode(token) as { exp?: number; iat?: number } | null
    if (decoded?.exp && decoded?.iat) {
      const now = Math.floor(Date.now() / 1000)
      const halfLife = (decoded.exp - decoded.iat) / 2
      if (decoded.exp - now < halfLife) {
        const newToken = signToken(payload.userId)
        cookieStore.set(COOKIE_NAME, newToken, COOKIE_OPTIONS)
      }
    }
  } catch { /* 갱신 실패 시 기존 토큰으로 계속 진행 */ }

  return getUserById(payload.userId)
}
