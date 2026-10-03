/**
 * 예전 묶음 배포(1.7.0~)가 남긴 기록 — 읽기와 마무리만 한다(새로 쌓지 않는다).
 *
 * 묶음 배포는 없앴다. 검증 에이전트가 통과시킨 이슈는 그 자리에서 MR 을 머지한다(scanner/auto-merge).
 * 없애기 전에 대기열에 올라 있던 이슈는 스캐너가 한 번 바로 머지로 넘기고(takeLegacyQueuedItems),
 * 이미 staging 에 푸시된 이슈는 확인(④)이 그 묶음의 머지 커밋으로 계속 기동한다(getLatestBundleItem).
 */
import { getDb } from './connection'

export interface BundleItem {
  id: number
  projectId: string
  issueIid: number
  bundleId: number | null
  status: string
  sourceSha: string
  mrIid: number | null
  mrUrl: string | null
  mergeSha: string | null
}

const toItem = (r: any): BundleItem => ({
  id: r.id, projectId: r.project_id, issueIid: r.issue_iid, bundleId: r.bundle_id, status: r.status,
  sourceSha: r.source_sha, mrIid: r.mr_iid, mrUrl: r.mr_url, mergeSha: r.merge_sha,
})

/** 이 이슈의 가장 최근 묶음 줄 */
export function getLatestBundleItem(projectId: string, issueIid: number): BundleItem | null {
  const r = getDb().prepare('SELECT * FROM stage_bundle_items WHERE project_id = ? AND issue_iid = ? ORDER BY id DESC LIMIT 1').get(projectId, issueIid)
  return r ? toItem(r) : null
}

/**
 * 출발 전(대기·실림·작업공간 머지)이던 줄을 꺼내며 닫는다 — 한 번만 돌려준다(DB 상태로 다시 꺼내지 않는다).
 * 호출한 쪽이 그 이슈를 바로 머지로 넘긴다.
 */
export function takeLegacyQueuedItems(projectId: string): BundleItem[] {
  const db = getDb()
  return db.transaction(() => {
    const rows = (db.prepare(`SELECT * FROM stage_bundle_items WHERE project_id = ? AND status IN ('waiting','in_bundle','merged') ORDER BY id`).all(projectId) as any[]).map(toItem)
    if (rows.length) {
      db.prepare(`UPDATE stage_bundle_items SET status = 'removed', note = '묶음 배포를 없애 바로 머지로 넘김', updated_at = datetime('now')
        WHERE project_id = ? AND status IN ('waiting','in_bundle','merged')`).run(projectId)
    }
    return rows
  })() as BundleItem[]
}
