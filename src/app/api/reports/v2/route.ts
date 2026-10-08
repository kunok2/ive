import { NextRequest, NextResponse } from 'next/server'
import { getCurrentUser } from '@/lib/auth'
import { logActivity } from '@/lib/activity'
import { getReportModel, regenerateReportModel, kstToday, periodOf, type ReportType, type Scope } from '@/lib/report-model'
import { scopedProjects } from '@/lib/report-model/load'
import { liveHeldAll, mineFrom } from '@/lib/report-model/build'
import { getSystemSetting } from '@/lib/db'

/**
 * 보고서 모델(화면·메일 공용). 범위 = 로그인한 사람이 소유하거나 공유받은 프로젝트.
 * 닫힌 기간은 확정본을, 진행 중인 기간은 매번 계산한 값을 돌려준다.
 * 진행 중인 기간이면 mine(지금 내 손에 있는 일 — 메일의 "내 손에 있는 일"과 같은 계산)을 함께 준다.
 * 오류는 화면이 번역해 보이도록 코드(code)로 준다.
 * projects=id,id… 면 그 범위 안에서 고른 프로젝트만(프로젝트 필터). 고를 수 있는 목록은 projectOptions 로 준다.
 */
function parse(req: NextRequest): { type: ReportType; day: string } | null {
  const t = req.nextUrl.searchParams.get('type') || 'weekly'
  if (t !== 'weekly' && t !== 'monthly' && t !== 'yearly') return null
  const d = req.nextUrl.searchParams.get('date') || kstToday()
  // 형식뿐 아니라 실제 있는 날짜인지(2026-13-45 같은 값은 거절)
  if (!/^\d{4}-\d{2}-\d{2}$/.test(d)) return null
  const ms = Date.parse(`${d}T00:00:00Z`)
  if (Number.isNaN(ms) || new Date(ms).toISOString().slice(0, 10) !== d) return null
  return { type: t, day: d }
}

/** 프로젝트 필터 — 없거나 비면 전체. 범위 밖 id 는 scopedProjects 가 걸러 낸다 */
function scopeOf(req: NextRequest, userId: string): Scope {
  const ids = (req.nextUrl.searchParams.get('projects') || '').split(',').map(s => s.trim()).filter(Boolean)
  return ids.length > 0 ? { user: userId, projects: [...new Set(ids)] } : userId
}

export async function GET(req: NextRequest) {
  const user = await getCurrentUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized', code: 'unauthorized' }, { status: 401 })
  const q = parse(req)
  if (!q) return NextResponse.json({ error: 'type 은 weekly|monthly|yearly, date 는 YYYY-MM-DD', code: 'bad_request' }, { status: 400 })
  try {
    const scope = scopeOf(req, user.id)
    const model = getReportModel(scope, q.type, q.day)
    // 작업 결과 평가의 사람별 결과는 관리자와 본인에게만(설정이 「본인만」이면 관리자도 본인 것만) — 확정본은 공용이라 응답에서 거른다
    const selfOnly = getSystemSetting('report.eval_visibility') === 'self'
    if (model.evaluation && (!user.isAdmin || selfOnly)) {
      const me = `u:${user.id}`
      // 에이전트(모델 단위, 키 m:)는 모두에게, 사람은 본인 것만
      const visible = (key: string) => key.startsWith('m:') || key === me
      model.evaluation = {
        ...model.evaluation,
        workers: model.evaluation.workers.filter(w => visible(w.key)),
        verifiers: model.evaluation.verifiers.filter(v => visible(v.key)),
        comparisons: model.evaluation.comparisons.filter(c => c.aKey.startsWith('m:') && c.bKey.startsWith('m:')),
      }
    }
    const filter = typeof scope === 'object' && scope ? new Set(scope.projects) : null
    const mine = model.isCurrent ? mineFrom(liveHeldAll(), user.id).filter(i => !filter || filter.has(i.projectId)) : undefined
    const projectOptions = scopedProjects(user.id).map(({ id, name, color }) => ({ id, name, color }))
    return NextResponse.json({ ...model, mine, projectOptions })
  } catch (e) {
    console.error('[reports/v2] build failed:', e)
    return NextResponse.json({ error: (e as Error).message, code: 'build_failed' }, { status: 500 })
  }
}

/** 확정본 재생성 — 계산을 고쳤거나 단가를 소급 반영해야 할 때만. 자기 보고서만 지운다. */
export async function DELETE(req: NextRequest) {
  const user = await getCurrentUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized', code: 'unauthorized' }, { status: 401 })
  const q = parse(req)
  if (!q) return NextResponse.json({ error: 'type 은 weekly|monthly|yearly, date 는 YYYY-MM-DD', code: 'bad_request' }, { status: 400 })
  regenerateReportModel(scopeOf(req, user.id), q.type, q.day)
  const p = periodOf(q.type, q.day)
  logActivity({
    userId: user.id, category: 'settings', action: 'regenerate_report_snapshot',
    detail: `보고서 확정 재생성: ${q.type} ${p.start}~${p.end}`, req,
  })
  return NextResponse.json({ ok: true })
}
