/**
 * 프로젝트별 단계 자동화 설정 — 기본 배정·안전장치·상한·staging 비밀값.
 *
 * 자동화 여부 자체는 역할 배정(사람/에이전트)으로 정해진다. 여기에는 "이슈마다 고르지 않아도 되게 하는
 * 기본 배정"과 안전장치만 둔다. 설정 행이 없는 프로젝트는 지금과 똑같이 동작한다(기본값 = 종전 동작).
 */
import { getDb } from './connection'
import { encrypt, decrypt } from '../crypto'
import type { PresetRoleInfo } from './issues'

/** 처리자 배정 — 기존 issue_stages.assign_mode 모델 그대로 (auto: 의뢰자 에이전트 풀 / assignee: 사람 / agent: 지정 에이전트) */
export interface ProcessorSpec {
  mode: 'auto' | 'assignee' | 'agent'
  agentId?: string | null
  /** assignee 모드에서 특정 사람을 Git 담당자로 지정할 때 (없으면 이슈에 이미 걸린 담당자를 기다린다) */
  userId?: string | null
  username?: string | null
}

export interface RoleDefaults {
  /** 「모든 단계 자동배정」— 이슈 시작 시 세 역할을 명부의 에이전트 중 가장 한가한 것으로 한꺼번에 지정 */
  autoAllAgents: boolean
  processor?: ProcessorSpec | null
  verifier?: PresetRoleInfo | null
  confirmer?: PresetRoleInfo | null
}

/** 기본 배정 — 이슈가 들어온 경로별. 본 값은 「IVE 에서 등록」, intake 는 「작업 접수 페이지·API·Git 직접 등록」 */
export interface DefaultRoles extends RoleDefaults {
  /** 접수 경로 기본 배정. null/없음 = IVE 등록과 같게 */
  intake?: RoleDefaults | null
  /** 작업 접수 페이지로 들어온 이슈는 이슈별 승인 없이 단계 작업자를 실행 (접수 페이지는 서명된 링크로만 들어오는 창구) */
  intakeAutoRun?: boolean
}

export type IntakeChannel = 'ive' | 'report' | null

/** 이 경로의 이슈에 적용할 기본 배정 */
export function roleDefaultsFor(d: DefaultRoles, channel: IntakeChannel): RoleDefaults {
  if (channel !== 'ive' && d.intake) return d.intake
  return { autoAllAgents: d.autoAllAgents, processor: d.processor, verifier: d.verifier, confirmer: d.confirmer }
}

export interface AutomationLimits {
  /** 확인(④) 작업자 동시 실행 상한 — 프로젝트별. 전역 상한은 system_settings 'stage.confirm.maxConcurrent' */
  confirmMaxConcurrent: number
  confirmMaxTurns: number
  confirmTimeoutMin: number
  /** 검증(③) 작업자 동시 실행 상한 — 프로젝트별. 전역 상한은 system_settings 'stage.verify.maxConcurrent' */
  verifyMaxConcurrent: number
  verifyMaxTurns: number
  verifyTimeoutMin: number
  /** 이슈별 자동 순환(검증 반려·확인 실패 → 재작업) 상한. 넘으면 자동 기동하지 않고 사람을 기다린다 */
  maxAutoCycles: number
}

export const DEFAULT_LIMITS: AutomationLimits = {
  confirmMaxConcurrent: 2,
  confirmMaxTurns: 80,
  confirmTimeoutMin: 30,
  verifyMaxConcurrent: 2,
  verifyMaxTurns: 60,
  verifyTimeoutMin: 30,
  maxAutoCycles: 3,
}

/** 확인(④) 단계가 쓰는 staging 정보 — 해석·검증은 src/lib/staging-config.ts */
export interface StagingSettings {
  url: string
  /** 배포된 커밋을 아는 방법 — url: 버전 주소 응답 / pipeline: staging 브랜치의 마지막 성공 파이프라인(배포 잡) 커밋 */
  versionSource: 'url' | 'pipeline'
  versionUrl: string
  commitField: string
  branch: string
  notes: string
}

const EMPTY_STAGING: StagingSettings = { url: '', versionSource: 'url', versionUrl: '', commitField: 'commit', branch: '', notes: '' }

/** 묶음 배포(3.5.1) — 검증 통과 이슈를 모아 staging 에 한 번 푸시한다 */
export interface BundleSettings {
  /** 꺼져 있으면 묶음이 출발 조건을 채워도 사람이 「출발 승인」을 눌러야 머지·푸시한다 */
  agentMerge: boolean
  /** 대기 N건이면 출발 */
  maxWaiting: number
  /** 마지막 추가 후 T분 조용하면 출발 */
  quietMin: number
  /** 정해진 시각에 출발 (HH:MM, 쉼표 구분, 프로젝트 소유자 시간대). 비면 쓰지 않는다 */
  times: string
  /** 한 묶음에 싣는 최대 건수 */
  maxSize: number
  /** 검사 명령(줄마다 하나) — 검증(③)과 묶음 출발 때 IVE 컨테이너에서 실행. 외부 서비스 없이 도는 명령만 */
  checkCommands: string
  checkTimeoutMin: number
}

export const DEFAULT_BUNDLE: BundleSettings = {
  agentMerge: false,
  maxWaiting: 5,
  quietMin: 30,
  times: '',
  maxSize: 10,
  checkCommands: '',
  checkTimeoutMin: 20,
}

export interface ProjectAutomation {
  defaultRoles: DefaultRoles
  /** 자동 실행을 허용할 이슈 작성자(Git username). 프로젝트 역할 명부의 사람은 따로 적지 않아도 허용된다 */
  authorAllowlist: string[]
  /** 비밀값 이름만 (값은 절대 내보내지 않는다) */
  stagingSecretNames: string[]
  limits: AutomationLimits
  staging: StagingSettings
  bundle: BundleSettings
  /**
   * MR 머지로 이슈 자동 닫기 (기본 켬 = 종전 동작). 켜면 처리(D) 커밋·MR 문구에 Git 닫기 키워드(「fix: resolve #N」)를 넣어
   * 기본 브랜치에 머지되는 순간 Git 이 이슈를 닫는다. 끄면 「fix(#N): …」 — 이슈는 확인을 거쳐 완료(E)가 될 때 IVE 가 닫는다.
   */
  closeIssueOnMerge: boolean
  updatedAt: string | null
}

const EMPTY_DEFAULT_ROLES: DefaultRoles = { autoAllAgents: false }

function parseJson<T>(raw: string | null | undefined, fallback: T): T {
  if (!raw) return fallback
  try { return JSON.parse(raw) as T } catch { return fallback }
}

function readSecrets(raw: string | null | undefined): Record<string, string> {
  if (!raw) return {}
  return parseJson<Record<string, string>>(decrypt(raw), {})
}

export function getProjectAutomation(projectId: string): ProjectAutomation {
  const r = getDb().prepare('SELECT * FROM project_automation WHERE project_id = ?').get(projectId) as any
  return {
    defaultRoles: { ...EMPTY_DEFAULT_ROLES, ...parseJson<DefaultRoles>(r?.default_roles, EMPTY_DEFAULT_ROLES) },
    authorAllowlist: parseJson<string[]>(r?.author_allowlist, []),
    stagingSecretNames: Object.keys(readSecrets(r?.staging_secrets)),
    limits: { ...DEFAULT_LIMITS, ...parseJson<Partial<AutomationLimits>>(r?.limits, {}) },
    staging: { ...EMPTY_STAGING, ...parseJson<Partial<StagingSettings>>(r?.staging, {}) },
    bundle: { ...DEFAULT_BUNDLE, ...parseJson<Partial<BundleSettings>>(r?.bundle, {}) },
    closeIssueOnMerge: r?.close_on_merge == null ? true : !!r.close_on_merge,
    updatedAt: r?.updated_at ?? null,
  }
}

/** 단계 실행 시 환경변수로만 넣는 비밀값 (복호화). 로그·코멘트에 쓰지 말 것. */
export function getStagingSecrets(projectId: string): Record<string, string> {
  const r = getDb().prepare('SELECT staging_secrets FROM project_automation WHERE project_id = ?').get(projectId) as any
  return readSecrets(r?.staging_secrets)
}

export interface ProjectAutomationPatch {
  defaultRoles?: DefaultRoles
  authorAllowlist?: string[]
  limits?: Partial<AutomationLimits>
  staging?: Partial<StagingSettings>
  bundle?: Partial<BundleSettings>
  closeIssueOnMerge?: boolean
  /** 이름 → 값. 값이 null 이면 삭제, 빈 문자열이면 그대로 둔다(화면 마스킹 값) */
  stagingSecrets?: Record<string, string | null>
}

export function updateProjectAutomation(projectId: string, patch: ProjectAutomationPatch, updatedBy: string | null) {
  const db = getDb()
  const cur = db.prepare('SELECT * FROM project_automation WHERE project_id = ?').get(projectId) as any
  const defaultRoles = patch.defaultRoles ?? parseJson<DefaultRoles>(cur?.default_roles, EMPTY_DEFAULT_ROLES)
  const allowlist = patch.authorAllowlist ?? parseJson<string[]>(cur?.author_allowlist, [])
  const limits = { ...parseJson<Partial<AutomationLimits>>(cur?.limits, {}), ...(patch.limits || {}) }
  const staging = { ...EMPTY_STAGING, ...parseJson<Partial<StagingSettings>>(cur?.staging, {}), ...(patch.staging || {}) }
  const bundle = { ...DEFAULT_BUNDLE, ...parseJson<Partial<BundleSettings>>(cur?.bundle, {}), ...(patch.bundle || {}) }
  let secretsRaw: string = cur?.staging_secrets || ''
  if (patch.stagingSecrets) {
    if (secretsRaw && decrypt(secretsRaw) === secretsRaw) {
      // 암호화 키가 바뀌는 등으로 기존 비밀값을 풀 수 없다 — 조용히 지우지 않고 막는다
      throw new Error('저장된 staging 비밀값을 복호화할 수 없습니다(ENCRYPTION_KEY 확인). 기존 값을 지키기 위해 저장하지 않았습니다')
    }
    const secrets = readSecrets(secretsRaw)
    for (const [name, value] of Object.entries(patch.stagingSecrets)) {
      if (value === null) delete secrets[name]
      else if (value !== '') secrets[name] = value
    }
    secretsRaw = Object.keys(secrets).length ? encrypt(JSON.stringify(secrets)) : ''
  }
  db.prepare(`
    INSERT INTO project_automation (project_id, default_roles, author_allowlist, staging_secrets, limits, staging, bundle, updated_by, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, datetime('now'))
    ON CONFLICT(project_id) DO UPDATE SET
      default_roles = excluded.default_roles, author_allowlist = excluded.author_allowlist,
      staging_secrets = excluded.staging_secrets, limits = excluded.limits, staging = excluded.staging,
      bundle = excluded.bundle, updated_by = excluded.updated_by, updated_at = datetime('now')
  `).run(projectId, JSON.stringify(defaultRoles), JSON.stringify(allowlist), secretsRaw, JSON.stringify(limits), JSON.stringify(staging), JSON.stringify(bundle), updatedBy)
  if (patch.closeIssueOnMerge !== undefined) {
    db.prepare('UPDATE project_automation SET close_on_merge = ? WHERE project_id = ?').run(patch.closeIssueOnMerge ? 1 : 0, projectId)
  }
}

// ── 외부 작성자 이슈의 자동 실행 승인 ──

export function getIssueAutomationApproval(projectId: string, issueIid: number): { approvedAt: string | null; approvedBy: string | null } {
  const r = getDb().prepare('SELECT automation_approved_at, automation_approved_by FROM issue_stages WHERE project_id = ? AND issue_iid = ?')
    .get(projectId, issueIid) as any
  return { approvedAt: r?.automation_approved_at ?? null, approvedBy: r?.automation_approved_by ?? null }
}

export function approveIssueAutomation(projectId: string, issueIid: number, userId: string) {
  getDb().prepare(`
    INSERT INTO issue_stages (project_id, issue_iid, stage, automation_approved_at, automation_approved_by, updated_at)
    VALUES (?, ?, '', datetime('now'), ?, datetime('now'))
    ON CONFLICT(project_id, issue_iid) DO UPDATE SET
      automation_approved_at = excluded.automation_approved_at, automation_approved_by = excluded.automation_approved_by
  `).run(projectId, issueIid, userId)
}

/** 스캐너가 본 이슈 작성자(Git username) — 허용 목록 판정용 캐시 */
export function setIssueAuthorUsername(projectId: string, issueIid: number, username: string | null) {
  getDb().prepare(`
    INSERT INTO issue_stages (project_id, issue_iid, stage, author_username, updated_at)
    VALUES (?, ?, '', ?, datetime('now'))
    ON CONFLICT(project_id, issue_iid) DO UPDATE SET author_username = excluded.author_username
  `).run(projectId, issueIid, username)
}

/** 이슈가 들어온 경로 기록 (IVE 등록 폼·작업 접수 페이지가 이슈를 만든 직후) */
export function setIssueIntakeChannel(projectId: string, issueIid: number, channel: 'ive' | 'report') {
  getDb().prepare(`
    INSERT INTO issue_stages (project_id, issue_iid, stage, intake_channel, updated_at)
    VALUES (?, ?, '', ?, datetime('now'))
    ON CONFLICT(project_id, issue_iid) DO UPDATE SET intake_channel = excluded.intake_channel
  `).run(projectId, issueIid, channel)
}

export function getIssueIntakeChannel(projectId: string, issueIid: number): IntakeChannel {
  const r = getDb().prepare('SELECT intake_channel FROM issue_stages WHERE project_id = ? AND issue_iid = ?').get(projectId, issueIid) as any
  return r?.intake_channel === 'ive' || r?.intake_channel === 'report' ? r.intake_channel : null
}

/** 단계 작업자가 기동하지 못한 이유 등 사람이 봐야 할 한 줄 (화면 표시용). null 이면 지운다. */
export function setStageWorkerNote(projectId: string, issueIid: number, note: string | null) {
  getDb().prepare(`
    INSERT INTO issue_stages (project_id, issue_iid, stage, stage_worker_note, updated_at)
    VALUES (?, ?, '', ?, datetime('now'))
    ON CONFLICT(project_id, issue_iid) DO UPDATE SET stage_worker_note = excluded.stage_worker_note
  `).run(projectId, issueIid, note)
}

export function getStageWorkerNote(projectId: string, issueIid: number): string | null {
  const r = getDb().prepare('SELECT stage_worker_note FROM issue_stages WHERE project_id = ? AND issue_iid = ?').get(projectId, issueIid) as any
  return r?.stage_worker_note ?? null
}
