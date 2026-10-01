/**
 * 이슈별 세 역할(처리자·검증자·확인자) 배정 — 사람 또는 에이전트.
 *
 *   처리자: issue_stages.assign_mode ('auto' 의뢰자 풀 | 'assignee' 사람 | 'agent' 지정 에이전트)
 *   검증자·확인자: issue_stages.preset_*  ('creator' | 'auto' | 'specific' 사람 | 'agent' 에이전트)
 *
 * 규칙
 *   - 후보는 역할 명부(project_role_members)에서 그 역할을 가진 사람·에이전트.
 *   - 같은 이슈에서 처리자 에이전트와 검증자 에이전트는 같을 수 없다(자기 작업을 자기가 검수하지 않는다).
 *   - 「모든 단계 자동배정」: 세 역할을 명부의 에이전트 중 가장 한가한 것으로 한꺼번에 지정한다.
 *     후보가 없는 역할은 비워 두고(종전 사람 기본값 유지) 이유를 돌려준다.
 */
import { Project } from '@/types'
import { isAgentAvailableNow } from '@/types'
import {
  getRoleCandidates, getAgentRoleLoad, getAgent, getAssignMode, setAssignMode, getPresetRoles, setPresetRoles,
  getProjectAutomation, markRolesInitialized, setStageWorkerNote, hasRole, getProject, getIssueIntakeChannel, roleDefaultsFor,
  type PresetRoleInfo, type ProcessorSpec, type RoleKey, type RoleDefaults,
} from './db'
import { WORKER_ACTIVE } from './role-prompts'
import { isAgentEligibleForProject } from './project-permissions'

/**
 * 그 역할을 에이전트에게 맡길 수 있는가 — 단계 작업자가 있는 역할만.
 * 검증(③) 작업자는 Phase 3 에서 붙는다. 그 전에 검증자를 에이전트로 두면 아무도 검증하지 않은 채 멈추므로 막는다.
 */
export function agentRoleAvailable(role: 'verify' | 'confirm'): boolean {
  return role === 'verify' ? WORKER_ACTIVE.verify : WORKER_ACTIVE.confirm
}

export interface RoleAssignmentView {
  processor: ProcessorSpec & { agentName?: string | null }
  verifier: PresetRoleInfo
  confirmer: PresetRoleInfo
}

export interface AutoAssignOutcome {
  processor: string | null   // agentId
  verifier: string | null
  confirmer: string | null
  warnings: string[]
}

export function getIssueRoles(projectId: string, iid: number): RoleAssignmentView {
  const a = getAssignMode(projectId, iid)
  const preset = getPresetRoles(projectId, iid)
  const agent = a.mode === 'agent' && a.agentId ? getAgent(a.agentId) : null
  return {
    processor: { mode: a.mode, agentId: a.mode === 'agent' ? a.agentId : null, agentName: agent?.name ?? null },
    verifier: preset.verifier,
    confirmer: preset.confirmer,
  }
}

/** 처리자 에이전트 == 검증자 에이전트 금지 */
export function violatesSelfReview(processorAgentId: string | null | undefined, verifier: PresetRoleInfo | null | undefined): boolean {
  return !!processorAgentId && verifier?.mode === 'agent' && !!verifier.agentId && verifier.agentId === processorAgentId
}

/** 명부에서 그 역할의 에이전트 중 가장 한가한 것 (사용 가능한 것만, exclude 제외) */
export function pickLeastLoadedAgent(projectId: string, role: RoleKey, exclude: string[] = []): string | null {
  const now = Date.now()
  const project = getProject(projectId)
  const candidates = getRoleCandidates(projectId, role)
    .filter(c => c.subjectType === 'agent' && !exclude.includes(c.subjectId))
    .map(c => ({ id: c.subjectId, name: c.name, agent: getAgent(c.subjectId) }))
    // 사용 가능하고, 소유자가 지금도 이 프로젝트의 소유자·editor 인 에이전트만
    .filter(c => c.agent && isAgentAvailableNow(c.agent, now) && (!project || isAgentEligibleForProject(project, c.agent)))
    .map(c => ({ ...c, load: getAgentRoleLoad(c.id) }))
    .sort((a, b) => a.load - b.load || a.name.localeCompare(b.name))
  return candidates[0]?.id ?? null
}

/**
 * 「모든 단계 자동배정」 — 세 역할을 에이전트로 한꺼번에.
 * dryRun 이면 고르기만 하고 저장하지 않는다(화면 미리보기).
 */
export function autoAssignAllAgents(projectId: string, iid: number | null, opts: { dryRun?: boolean; isKo?: boolean } = {}): AutoAssignOutcome {
  const ko = opts.isKo !== false
  const warnings: string[] = []
  const processor = pickLeastLoadedAgent(projectId, 'process')
  if (!processor) warnings.push(ko ? '처리 역할 에이전트가 명부에 없습니다 — 처리자는 기존 방식(의뢰자 에이전트)으로 둡니다' : 'No processor agent in the roster')
  // 실제로 처리할 에이전트 — 새로 고르지 못했으면 이슈에 이미 지정된 처리 에이전트
  const current = iid != null ? getAssignMode(projectId, iid) : null
  const effectiveProcessor = processor ?? (current?.mode === 'agent' ? current.agentId : null)

  let verifier: string | null = null
  if (!agentRoleAvailable('verify')) {
    if (getRoleCandidates(projectId, 'verify').some(c => c.subjectType === 'agent')) {
      warnings.push(ko ? '검증 에이전트 작업자는 아직 없어(다음 단계에서 붙음) 검증자는 사람 기본값으로 둡니다' : 'Verify agents are not available yet — verifier stays a person')
    }
  } else {
    verifier = pickLeastLoadedAgent(projectId, 'verify', effectiveProcessor ? [effectiveProcessor] : [])
    if (!verifier) {
      const onlySame = effectiveProcessor && hasRole(projectId, 'verify', 'agent', effectiveProcessor)
      warnings.push(onlySame
        ? (ko ? '검증 역할 에이전트가 처리자와 같은 것뿐이라 배정하지 않았습니다(처리자 ≠ 검증자)' : 'Only the processor agent can verify — not assigned (processor ≠ verifier)')
        : (ko ? '검증 역할 에이전트가 명부에 없습니다 — 검증자는 사람 기본값으로 둡니다' : 'No verifier agent in the roster'))
    }
  }
  // 확인자는 처리자와 다른 에이전트를 우선(처리자가 자기 결과를 확인하지 않도록), 없으면 처리자라도 쓴다.
  const confirmer = pickLeastLoadedAgent(projectId, 'confirm', effectiveProcessor ? [effectiveProcessor] : [])
    ?? pickLeastLoadedAgent(projectId, 'confirm')
  if (!confirmer) warnings.push(ko ? '확인 역할 에이전트가 명부에 없습니다 — 확인자는 사람 기본값으로 둡니다' : 'No confirmer agent in the roster')

  if (!opts.dryRun && iid != null) {
    if (processor) setAssignMode(projectId, iid, 'agent', processor)
    const cur = getPresetRoles(projectId, iid)
    setPresetRoles(projectId, iid, {
      verifier: verifier ? { mode: 'agent', userId: null, username: null, agentId: verifier } : cur.verifier,
      confirmer: confirmer ? { mode: 'agent', userId: null, username: null, agentId: confirmer } : cur.confirmer,
    })
  }
  return { processor, verifier, confirmer, warnings }
}

function hasDefaults(d: RoleDefaults): boolean {
  return !!(d.autoAllAgents || d.processor || d.verifier || d.confirmer)
}

/**
 * 프로젝트 기본 배정을 이 이슈에 한 번 적용한다 (스캐너가 이슈를 스케줄(S)에서 처음 볼 때).
 * 이슈가 들어온 경로(issue_stages.intake_channel)로 기본 배정을 고른다 — IVE 등록 폼 / 작업 접수 페이지·API·Git 직접.
 * 기본 배정이 없는 프로젝트는 아무것도 하지 않는다(종전 동작). 이미 적용했거나 등록 폼에서 직접 고른 이슈도 건너뛴다.
 * @returns 적용했으면 true
 */
export function applyDefaultRoles(project: Project, iid: number, rolesInitializedAt: string | null, isKo = true): boolean {
  if (rolesInitializedAt) return false
  const d = roleDefaultsFor(getProjectAutomation(project.id).defaultRoles, getIssueIntakeChannel(project.id, iid))
  if (!hasDefaults(d)) return false
  const notes: string[] = []
  if (d.autoAllAgents) {
    notes.push(...autoAssignAllAgents(project.id, iid, { isKo }).warnings)
  } else {
    if (d.processor) {
      const p = d.processor
      if (p.mode === 'agent' && p.agentId && getAgent(p.agentId) && hasRole(project.id, 'process', 'agent', p.agentId)) setAssignMode(project.id, iid, 'agent', p.agentId)
      else if (p.mode === 'assignee') setAssignMode(project.id, iid, 'assignee')
    }
    const cur = getPresetRoles(project.id, iid)
    const valid = (r: PresetRoleInfo | null | undefined, role: 'verify' | 'confirm') =>
      (r && (r.mode !== 'agent' || (agentRoleAvailable(role) && r.agentId && getAgent(r.agentId) && hasRole(project.id, role, 'agent', r.agentId)))) ? r : null
    let verifier = valid(d.verifier, 'verify') ?? cur.verifier
    // 실제로 처리할 에이전트(기본값 적용 후) 기준으로 처리자 ≠ 검증자
    const pm = getAssignMode(project.id, iid)
    const processorAgent = pm.mode === 'agent' ? pm.agentId : null
    if (violatesSelfReview(processorAgent, verifier)) {
      notes.push(isKo ? '기본 배정의 처리자와 검증자가 같은 에이전트라 검증자는 적용하지 않았습니다' : 'Default verifier equals processor — skipped')
      verifier = cur.verifier
    }
    setPresetRoles(project.id, iid, { verifier, confirmer: valid(d.confirmer, 'confirm') ?? cur.confirmer })
  }
  markRolesInitialized(project.id, iid)
  if (notes.length) setStageWorkerNote(project.id, iid, notes.join(' / '))
  return true
}
