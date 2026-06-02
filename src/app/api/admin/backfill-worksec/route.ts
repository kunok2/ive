import { NextRequest, NextResponse } from 'next/server'
import { getCurrentUser } from '@/lib/auth'
import { backfillToolDevWorkSec } from '@/lib/backfill-worksec'
import { logActivity } from '@/lib/activity'

// POST /api/admin/backfill-worksec — ive-meta 없는 과거 툴개발 exec의 work_sec을 GitLab /spend로 1회 복구.
// (Part A 마이그레이션이 ive-meta 있는 건은 이미 채움. 여기는 나머지 GitLab 이슈만.)
export async function POST(req: NextRequest) {
  const user = await getCurrentUser()
  if (!user?.isAdmin) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const result = await backfillToolDevWorkSec()
  logActivity({ userId: user.id, category: 'admin', action: 'backfill_worksec', detail: `work_sec 백필: 대상 ${result.scanned}, 갱신 ${result.updated}, 건너뜀 ${result.skipped}`, req })
  return NextResponse.json(result)
}
