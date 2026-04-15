import jwt from 'jsonwebtoken'
import bcrypt from 'bcryptjs'
import { cookies } from 'next/headers'
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

export async function setAuthCookie(userId: string) {
  const token = signToken(userId)
  const cookieStore = await cookies()
  cookieStore.set(COOKIE_NAME, token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'strict',
    maxAge: TOKEN_MAX_AGE,
    path: '/',
  })
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
        cookieStore.set(COOKIE_NAME, newToken, {
          httpOnly: true,
          secure: process.env.NODE_ENV === 'production',
          sameSite: 'strict',
          maxAge: TOKEN_MAX_AGE,
          path: '/',
        })
      }
    }
  } catch { /* 갱신 실패 시 기존 토큰으로 계속 진행 */ }

  return getUserById(payload.userId)
}
