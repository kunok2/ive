import { Project } from '@/types'
import { getDb } from './connection'
import { getKSTTodayStartISO } from '../date-utils'
import { isBotName } from '../git-bot'
import { syncRosterWithMembers } from './roles'
import { DEFAULT_LABELS } from '@/lib/labels'
import { isIveManaged } from '@/lib/stage-transitions'

// ── Issue Stage (레이블 기반 상태 판정) ──

export type IssueStage = 'waiting' | 'verify_waiting' | 'dev' | 'dev_fail' | 'verifying' | 'confirm_waiting' | 'confirming' | 'done' | 'rejected'

export function stageFromLabels(
  labels: string[],
  project: Project,
  options?: { hasActiveExec?: boolean }
): IssueStage | null {
  // 대상 라벨(ive) 또는 단계 라벨이 있어야 IVE 관리 이슈 — 단계 라벨만 있어도 된다(붙일 때 ive 는 뗀다)
  if (!isIveManaged(labels, project)) return null

  const labelS = project.labelSchedule || DEFAULT_LABELS.schedule
  const labelD = project.labelDev || DEFAULT_LABELS.dev
  const labelW = project.labelVerifyWait || DEFAULT_LABELS.verifyWait
  const labelV = project.labelVerify || DEFAULT_LABELS.verify
  const labelP = project.labelConfirmWait || DEFAULT_LABELS.confirmWait
  const labelC = project.labelConfirm || DEFAULT_LABELS.confirm
  const labelE = project.labelEnd || DEFAULT_LABELS.end

  // 우선순위: E > C > P > V > W > D > S
  if (labels.includes(labelE)) return 'done'
  if (labels.includes(labelC)) return 'confirming'
  if (labels.includes(labelP)) return 'confirm_waiting'
  if (labels.includes(labelV)) return 'verifying'
  if (labels.includes(labelW)) return 'verify_waiting'
  if (labels.includes(labelD)) {
    if (options?.hasActiveExec === false) return 'dev_fail'
    return 'dev'
  }
  if (labels.includes(labelS)) return 'waiting'
  return null
}

export function getLastExecutionStatus(projectId: string, issueIid: number): string | null {
  const r = getDb().prepare(
    "SELECT status FROM task_executions WHERE project_id = ? AND issue_iid = ? ORDER BY started_at DESC LIMIT 1"
  ).get(projectId, issueIid) as any
  return r?.status || null
}

// 하위 호환을 위해 유지 (deprecated)
export function getIssueStage(_projectId: string, _issueIid: number): IssueStage | null { return null }
export function getIssueStageUpdatedAt(_projectId: string, _issueIid: number): string | null { return null }

export function getIssueScheduledAt(projectId: string, issueIid: number): string | null {
  const r = getDb().prepare('SELECT scheduled_at FROM issue_stages WHERE project_id = ? AND issue_iid = ?').get(projectId, issueIid) as any
  return r?.scheduled_at || null
}

export function getCachedStage(projectId: string, issueIid: number): string | null {
  const r = getDb().prepare('SELECT cached_stage FROM issue_stages WHERE project_id = ? AND issue_iid = ?').get(projectId, issueIid) as any
  return r?.cached_stage || null
}

/**
 * 오늘(KST 자정 이후) 특정 cached_stage 로 전이된 이슈 수.
 * 프로젝트 카드의 "완료(done)"/"반려(rejected)" 카운트 집계에 사용.
 *
 * ⚠️ datetime()로 양변을 정규화하는 것이 핵심이다. issue_stages.updated_at 은
 * datetime('now') 포맷('YYYY-MM-DD HH:MM:SS', 공백 구분)이고 todayStartISO 는
 * toISOString() 포맷('YYYY-MM-DDTHH:MM:SS.sssZ', 'T' 구분)이라, 날짜가 같은 행을
 * 단순 문자열 비교(updated_at >= todayStartISO)하면 공백(0x20) < 'T'(0x54) 때문에
 * 항상 false 가 된다. 그 결과 KST 자정~오전 09시(=UTC 같은 날짜) 사이 완료 건이
 * "오늘 완료"에서 누락되어 0 으로 표시되는 버그가 있었다(#448).
 */
export function countTodayStageTransitions(projectId: string, stage: string, todayStartISO: string): number {
  const r = getDb().prepare(`
    SELECT COUNT(*) as count FROM issue_stages
    WHERE project_id = ? AND cached_stage = ? AND datetime(updated_at) >= datetime(?)
  `).get(projectId, stage, todayStartISO) as any
  return r?.count ?? 0
}

/** 오늘 완료·반려로 바뀐 이슈 — 카드 「완료」 숫자(countTodayStageTransitions)와 같은 조건의 목록 */
export interface TodayDoneIssue {
  iid: number
  title: string
  stage: 'done' | 'rejected'
  at: string
  /** 마지막에 맡은 사람 — 확인자 > 담당자 */
  who: { name: string; avatar: string | null; userId: string | null } | null
}
export function listTodayDoneIssues(projectId: string, todayStartISO: string): TodayDoneIssue[] {
  const rows = getDb().prepare(`
    SELECT issue_iid AS iid, issue_title AS title, cached_stage AS stage, updated_at AS at,
           confirmer_name, confirmer_avatar, confirmer_user_id, assignee_name, assignee_avatar
    FROM issue_stages
    WHERE project_id = ? AND cached_stage IN ('done', 'rejected') AND datetime(updated_at) >= datetime(?)
    ORDER BY datetime(updated_at) DESC
  `).all(projectId, todayStartISO) as any[]
  return rows.map(r => ({
    // updated_at 은 datetime('now') 의 UTC 'YYYY-MM-DD HH:MM:SS' — 화면이 시간대를 오해하지 않게 ISO(Z)로
    iid: r.iid, title: r.title || `#${r.iid}`, stage: r.stage, at: String(r.at).includes('T') ? r.at : `${String(r.at).replace(' ', 'T')}Z`,
    who: r.confirmer_name ? { name: r.confirmer_name, avatar: r.confirmer_avatar ?? null, userId: r.confirmer_user_id ?? null }
      : r.assignee_name ? { name: r.assignee_name, avatar: r.assignee_avatar ?? null, userId: null }
      : null,
  }))
}

export function recordIssueScheduledAt(projectId: string, issueIid: number, scheduledAt: string) {
  getDb().prepare(`
    INSERT INTO issue_stages (project_id, issue_iid, stage, scheduled_at, updated_at)
    VALUES (?, ?, 'waiting', ?, datetime('now'))
    ON CONFLICT(project_id, issue_iid) DO UPDATE SET
      scheduled_at = COALESCE(issue_stages.scheduled_at, excluded.scheduled_at)
  `).run(projectId, issueIid, scheduledAt)
}

export function setIssueStage(_projectId: string, _issueIid: number, _stage: IssueStage, _failReason?: string, _updatedAt?: string) {
  // no-op: 레이블 기반으로 전환됨
}

export function deleteIssueStage(_projectId: string, _issueIid: number) {
  // no-op: 레이블 기반으로 전환됨
}

export function countIssuesByStage(_projectId: string, _stage: IssueStage): number {
  return 0
}

// ── Assign Mode ──

export interface AssignModeInfo {
  mode: 'auto' | 'assignee' | 'agent'
  agentId: string | null
  assigneeAuto: boolean
  /** 0 보통 · 1 높음 · 2 긴급 */
  priority: IssuePriority
}

/** 작업 우선순위 — 0 보통 · 1 높음 · 2 긴급 */
export type IssuePriority = 0 | 1 | 2
export const normalizePriority = (v: unknown): IssuePriority => (v === 2 || v === 1 ? v : Number(v) === 2 ? 2 : Number(v) === 1 ? 1 : 0)

export function setIssuePriority(projectId: string, issueIid: number, priority: IssuePriority) {
  getDb().prepare(`
    INSERT INTO issue_stages (project_id, issue_iid, stage, priority, updated_at)
    VALUES (?, ?, '', ?, datetime('now'))
    ON CONFLICT(project_id, issue_iid) DO UPDATE SET priority = excluded.priority, updated_at = datetime('now')
  `).run(projectId, issueIid, priority)
}

/** 우선순위 높은 것 먼저, 같으면 먼저 들어온(작성) 것 먼저 — 에이전트가 대기 작업을 집는 순서 */
export function byPriorityThenOldest<T extends { iid: number; created_at?: string }>(issues: T[], priorityOf: (iid: number) => number): T[] {
  return [...issues].sort((a, b) => (priorityOf(b.iid) - priorityOf(a.iid))
    || (new Date(a.created_at || 0).getTime() - new Date(b.created_at || 0).getTime()))
}

export function getAssignMode(projectId: string, issueIid: number): AssignModeInfo {
  const r = getDb().prepare('SELECT assign_mode, preferred_agent_id, assignee_auto, priority FROM issue_stages WHERE project_id = ? AND issue_iid = ?').get(projectId, issueIid) as any
  return {
    mode: (r?.assign_mode as 'auto' | 'assignee' | 'agent') || 'auto',
    agentId: r?.preferred_agent_id || null,
    assigneeAuto: !!r?.assignee_auto,
    priority: normalizePriority(r?.priority),
  }
}

export function getAssignModeMap(projectId: string): Map<number, AssignModeInfo> {
  const rows = getDb().prepare(
    'SELECT issue_iid, assign_mode, preferred_agent_id, assignee_auto, priority FROM issue_stages WHERE project_id = ?'
  ).all(projectId) as any[]
  const map = new Map<number, AssignModeInfo>()
  for (const r of rows) map.set(r.issue_iid, {
    mode: r.assign_mode || 'auto',
    agentId: r.preferred_agent_id || null,
    assigneeAuto: !!r.assignee_auto,
    priority: normalizePriority(r.priority),
  })
  return map
}

export function setAssignMode(projectId: string, issueIid: number, mode: 'auto' | 'assignee' | 'agent', agentId?: string | null) {
  const effectiveAgentId = mode === 'agent' ? (agentId || null) : null
  getDb().prepare(`
    INSERT INTO issue_stages (project_id, issue_iid, stage, assign_mode, preferred_agent_id, updated_at)
    VALUES (?, ?, '', ?, ?, datetime('now'))
    ON CONFLICT(project_id, issue_iid) DO UPDATE SET assign_mode = excluded.assign_mode, preferred_agent_id = excluded.preferred_agent_id
  `).run(projectId, issueIid, mode, effectiveAgentId)
}

export function setAssigneeAuto(projectId: string, issueIid: number, value: boolean) {
  getDb().prepare(`
    INSERT INTO issue_stages (project_id, issue_iid, stage, assignee_auto, updated_at)
    VALUES (?, ?, '', ?, datetime('now'))
    ON CONFLICT(project_id, issue_iid) DO UPDATE SET assignee_auto = excluded.assignee_auto, updated_at = datetime('now')
  `).run(projectId, issueIid, value ? 1 : 0)
}

export function getAssigneeAuto(projectId: string, issueIid: number): boolean {
  const r = getDb().prepare('SELECT assignee_auto FROM issue_stages WHERE project_id = ? AND issue_iid = ?').get(projectId, issueIid) as any
  return !!r?.assignee_auto
}

// "지정 대기" = 에이전트에 지정됐으나 아직 처리되지 않은(=대기 중) 이슈.
//   cached_stage 필터만으로는, 완료된 이슈(IVE-E/done)라도 스캐너가 매 틱 행을 다시 쓰는
//   순간 cached_stage가 잠깐 비어 'waiting'으로 오인되어 대기로 집계되는 경우가 있었다(#365).
//   성공 실행이 있는 이슈는 제외했지만, "처리 중(running)"인 이슈는 success가 아직 없어
//   같은 찰나에 cached_stage가 비면 running 이면서 동시에 waiting으로 이중 집계되는 재발 버그가 있었다.
//   → success뿐 아니라 running 실행이 있는 이슈도 stage 순간값과 무관하게 대기가 아니므로 제외한다.
const NOT_PENDING_GUARD = `
  AND NOT EXISTS (
    SELECT 1 FROM task_executions te
    WHERE te.project_id = issue_stages.project_id
      AND te.issue_iid = issue_stages.issue_iid
      AND te.status IN ('success', 'running')
  )`

export function countPreferredIssuesByAgent(agentId: string): number {
  const r = getDb().prepare(`
    SELECT COUNT(*) as cnt FROM issue_stages
    WHERE preferred_agent_id = ? AND (cached_stage IS NULL OR cached_stage IN ('', 'waiting'))
    ${NOT_PENDING_GUARD}
  `).get(agentId) as any
  return r?.cnt || 0
}

export function getPreferredIssuesByAgent(agentId: string): { projectId: string; projectName: string; issueIid: number }[] {
  return getDb().prepare(`
    SELECT s.project_id as projectId, p.name as projectName, s.issue_iid as issueIid
    FROM issue_stages s JOIN projects p ON p.id = s.project_id
    WHERE s.preferred_agent_id = ? AND (s.cached_stage IS NULL OR s.cached_stage IN ('', 'waiting'))
      AND NOT EXISTS (
        SELECT 1 FROM task_executions te
        WHERE te.project_id = s.project_id
          AND te.issue_iid = s.issue_iid
          AND te.status IN ('success', 'running')
      )
    ORDER BY s.updated_at ASC
  `).all(agentId) as any[]
}

export function clearPreferredAgentRefs(agentId: string) {
  const db = getDb()
  db.prepare('UPDATE issue_stages SET preferred_agent_id = NULL WHERE preferred_agent_id = ?').run(agentId)
  // 검증자·확인자로 지정돼 있던 이슈는 사람 기본값(creator)으로 되돌린다 — 없는 에이전트를 기다리며 멈추지 않도록.
  db.prepare(`UPDATE issue_stages SET preset_verifier_mode = 'creator', preset_verifier_agent_id = NULL
    WHERE preset_verifier_mode = 'agent' AND preset_verifier_agent_id = ?`).run(agentId)
  db.prepare(`UPDATE issue_stages SET preset_confirmer_mode = 'creator', preset_confirmer_agent_id = NULL
    WHERE preset_confirmer_mode = 'agent' AND preset_confirmer_agent_id = ?`).run(agentId)
  db.prepare(`DELETE FROM project_role_members WHERE subject_type = 'agent' AND subject_id = ?`).run(agentId)
}

// ── Preset Verifier / Confirmer (이슈 생성 시 사전 배정) ──

/**
 * 검증자/확인자 preset 모드.
 *   creator | auto | specific : 사람 (기존)
 *   agent                     : 에이전트 지정 — 그 단계는 스캐너가 단계 작업자로 기동한다.
 * `specific` 은 종전대로 "특정 사람" 만 뜻한다. 에이전트를 새 모드로 둔 이유: 기존 행·기존 화면이
 * specific=사람 전제로 userId(Git id)를 assignee 로 쓰므로, 뜻을 넓히면 기존 경로가 에이전트 id 를
 * Git id 로 오인한다. 새 모드는 기존 행을 건드리지 않는다(이행 불필요).
 */
export type RoleMode = 'creator' | 'auto' | 'specific' | 'agent'

export interface PresetRoleInfo {
  mode: RoleMode
  userId: string | null      // GitLab/GitHub user id (specific 모드일 때)
  username: string | null    // 표시용
  agentId?: string | null    // agent 모드일 때 agents.id
  agentName?: string | null  // 표시용 (agent 모드)
  agentAvatar?: string | null
}

export interface PresetRolesInfo {
  verifier: PresetRoleInfo
  confirmer: PresetRoleInfo
}

const DEFAULT_ROLE: PresetRoleInfo = { mode: 'creator', userId: null, username: null, agentId: null }

export function getPresetRoles(projectId: string, issueIid: number): PresetRolesInfo {
  const r = getDb().prepare(`
    SELECT s.preset_verifier_mode, s.preset_verifier_user_id, s.preset_verifier_username, s.preset_verifier_agent_id,
      s.preset_confirmer_mode, s.preset_confirmer_user_id, s.preset_confirmer_username, s.preset_confirmer_agent_id,
      va.name as v_agent_name, va.avatar as v_agent_avatar, ca.name as c_agent_name, ca.avatar as c_agent_avatar
    FROM issue_stages s
    LEFT JOIN agents va ON va.id = s.preset_verifier_agent_id
    LEFT JOIN agents ca ON ca.id = s.preset_confirmer_agent_id
    WHERE s.project_id = ? AND s.issue_iid = ?`
  ).get(projectId, issueIid) as any
  return {
    verifier: {
      mode: (r?.preset_verifier_mode as RoleMode) || 'creator',
      userId: r?.preset_verifier_user_id ?? null,
      username: r?.preset_verifier_username ?? null,
      agentId: r?.preset_verifier_agent_id ?? null,
      agentName: r?.v_agent_name ?? null,
      agentAvatar: r?.v_agent_avatar ?? null,
    },
    confirmer: {
      mode: (r?.preset_confirmer_mode as RoleMode) || 'creator',
      userId: r?.preset_confirmer_user_id ?? null,
      username: r?.preset_confirmer_username ?? null,
      agentId: r?.preset_confirmer_agent_id ?? null,
      agentName: r?.c_agent_name ?? null,
      agentAvatar: r?.c_agent_avatar ?? null,
    },
  }
}

export function setPresetRoles(
  projectId: string,
  issueIid: number,
  roles: { verifier?: PresetRoleInfo; confirmer?: PresetRoleInfo },
) {
  const v = roles.verifier || DEFAULT_ROLE
  const c = roles.confirmer || DEFAULT_ROLE
  getDb().prepare(`
    INSERT INTO issue_stages (project_id, issue_iid, stage,
      preset_verifier_mode, preset_verifier_user_id, preset_verifier_username, preset_verifier_agent_id,
      preset_confirmer_mode, preset_confirmer_user_id, preset_confirmer_username, preset_confirmer_agent_id,
      updated_at)
    VALUES (?, ?, '', ?, ?, ?, ?, ?, ?, ?, ?, datetime('now'))
    ON CONFLICT(project_id, issue_iid) DO UPDATE SET
      preset_verifier_mode = excluded.preset_verifier_mode,
      preset_verifier_user_id = excluded.preset_verifier_user_id,
      preset_verifier_username = excluded.preset_verifier_username,
      preset_verifier_agent_id = excluded.preset_verifier_agent_id,
      preset_confirmer_mode = excluded.preset_confirmer_mode,
      preset_confirmer_user_id = excluded.preset_confirmer_user_id,
      preset_confirmer_username = excluded.preset_confirmer_username,
      preset_confirmer_agent_id = excluded.preset_confirmer_agent_id,
      updated_at = datetime('now')
  `).run(
    projectId, issueIid,
    v.mode, v.userId, v.username, v.mode === 'agent' ? (v.agentId ?? null) : null,
    c.mode, c.userId, c.username, c.mode === 'agent' ? (c.agentId ?? null) : null,
  )
}

/** 기본 배정(프로젝트 설정)을 이 이슈에 이미 적용했는가 — 한 번만 적용한다. */
export function getRolesInitializedAt(projectId: string, issueIid: number): string | null {
  const r = getDb().prepare('SELECT roles_initialized_at FROM issue_stages WHERE project_id = ? AND issue_iid = ?')
    .get(projectId, issueIid) as any
  return r?.roles_initialized_at ?? null
}

export function markRolesInitialized(projectId: string, issueIid: number) {
  getDb().prepare(`
    INSERT INTO issue_stages (project_id, issue_iid, stage, roles_initialized_at, updated_at)
    VALUES (?, ?, '', datetime('now'), datetime('now'))
    ON CONFLICT(project_id, issue_iid) DO UPDATE SET
      roles_initialized_at = COALESCE(issue_stages.roles_initialized_at, excluded.roles_initialized_at)
  `).run(projectId, issueIid)
}

// ── Actual Role Assignees (실제 수행 이력) ──

/**
 * 단계별로 "실제 그 단계를 수행한/수행 중인 사람/에이전트" 를 반환.
 * preset(규칙)보다 우선해서 표시할 수 있도록 RoleAvatarBar 가 사용.
 */
export interface ActualRoleAssignees {
  processor: { agentId: string | null; agentName: string | null; agentAvatar: string | null; cliName: string | null } | null
  verifier: { userId: string | null; name: string | null; avatar: string | null } | null
  confirmer: { userId: string | null; name: string | null; avatar: string | null } | null
}

const EMPTY_ROLES: ActualRoleAssignees = { processor: null, verifier: null, confirmer: null }

/**
 * user_avatar 컬럼은 'photo' (업로드 사진) | 'av-XX' (프리셋) | URL | null 중 하나.
 * 'photo' 인 경우 IVE userId 로 이미지 API URL 을 만든다.
 */
function resolveUserAvatar(avatar: string | null | undefined, userId: string | null | undefined): string | null {
  if (!avatar) return null
  if (avatar === 'photo') return userId ? `/api/auth/avatar/image?id=${userId}` : null
  return avatar
}

// 처리자(D) 판정에서 단계 작업자 행(검증·확인·재현 에이전트)과 AI 채팅·충돌 검사를 뺀다 — 확인 에이전트나 대화만 한 에이전트가 처리자로 보이면 안 된다.
const NOT_STAGE_ROW = "te.id NOT LIKE 'ex-verify-%' AND te.id NOT LIKE 'ex-confirm-%' AND te.id NOT LIKE 'ex-reproduce-%' AND te.id NOT LIKE 'exec-chat-%' AND te.id NOT LIKE 'ex-conflict%'"

export function getActualRoleAssignees(projectId: string, issueIid: number): ActualRoleAssignees {
  const db = getDb()

  // 1) processor — 가장 최근의 agent execution
  const pRow = db.prepare(`
    SELECT te.agent_id as agentId, a.name as agentName, a.avatar as agentAvatar, a.cli_name as cliName
    FROM task_executions te LEFT JOIN agents a ON a.id = te.agent_id
    WHERE te.project_id = ? AND te.issue_iid = ? AND te.assignee_type = 'agent' AND ${NOT_STAGE_ROW}
    ORDER BY te.started_at DESC LIMIT 1
  `).get(projectId, issueIid) as any
  const processor = pRow?.agentId ? {
    agentId: pRow.agentId, agentName: pRow.agentName, agentAvatar: pRow.agentAvatar, cliName: pRow.cliName,
  } : null

  // 2) verifier — 활성 verify exec 우선 → 종결된 검증자(verifier_*)
  const vActive = db.prepare(`
    SELECT user_id as userId, user_name as name, user_avatar as avatar
    FROM task_executions
    WHERE project_id = ? AND issue_iid = ? AND id LIKE 'ex-verify-%'
      AND status IN ('running', 'assigned')
    ORDER BY started_at DESC LIMIT 1
  `).get(projectId, issueIid) as any
  let verifier: ActualRoleAssignees['verifier'] = null
  if (vActive?.userId) {
    verifier = { userId: vActive.userId, name: vActive.name, avatar: resolveUserAvatar(vActive.avatar, vActive.userId) }
  } else {
    const vDone = db.prepare(`
      SELECT verifier_user_id as userId, verifier_name as name, verifier_avatar as avatar
      FROM task_executions
      WHERE project_id = ? AND issue_iid = ? AND verifier_user_id IS NOT NULL
      ORDER BY COALESCE(verified_at, rejected_at) DESC LIMIT 1
    `).get(projectId, issueIid) as any
    if (vDone?.userId) verifier = { userId: vDone.userId, name: vDone.name, avatar: resolveUserAvatar(vDone.avatar, vDone.userId) }
  }

  // 3) confirmer — 활성 confirm exec 우선 → issue_stages.confirmer_*
  const cActive = db.prepare(`
    SELECT user_id as userId, user_name as name, user_avatar as avatar
    FROM task_executions
    WHERE project_id = ? AND issue_iid = ? AND id LIKE 'ex-confirm-%'
      AND status IN ('running', 'assigned')
    ORDER BY started_at DESC LIMIT 1
  `).get(projectId, issueIid) as any
  let confirmer: ActualRoleAssignees['confirmer'] = null
  if (cActive?.userId) {
    confirmer = { userId: cActive.userId, name: cActive.name, avatar: resolveUserAvatar(cActive.avatar, cActive.userId) }
  } else {
    const cDone = db.prepare(`
      SELECT confirmer_user_id as userId, confirmer_name as name, confirmer_avatar as avatar
      FROM issue_stages
      WHERE project_id = ? AND issue_iid = ? AND confirmer_user_id IS NOT NULL
    `).get(projectId, issueIid) as any
    if (cDone?.userId) confirmer = { userId: cDone.userId, name: cDone.name, avatar: resolveUserAvatar(cDone.avatar, cDone.userId) }
  }

  return { processor, verifier, confirmer }
}

/**
 * 프로젝트 전체 이슈에 대해 actual role assignees 를 batch 로 조회 (목록 API 용).
 */
export function getActualRoleAssigneesMap(projectId: string): Map<number, ActualRoleAssignees> {
  const db = getDb()
  const map = new Map<number, ActualRoleAssignees>()

  // processor
  const pRows = db.prepare(`
    SELECT te.issue_iid as iid, te.agent_id as agentId, a.name as agentName, a.avatar as agentAvatar, a.cli_name as cliName,
      te.started_at as startedAt
    FROM task_executions te LEFT JOIN agents a ON a.id = te.agent_id
    WHERE te.project_id = ? AND te.assignee_type = 'agent' AND ${NOT_STAGE_ROW}
    ORDER BY te.started_at DESC
  `).all(projectId) as any[]
  for (const r of pRows) {
    if (!map.has(r.iid)) map.set(r.iid, { ...EMPTY_ROLES })
    const e = map.get(r.iid)!
    if (!e.processor && r.agentId) {
      e.processor = { agentId: r.agentId, agentName: r.agentName, agentAvatar: r.agentAvatar, cliName: r.cliName }
    }
  }

  // active verify exec
  const vActiveRows = db.prepare(`
    SELECT issue_iid as iid, user_id as userId, user_name as name, user_avatar as avatar, started_at as startedAt
    FROM task_executions
    WHERE project_id = ? AND id LIKE 'ex-verify-%' AND status IN ('running', 'assigned')
    ORDER BY started_at DESC
  `).all(projectId) as any[]
  for (const r of vActiveRows) {
    if (!map.has(r.iid)) map.set(r.iid, { ...EMPTY_ROLES })
    const e = map.get(r.iid)!
    if (!e.verifier && r.userId) e.verifier = { userId: r.userId, name: r.name, avatar: resolveUserAvatar(r.avatar, r.userId) }
  }

  // verifier from done execs
  const vDoneRows = db.prepare(`
    SELECT issue_iid as iid, verifier_user_id as userId, verifier_name as name, verifier_avatar as avatar,
      COALESCE(verified_at, rejected_at) as ts
    FROM task_executions
    WHERE project_id = ? AND verifier_user_id IS NOT NULL
    ORDER BY ts DESC
  `).all(projectId) as any[]
  for (const r of vDoneRows) {
    if (!map.has(r.iid)) map.set(r.iid, { ...EMPTY_ROLES })
    const e = map.get(r.iid)!
    if (!e.verifier && r.userId) e.verifier = { userId: r.userId, name: r.name, avatar: resolveUserAvatar(r.avatar, r.userId) }
  }

  // active confirm exec
  const cActiveRows = db.prepare(`
    SELECT issue_iid as iid, user_id as userId, user_name as name, user_avatar as avatar, started_at as startedAt
    FROM task_executions
    WHERE project_id = ? AND id LIKE 'ex-confirm-%' AND status IN ('running', 'assigned')
    ORDER BY started_at DESC
  `).all(projectId) as any[]
  for (const r of cActiveRows) {
    if (!map.has(r.iid)) map.set(r.iid, { ...EMPTY_ROLES })
    const e = map.get(r.iid)!
    if (!e.confirmer && r.userId) e.confirmer = { userId: r.userId, name: r.name, avatar: resolveUserAvatar(r.avatar, r.userId) }
  }

  // confirmer from issue_stages
  const cDoneRows = db.prepare(`
    SELECT issue_iid as iid, confirmer_user_id as userId, confirmer_name as name, confirmer_avatar as avatar
    FROM issue_stages
    WHERE project_id = ? AND confirmer_user_id IS NOT NULL
  `).all(projectId) as any[]
  for (const r of cDoneRows) {
    if (!map.has(r.iid)) map.set(r.iid, { ...EMPTY_ROLES })
    const e = map.get(r.iid)!
    if (!e.confirmer && r.userId) e.confirmer = { userId: r.userId, name: r.name, avatar: resolveUserAvatar(r.avatar, r.userId) }
  }

  return map
}

// ── Project Members ──

export function replaceProjectMembers(
  projectId: string,
  members: { username: string; name: string; avatarUrl: string; provider: string; gitUserId?: string | null }[]
) {
  const db = getDb()
  const tx = db.transaction(() => {
    db.prepare('DELETE FROM project_members WHERE project_id = ?').run(projectId)
    const stmt = db.prepare(`
      INSERT INTO project_members (project_id, username, name, avatar_url, provider, git_user_id, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, datetime('now'))
    `)
    for (const m of members) {
      if (!m.username) continue
      stmt.run(projectId, m.username, m.name || m.username, m.avatarUrl || '', m.provider || 'gitlab', m.gitUserId ?? null)
    }
    // 역할 명부: 새 멤버는 검증 역할로, 빠진 멤버의 자동(sync) 줄은 제거. 사람이 정한 줄은 유지.
    syncRosterWithMembers(projectId, members)
  })
  tx()
}

// ── Verifier (Git assignee 기반 검증자) ──

export function upsertIssueStageSnapshot(
  projectId: string,
  issueIid: number,
  snapshot: {
    cachedStage: string | null
    assigneeUsername: string | null
    assigneeName: string | null
    assigneeAvatar: string | null
    assigneeProvider: string | null
    assigneeGitUserId: string | null
    issueTitle: string | null
  }
) {
  getDb().prepare(`
    INSERT INTO issue_stages (project_id, issue_iid, stage, cached_stage, assignee_username, assignee_name, assignee_avatar, assignee_provider, assignee_git_user_id, issue_title, verify_waiting_since, updated_at)
    VALUES (?, ?, '', ?, ?, ?, ?, ?, ?, ?,
      CASE WHEN ? IN ('verify_waiting', 'verifying') THEN datetime('now') ELSE NULL END,
      datetime('now'))
    ON CONFLICT(project_id, issue_iid) DO UPDATE SET
      cached_stage = excluded.cached_stage,
      assignee_username = excluded.assignee_username,
      assignee_name = excluded.assignee_name,
      assignee_avatar = excluded.assignee_avatar,
      assignee_provider = excluded.assignee_provider,
      assignee_git_user_id = excluded.assignee_git_user_id,
      issue_title = excluded.issue_title,
      verify_waiting_since = CASE
        WHEN excluded.cached_stage IN ('verify_waiting', 'verifying') THEN
          COALESCE(issue_stages.verify_waiting_since, datetime('now'))
        ELSE NULL
      END,
      updated_at = datetime('now')
  `).run(
    projectId, issueIid,
    snapshot.cachedStage,
    snapshot.assigneeUsername,
    snapshot.assigneeName,
    snapshot.assigneeAvatar,
    snapshot.assigneeProvider,
    snapshot.assigneeGitUserId,
    snapshot.issueTitle,
    snapshot.cachedStage
  )
}

export function getIssueAssigneeUsername(projectId: string, issueIid: number): { username: string | null; name: string | null; avatar: string | null } {
  const r = getDb().prepare(
    'SELECT assignee_username, assignee_name, assignee_avatar FROM issue_stages WHERE project_id = ? AND issue_iid = ?'
  ).get(projectId, issueIid) as any
  return {
    username: r?.assignee_username || null,
    name: r?.assignee_name || null,
    avatar: r?.assignee_avatar || null,
  }
}

export interface VerifierSummary {
  username: string
  name: string
  avatar: string
  provider: string
  verifying: number
  verifyWaiting: number
  approvedToday: number
  rejectedToday: number
  approved7d: number
  rejected7d: number
  avgVerifyMin: number
  oldestWaitMin: number
  assignedProjects: { id: string; name: string; color: string; provider: string }[]
  iveUser: { id: string; name: string; email: string; avatar: string } | null
}

export function getVerifiersList(userId: string): VerifierSummary[] {
  return getRolePeopleList(userId, 'verify')
}

/** 확인자 목록 — 검증자 카드와 같은 모양(대기·진행·처리 건수). verifyWaiting/verifying 은 확인대기/확인중. */
export function getConfirmersList(userId: string): VerifierSummary[] {
  return getRolePeopleList(userId, 'confirm')
}

/** 처리자(사람) 목록 — 같은 카드 모양. verifyWaiting/verifying 은 처리대기(스케줄)/처리중, approved/rejected 는 처리 완료/실패. */
export function getProcessorsList(userId: string): VerifierSummary[] {
  return getRolePeopleList(userId, 'process')
}

/**
 * 역할(검증·확인)을 가진 사람 목록 + 역할별 대기·진행 건수.
 * 사람 후보는 역할 명부(project_role_members)에서 그 역할을 가진 사람이다. 명부 밖이어도 지금 그 단계의
 * Git 담당자로 걸려 있는 사람은 일감이 있으므로 함께 보인다(종전 검증자 목록과 같은 규칙).
 */
function getRolePeopleList(userId: string, role: 'process' | 'verify' | 'confirm'): VerifierSummary[] {
  const db = getDb()
  const accessCondition = `(p.user_id = ? OR EXISTS (SELECT 1 FROM project_shares ps WHERE ps.project_id = p.id AND ps.user_id = ?))`
  const todayStartISO = getKSTTodayStartISO()
  const week7Ago = new Date(Date.now() - 7 * 86400 * 1000).toISOString()
  const roleCol = role === 'process' ? 'can_process' : role === 'verify' ? 'can_verify' : 'can_confirm'
  const [waitStage, activeStage] = role === 'process' ? ['waiting', 'dev'] : role === 'verify' ? ['verify_waiting', 'verifying'] : ['confirm_waiting', 'confirming']
  // 그 단계를 사람이 맡은 이슈만 그 사람의 일감이다 — 처리: 담당자 모드, 검증·확인: 에이전트 배정이 아닌 것
  const personOwned = role === 'process'
    ? `COALESCE(s.assign_mode, '') = 'assignee'`
    : `COALESCE(s.${role === 'verify' ? 'preset_verifier_mode' : 'preset_confirmer_mode'}, '') != 'agent'`

  const memberRows = db.prepare(`
    SELECT m.subject_id as username, m.name, m.avatar as avatar_url, p.provider, m.git_user_id,
      p.id as project_id, p.name as project_name, p.color as project_color
    FROM project_role_members m JOIN projects p ON p.id = m.project_id
    WHERE m.subject_type = 'user' AND m.${roleCol} = 1 AND ${accessCondition}
  `).all(userId, userId) as any[]
  interface Meta {
    username: string; name: string; avatar: string; provider: string; gitUserId: string | null
    projects: Map<string, { id: string; name: string; color: string; provider: string }>
  }
  const metaMap = new Map<string, Meta>()
  const metaKey = (provider: string, username: string) => `${provider || 'gitlab'}:${username}`

  for (const m of memberRows) {
    const key = metaKey(m.provider, m.username)
    const existing = metaMap.get(key) || {
      username: m.username, name: m.name || m.username, avatar: m.avatar_url || 'av-01',
      provider: m.provider || 'gitlab', gitUserId: m.git_user_id || null, projects: new Map(),
    }
    existing.projects.set(m.project_id, { id: m.project_id, name: m.project_name, color: m.project_color, provider: m.provider || 'gitlab' })
    if (!existing.name && m.name) existing.name = m.name
    if (!existing.avatar && m.avatar_url) existing.avatar = m.avatar_url
    if (!existing.gitUserId && m.git_user_id) existing.gitUserId = m.git_user_id
    metaMap.set(key, existing)
  }

  const currentRows = db.prepare(`
    SELECT s.assignee_username as username, COALESCE(s.assignee_provider, 'gitlab') as provider,
      MAX(s.assignee_name) as name, MAX(s.assignee_avatar) as avatar, MAX(s.assignee_git_user_id) as git_user_id,
      SUM(CASE WHEN s.cached_stage = '${activeStage}' THEN 1 ELSE 0 END) as verifying,
      SUM(CASE WHEN s.cached_stage = '${waitStage}' THEN 1 ELSE 0 END) as verify_waiting,
      MIN(CASE WHEN s.cached_stage IN ('${waitStage}', '${activeStage}') THEN ${role === 'verify' ? 's.verify_waiting_since' : 'NULL'} ELSE NULL END) as oldest_wait_at
    FROM issue_stages s JOIN projects p ON p.id = s.project_id
    WHERE s.assignee_username IS NOT NULL AND s.cached_stage IN ('${waitStage}', '${activeStage}') AND ${accessCondition}
      -- 그 단계를 에이전트가 맡은 이슈는 사람의 일감으로 세지 않는다(Git 담당자로만 걸려 있을 뿐)
      AND ${personOwned}
    GROUP BY COALESCE(s.assignee_provider, 'gitlab'), s.assignee_username
  `).all(userId, userId) as any[]
  const currentMap = new Map<string, any>()
  for (const r of currentRows) {
    const key = metaKey(r.provider, r.username)
    currentMap.set(key, r)
    const existing = metaMap.get(key)
    if (!existing) {
      metaMap.set(key, { username: r.username, name: r.name || r.username, avatar: r.avatar || 'av-01', provider: r.provider || 'gitlab', gitUserId: r.git_user_id || null, projects: new Map() })
    } else if (!existing.gitUserId && r.git_user_id) { existing.gitUserId = r.git_user_id }
  }

  // IVE 사용자 매칭
  const iveUserByGitId = new Map<string, { id: string; name: string; email: string; avatar: string }>()
  const gitIdsToMatch = Array.from(metaMap.values()).map(m => m.gitUserId).filter((id): id is string => !!id)
  if (gitIdsToMatch.length > 0) {
    const placeholders = gitIdsToMatch.map(() => '?').join(',')
    const iveRows = db.prepare(`
      SELECT u.id, u.name, u.email, u.avatar, u.oauth_user_id, op.type as provider_type
      FROM users u JOIN oauth_providers op ON op.id = u.oauth_provider_id
      WHERE u.oauth_user_id IN (${placeholders})
    `).all(...gitIdsToMatch) as any[]
    for (const row of iveRows) {
      iveUserByGitId.set(`${row.provider_type}:${row.oauth_user_id}`, { id: row.id, name: row.name, email: row.email, avatar: row.avatar || 'av-01' })
    }
  }

  // 처리(사람): 담당자 모드 처리 실행(사람 행, 검증·확인 행 제외)의 완료·실패·소요 시간. 실행 행의 user_id 는 Git 사용자 id 다.
  const processStats = role === 'process' ? db.prepare(`
    SELECT te.user_id as gitUserId, p.provider as provider,
      SUM(CASE WHEN te.status = 'success' AND te.ended_at >= ? THEN 1 ELSE 0 END) as approved_7d,
      SUM(CASE WHEN te.status = 'failed' AND te.ended_at >= ? THEN 1 ELSE 0 END) as rejected_7d,
      SUM(CASE WHEN te.status = 'success' AND te.ended_at >= ? THEN 1 ELSE 0 END) as approved_today,
      SUM(CASE WHEN te.status = 'failed' AND te.ended_at >= ? THEN 1 ELSE 0 END) as rejected_today,
      AVG(CASE WHEN te.status = 'success' AND te.ended_at >= ?
        THEN (julianday(te.ended_at) - julianday(te.started_at)) * 1440 ELSE NULL END) as avg_verify_min
    FROM task_executions te JOIN projects p ON p.id = te.project_id
    WHERE te.assignee_type = 'user' AND te.user_id IS NOT NULL
      AND te.id NOT LIKE 'ex-verify-%' AND te.id NOT LIKE 'ex-confirm-%' AND te.id NOT LIKE 'ex-reproduce-%' AND te.id NOT LIKE 'exec-chat-%'
      AND ${accessCondition}
    GROUP BY p.provider, te.user_id
  `).all(week7Ago, week7Ago, todayStartISO, todayStartISO, week7Ago, userId, userId) as any[] : []
  const processMap = new Map<string, any>(processStats.map(r => [`${r.provider || 'gitlab'}:${r.gitUserId}`, r]))

  const execStats = role === 'process' ? [] : role === 'verify' ? db.prepare(`
    SELECT te.verifier_username as username, p.provider as provider,
      SUM(CASE WHEN te.verified_at IS NOT NULL AND te.verified_at >= ? THEN 1 ELSE 0 END) as approved_7d,
      SUM(CASE WHEN te.rejected_at IS NOT NULL AND te.rejected_at >= ? THEN 1 ELSE 0 END) as rejected_7d,
      SUM(CASE WHEN te.verified_at IS NOT NULL AND te.verified_at >= ? THEN 1 ELSE 0 END) as approved_today,
      SUM(CASE WHEN te.rejected_at IS NOT NULL AND te.rejected_at >= ? THEN 1 ELSE 0 END) as rejected_today,
      AVG(CASE WHEN te.verified_at IS NOT NULL AND te.verify_started_at IS NOT NULL AND te.verified_at >= ?
        THEN (strftime('%s', te.verified_at) - strftime('%s', te.verify_started_at)) / 60.0
        ELSE NULL END) as avg_verify_min
    FROM task_executions te JOIN projects p ON p.id = te.project_id
    WHERE te.verifier_username IS NOT NULL AND ${accessCondition}
    GROUP BY p.provider, te.verifier_username
  `).all(week7Ago, week7Ago, todayStartISO, todayStartISO, week7Ago, userId, userId) as any[]
  // 확인: 완료(confirmed_at) 시점의 Git 담당자가 확인자다(단계 전이 때 확인자로 교체되므로).
  // 확인 반려(재작업 요청)는 따로 기록되지 않아 0 으로 둔다.
  : db.prepare(`
    SELECT s.assignee_username as username, p.provider as provider,
      SUM(CASE WHEN s.confirmed_at >= ? THEN 1 ELSE 0 END) as approved_7d,
      0 as rejected_7d,
      SUM(CASE WHEN s.confirmed_at >= ? THEN 1 ELSE 0 END) as approved_today,
      0 as rejected_today,
      AVG(CASE WHEN s.confirmed_at >= ? AND s.confirm_started_at IS NOT NULL
        THEN (strftime('%s', s.confirmed_at) - strftime('%s', s.confirm_started_at)) / 60.0
        ELSE NULL END) as avg_verify_min
    FROM issue_stages s JOIN projects p ON p.id = s.project_id
    WHERE s.assignee_username IS NOT NULL AND s.confirmed_at IS NOT NULL AND ${accessCondition}
    GROUP BY p.provider, s.assignee_username
  `).all(week7Ago, todayStartISO, week7Ago, userId, userId) as any[]
  const execMap = new Map<string, any>()
  for (const r of execStats) {
    const key = metaKey(r.provider, r.username)
    execMap.set(key, r)
    if (!metaMap.has(key)) {
      metaMap.set(key, { username: r.username, name: r.username, avatar: 'av-01', provider: r.provider || 'gitlab', gitUserId: null, projects: new Map() })
    }
  }

  const now = Date.now()
  return Array.from(metaMap.entries())
    .filter(([, meta]) => !isBotName(meta.username) && !isBotName(meta.name))
    .map(([key, meta]) => {
    const curr = currentMap.get(key)
    const exec = role === 'process' ? (meta.gitUserId ? processMap.get(`${meta.provider}:${meta.gitUserId}`) : null) : execMap.get(key)
    const oldestWaitMs = curr?.oldest_wait_at ? now - new Date(curr.oldest_wait_at + 'Z').getTime() : 0
    const iveUser = meta.gitUserId ? (iveUserByGitId.get(`${meta.provider}:${meta.gitUserId}`) || null) : null
    return {
      username: meta.username, name: meta.name, avatar: meta.avatar, provider: meta.provider,
      verifying: Number(curr?.verifying || 0), verifyWaiting: Number(curr?.verify_waiting || 0),
      approvedToday: Number(exec?.approved_today || 0), rejectedToday: Number(exec?.rejected_today || 0),
      approved7d: Number(exec?.approved_7d || 0), rejected7d: Number(exec?.rejected_7d || 0),
      avgVerifyMin: exec?.avg_verify_min != null ? Math.round(Number(exec.avg_verify_min) * 10) / 10 : 0,
      oldestWaitMin: oldestWaitMs > 0 ? Math.round(oldestWaitMs / 60000) : 0,
      assignedProjects: Array.from(meta.projects.values()),
      iveUser,
    }
  }).sort((a, b) => {
    const diff = (b.verifyWaiting + b.verifying) - (a.verifyWaiting + a.verifying)
    if (diff !== 0) return diff
    const activityDiff = (b.approved7d + b.rejected7d) - (a.approved7d + a.rejected7d)
    if (activityDiff !== 0) return activityDiff
    return a.name.localeCompare(b.name)
  })
}

export function getVerifierBacklogForReport(userId: string): {
  username: string; name: string; avatar: string; provider: string;
  verifyWaiting: number; verifying: number; oldestWaitMin: number; assignedProjectNames: string[]
}[] {
  const db = getDb()
  const rows = db.prepare(`
    SELECT s.assignee_username as username, MAX(s.assignee_name) as name, MAX(s.assignee_avatar) as avatar,
      MAX(s.assignee_provider) as provider,
      SUM(CASE WHEN s.cached_stage = 'verify_waiting' THEN 1 ELSE 0 END) as verify_waiting,
      SUM(CASE WHEN s.cached_stage = 'verifying' THEN 1 ELSE 0 END) as verifying,
      MIN(CASE WHEN s.cached_stage IN ('verify_waiting', 'verifying') THEN s.verify_waiting_since ELSE NULL END) as oldest_wait_at
    FROM issue_stages s JOIN projects p ON p.id = s.project_id
    WHERE s.assignee_username IS NOT NULL AND s.cached_stage IN ('verify_waiting', 'verifying')
      AND COALESCE(s.preset_verifier_mode, '') != 'agent'
      AND (p.user_id = ? OR EXISTS (SELECT 1 FROM project_shares ps WHERE ps.project_id = p.id AND ps.user_id = ?))
    GROUP BY s.assignee_username
  `).all(userId, userId) as any[]

  const projectRows = db.prepare(`
    SELECT DISTINCT s.assignee_username as username, p.name as project_name
    FROM issue_stages s JOIN projects p ON p.id = s.project_id
    WHERE s.assignee_username IS NOT NULL AND s.cached_stage IN ('verify_waiting', 'verifying')
      AND (p.user_id = ? OR EXISTS (SELECT 1 FROM project_shares ps WHERE ps.project_id = p.id AND ps.user_id = ?))
  `).all(userId, userId) as any[]
  const projMap = new Map<string, string[]>()
  for (const r of projectRows) {
    if (!projMap.has(r.username)) projMap.set(r.username, [])
    projMap.get(r.username)!.push(r.project_name)
  }

  const now = Date.now()
  return rows.map(r => ({
    username: r.username, name: r.name || r.username, avatar: r.avatar || 'av-01', provider: r.provider || 'gitlab',
    verifyWaiting: Number(r.verify_waiting || 0), verifying: Number(r.verifying || 0),
    oldestWaitMin: r.oldest_wait_at ? Math.round((now - new Date(r.oldest_wait_at + 'Z').getTime()) / 60000) : 0,
    assignedProjectNames: projMap.get(r.username) || [],
  }))
}

export function getVerifierQueue(userId: string, username: string, role: 'process' | 'verify' | 'confirm' = 'verify'): { projectId: string; projectName: string; projectColor: string; issueIid: number; issueTitle: string; stage: string; waitingSince: string | null }[] {
  if (role === 'process') {
    // 담당자 모드로 사람이 처리하는 이슈 (스케줄 = 처리대기, 개발 = 처리중)
    return getDb().prepare(`
      SELECT s.project_id as projectId, p.name as projectName, p.color as projectColor,
        s.issue_iid as issueIid, COALESCE(s.issue_title, '') as issueTitle,
        CASE WHEN s.cached_stage = 'dev_fail' THEN 'dev' ELSE s.cached_stage END as stage, s.scheduled_at as waitingSince
      FROM issue_stages s JOIN projects p ON p.id = s.project_id
      WHERE s.assignee_username = ? AND s.cached_stage IN ('waiting', 'dev', 'dev_fail') AND COALESCE(s.assign_mode, '') = 'assignee'
        AND (p.user_id = ? OR EXISTS (SELECT 1 FROM project_shares ps WHERE ps.project_id = p.id AND ps.user_id = ?))
      ORDER BY s.issue_iid ASC
    `).all(username, userId, userId) as any[]
  }
  if (role === 'confirm') {
    return getDb().prepare(`
      SELECT s.project_id as projectId, p.name as projectName, p.color as projectColor,
        s.issue_iid as issueIid, COALESCE(s.issue_title, '') as issueTitle,
        s.cached_stage as stage, NULL as waitingSince
      FROM issue_stages s JOIN projects p ON p.id = s.project_id
      WHERE s.assignee_username = ? AND s.cached_stage IN ('confirm_waiting', 'confirming') AND COALESCE(s.preset_confirmer_mode, '') != 'agent'
        AND (p.user_id = ? OR EXISTS (SELECT 1 FROM project_shares ps WHERE ps.project_id = p.id AND ps.user_id = ?))
      ORDER BY s.issue_iid ASC
    `).all(username, userId, userId) as any[]
  }
  return getDb().prepare(`
    SELECT s.project_id as projectId, p.name as projectName, p.color as projectColor,
      s.issue_iid as issueIid, COALESCE(s.issue_title, '') as issueTitle,
      s.cached_stage as stage, s.verify_waiting_since as waitingSince
    FROM issue_stages s JOIN projects p ON p.id = s.project_id
    WHERE s.assignee_username = ? AND s.cached_stage IN ('verify_waiting', 'verifying') AND COALESCE(s.preset_verifier_mode, '') != 'agent'
      AND (p.user_id = ? OR EXISTS (SELECT 1 FROM project_shares ps WHERE ps.project_id = p.id AND ps.user_id = ?))
    ORDER BY s.verify_waiting_since IS NULL, s.verify_waiting_since ASC, s.issue_iid ASC
  `).all(username, userId, userId) as any[]
}

export function getMyVerifierQueue(
  userId: string, oauthUserId: string, providerType: 'github' | 'gitlab',
): { projectId: string; projectName: string; projectColor: string; issueIid: number; issueTitle: string; stage: string; waitingSince: string | null }[] {
  return getDb().prepare(`
    SELECT s.project_id as projectId, p.name as projectName, p.color as projectColor,
      s.issue_iid as issueIid, COALESCE(s.issue_title, '') as issueTitle,
      s.cached_stage as stage, s.verify_waiting_since as waitingSince
    FROM issue_stages s JOIN projects p ON p.id = s.project_id
    WHERE s.assignee_git_user_id = ? AND p.provider = ?
      AND s.cached_stage IN ('verify_waiting', 'verifying') AND COALESCE(s.preset_verifier_mode, '') != 'agent'
      AND (p.user_id = ? OR EXISTS (SELECT 1 FROM project_shares ps WHERE ps.project_id = p.id AND ps.user_id = ?))
    ORDER BY s.verify_waiting_since IS NULL, s.verify_waiting_since ASC, s.issue_iid ASC
  `).all(oauthUserId, providerType, userId, userId) as any[]
}

export function getMyVerifierCounts(
  userId: string, oauthUserId: string, providerType: 'github' | 'gitlab',
): { verifyWaiting: number; verifying: number; total: number } {
  const r = getDb().prepare(`
    SELECT
      SUM(CASE WHEN s.cached_stage = 'verify_waiting' THEN 1 ELSE 0 END) as verify_waiting,
      SUM(CASE WHEN s.cached_stage = 'verifying' THEN 1 ELSE 0 END) as verifying
    FROM issue_stages s JOIN projects p ON p.id = s.project_id
    WHERE s.assignee_git_user_id = ? AND p.provider = ?
      AND s.cached_stage IN ('verify_waiting', 'verifying') AND COALESCE(s.preset_verifier_mode, '') != 'agent'
      AND (p.user_id = ? OR EXISTS (SELECT 1 FROM project_shares ps WHERE ps.project_id = p.id AND ps.user_id = ?))
  `).get(oauthUserId, providerType, userId, userId) as any
  const verifyWaiting = Number(r?.verify_waiting || 0)
  const verifying = Number(r?.verifying || 0)
  return { verifyWaiting, verifying, total: verifyWaiting + verifying }
}

/**
 * 이슈 제목에 검색어(공백으로 나눈 단어 모두)가 들어간 이슈 번호 — 최신 번호순, 최대 limit 개.
 * 이력 탭에서 GitLab 검색이 무시하는 짧은 검색어(3글자 미만, 예: "영어")를 IVE 가 기록해 둔 제목으로 찾는다.
 * limit 100 = GitLab 이 iids[] 를 받아 주는 선(150개부터 502, 실측).
 * 제목은 실행 기록(task_executions)과 단계 스냅샷(issue_stages) 양쪽에서 모은다.
 */
export function findIssueIidsByTitle(projectId: string, search: string, limit = 100): number[] {
  const words = search.trim().split(/\s+/).filter(Boolean)
  if (words.length === 0) return []
  const escape = (w: string) => w.replace(/[\\%_]/g, c => '\\' + c)
  const cond = words.map(() => "t.issue_title LIKE ? ESCAPE '\\'").join(' AND ')
  const rows = getDb().prepare(`
    SELECT DISTINCT t.issue_iid AS iid FROM (
      SELECT issue_iid, issue_title FROM task_executions WHERE project_id = ? AND issue_title IS NOT NULL
      UNION
      SELECT issue_iid, issue_title FROM issue_stages WHERE project_id = ? AND issue_title IS NOT NULL
    ) t
    WHERE ${cond}
    ORDER BY t.issue_iid DESC
    LIMIT ?
  `).all(projectId, projectId, ...words.map(w => `%${escape(w)}%`), limit) as { iid: number }[]
  return rows.map(r => r.iid)
}
