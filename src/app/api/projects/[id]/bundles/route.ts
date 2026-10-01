import { NextResponse } from 'next/server'
import { getCurrentUser } from '@/lib/auth'
import { logActivity } from '@/lib/activity'
import {
  getProjectAutomation, listWaitingBundleItems, listBundleItems, getInFlightBundle, getHoldingBundle, listRecentBundles,
  getBundle, updateBundle, updateBundleItem,
} from '@/lib/db'
import { checkProjectSettingsAccess } from '@/lib/project-permissions'
import { bundleNextDeparture } from '@/lib/scanner/bundle-deploy'
import { triggerScan } from '@/lib/scanner'

/**
 * 묶음 배포 현황 — 대기열·다음 출발 예정·진행 중 묶음·최근 묶음.
 * POST: approve(승인 대기 묶음 출발) · release(실패·깨짐으로 막힌 보류 해제). 프로젝트 소유자·editor.
 */
export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const user = await getCurrentUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const { id } = await params
  const acc = checkProjectSettingsAccess(id, user.id)
  if ('error' in acc) return NextResponse.json({ error: acc.error }, { status: acc.status })

  const settings = getProjectAutomation(id).bundle
  const waiting = listWaitingBundleItems(id)
  const inFlight = getInFlightBundle(id)
  const holding = getHoldingBundle(id)
  const recent = listRecentBundles(id, 8).map(b => ({ ...b, items: listBundleItems(b.id) }))
  return NextResponse.json({
    canEdit: acc.canEdit,
    settings,
    waiting,
    // 진행 중·보류 묶음이 있으면 다음 묶음은 출발하지 않는다
    nextAt: inFlight || holding ? null : bundleNextDeparture(acc.project, waiting, settings),
    inFlight: inFlight ? { ...inFlight, items: listBundleItems(inFlight.id) } : null,
    holding: holding ? { ...holding, items: listBundleItems(holding.id) } : null,
    recent,
  })
}

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const user = await getCurrentUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const { id } = await params
  const acc = checkProjectSettingsAccess(id, user.id)
  if ('error' in acc) return NextResponse.json({ error: acc.error }, { status: acc.status })
  if (!acc.canEdit) return NextResponse.json({ error: '소유자 또는 편집 권한자만 할 수 있습니다' }, { status: 403 })

  const body = await req.json().catch(() => ({}))
  const bundle = getBundle(Number(body.bundleId))
  if (!bundle || bundle.projectId !== id) return NextResponse.json({ error: '묶음을 찾을 수 없습니다' }, { status: 404 })

  if (body.action === 'approve') {
    // 출발은 스캐너가 한다(같은 묶음을 두 곳에서 돌리지 않도록) — 상태만 바꾸고 스캔을 깨운다
    if (!updateBundle(bundle.id, { status: 'departing', approvedBy: user.id, approvedAt: true, departedAt: true }, 'awaiting_approval')) {
      return NextResponse.json({ error: '이미 출발했거나 승인 대기 상태가 아닙니다' }, { status: 409 })
    }
  } else if (body.action === 'release') {
    if (!updateBundle(bundle.id, { status: 'released', finishedAt: true }, ['failed', 'broken'])) {
      return NextResponse.json({ error: '보류 중인 묶음이 아닙니다' }, { status: 409 })
    }
    // 푸시하지 못한 이슈는 대기열로 되돌려 다음 묶음에 싣는다 (푸시된 이슈는 그대로 확인을 진행한다)
    for (const it of listBundleItems(bundle.id)) {
      if (it.status === 'in_bundle' || it.status === 'merged') updateBundleItem(it.id, { status: 'waiting', bundleId: null, mergeSha: null })
    }
  } else {
    return NextResponse.json({ error: '알 수 없는 동작' }, { status: 400 })
  }
  logActivity({
    userId: user.id, category: 'project', action: `bundle_${body.action}`,
    detail: `묶음 배포 #${bundle.id} ${body.action === 'approve' ? '출발 승인' : '보류 해제'}: ${acc.project.name}`,
    targetType: 'project', targetId: id, req,
  })
  try { triggerScan(id) } catch { /* 다음 주기에 진행 */ }
  return NextResponse.json({ success: true })
}
