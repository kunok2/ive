/**
 * 보고서 모델용 DB 조회. 보고서 조회 중에는 Git 을 호출하지 않는다(DB 만).
 * 범위(scope): 사용자 id 면 그 사람이 소유하거나 공유받은 프로젝트, null 이면 전체.
 */
import {
  getDb, getExecutionsInRange, getGlobalExecutionsInRange, getIssuesStartedInRange, getIssuesCompletedInRange,
  getGlobalIssuesStartedInRange, getGlobalIssuesCompletedInRange, resolvePersonAlias, type ReportExecution,
} from '../db'
import { kstDayStartISO } from './period'
import type { HeldStage } from './types'

export type Scope = string | null

export interface ScopedProject { id: string; name: string; color: string; provider: string }

export function scopedProjects(scope: Scope): ScopedProject[] {
  const rows = scope
    ? getDb().prepare(`
        SELECT id, name, color, provider FROM projects p
        WHERE p.user_id = ? OR EXISTS (SELECT 1 FROM project_shares ps WHERE ps.project_id = p.id AND ps.user_id = ?)
        ORDER BY name`).all(scope, scope)
    : getDb().prepare(`SELECT id, name, color, provider FROM projects ORDER BY name`).all()
  return (rows as any[]).map(r => ({ id: r.id, name: r.name, color: r.color || '', provider: r.provider }))
}

export function execsInRange(scope: Scope, start: string, end: string): ReportExecution[] {
  return scope ? getExecutionsInRange(scope, start, end) : getGlobalExecutionsInRange(start, end)
}

export function startedInRange(scope: Scope, start: string, end: string): Map<string, string> {
  return scope ? getIssuesStartedInRange(scope, start, end) : getGlobalIssuesStartedInRange(start, end)
}

export function completedInRange(scope: Scope, start: string, end: string): Map<string, string> {
  return scope ? getIssuesCompletedInRange(scope, start, end) : getGlobalIssuesCompletedInRange(start, end)
}

/** 한 이슈의 실행 기록(전 기간) — 처리 횟수·반려·처리 종료 시각·모델·사람을 판정한다 */
export interface IssueExec {
  id: string
  agentId: string | null
  assigneeType: string | null
  status: string
  startedAt: string
  endedAt: string | null
  verifiedAt: string | null
  rejectedAt: string | null
  modelName: string | null
  cliName: string | null
  userId: string | null
  userName: string | null
  issueCreatedAt: string | null
  verifierName: string | null
  verifierUserId: string | null
  verifierUsername: string | null
}

export interface IssueFacts {
  key: string
  projectId: string
  iid: number
  title: string | null
  scheduledAt: string | null
  confirmedAt: string | null
  execs: IssueExec[]
}

/** 이슈 키 목록('pid:iid')의 실행 기록과 단계 정보 */
export function issueFacts(keys: string[]): Map<string, IssueFacts> {
  const out = new Map<string, IssueFacts>()
  if (keys.length === 0) return out
  const byProject = new Map<string, number[]>()
  for (const k of keys) {
    const i = k.lastIndexOf(':')
    const pid = k.slice(0, i), iid = Number(k.slice(i + 1))
    const list = byProject.get(pid) ?? []
    list.push(iid)
    byProject.set(pid, list)
  }
  const db = getDb()
  for (const [pid, iids] of byProject) {
    for (let off = 0; off < iids.length; off += 400) {
      const chunk = iids.slice(off, off + 400)
      const ph = chunk.map(() => '?').join(',')
      const stages = db.prepare(`
        SELECT issue_iid, issue_title, scheduled_at, confirmed_at FROM issue_stages WHERE project_id = ? AND issue_iid IN (${ph})
      `).all(pid, ...chunk) as any[]
      const stageMap = new Map(stages.map(s => [s.issue_iid, s]))
      const execs = db.prepare(`
        SELECT te.id, te.issue_iid, te.agent_id, te.assignee_type, te.status, te.started_at, te.ended_at, te.verified_at, te.rejected_at,
               te.model_name, a.cli_name, te.user_id, te.user_name, te.issue_created_at, te.issue_title,
               te.verifier_name, te.verifier_user_id, te.verifier_username
        FROM task_executions te LEFT JOIN agents a ON a.id = te.agent_id
        WHERE te.project_id = ? AND te.issue_iid IN (${ph})
        ORDER BY te.started_at ASC
      `).all(pid, ...chunk) as any[]
      for (const iid of chunk) {
        const st = stageMap.get(iid)
        out.set(`${pid}:${iid}`, {
          key: `${pid}:${iid}`, projectId: pid, iid,
          title: st?.issue_title ?? null, scheduledAt: st?.scheduled_at ?? null, confirmedAt: st?.confirmed_at ?? null,
          execs: [],
        })
      }
      for (const e of execs) {
        const f = out.get(`${pid}:${e.issue_iid}`)
        if (!f) continue
        if (!f.title && e.issue_title) f.title = e.issue_title
        f.execs.push({
          id: e.id, agentId: e.agent_id || null, assigneeType: e.assignee_type ?? null, status: e.status,
          startedAt: e.started_at, endedAt: e.ended_at, verifiedAt: e.verified_at, rejectedAt: e.rejected_at,
          modelName: e.model_name || null, cliName: e.cli_name || null, userId: e.user_id || null, userName: e.user_name || null,
          issueCreatedAt: e.issue_created_at || null, verifierName: e.verifier_name || null,
          verifierUserId: e.verifier_user_id || null, verifierUsername: e.verifier_username || null,
        })
      }
    }
  }
  return out
}

// ─── 지금 보유 ───

export interface HeldRow {
  projectId: string
  iid: number
  title: string | null
  stage: HeldStage
  assignMode: string | null
  assigneeUsername: string | null
  assigneeName: string | null
  assigneeGitUserId: string | null
  confirmerName: string | null
  confirmerUserId: string | null
  presetVerifierMode: string | null
  presetConfirmerMode: string | null
  receivedAt: string | null
  /** 처리 중이면 그 실행의 담당 유형('user'면 사람이 처리 중) */
  activeAssigneeType: string | null
  activeUserId: string | null
  activeUserName: string | null
}

export function heldNow(projectIds: string[]): HeldRow[] {
  if (projectIds.length === 0) return []
  const ph = projectIds.map(() => '?').join(',')
  const rows = getDb().prepare(`
    SELECT s.project_id, s.issue_iid, s.issue_title, s.cached_stage, s.assign_mode,
           s.assignee_username, s.assignee_name, s.assignee_git_user_id, s.confirmer_name, s.confirmer_user_id,
           s.preset_verifier_mode, s.preset_confirmer_mode,
           COALESCE(s.scheduled_at, (SELECT MIN(te.started_at) FROM task_executions te WHERE te.project_id = s.project_id AND te.issue_iid = s.issue_iid)) AS received_at,
           (SELECT te.assignee_type FROM task_executions te WHERE te.project_id = s.project_id AND te.issue_iid = s.issue_iid
              AND te.status IN ('running','assigned') AND te.id NOT LIKE 'ex-verify-%' AND te.id NOT LIKE 'ex-confirm-%' ORDER BY te.started_at DESC LIMIT 1) AS active_type,
           (SELECT te.user_id FROM task_executions te WHERE te.project_id = s.project_id AND te.issue_iid = s.issue_iid
              AND te.status IN ('running','assigned') AND te.id NOT LIKE 'ex-verify-%' AND te.id NOT LIKE 'ex-confirm-%' ORDER BY te.started_at DESC LIMIT 1) AS active_user_id,
           (SELECT te.user_name FROM task_executions te WHERE te.project_id = s.project_id AND te.issue_iid = s.issue_iid
              AND te.status IN ('running','assigned') AND te.id NOT LIKE 'ex-verify-%' AND te.id NOT LIKE 'ex-confirm-%' ORDER BY te.started_at DESC LIMIT 1) AS active_user_name
    FROM issue_stages s
    WHERE s.project_id IN (${ph})
      AND s.cached_stage IN ('waiting','dev','dev_fail','verify_waiting','verifying','confirm_waiting','confirming')
  `).all(...projectIds) as any[]
  return rows.map(r => ({
    projectId: r.project_id, iid: r.issue_iid, title: r.issue_title ?? null, stage: r.cached_stage,
    assignMode: r.assign_mode ?? null, assigneeUsername: r.assignee_username ?? null, assigneeName: r.assignee_name ?? null,
    assigneeGitUserId: r.assignee_git_user_id ?? null, confirmerName: r.confirmer_name ?? null, confirmerUserId: r.confirmer_user_id ?? null,
    presetVerifierMode: r.preset_verifier_mode ?? null, presetConfirmerMode: r.preset_confirmer_mode ?? null,
    receivedAt: r.received_at ?? null, activeAssigneeType: r.active_type ?? null,
    activeUserId: r.active_user_id ?? null, activeUserName: r.active_user_name ?? null,
  }))
}

// ─── 하루 마감 보유 ───

export interface HeldDayRow { projectId: string; date: string; total: number }

/** 날짜 범위(포함·미포함)의 프로젝트별 하루 마감 보유 합계 */
export function heldDaily(projectIds: string[], fromDay: string, toDay: string): HeldDayRow[] {
  if (projectIds.length === 0) return []
  const ph = projectIds.map(() => '?').join(',')
  const rows = getDb().prepare(`
    SELECT project_id, date, waiting + dev + dev_fail + verify_waiting + verifying + confirm_waiting + confirming AS total
    FROM held_daily WHERE project_id IN (${ph}) AND date >= ? AND date < ?
  `).all(...projectIds, fromDay, toDay) as any[]
  return rows.map(r => ({ projectId: r.project_id, date: r.date, total: r.total }))
}

/** 보유 기록이 처음 시작된 날짜(전체). 없으면 null */
export function heldTrackingSince(): string | null {
  const r = getDb().prepare(`SELECT MIN(date) AS d FROM held_daily`).get() as { d: string | null } | undefined
  return r?.d ?? null
}

// ─── 뒤집힘 근거(사건 로그) ───

/** 완료 후 다시 열렸거나(단계 사건) 후속 이슈가 고친(연결) 이슈 키 집합 */
export function overturnedKeys(projectIds: string[], sinceISO: string): Set<string> {
  const out = new Set<string>()
  if (projectIds.length === 0) return out
  const ph = projectIds.map(() => '?').join(',')
  const links = getDb().prepare(`
    SELECT ref_project_id, ref_issue_iid FROM issue_events
    WHERE event = 'link' AND reason = 'fixes' AND ref_project_id IN (${ph}) AND occurred_at >= ?
  `).all(...projectIds, sinceISO) as any[]
  for (const l of links) out.add(`${l.ref_project_id}:${l.ref_issue_iid}`)
  const reopens = getDb().prepare(`
    SELECT project_id, issue_iid FROM issue_events
    WHERE event = 'stage' AND from_stage IN ('done','closed') AND to_stage IS NOT NULL AND to_stage NOT IN ('done','closed')
      AND project_id IN (${ph}) AND occurred_at >= ?
  `).all(...projectIds, sinceISO) as any[]
  for (const r of reopens) out.add(`${r.project_id}:${r.issue_iid}`)
  return out
}

// ─── 사람 식별 ───

const personCache = new Map<string, { key: string; name: string }>()

/** 사람 → 통합 키·표시 이름. IVE 사용자 id 가 있으면 그것, 없으면 별칭표, 그래도 없으면 이름 자체. */
export function personOf(userId: string | null | undefined, name: string | null | undefined, gitUsername?: string | null): { key: string; name: string } | null {
  const ck = `${userId ?? ''}|${name ?? ''}|${gitUsername ?? ''}`
  const cached = personCache.get(ck)
  if (cached) return cached
  let id: string | null = null
  if (userId) {
    const u = getDb().prepare('SELECT id FROM users WHERE id = ?').get(userId) as { id: string } | undefined
    id = u?.id ?? null
    if (!id) {
      // 실행 행의 user_id 가 Git 숫자 id 인 경로(담당자 처리)
      const g = getDb().prepare('SELECT id FROM users WHERE oauth_user_id = ? LIMIT 1').get(userId) as { id: string } | undefined
      id = g?.id ?? null
    }
  }
  // 사용자 표에서 바로 찾는다(별칭표는 기동 때 채워지므로 그 뒤 가입한 사람은 아직 없을 수 있다)
  if (!id && gitUsername) {
    const g = getDb().prepare(`SELECT id FROM users WHERE gitlab_username = ? COLLATE NOCASE OR github_username = ? COLLATE NOCASE LIMIT 1`).get(gitUsername, gitUsername) as { id: string } | undefined
    id = g?.id ?? resolvePersonAlias(gitUsername)
  }
  if (!id && name) {
    // 표시 이름이 겹치면 누구인지 정할 수 없으므로 한 명일 때만
    const rows = getDb().prepare(`SELECT id FROM users WHERE TRIM(name) = TRIM(?) LIMIT 2`).all(name) as { id: string }[]
    id = rows.length === 1 ? rows[0].id : resolvePersonAlias(name)
  }
  let result: { key: string; name: string } | null = null
  if (id) {
    const u = getDb().prepare('SELECT name FROM users WHERE id = ?').get(id) as { name: string } | undefined
    result = { key: `u:${id}`, name: u?.name || name || gitUsername || id }
  } else if (name || gitUsername) {
    const n = (name || gitUsername)!.trim()
    result = { key: `n:${n.toLowerCase()}`, name: n }
  }
  if (result) personCache.set(ck, result)
  return result
}

/** 테스트·요청 사이에 별칭이 바뀔 수 있으므로 요청마다 비운다 */
export function resetPersonCache(): void { personCache.clear() }

export function dayStartISO(day: string): string { return kstDayStartISO(day) }

/**
 * 기간 안에 접수된 이슈 → 접수 시각.
 * 접수 = 스케줄 라벨을 처음 본 시각(scheduled_at)과 첫 실행 시각 중 이른 것.
 * 종전 보고서는 "첫 실행"만 유입으로 셌기 때문에 아직 시작하지 않은 대기 이슈가 유입에서 빠져
 * 기초 + 유입 − 완료 = 기말 이 맞지 않았다.
 */
export function receivedInRange(projectIds: string[], startDay: string, endDay: string): Map<string, string> {
  const out = new Map<string, string>()
  if (projectIds.length === 0) return out
  const ph = projectIds.map(() => '?').join(',')
  const rows = getDb().prepare(`
    SELECT project_id, issue_iid, MIN(t) AS received FROM (
      SELECT project_id, issue_iid, scheduled_at AS t FROM issue_stages
        WHERE scheduled_at IS NOT NULL AND scheduled_at <> '' AND project_id IN (${ph})
      UNION ALL
      SELECT project_id, issue_iid, MIN(started_at) AS t FROM task_executions
        WHERE project_id IN (${ph}) AND issue_iid > 0
          AND id NOT LIKE 'ex-verify-%' AND id NOT LIKE 'ex-confirm-%' AND id NOT LIKE 'exec-chat%'
        GROUP BY project_id, issue_iid
    ) GROUP BY project_id, issue_iid
    HAVING received >= ? AND received < ?
  `).all(...projectIds, ...projectIds, kstDayStartISO(startDay), kstDayStartISO(endDay)) as any[]
  for (const r of rows) out.set(`${r.project_id}:${r.issue_iid}`, r.received)
  return out
}

/** 기간 안에 검증 판정(승인·반려)을 내린 검증 실행 */
export interface VerifyDecision { projectId: string; iid: number; userId: string | null; userName: string | null; username: string | null; approvedAt: string | null; rejectedAt: string | null }

export function verifyDecisions(projectIds: string[], startISO: string, endISO: string): VerifyDecision[] {
  if (projectIds.length === 0) return []
  const ph = projectIds.map(() => '?').join(',')
  const rows = getDb().prepare(`
    SELECT project_id, issue_iid, user_id, user_name, verifier_username, verified_at, rejected_at, ended_at, status
    FROM task_executions
    WHERE id LIKE 'ex-verify-%' AND project_id IN (${ph})
      AND COALESCE(verified_at, rejected_at, ended_at) >= ? AND COALESCE(verified_at, rejected_at, ended_at) < ?
      AND status IN ('success','failed')
  `).all(...projectIds, startISO, endISO) as any[]
  return rows.map(r => ({
    projectId: r.project_id, iid: r.issue_iid, userId: r.user_id || null, userName: r.user_name || null, username: r.verifier_username || null,
    approvedAt: r.verified_at || (r.status === 'success' && !r.rejected_at ? r.ended_at : null),
    rejectedAt: r.rejected_at || (r.status === 'failed' ? r.ended_at : null),
  }))
}

/** 이슈들의 확인 반려 시각(확인 실행이 실패로 끝난 시각) */
export function confirmRejections(projectIds: string[], sinceISO: string): Map<string, string[]> {
  const out = new Map<string, string[]>()
  if (projectIds.length === 0) return out
  const ph = projectIds.map(() => '?').join(',')
  const rows = getDb().prepare(`
    SELECT project_id, issue_iid, COALESCE(rejected_at, ended_at) AS at FROM task_executions
    WHERE id LIKE 'ex-confirm-%' AND project_id IN (${ph}) AND (rejected_at IS NOT NULL OR status = 'failed')
      AND COALESCE(rejected_at, ended_at) >= ?
  `).all(...projectIds, sinceISO) as any[]
  for (const r of rows) {
    const k = `${r.project_id}:${r.issue_iid}`
    const list = out.get(k) ?? []
    if (r.at) list.push(r.at)
    out.set(k, list)
  }
  return out
}
