import { UserActivityLog, ActivityCategory } from '@/types'
import { getDb } from './connection'

function mapActivityLog(r: any): UserActivityLog {
  return {
    id: r.id, userId: r.user_id,
    userName: r.user_name ?? undefined, userEmail: r.user_email ?? undefined,
    category: r.category as ActivityCategory, action: r.action,
    detail: r.detail || '',
    targetType: r.target_type ?? undefined, targetId: r.target_id ?? undefined,
    ipAddress: r.ip_address ?? undefined, userAgent: r.user_agent ?? undefined,
    createdAt: r.created_at,
  }
}

export function createActivityLog(log: {
  userId: string; category: ActivityCategory; action: string; detail: string;
  targetType?: string; targetId?: string; ipAddress?: string; userAgent?: string
}) {
  const id = `al-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
  getDb().prepare(
    `INSERT INTO user_activity_logs (id, user_id, category, action, detail, target_type, target_id, ip_address, user_agent)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(id, log.userId, log.category, log.action, log.detail, log.targetType ?? null, log.targetId ?? null, log.ipAddress ?? null, log.userAgent ?? null)
  return id
}

export function getActivityLogs(opts: {
  limit?: number; offset?: number;
  userId?: string; category?: string;        // 단일 (하위 호환)
  userIds?: string[]; categories?: string[]; // 다중 선택
  startDate?: string; endDate?: string;
  sortBy?: string; sortOrder?: 'ASC' | 'DESC'
}): { logs: UserActivityLog[]; total: number } {
  const conditions: string[] = []
  const params: any[] = []

  // 다중이 우선, 없으면 단일을 사용
  const userIds = (opts.userIds && opts.userIds.length > 0) ? opts.userIds : (opts.userId ? [opts.userId] : [])
  const categories = (opts.categories && opts.categories.length > 0) ? opts.categories : (opts.category ? [opts.category] : [])

  if (userIds.length > 0) {
    conditions.push(`al.user_id IN (${userIds.map(() => '?').join(',')})`)
    params.push(...userIds)
  }
  if (categories.length > 0) {
    conditions.push(`al.category IN (${categories.map(() => '?').join(',')})`)
    params.push(...categories)
  }
  if (opts.startDate) { conditions.push('al.created_at >= ?'); params.push(opts.startDate) }
  if (opts.endDate) { conditions.push('al.created_at < ?'); params.push(opts.endDate) }

  const where = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : ''

  const countRow = getDb().prepare(`SELECT COUNT(*) as cnt FROM user_activity_logs al ${where}`).get(...params) as { cnt: number }

  const limit = opts.limit || 50
  const offset = opts.offset || 0

  // 정렬 컬럼 화이트리스트
  const validSortColumns = ['created_at', 'category', 'action', 'user_name']
  const sortBy = validSortColumns.includes(opts.sortBy || '') ? opts.sortBy : 'created_at'
  const sortOrder = opts.sortOrder === 'ASC' ? 'ASC' : 'DESC'

  // user_name 정렬 시 JOIN된 컬럼 사용
  const orderColumn = sortBy === 'user_name' ? 'u.name' : `al.${sortBy}`

  const rows = getDb().prepare(`
    SELECT al.*, u.name as user_name, u.email as user_email
    FROM user_activity_logs al LEFT JOIN users u ON al.user_id = u.id
    ${where}
    ORDER BY ${orderColumn} ${sortOrder} LIMIT ? OFFSET ?
  `).all(...params, limit, offset) as any[]

  return { logs: rows.map(mapActivityLog), total: countRow.cnt }
}

/**
 * 되돌림 — 진행 막대 칸(1 유입 · 2 처리 · 3 검증 · 4 확인 · 5 완료) 사이를 뒤로 간 이동과 횟수.
 * 예: 검증 반려 3→2, 유입 전환 3→1, 확인 실패(에이전트) 4→2, 재검증 요청 4→3, 재오픈 5→4
 */
export interface IssueBackMove { from: number; to: number; count: number }
export type IssueRetryCounts = IssueBackMove[]

export interface IssueForwardCounts {
  toProcess: number   // 유입→처리 진입 횟수 (execution 행 수로 집계)
  toVerify: number    // 처리→검증 (task_complete)
  toConfirm: number   // 검증→확인
  toDone: number      // 확인→완료
}

type IterationCounts = { forward: IssueForwardCounts; retry: IssueRetryCounts }

const emptyCounts = (): IterationCounts => ({
  forward: { toProcess: 0, toVerify: 0, toConfirm: 0, toDone: 0 },
  retry: [],
})

/** 단계 → 진행 막대의 칸(1 유입 · 2 처리 · 3 검증 · 4 확인 · 5 완료). StageProgress 의 STAGE_TO_MACRO 와 같다. */
const STAGE_MACRO: Record<string, number> = {
  waiting: 2, dev: 2, dev_fail: 2,
  verify_waiting: 3, verifying: 3,
  confirm_waiting: 4, confirming: 4,
  done: 5, closed: 5,
}
const macroOf = (s: string | null) => (s ? STAGE_MACRO[s] ?? 0 : 1)

/** 칸 이동(from → to)을 정/역방향 횟수에 더한다. 같은 칸 안의 이동(처리 중 ↔ 처리 실패 등)은 세지 않는다. */
function addMove(c: IterationCounts, from: number, to: number, n: number) {
  if (!from || !to || from === to) return
  if (from === 3 && to === 4) c.forward.toConfirm += n
  else if (from === 4 && to === 5) c.forward.toDone += n
  else if (to < from) {
    const m = c.retry.find(x => x.from === from && x.to === to)
    if (m) m.count += n
    else c.retry.push({ from, to, count: n })
  }
}

/** 「단계 없음」 순간을 사이에 둔 두 단계 기록을 한 이동으로 합치는 최대 간격 */
const LABEL_GAP_MERGE_MS = 5 * 60_000

/** 사건 로그가 생기기 전 활동 로그 action → 칸 이동 */
const LEGACY_ACTION_MOVE: Record<string, [number, number]> = {
  task_approve: [3, 4], task_accept: [4, 5],
  task_reject: [3, 2], task_to_inflow: [3, 1], task_return_to_dev: [4, 3], task_reopen: [5, 4],
}

/**
 * 이슈별 정/역방향 횟수 — 진행 막대의 커넥터·되돌림 화살표.
 *
 * 단계 이동은 사건 로그(issue_events)의 단계 전이(출발 → 도착 단계)로 센다. 화면 버튼·단계 작업자(에이전트 검증·확인)·
 * 스캐너가 감지한 라벨 이동이 모두 여기에 남기 때문이다(활동 로그는 화면 버튼만 남겨 에이전트 반려가 빠졌다).
 * 사건 로그가 생기기 전 기록은 그 이슈의 첫 단계 사건 이전 활동 로그로 보충한다 — 이후 구간은 화면 버튼이 양쪽에 남기므로 세지 않는다.
 * 처리 진입(toProcess)·검증 진입(toVerify)은 처리 실행 행으로 센다.
 */
function getIterationCounts(projectId: string, issueIid?: number): Map<number, IterationCounts> {
  const db = getDb()
  const result = new Map<number, IterationCounts>()
  const entry = (iid: number) => {
    let e = result.get(iid)
    if (!e) { e = emptyCounts(); result.set(iid, e) }
    return e
  }
  const iidFilter = issueIid != null ? 'AND issue_iid = ?' : ''
  const iidParam = issueIid != null ? [issueIid] : []

  const moves = db.prepare(
    `SELECT issue_iid, from_stage, to_stage, source, occurred_at FROM issue_events
     WHERE project_id = ? ${iidFilter} AND event = 'stage'
     ORDER BY issue_iid, id`
  ).all(projectId, ...iidParam) as Array<{ issue_iid: number; from_stage: string | null; to_stage: string | null; source: string; occurred_at: string }>
  for (let i = 0; i < moves.length; i++) {
    const r = moves[i], next = moves[i + 1]
    // 라벨 교체 도중의 순간 — 스캐너가 단계 라벨이 빈 이슈를 「단계 없음」으로 읽었고, 곧바로(1분 안에) IVE 가 같은 출발 단계에서
    // 옮긴 기록이 뒤따른다. 실제 이동이 아니므로 세지 않는다(예전에 떼기·붙이기를 따로 하던 때 남은 기록 — swapIssueLabels 로 막음)
    if (r.source === 'scanner' && r.to_stage == null && r.from_stage != null && next && next.issue_iid === r.issue_iid
      && next.from_stage === r.from_stage && new Date(next.occurred_at).getTime() - new Date(r.occurred_at).getTime() < 60_000) continue
    // 라벨 교체 도중에 읽힌 「단계 없음」을 사이에 둔 두 기록(A → 없음, 없음 → B)은 실제로는 A → B 한 번의 이동이다.
    // 둘로 세면 「A → 유입」 되돌림이 생기고 정방향 이동은 빠진다. 간격은 스캔 주기를 넘길 수 있어 넉넉히 잡는다.
    if (r.source === 'scanner' && r.to_stage == null && r.from_stage != null && next && next.issue_iid === r.issue_iid
      && next.from_stage == null && next.to_stage != null && new Date(next.occurred_at).getTime() - new Date(r.occurred_at).getTime() < LABEL_GAP_MERGE_MS) {
      addMove(entry(r.issue_iid), macroOf(r.from_stage), macroOf(next.to_stage), 1)
      i++
      continue
    }
    addMove(entry(r.issue_iid), macroOf(r.from_stage), macroOf(r.to_stage), 1)
  }

  const prefix = `${projectId}:`
  const legacy = db.prepare(
    `SELECT al.target_id, al.action, COUNT(*) AS cnt FROM user_activity_logs al
     WHERE al.target_type = 'issue' AND ${issueIid != null ? 'al.target_id = ?' : 'al.target_id LIKE ?'}
       AND al.action IN (${Object.keys(LEGACY_ACTION_MOVE).map(() => '?').join(', ')})
       AND al.created_at < COALESCE((
         SELECT datetime(MIN(e.occurred_at)) FROM issue_events e
         WHERE e.project_id = ? AND e.event = 'stage'
           AND e.issue_iid = CAST(substr(al.target_id, ?) AS INTEGER)
       ), '9999')
     GROUP BY al.target_id, al.action`
  ).all(
    issueIid != null ? `${prefix}${issueIid}` : `${prefix}%`, ...Object.keys(LEGACY_ACTION_MOVE),
    projectId, prefix.length + 1,
  ) as Array<{ target_id: string; action: string; cnt: number }>
  for (const r of legacy) {
    const iid = Number(r.target_id.slice(prefix.length))
    const move = LEGACY_ACTION_MOVE[r.action]
    if (!Number.isFinite(iid) || !move) continue
    addMove(entry(iid), move[0], move[1], r.cnt)
  }

  // toProcess: 전체 dev execution 수
  // toVerify: 검증 단계로 넘어간 dev execution 수 (verify_started_at 가 채워진 것)
  // 처리 실행만 — 검증·확인 기록, AI 채팅, 충돌 해결, 재현 실행은 처리 횟수가 아니다(보고서의 처리 실행 판정과 같다)
  const DEV_FILTER = "id NOT LIKE 'ex-verify-%' AND id NOT LIKE 'ex-confirm-%' AND id NOT LIKE 'exec-chat-%' AND id NOT LIKE 'ex-conflict%' AND id NOT LIKE 'ex-reproduce-%'"
  const execRows = db.prepare(
    `SELECT issue_iid,
            COUNT(*) AS total,
            SUM(CASE WHEN verify_started_at IS NOT NULL THEN 1 ELSE 0 END) AS verified
     FROM task_executions
     WHERE project_id = ? ${iidFilter} AND ${DEV_FILTER}
     GROUP BY issue_iid`
  ).all(projectId, ...iidParam) as Array<{ issue_iid: number; total: number; verified: number }>
  for (const r of execRows) {
    const e = entry(r.issue_iid)
    e.forward.toProcess = r.total ?? 0
    e.forward.toVerify = r.verified ?? 0
  }
  return result
}

/** 각 단계로 진입한 횟수 — 정방향 화살표에 표시. */
export function getIssueForwardCounts(projectId: string, issueIid: number): IssueForwardCounts {
  return (getIterationCounts(projectId, issueIid).get(issueIid) ?? emptyCounts()).forward
}

/** 이슈의 단계별 되돌림 횟수 — 되돌림 화살표에 표시. */
export function getIssueRetryCounts(projectId: string, issueIid: number): IssueRetryCounts {
  return (getIterationCounts(projectId, issueIid).get(issueIid) ?? emptyCounts()).retry
}

/**
 * 프로젝트 전체 이슈에 대한 정/역방향 카운트를 한 번에 가져온다 (목록 화면용).
 * 개별 호출(getIssueForwardCounts/getIssueRetryCounts)은 N+1 문제를 일으키므로 사용 금지.
 */
export function getIssueIterationCountsMap(projectId: string): Map<number, IterationCounts> {
  return getIterationCounts(projectId)
}

export function cleanOldActivityLogs(retentionDays: number = 90) {
  const cutoff = new Date(Date.now() - retentionDays * 86400000).toISOString()
  const result = getDb().prepare('DELETE FROM user_activity_logs WHERE created_at < ?').run(cutoff)
  if (result.changes > 0) {
    console.log(`[Cleanup] Purged ${result.changes} activity logs (retention: ${retentionDays}d)`)
  }
}
