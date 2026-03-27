import { NextRequest, NextResponse } from 'next/server'
import { getCurrentUser } from '@/lib/auth'
import { getProject, getProjectAccess, updateProjectConflictCount } from '@/lib/db'
import { decrypt } from '@/lib/crypto'
import { fetchOpenMRs, mergeMR } from '@/lib/provider'

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const user = await getCurrentUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { id } = await params
  const project = getProject(id)
  if (!project || !getProjectAccess(id, user.id)) {
    return NextResponse.json({ error: 'Not found' }, { status: 404 })
  }

  let decryptedToken: string
  try {
    decryptedToken = decrypt(project.accessToken)
  } catch {
    return NextResponse.json({ error: 'Token decryption failed' }, { status: 500 })
  }

  const openMRs = await fetchOpenMRs(project, decryptedToken)
  const conflicts = openMRs.filter((mr: any) => mr.has_conflicts)

  // DB 캐시도 실시간 값으로 동기화 — 카드 통계에 반영
  updateProjectConflictCount(id, conflicts.length)

  return NextResponse.json({
    conflictCount: conflicts.length,
    totalOpenMRs: openMRs.length,
    conflicts,
    all: openMRs,
  })
}

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const user = await getCurrentUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { id } = await params
  const project = getProject(id)
  if (!project || !getProjectAccess(id, user.id)) {
    return NextResponse.json({ error: 'Not found' }, { status: 404 })
  }

  let decryptedToken: string
  try {
    decryptedToken = decrypt(project.accessToken)
  } catch {
    return NextResponse.json({ error: 'Token decryption failed' }, { status: 500 })
  }

  const body = await req.json()
  const { action, mrIids } = body

  if (action !== 'sequential_merge' || !Array.isArray(mrIids)) {
    return NextResponse.json({ error: 'Invalid request' }, { status: 400 })
  }

  const results: { iid: number; success: boolean; error?: string }[] = []
  for (const iid of mrIids) {
    try {
      await mergeMR(project, decryptedToken, iid)
      results.push({ iid, success: true })
    } catch (e) {
      results.push({ iid, success: false, error: e instanceof Error ? e.message : String(e) })
    }
  }

  return NextResponse.json({
    results,
    mergedCount: results.filter(r => r.success).length,
    failedCount: results.filter(r => !r.success).length,
  })
}
