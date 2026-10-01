/**
 * 프로젝트 역할 명부(roster) — 「누가 어떤 역할(처리·검증·확인)을 할 수 있는가」.
 *
 * 대상은 사람(프로젝트 Git 멤버 username) 또는 에이전트(agents.id).
 *   - Git 멤버는 동기화 때 검증 역할로 자동 등록된다(source='sync'). 멤버가 빠지면 줄도 빠진다.
 *   - 사람이 역할을 바꾸면 source='manual' 이 되어 동기화가 더 이상 손대지 않는다.
 *     역할을 전부 끈 사람 줄은 "명시적 제외" 기록으로 남아, 다음 동기화에서 다시 들어오지 않는다.
 *   - 에이전트 줄은 역할을 전부 끄면 지운다(동기화 대상이 아니므로 제외 기록이 필요 없다).
 */
import { getDb } from './connection'

export type RoleKey = 'process' | 'verify' | 'confirm'
export type RosterSubjectType = 'user' | 'agent'

export interface RosterEntry {
  subjectType: RosterSubjectType
  subjectId: string          // user: Git username / agent: agents.id
  gitUserId: string | null
  name: string
  avatar: string
  roles: Record<RoleKey, boolean>
  /** 사람: 이 프로젝트에서 그 역할을 할 때의 단가 배수 (기본 단가 × 배수, 기본 1). 에이전트는 AI 토큰 비용이라 없다 */
  rates?: Record<RoleKey, number>
  source: 'sync' | 'manual'
  // 에이전트일 때
  cliName?: string | null
  ownerUserId?: string | null
  enabled?: boolean
}

const ROLE_COL: Record<RoleKey, string> = {
  process: 'can_process',
  verify: 'can_verify',
  confirm: 'can_confirm',
}

function mapRow(r: any): RosterEntry {
  return {
    subjectType: r.subject_type,
    subjectId: r.subject_id,
    gitUserId: r.git_user_id ?? null,
    name: r.agent_name ?? (r.name || r.subject_id),
    avatar: r.agent_avatar ?? (r.avatar || 'av-01'),
    roles: { process: !!r.can_process, verify: !!r.can_verify, confirm: !!r.can_confirm },
    source: r.source,
    ...(r.subject_type === 'user' ? {
      rates: { process: r.rate_process ?? 1, verify: r.rate_verify ?? 1, confirm: r.rate_confirm ?? 1 },
    } : {}),
    ...(r.subject_type === 'agent' ? {
      cliName: r.agent_cli ?? null,
      ownerUserId: r.agent_owner ?? null,
      enabled: r.agent_enabled == null ? false : !!r.agent_enabled,
    } : {}),
  }
}

const SELECT_ROSTER = `
  SELECT m.*, a.name as agent_name, a.avatar as agent_avatar, a.cli_name as agent_cli,
    a.user_id as agent_owner, a.enabled as agent_enabled
  FROM project_role_members m
  LEFT JOIN agents a ON m.subject_type = 'agent' AND a.id = m.subject_id
`

/** 명부 전체 (역할을 모두 끈 제외 줄 포함). 삭제된 에이전트 줄은 뺀다. */
export function getRoster(projectId: string): RosterEntry[] {
  const rows = getDb().prepare(`${SELECT_ROSTER}
    WHERE m.project_id = ? AND (m.subject_type = 'user' OR a.id IS NOT NULL)
    ORDER BY m.subject_type DESC, m.name COLLATE NOCASE`).all(projectId) as any[]
  return rows.map(mapRow)
}

/** 그 역할을 가진 대상만 */
export function getRoleCandidates(projectId: string, role: RoleKey): RosterEntry[] {
  const rows = getDb().prepare(`${SELECT_ROSTER}
    WHERE m.project_id = ? AND m.${ROLE_COL[role]} = 1 AND (m.subject_type = 'user' OR a.id IS NOT NULL)
    ORDER BY m.subject_type DESC, m.name COLLATE NOCASE`).all(projectId) as any[]
  return rows.map(mapRow)
}

export function hasRole(projectId: string, role: RoleKey, subjectType: RosterSubjectType, subjectId: string): boolean {
  const r = getDb().prepare(
    `SELECT 1 FROM project_role_members WHERE project_id = ? AND subject_type = ? AND subject_id = ? AND ${ROLE_COL[role]} = 1`
  ).get(projectId, subjectType, subjectId)
  return !!r
}

/**
 * 에이전트가 이 프로젝트에서 그 역할을 더는 못 하게 됐을 때(명부에서 역할 끔·빠짐, 소유자 편집 권한 상실)
 * 아직 끝나지 않은 이슈의 검증자·확인자 배정을 사람 기본값으로 되돌린다 — 아무도 맡지 않은 채 멈추지 않도록.
 * 처리자 배정은 건드리지 않는다: 처리 에이전트는 명부와 무관하게 의뢰자 본인의 풀에서도 고를 수 있고(기존 기능),
 * 쓸 수 없게 된 처리 에이전트는 스캐너가 이유를 남기고 기다린다. 프로젝트 기본 배정의 처리자만 지운다.
 */
export function releaseAgentFromProject(projectId: string, agentId: string, roles: Partial<Record<RoleKey, boolean>> = { process: true, verify: true, confirm: true }) {
  const db = getDb()
  const open = "COALESCE(cached_stage, '') != 'done'"
  if (roles.verify) db.prepare(`UPDATE issue_stages SET preset_verifier_mode = 'creator', preset_verifier_agent_id = NULL
    WHERE project_id = ? AND preset_verifier_mode = 'agent' AND preset_verifier_agent_id = ? AND ${open}`).run(projectId, agentId)
  if (roles.confirm) db.prepare(`UPDATE issue_stages SET preset_confirmer_mode = 'creator', preset_confirmer_agent_id = NULL
    WHERE project_id = ? AND preset_confirmer_mode = 'agent' AND preset_confirmer_agent_id = ? AND ${open}`).run(projectId, agentId)

  // 프로젝트 기본 배정에 남아 있으면 지운다(남아 있으면 다음 이슈에 또 배정되고, 설정 저장도 막힌다)
  const row = db.prepare('SELECT default_roles FROM project_automation WHERE project_id = ?').get(projectId) as { default_roles: string } | undefined
  if (row) {
    let d: any = {}
    try { d = JSON.parse(row.default_roles || '{}') } catch { d = {} }
    let changed = false
    // IVE 등록 기본 배정과 접수 경로 기본 배정(intake) 모두에서
    for (const t of [d, d.intake].filter(Boolean)) {
      if (roles.process && t.processor?.mode === 'agent' && t.processor.agentId === agentId) { t.processor = null; changed = true }
      if (roles.verify && t.verifier?.mode === 'agent' && t.verifier.agentId === agentId) { t.verifier = null; changed = true }
      if (roles.confirm && t.confirmer?.mode === 'agent' && t.confirmer.agentId === agentId) { t.confirmer = null; changed = true }
    }
    if (changed) db.prepare('UPDATE project_automation SET default_roles = ? WHERE project_id = ?').run(JSON.stringify(d), projectId)
  }
}

/** 명부 줄 저장. 사람이 바꾼 줄은 manual 로 고정된다. */
export function setRosterEntry(
  projectId: string,
  entry: { subjectType: RosterSubjectType; subjectId: string; gitUserId?: string | null; name?: string; avatar?: string; roles: Record<RoleKey, boolean> },
  updatedBy: string | null,
) {
  const db = getDb()
  const none = !entry.roles.process && !entry.roles.verify && !entry.roles.confirm
  // 에이전트가 맡던 역할을 끄면(켜져 있다가 꺼진 역할만), 그 역할로 배정돼 있던 진행 중 이슈는 사람 기본값으로
  if (entry.subjectType === 'agent') {
    const prev = db.prepare(`SELECT can_process, can_verify, can_confirm FROM project_role_members
      WHERE project_id = ? AND subject_type = 'agent' AND subject_id = ?`).get(projectId, entry.subjectId) as { can_process: number; can_verify: number; can_confirm: number } | undefined
    if (prev) {
      releaseAgentFromProject(projectId, entry.subjectId, {
        process: !!prev.can_process && !entry.roles.process,
        verify: !!prev.can_verify && !entry.roles.verify,
        confirm: !!prev.can_confirm && !entry.roles.confirm,
      })
    }
  }
  if (entry.subjectType === 'agent' && none) {
    db.prepare(`DELETE FROM project_role_members WHERE project_id = ? AND subject_type = 'agent' AND subject_id = ?`)
      .run(projectId, entry.subjectId)
    return
  }
  db.prepare(`
    INSERT INTO project_role_members (project_id, subject_type, subject_id, git_user_id, name, avatar,
      can_process, can_verify, can_confirm, source, updated_by, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'manual', ?, datetime('now'))
    ON CONFLICT(project_id, subject_type, subject_id) DO UPDATE SET
      git_user_id = COALESCE(excluded.git_user_id, project_role_members.git_user_id),
      name = CASE WHEN excluded.name != '' THEN excluded.name ELSE project_role_members.name END,
      avatar = CASE WHEN excluded.avatar != '' THEN excluded.avatar ELSE project_role_members.avatar END,
      can_process = excluded.can_process, can_verify = excluded.can_verify, can_confirm = excluded.can_confirm,
      source = 'manual', updated_by = excluded.updated_by, updated_at = datetime('now')
  `).run(
    projectId, entry.subjectType, entry.subjectId, entry.gitUserId ?? null, entry.name || '', entry.avatar || '',
    entry.roles.process ? 1 : 0, entry.roles.verify ? 1 : 0, entry.roles.confirm ? 1 : 0, updatedBy,
  )
}

/**
 * Git 멤버 동기화 결과를 명부에 반영한다 (replaceProjectMembers 와 같은 트랜잭션에서 호출).
 *   - 새 멤버: 검증 역할로 추가 (source='sync')
 *   - 빠진 멤버: sync 줄만 삭제 (manual 줄은 사람이 정한 것이므로 유지)
 *   - 남은 멤버: sync 줄의 표시 정보 갱신
 */
export function syncRosterWithMembers(
  projectId: string,
  members: { username: string; name: string; avatarUrl: string; gitUserId?: string | null }[],
) {
  const db = getDb()
  const usernames = members.map(m => m.username).filter(Boolean)
  const ins = db.prepare(`
    INSERT INTO project_role_members (project_id, subject_type, subject_id, git_user_id, name, avatar, can_verify, source)
    VALUES (?, 'user', ?, ?, ?, ?, 1, 'sync')
    ON CONFLICT(project_id, subject_type, subject_id) DO UPDATE SET
      git_user_id = COALESCE(excluded.git_user_id, project_role_members.git_user_id),
      name = CASE WHEN project_role_members.source = 'sync' THEN excluded.name ELSE project_role_members.name END,
      avatar = CASE WHEN project_role_members.source = 'sync' THEN excluded.avatar ELSE project_role_members.avatar END
  `)
  for (const m of members) {
    if (!m.username) continue
    ins.run(projectId, m.username, m.gitUserId ?? null, m.name || m.username, m.avatarUrl || '')
  }
  if (usernames.length > 0) {
    const ph = usernames.map(() => '?').join(',')
    db.prepare(`DELETE FROM project_role_members
      WHERE project_id = ? AND subject_type = 'user' AND source = 'sync' AND subject_id NOT IN (${ph})`)
      .run(projectId, ...usernames)
  }
}

/**
 * 에이전트의 현재 부하 — 「모든 단계 자동배정」에서 가장 한가한 에이전트를 고를 때 쓴다.
 *   실행 중인 작업 + 아직 끝나지 않은 이슈에 (처리·검증·확인 어느 역할로든) 배정된 수.
 */
export function getAgentRoleLoad(agentId: string): number {
  const db = getDb()
  const running = db.prepare(
    `SELECT COUNT(*) as c FROM task_executions WHERE agent_id = ? AND status = 'running'`
  ).get(agentId) as { c: number }
  const assigned = db.prepare(`
    SELECT COUNT(*) as c FROM issue_stages
    WHERE COALESCE(cached_stage, '') NOT IN ('done', '')
      AND ((assign_mode = 'agent' AND preferred_agent_id = ?)
        OR (preset_verifier_mode = 'agent' AND preset_verifier_agent_id = ?)
        OR (preset_confirmer_mode = 'agent' AND preset_confirmer_agent_id = ?))
  `).get(agentId, agentId, agentId) as { c: number }
  return running.c + assigned.c
}

/** 이 에이전트를 명부에 둔 프로젝트 id 목록 (에이전트 삭제·권한 확인용) */
export function getProjectsWithAgentInRoster(agentId: string): string[] {
  return (getDb().prepare(
    `SELECT DISTINCT project_id FROM project_role_members WHERE subject_type = 'agent' AND subject_id = ?`
  ).all(agentId) as { project_id: string }[]).map(r => r.project_id)
}

export interface AgentRoleSummary {
  /** 명부에서 이 에이전트가 그 역할을 가진 프로젝트 수 */
  roles: Record<RoleKey, number>
  /** 이 에이전트가 검증자·확인자로 지정된 이슈의 대기·진행 건수 */
  verifyWaiting: number
  verifying: number
  confirmWaiting: number
  confirming: number
}

export function getAgentRoleSummary(agentId: string): AgentRoleSummary {
  const db = getDb()
  const r = db.prepare(`
    SELECT SUM(can_process) as p, SUM(can_verify) as v, SUM(can_confirm) as c
    FROM project_role_members WHERE subject_type = 'agent' AND subject_id = ?
  `).get(agentId) as any
  const q = db.prepare(`
    SELECT
      SUM(CASE WHEN preset_verifier_mode = 'agent' AND preset_verifier_agent_id = ? AND cached_stage = 'verify_waiting' THEN 1 ELSE 0 END) as vw,
      SUM(CASE WHEN preset_verifier_mode = 'agent' AND preset_verifier_agent_id = ? AND cached_stage = 'verifying' THEN 1 ELSE 0 END) as vi,
      SUM(CASE WHEN preset_confirmer_mode = 'agent' AND preset_confirmer_agent_id = ? AND cached_stage = 'confirm_waiting' THEN 1 ELSE 0 END) as cw,
      SUM(CASE WHEN preset_confirmer_mode = 'agent' AND preset_confirmer_agent_id = ? AND cached_stage = 'confirming' THEN 1 ELSE 0 END) as ci
    FROM issue_stages
  `).get(agentId, agentId, agentId, agentId) as any
  return {
    roles: { process: Number(r?.p || 0), verify: Number(r?.v || 0), confirm: Number(r?.c || 0) },
    verifyWaiting: Number(q?.vw || 0), verifying: Number(q?.vi || 0),
    confirmWaiting: Number(q?.cw || 0), confirming: Number(q?.ci || 0),
  }
}

const RATE_COL: Record<RoleKey, string> = { process: 'rate_process', verify: 'rate_verify', confirm: 'rate_confirm' }

/**
 * 사람의 역할별 단가 배수 저장 (이 프로젝트에서 그 역할을 할 때). 명부에 있는 사람 줄만.
 * 바뀐 값은 단가 이력(rate_history, kind='multiplier', key=프로젝트:역할:사람)에도 남긴다.
 * @returns 저장했으면 true
 */
export function setRosterRates(projectId: string, subjectId: string, rates: Partial<Record<RoleKey, number>>, updatedBy: string | null): boolean {
  const db = getDb()
  const cur = db.prepare(`SELECT rate_process, rate_verify, rate_confirm FROM project_role_members
    WHERE project_id = ? AND subject_type = 'user' AND subject_id = ?`).get(projectId, subjectId) as any
  if (!cur) return false
  const now = new Date().toISOString()
  for (const k of Object.keys(rates) as RoleKey[]) {
    const v = rates[k]
    if (v == null || cur[RATE_COL[k]] === v) continue
    db.prepare(`UPDATE project_role_members SET ${RATE_COL[k]} = ?, updated_by = ?, updated_at = datetime('now')
      WHERE project_id = ? AND subject_type = 'user' AND subject_id = ?`).run(v, updatedBy, projectId, subjectId)
    db.prepare(`INSERT INTO rate_history (id, kind, key, input_price, output_price, meta, effective_from) VALUES (?, 'multiplier', ?, ?, 0, NULL, ?)
      ON CONFLICT(id) DO UPDATE SET input_price = excluded.input_price`)
      .run(`rh-multiplier-${projectId}:${k}:${subjectId}-${now}`, `${projectId}:${k}:${subjectId}`, v, now)
  }
  return true
}
