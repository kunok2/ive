import { NextResponse } from 'next/server'
import fs from 'fs'
import path from 'path'

export const dynamic = 'force-dynamic'

/**
 * 지금 서버가 내보내는 판 — 열린 탭이 옛 번들을 돌고 있는지 견주는 기준(use-app-version-watch).
 *
 * 판(package.json version)은 릴리스 때만 오르고 배포는 커밋마다 일어나므로, 배포마다 바뀌는
 * Next.js 빌드 ID(.next/BUILD_ID)를 함께 준다. 요청 때마다 파일을 읽어 재시작 뒤 새 빌드를 바로 반영한다.
 */
export async function GET() {
  let buildId = ''
  try { buildId = fs.readFileSync(path.join(process.cwd(), '.next', 'BUILD_ID'), 'utf-8').trim() } catch { /* dev 등 — 판만 */ }
  return NextResponse.json(
    { version: process.env.APP_VERSION || '', buildId },
    { headers: { 'Cache-Control': 'no-store' } },
  )
}
