import { NextRequest, NextResponse } from 'next/server'
import { getCurrentUser } from '@/lib/auth'
import { logActivity } from '@/lib/activity'
import { getReportModel, regenerateReportModel, kstToday, periodOf, type ReportType } from '@/lib/report-model'

/**
 * 보고서 모델(화면·메일 공용). 범위 = 로그인한 사람이 소유하거나 공유받은 프로젝트.
 * 닫힌 기간은 확정본을, 진행 중인 기간은 매번 계산한 값을 돌려준다.
 */
function parse(req: NextRequest): { type: ReportType; day: string } | null {
  const t = req.nextUrl.searchParams.get('type') || 'weekly'
  if (t !== 'weekly' && t !== 'monthly' && t !== 'yearly') return null
  const d = req.nextUrl.searchParams.get('date') || kstToday()
  if (!/^\d{4}-\d{2}-\d{2}$/.test(d)) return null
  return { type: t, day: d }
}

export async function GET(req: NextRequest) {
  const user = await getCurrentUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const q = parse(req)
  if (!q) return NextResponse.json({ error: 'type 은 weekly|monthly|yearly, date 는 YYYY-MM-DD' }, { status: 400 })
  try {
    const model = getReportModel(user.id, q.type, q.day)
    // 작업 결과 평가의 사람별 결과는 관리자와 본인에게만 — 확정본은 공용이라 응답에서 거른다
    if (model.evaluation && !user.isAdmin) {
      const me = `u:${user.id}`
      model.evaluation = {
        ...model.evaluation,
        workers: model.evaluation.workers.filter(w => w.kind === 'agent' || w.key === me),
        verifiers: model.evaluation.verifiers.filter(v => v.key === me),
        comparisons: model.evaluation.comparisons.filter(c =>
          model.evaluation!.workers.some(w => w.kind === 'agent' && w.name === c.a) &&
          model.evaluation!.workers.some(w => w.kind === 'agent' && w.name === c.b)),
      }
    }
    return NextResponse.json(model)
  } catch (e) {
    console.error('[reports/v2] build failed:', e)
    return NextResponse.json({ error: (e as Error).message }, { status: 500 })
  }
}

/** 확정본 재생성 — 계산을 고쳤거나 단가를 소급 반영해야 할 때만. 자기 보고서만 지운다. */
export async function DELETE(req: NextRequest) {
  const user = await getCurrentUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const q = parse(req)
  if (!q) return NextResponse.json({ error: 'type 은 weekly|monthly|yearly, date 는 YYYY-MM-DD' }, { status: 400 })
  regenerateReportModel(user.id, q.type, q.day)
  const p = periodOf(q.type, q.day)
  logActivity({
    userId: user.id, category: 'settings', action: 'regenerate_report_snapshot',
    detail: `보고서 확정 재생성: ${q.type} ${p.start}~${p.end}`, req,
  })
  return NextResponse.json({ ok: true })
}
