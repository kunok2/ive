// work_sec 백필 (Part B) — ive-meta가 없는 과거 "툴 직접개발" exec의 작업시간을
// GitLab /spend(total_time_spent)로 복구한다. 1회성 작업.
//
// Part A(마이그레이션)는 ive-meta 있는 건(started!=issue_created_at)을 (ended-started)로 이미 채웠다.
// 여기서는 started_at == issue_created_at (= ive-meta 부재) 인 GitLab 이슈만 처리.
// GitHub은 native 시간추적이 없어 0으로 남는다(ive-meta로만 복구 가능).

import { getDb, getProject } from './db'
import { decrypt } from './crypto'
import { fetchIssueTimeSpentSec } from './provider'

export async function backfillToolDevWorkSec(): Promise<{ scanned: number; updated: number; skipped: number }> {
  const rows = getDb().prepare(`
    SELECT id, project_id, issue_iid
      FROM task_executions
     WHERE assignee_type = 'user'
       AND id NOT LIKE 'ex-verify%' AND id NOT LIKE 'ex-confirm%'
       AND work_sec = 0
       AND started_at = issue_created_at
  `).all() as { id: string; project_id: string; issue_iid: number }[]

  const tokenCache = new Map<string, { project: any; token: string } | null>()
  const resolveProj = (pid: string) => {
    if (tokenCache.has(pid)) return tokenCache.get(pid)!
    let res: { project: any; token: string } | null = null
    const project = getProject(pid)
    if (project?.accessToken) {
      try { res = { project, token: decrypt(project.accessToken) } } catch { res = null }
    }
    tokenCache.set(pid, res)
    return res
  }

  const upd = getDb().prepare('UPDATE task_executions SET work_sec = ? WHERE id = ?')
  let updated = 0, skipped = 0
  for (const r of rows) {
    const pr = resolveProj(r.project_id)
    if (!pr) { skipped++; continue }
    try {
      const sec = await fetchIssueTimeSpentSec(pr.project, pr.token, r.issue_iid) // GitHub → 0
      if (sec > 0) { upd.run(Math.round(sec), r.id); updated++ } else { skipped++ }
    } catch { skipped++ }
  }
  return { scanned: rows.length, updated, skipped }
}
