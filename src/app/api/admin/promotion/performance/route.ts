import { NextResponse } from 'next/server'
import { getCurrentUser } from '@/lib/auth'
import { getMailBroadcastLogs, getSocialPosts } from '@/lib/db'

/**
 * 홍보 성과 통합 — 메일 발송 + SNS 글을 한 표로 비교한다.
 * row: { kind, id, title, createdAt, clicks(유입), unique(고유), conversions(가입/로그인 전환 | null) }
 *  - 메일: 수신자=기존 사용자라 '가입 전환' 개념이 없어 conversions=null, unique=접속 고유 사용자.
 *  - SNS : 공개 익명 → unique=고유 방문자, conversions=클릭 후 가입/로그인 수.
 */
export async function GET(req: Request) {
  const user = await getCurrentUser()
  if (!user?.isAdmin) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const limit = Math.min(Number(new URL(req.url).searchParams.get('limit')) || 100, 300)

  const mail = getMailBroadcastLogs(limit, 0).map(m => ({
    kind: 'mail' as const,
    id: m.id,
    title: m.subject,
    createdAt: m.sentAt,
    clicks: m.clickCount,
    unique: m.clickUserCount,
    conversions: null as number | null,
  }))

  const social = getSocialPosts(limit, 0).map(s => ({
    kind: 'social' as const,
    id: s.id,
    title: s.title || '(제목 없음)',
    createdAt: s.createdAt,
    clicks: s.clickCount,
    unique: s.visitorCount,
    conversions: s.conversionCount as number | null,
  }))

  const rows = [...mail, ...social].sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1)).slice(0, limit)

  const totals = {
    clicks: rows.reduce((s, r) => s + r.clicks, 0),
    conversions: rows.reduce((s, r) => s + (r.conversions ?? 0), 0),
  }
  return NextResponse.json({ rows, totals })
}
