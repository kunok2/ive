import { NextResponse } from 'next/server'
import { getUserById, setUserMailUnsubscribed } from '@/lib/db'
import { verifyUnsubscribeToken } from '@/lib/mail-broadcast'

/**
 * 브로드캐스트 메일 수신거부/재구독 — 비로그인. 인증은 서명 토큰으로만 한다.
 * GET  : 현재 상태 조회 (상태 변경 없음 — 메일 클라이언트의 링크 프리페치로 인한 오작동 방지)
 * POST : { token, subscribe?: boolean } — subscribe=true면 재구독, 아니면 수신거부
 */

function resolve(token: string | null) {
  const userId = token ? verifyUnsubscribeToken(token) : null
  if (!userId) return null
  const u = getUserById(userId)
  if (!u) return null
  return u
}

export async function GET(req: Request) {
  const token = new URL(req.url).searchParams.get('token')
  const u = resolve(token)
  if (!u) return NextResponse.json({ error: 'invalid_token' }, { status: 400 })
  return NextResponse.json({ email: u.email, name: u.name, unsubscribed: u.mailUnsubscribed })
}

export async function POST(req: Request) {
  let body: any = {}
  try { body = await req.json() } catch { /* empty */ }
  const u = resolve(body?.token ?? null)
  if (!u) return NextResponse.json({ error: 'invalid_token' }, { status: 400 })

  const unsubscribe = body?.subscribe !== true // 기본 동작 = 수신거부
  setUserMailUnsubscribed(u.id, unsubscribe)
  return NextResponse.json({ email: u.email, name: u.name, unsubscribed: unsubscribe })
}
