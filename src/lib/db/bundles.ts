/**
 * 묶음 배포(3.5.1) 대기열·묶음 기록.
 *
 * 검증(③) 통과 이슈는 바로 머지하지 않고 대기열(stage_bundle_items, bundle_id NULL)에 오른다.
 * 출발 조건이 차면 대기 이슈를 묶음(stage_bundles) 하나로 묶어 staging 최신본 위에 차례로 머지하고 한 번 푸시한다.
 * 한 번에 한 묶음만 떠 있다 — 진행 중(승인 대기·출발·푸시·배포) 묶음이 있거나 실패·깨짐으로 보류된 묶음이 있으면 출발하지 않는다.
 */
import { getDb } from './connection'

export type BundleStatus =
  | 'awaiting_approval' // 출발 조건은 찼고 사람 승인을 기다림 (자동 머지 꺼짐)
  | 'departing'         // 머지·검사·푸시 중
  | 'pushed'            // staging 에 푸시함 — 파이프라인(배포) 대기
  | 'deployed'          // 배포 파이프라인 성공 — 확인(④) 진행 중
  | 'done'              // 실린 이슈의 확인이 모두 끝남
  | 'empty'             // 실을 이슈가 없어(충돌·검사 실패로 전부 빠짐) 푸시하지 않음
  | 'failed'            // 푸시·배포 실패 — 사람 필요, 다음 묶음 보류
  | 'broken'            // 여러 이슈의 확인이 동시에 실패 — staging 이 깨진 것으로 보고 다음 묶음 보류
  | 'released'          // 실패·깨짐을 사람이 확인하고 보류를 풀었다

export type BundleItemStatus =
  | 'waiting'       // 대기열
  | 'in_bundle'     // 묶음에 실림(출발 전)
  | 'merged'        // 묶음 작업공간에서 머지됨(푸시 전)
  | 'pushed'        // staging 에 푸시됨 — 확인 대기
  | 'done'          // 확인이 끝났거나 이슈가 다음 단계로 감
  | 'conflict'      // staging 최신본과 충돌 — 처리자에게 되돌림
  | 'check_failed'  // 합친 결과 검사에서 원인으로 지목 — 처리자에게 되돌림
  | 'removed'       // 대기 중에 이슈가 확인대기를 벗어남(사람이 옮김 등) 또는 커밋이 바뀜

export const IN_FLIGHT_BUNDLE: BundleStatus[] = ['awaiting_approval', 'departing', 'pushed', 'deployed']
export const HOLD_BUNDLE: BundleStatus[] = ['failed', 'broken']
const ACTIVE_ITEM: BundleItemStatus[] = ['waiting', 'in_bundle', 'merged', 'pushed']

export interface StageBundle {
  id: number
  projectId: string
  status: BundleStatus
  targetBranch: string
  baseSha: string | null
  pushedSha: string | null
  pipelineStatus: string | null
  pipelineUrl: string | null
  note: string | null
  createdAt: string
  approvedAt: string | null
  approvedBy: string | null
  departedAt: string | null
  pushedAt: string | null
  deployedAt: string | null
  finishedAt: string | null
}

export interface BundleItem {
  id: number
  projectId: string
  issueIid: number
  bundleId: number | null
  status: BundleItemStatus
  sourceSha: string
  mrIid: number | null
  mrUrl: string | null
  issueTitle: string | null
  mergeSha: string | null
  /** 푸시 후 MR 이 어떻게 닫혔나 — merged_by_push(Git 이 머지로 인식) | closed_by_ive(인식 못해 IVE 가 닫음) */
  mrResult: string | null
  note: string | null
  queuedAt: string
  updatedAt: string
}

const toBundle = (r: any): StageBundle => ({
  id: r.id, projectId: r.project_id, status: r.status, targetBranch: r.target_branch, baseSha: r.base_sha,
  pushedSha: r.pushed_sha, pipelineStatus: r.pipeline_status, pipelineUrl: r.pipeline_url, note: r.note,
  createdAt: r.created_at, approvedAt: r.approved_at, approvedBy: r.approved_by, departedAt: r.departed_at,
  pushedAt: r.pushed_at, deployedAt: r.deployed_at, finishedAt: r.finished_at,
})

const toItem = (r: any): BundleItem => ({
  id: r.id, projectId: r.project_id, issueIid: r.issue_iid, bundleId: r.bundle_id, status: r.status,
  sourceSha: r.source_sha, mrIid: r.mr_iid, mrUrl: r.mr_url, issueTitle: r.issue_title, mergeSha: r.merge_sha,
  mrResult: r.mr_result, note: r.note, queuedAt: r.queued_at, updatedAt: r.updated_at,
})

const inList = (xs: string[]) => xs.map(x => `'${x}'`).join(',')

/**
 * 검증 통과 이슈를 대기열에 올린다. 같은 이슈의 아직 출발 전(대기) 줄이 있으면 새 커밋으로 바꿔 단다.
 * 이미 묶음에 실려 진행 중이면(머지·푸시) 새로 올리지 않는다 — 그 묶음의 결과를 따른다.
 */
export function enqueueBundleItem(projectId: string, issueIid: number, v: { sourceSha: string; mrIid?: number | null; mrUrl?: string | null; issueTitle?: string | null }): BundleItem | null {
  const db = getDb()
  const tx = db.transaction(() => {
    const busy = db.prepare(`SELECT id FROM stage_bundle_items WHERE project_id = ? AND issue_iid = ? AND status IN ('in_bundle','merged') LIMIT 1`).get(projectId, issueIid)
    if (busy) return null
    db.prepare(`UPDATE stage_bundle_items SET status = 'removed', note = '다시 검증되어 새 커밋으로 대체', updated_at = datetime('now')
      WHERE project_id = ? AND issue_iid = ? AND status IN ('waiting','pushed')`).run(projectId, issueIid)
    const r = db.prepare(`INSERT INTO stage_bundle_items (project_id, issue_iid, status, source_sha, mr_iid, mr_url, issue_title)
      VALUES (?, ?, 'waiting', ?, ?, ?, ?)`).run(projectId, issueIid, v.sourceSha, v.mrIid ?? null, v.mrUrl ?? null, v.issueTitle ?? null)
    return toItem(db.prepare('SELECT * FROM stage_bundle_items WHERE id = ?').get(r.lastInsertRowid))
  })
  return tx() as BundleItem | null
}

/** 이 이슈의 가장 최근 대기열·묶음 줄 */
export function getLatestBundleItem(projectId: string, issueIid: number): BundleItem | null {
  const r = getDb().prepare('SELECT * FROM stage_bundle_items WHERE project_id = ? AND issue_iid = ? ORDER BY id DESC LIMIT 1').get(projectId, issueIid)
  return r ? toItem(r) : null
}

/** 이 이슈가 지금 대기열·진행 중 묶음에 있는가 */
export function getActiveBundleItem(projectId: string, issueIid: number): BundleItem | null {
  const r = getDb().prepare(`SELECT * FROM stage_bundle_items WHERE project_id = ? AND issue_iid = ? AND status IN (${inList(ACTIVE_ITEM)}) ORDER BY id DESC LIMIT 1`).get(projectId, issueIid)
  return r ? toItem(r) : null
}

export function listWaitingBundleItems(projectId: string): BundleItem[] {
  return (getDb().prepare(`SELECT * FROM stage_bundle_items WHERE project_id = ? AND status = 'waiting' AND bundle_id IS NULL ORDER BY queued_at, id`).all(projectId) as any[]).map(toItem)
}

export function listBundleItems(bundleId: number): BundleItem[] {
  return (getDb().prepare('SELECT * FROM stage_bundle_items WHERE bundle_id = ? ORDER BY queued_at, id').all(bundleId) as any[]).map(toItem)
}

export function updateBundleItem(id: number, patch: Partial<Pick<BundleItem, 'status' | 'mergeSha' | 'mrResult' | 'note' | 'bundleId'>>) {
  const cols: string[] = []
  const vals: unknown[] = []
  const map: Record<string, string> = { status: 'status', mergeSha: 'merge_sha', mrResult: 'mr_result', note: 'note', bundleId: 'bundle_id' }
  for (const [k, c] of Object.entries(map)) {
    if (k in patch) { cols.push(`${c} = ?`); vals.push((patch as any)[k]) }
  }
  if (!cols.length) return
  getDb().prepare(`UPDATE stage_bundle_items SET ${cols.join(', ')}, updated_at = datetime('now') WHERE id = ?`).run(...vals, id)
}

/** 진행 중(승인 대기·출발·푸시·배포) 묶음 — 한 번에 하나 */
export function getInFlightBundle(projectId: string): StageBundle | null {
  const r = getDb().prepare(`SELECT * FROM stage_bundles WHERE project_id = ? AND status IN (${inList(IN_FLIGHT_BUNDLE)}) ORDER BY id DESC LIMIT 1`).get(projectId)
  return r ? toBundle(r) : null
}

/** 실패·깨짐으로 다음 묶음을 막고 있는 묶음 */
export function getHoldingBundle(projectId: string): StageBundle | null {
  const r = getDb().prepare(`SELECT * FROM stage_bundles WHERE project_id = ? AND status IN (${inList(HOLD_BUNDLE)}) ORDER BY id DESC LIMIT 1`).get(projectId)
  return r ? toBundle(r) : null
}

export function getBundle(id: number): StageBundle | null {
  const r = getDb().prepare('SELECT * FROM stage_bundles WHERE id = ?').get(id)
  return r ? toBundle(r) : null
}

export function listRecentBundles(projectId: string, limit = 10): StageBundle[] {
  return (getDb().prepare('SELECT * FROM stage_bundles WHERE project_id = ? ORDER BY id DESC LIMIT ?').all(projectId, limit) as any[]).map(toBundle)
}

/** 마지막으로 묶음을 만든 시각 (정해진 시각 출발 판정용) */
export function getLastBundleCreatedAt(projectId: string): string | null {
  const r = getDb().prepare('SELECT MAX(created_at) as t FROM stage_bundles WHERE project_id = ?').get(projectId) as { t: string | null }
  return r?.t ?? null
}

/**
 * 대기 이슈를 묶음 하나로 묶는다 (트랜잭션 — 진행 중·보류 묶음이 있으면 만들지 않는다).
 * @returns 만든 묶음, 못 만들었으면 null
 */
export function createBundle(projectId: string, targetBranch: string, itemIds: number[], status: 'awaiting_approval' | 'departing'): StageBundle | null {
  const db = getDb()
  const tx = db.transaction(() => {
    const blocking = db.prepare(`SELECT 1 FROM stage_bundles WHERE project_id = ? AND status IN (${inList([...IN_FLIGHT_BUNDLE, ...HOLD_BUNDLE])}) LIMIT 1`).get(projectId)
    if (blocking || itemIds.length === 0) return null
    const r = db.prepare(`INSERT INTO stage_bundles (project_id, status, target_branch, departed_at) VALUES (?, ?, ?, ${status === 'departing' ? "datetime('now')" : 'NULL'})`)
      .run(projectId, status, targetBranch)
    const id = Number(r.lastInsertRowid)
    const upd = db.prepare(`UPDATE stage_bundle_items SET bundle_id = ?, status = 'in_bundle', updated_at = datetime('now') WHERE id = ? AND status = 'waiting' AND bundle_id IS NULL`)
    let n = 0
    for (const iid of itemIds) n += upd.run(id, iid).changes
    if (n === 0) { db.prepare('DELETE FROM stage_bundles WHERE id = ?').run(id); return null }
    return toBundle(db.prepare('SELECT * FROM stage_bundles WHERE id = ?').get(id))
  })
  return tx() as StageBundle | null
}

const BUNDLE_COLS: Record<string, string> = {
  status: 'status', baseSha: 'base_sha', pushedSha: 'pushed_sha', pipelineStatus: 'pipeline_status', pipelineUrl: 'pipeline_url',
  note: 'note', approvedBy: 'approved_by',
}
const BUNDLE_STAMPS = {
  approvedAt: 'approved_at', departedAt: 'departed_at', pushedAt: 'pushed_at', deployedAt: 'deployed_at', finishedAt: 'finished_at',
} as const

/**
 * 묶음 갱신. 시각 칸은 true 를 주면 지금 시각으로 찍는다.
 * fromStatus 를 주면 그 상태일 때만 바꾼다(동시 갱신 방지) — 바꿨으면 true.
 */
export function updateBundle(
  id: number,
  patch: Partial<Pick<StageBundle, 'status' | 'baseSha' | 'pushedSha' | 'pipelineStatus' | 'pipelineUrl' | 'note' | 'approvedBy'>> & Partial<Record<keyof typeof BUNDLE_STAMPS, true>>,
  fromStatus?: BundleStatus | BundleStatus[],
): boolean {
  const cols: string[] = []
  const vals: unknown[] = []
  for (const [k, c] of Object.entries(BUNDLE_COLS)) if (k in patch) { cols.push(`${c} = ?`); vals.push((patch as any)[k]) }
  for (const [k, c] of Object.entries(BUNDLE_STAMPS)) if ((patch as any)[k]) cols.push(`${c} = datetime('now')`)
  if (!cols.length) return false
  const from = fromStatus ? (Array.isArray(fromStatus) ? fromStatus : [fromStatus]) : null
  const r = getDb().prepare(`UPDATE stage_bundles SET ${cols.join(', ')} WHERE id = ?${from ? ` AND status IN (${inList(from)})` : ''}`).run(...vals, id)
  return r.changes > 0
}

/** 대기 중에 이슈가 확인대기를 벗어나면(사람이 옮김 등) 대기열에서 뺀다 */
export function removeWaitingBundleItem(projectId: string, issueIid: number, note: string): number {
  return getDb().prepare(`UPDATE stage_bundle_items SET status = 'removed', note = ?, updated_at = datetime('now')
    WHERE project_id = ? AND issue_iid = ? AND status = 'waiting' AND bundle_id IS NULL`).run(note, projectId, issueIid).changes
}
