import fs from 'fs'
import { NextResponse } from 'next/server'
import { getCurrentUser } from '@/lib/auth'
import { getProject, getProjectAccess } from '@/lib/db'
import { resolveEvidenceFile, evidenceMime } from '@/lib/evidence'

/** 증적 파일 1개 — ?run=<stage-stamp>&file=<상대경로>. 프로젝트 접근 권한 필요, 경로 탈출 차단. */
export async function GET(req: Request, { params }: { params: Promise<{ id: string; iid: string }> }) {
  const user = await getCurrentUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const { id, iid } = await params
  if (!getProject(id) || !getProjectAccess(id, user.id)) return NextResponse.json({ error: 'Not found' }, { status: 404 })
  const url = new URL(req.url)
  const abs = resolveEvidenceFile(id, Number(iid), url.searchParams.get('run') || '', url.searchParams.get('file') || '')
  if (!abs) return NextResponse.json({ error: 'Not found' }, { status: 404 })
  const buf = fs.readFileSync(abs)
  return new NextResponse(new Uint8Array(buf), {
    headers: {
      'Content-Type': evidenceMime(abs),
      'Cache-Control': 'private, max-age=3600',
      'X-Content-Type-Options': 'nosniff',
    },
  })
}
