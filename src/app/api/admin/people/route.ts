import { NextRequest, NextResponse } from 'next/server'
import { getCurrentUser } from '@/lib/auth'
import { getAllUsers, getPersonAliases, setPersonAlias, removePersonAlias, unresolvedPersonNames, type AliasKind } from '@/lib/db'
import { logActivity } from '@/lib/activity'

/**
 * 사람 이름 연결 — 기록에 남은 이름·Git 계정(예: "관리자", "Joung Kun-ok")을 IVE 사용자에 잇는다.
 * 보고서의 사람별 집계(누구 손에·사람 시간·작업 결과 평가)가 한 사람을 한 사람으로 센다.
 */
const KINDS: AliasKind[] = ['name', 'gitlab', 'github']

export async function GET() {
  const user = await getCurrentUser()
  if (!user?.isAdmin) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  return NextResponse.json({
    unresolved: unresolvedPersonNames(),
    linked: getPersonAliases().filter(a => a.source === 'manual'),
    users: getAllUsers().map(u => ({ id: u.id, name: u.name, email: u.email })),
  })
}

export async function POST(req: NextRequest) {
  const user = await getCurrentUser()
  if (!user?.isAdmin) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  const { alias, kind, userId } = await req.json().catch(() => ({}))
  if (typeof alias !== 'string' || !alias.trim() || !KINDS.includes(kind) || typeof userId !== 'string' || !userId) {
    return NextResponse.json({ error: 'alias, kind(name|gitlab|github), userId 가 필요합니다' }, { status: 400 })
  }
  setPersonAlias(alias, kind, userId)
  logActivity({ userId: user.id, category: 'admin', action: 'link_person_alias', detail: `사람 이름 연결: ${kind}:${alias} → ${userId}`, req })
  return NextResponse.json({ ok: true })
}

export async function DELETE(req: NextRequest) {
  const user = await getCurrentUser()
  if (!user?.isAdmin) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  const alias = req.nextUrl.searchParams.get('alias') || ''
  const kind = req.nextUrl.searchParams.get('kind') as AliasKind
  if (!alias || !KINDS.includes(kind)) return NextResponse.json({ error: 'alias, kind 가 필요합니다' }, { status: 400 })
  removePersonAlias(alias, kind)
  logActivity({ userId: user.id, category: 'admin', action: 'unlink_person_alias', detail: `사람 이름 연결 해제: ${kind}:${alias}`, req })
  return NextResponse.json({ ok: true })
}
