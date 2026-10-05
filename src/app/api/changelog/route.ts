import { NextResponse } from 'next/server'
import fs from 'fs'
import path from 'path'
import { getCurrentUser } from '@/lib/auth'
import { parseChangelog } from '@/lib/changelog'

export const dynamic = 'force-dynamic'

/**
 * 변경 이력 — 지금 판(APP_VERSION)과 릴리스된 판별 내용(CHANGELOG.md). 도움말 › 버전 › 「변경 이력」 창이 쓴다.
 * 운영 이미지에는 CHANGELOG.md 를 따로 넣는다(.dockerignore 예외 + Dockerfile COPY).
 */
export async function GET() {
  const user = await getCurrentUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  let md = ''
  try { md = fs.readFileSync(path.join(process.cwd(), 'CHANGELOG.md'), 'utf-8') } catch { /* 파일 없음 — 판만 */ }
  return NextResponse.json({ version: process.env.APP_VERSION || '', releases: parseChangelog(md) })
}
