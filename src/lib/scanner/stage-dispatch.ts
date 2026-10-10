/**
 * 단계 작업자 기동 판정 — 스캐너가 프로젝트를 한 번 훑을 때마다 호출한다.
 *
 * 스캐너 원칙: 기동 여부는 DB 상태로 판단한다(노트·라벨 문자열로 스케줄링하지 않는다).
 *   - 그 단계의 배정(issue_stages.preset_*)이 에이전트인가
 *   - 열린 단계 실행 기록(task_executions ex-verify-* / ex-confirm-*)이 없는가
 *   - 지난 자동 실행 기록(판정·횟수)이 상한 안인가
 * 여기에 "MR 존재"(검증)와 "배포 사실"(확인: staging 이 내보내는 커밋에 머지 커밋이 들어 있는가)만 외부에서 확인한다.
 * staging 주소·배포 커밋 확인 방법은 IVE 프로젝트 설정(project_automation.staging)에서 읽는다.
 *
 * 기동하지 못하는 이유는 issue_stages.stage_worker_note 에 한 줄로 남겨 화면에 보인다(판정에는 쓰지 않는다).
 */
import { getLogger } from '../logger'
import { Project, Agent, isAgentAvailableNow } from '@/types'
import {
  getPresetRoles, getAgent, countActiveExecutionsByAgent, getProjectAutomation, getStagingSecrets,
  getSystemSetting, setStageWorkerNote, getStageWorkerNote, getIssueAutomationApproval, getRoster, getDb, hasRole,
  getLatestBundleItem, getAssignModeMap, byPriorityThenOldest, getUserById, getProjectAccess, getIssueIntakeChannel, recordWaitIfChanged,
  getAssignMode, getRoleCandidates, getAgentRoleLoad,
} from '../db'
import { isBotName } from '../git-bot'
import { extractIveAuthorId } from '../ive-author'
import { isAgentEligibleForProject } from '../project-permissions'
import { fetchMRByBranch, isAncestorCommit } from '../provider'
import { resolveStagingConfig, fetchDeployedCommit, resolveStagingBranch, type StagingConfig, type ConfigResult } from '../staging-config'
import { hasOpenStageExecution, countAgentStageRuns, countRunningAgentStage, newStageExecutionId, type StageKind } from './stage-records'
import { runConfirmWorker } from './confirm-worker'
import { runVerifyWorker } from './verify-worker'

const slog = getLogger('StageDispatch')

/** 같은 이슈의 기동 판정(외부 호출 포함)을 너무 자주 하지 않도록. 메모리 — 재시작하면 바로 다시 본다. */
const CHECK_INTERVAL_MS = 60_000
const lastCheckAt = new Map<string, number>()

export interface StageIssue { issue: any; stage: string }

function note(projectId: string, iid: number, text: string | null) {
  if (getStageWorkerNote(projectId, iid) !== text) {
    setStageWorkerNote(projectId, iid, text)
    // 사건 로그 — 검증·확인 작업자를 띄우지 못한 사유(바뀔 때만)
    if (text) recordWaitIfChanged(projectId, iid, 'stage_dispatch', { detail: { note: text } })
  }
}

function globalCap(kind: StageKind): number {
  const n = Number(getSystemSetting(`stage.${kind}.maxConcurrent`))
  return Number.isFinite(n) && n > 0 ? n : 2
}

/** 가장 최근의 에이전트 단계 실행 (판정·상태) */
function latestAgentStageRun(projectId: string, iid: number, kind: StageKind): { verdict: string | null; status: string } | null {
  const r = getDb().prepare(`
    SELECT stage_verdict as verdict, status FROM task_executions
    WHERE project_id = ? AND issue_iid = ? AND id LIKE ? AND assignee_type = 'agent'
    ORDER BY julianday(started_at) DESC LIMIT 1
  `).get(projectId, iid, `ex-${kind}-%`) as { verdict: string | null; status: string } | undefined
  return r ?? null
}

/** 이 이슈를 마지막으로 처리(D)한 에이전트 — 처리자 ≠ 검증자 확인용 */
function lastProcessorAgentId(projectId: string, iid: number): string | null {
  const r = getDb().prepare(`
    SELECT agent_id FROM task_executions
    WHERE project_id = ? AND issue_iid = ? AND id NOT LIKE 'ex-verify-%' AND id NOT LIKE 'ex-confirm-%' AND id NOT LIKE 'ex-reproduce-%'
      AND COALESCE(agent_id, '') != ''
    ORDER BY julianday(started_at) DESC LIMIT 1
  `).get(projectId, iid) as { agent_id: string } | undefined
  return r?.agent_id ?? null
}

/**
 * 외부에서 들어온 이슈의 본문은 곧 프롬프트다. 작성자가 프로젝트 사람(명부·Git 멤버)이거나 허용 목록에 있거나,
 * 사람이 이 이슈의 자동 실행을 한 번 승인했을 때만 단계 작업자를 기동한다.
 *
 * IVE 화면·로그인한 접수로 만든 이슈는 IVE 가 프로젝트 토큰(봇 계정)으로 만들어 Git 작성자가 봇이다. 이때는 본문의
 * ive-author 마커(실제 등록한 IVE 사용자)로 판정한다 — 그 사용자가 이 프로젝트의 소유자이거나 공유받은 사람이면 허용.
 * 마커는 Git 작성자가 봇일 때만 믿는다(사람이 Git 에 직접 이슈를 만들며 남의 마커를 적어 넣는 것을 막는다).
 * 공개 접수 창구는 입력 내용의 마커를 지우고, 로그인한 접수자일 때만 IVE 가 마커를 붙인다.
 */
export function isAutomationAllowed(project: Project, iid: number, issue: any): { ok: boolean; author: string | null } {
  const author: string | null = issue?.author?.username || issue?.author?.login || null
  if (getIssueAutomationApproval(project.id, iid).approvedAt) return { ok: true, author }
  if (!author) return { ok: false, author }
  if (isBotName(author)) {
    const iveUserId = extractIveAuthorId(issue?.description ?? issue?.body ?? '')
    const iveUser = iveUserId ? getUserById(iveUserId) : null
    if (iveUser && getProjectAccess(project.id, iveUser.id)) return { ok: true, author: iveUser.name }
  }
  // 작업 접수 페이지로 들어온 이슈 — 프로젝트가 「승인 없이 자동 실행」을 켰으면 허용 (서명된 접수 링크로만 들어오는 창구)
  if (getIssueIntakeChannel(project.id, iid) === 'report' && getProjectAutomation(project.id).defaultRoles.intakeAutoRun) return { ok: true, author }
  const allow = new Set(getProjectAutomation(project.id).authorAllowlist.map(s => s.toLowerCase()))
  if (allow.has(author.toLowerCase())) return { ok: true, author }
  const inRoster = getRoster(project.id).some(e => e.subjectType === 'user' && e.subjectId.toLowerCase() === author.toLowerCase())
  if (inRoster) return { ok: true, author }
  const member = getDb().prepare('SELECT 1 FROM project_members WHERE project_id = ? AND lower(username) = lower(?)').get(project.id, author)
  return { ok: !!member, author }
}

const ROLE_LABEL: Record<'verify' | 'confirm', string> = { verify: '검증', confirm: '확인' }

/**
 * 에이전트가 지금 이 프로젝트의 그 역할을 맡을 수 있는가 — 명부·자격·사용중지·다른 작업·동시 실행 상한.
 * 맡을 수 있으면 null, 아니면 그 이유 한 줄. (스캐너 관문과 화면의 「에이전트에게 맡기기」가 같이 쓴다)
 * pickedByHand — 사람이 이 작업의 작업자로 직접 고른 에이전트: 명부에 그 역할이 없어도 된다(소유자 자격은 그대로 본다).
 */
function agentNotReady(project: Project, agent: Agent, kind: 'verify' | 'confirm', busy: Set<string>, now = Date.now(), pickedByHand = false): string | null {
  const label = ROLE_LABEL[kind]
  const limits = getProjectAutomation(project.id).limits
  // 지금도 이 프로젝트의 명부에 그 역할로 있고, 소유자가 여전히 프로젝트 소유자·editor 인 에이전트만 돌린다
  if (!(pickedByHand || hasRole(project.id, kind, 'agent', agent.id)) || !isAgentEligibleForProject(project, agent)) {
    return `${label} 에이전트 '${agent.name}' 이(가) 이 프로젝트 명부에 없습니다 — ${label}자를 다시 지정해 주세요`
  }
  if (!isAgentAvailableNow(agent, now)) return `${label} 에이전트 '${agent.name}' 사용중지/휴가`
  if (busy.has(agent.id) || countActiveExecutionsByAgent(agent.id) > 0) return `${label} 에이전트 '${agent.name}' 다른 작업 중 — 대기`
  // 이번 판에 띄운 작업자도 실행 행이 즉시 생기므로 countRunningAgentStage 에 이미 들어 있다(따로 더하지 않는다)
  const projectCap = kind === 'verify' ? limits.verifyMaxConcurrent : limits.confirmMaxConcurrent
  if (countRunningAgentStage(kind) >= globalCap(kind) || countRunningAgentStage(kind, project.id) >= projectCap) {
    return `${label} 작업자 동시 실행 상한 — 대기`
  }
  return null
}

/**
 * 단계 작업자 공통 관문 — 순환 상한·재기동·작성자 허용·판정 간격·에이전트 자격·동시 실행 상한.
 * 통과하면 에이전트를, 아니면 null (이유는 이슈 메모에 남긴다).
 */
function passGate(
  project: Project, iid: number, issue: any, stage: string, kind: 'verify' | 'confirm', agentId: string, busy: Set<string>,
): Agent | null {
  const limits = getProjectAutomation(project.id).limits
  const label = ROLE_LABEL[kind]
  const runs = countAgentStageRuns(project.id, iid, kind)
  if (runs.crashed >= limits.maxAutoCycles) { note(project.id, iid, `${label} 작업자 비정상 종료 ${runs.crashed}회 — 사람 ${label} 필요`); return null }
  if (runs.fail >= limits.maxAutoCycles) { note(project.id, iid, `자동 ${label} 실패 ${runs.fail}회(상한 ${limits.maxAutoCycles}) — 사람 ${label} 필요`); return null }
  if (stage === (kind === 'verify' ? 'verifying' : 'confirming')) {
    // 진행 단계(V/C)인데 열린 기록이 없다 = 작업자가 중간에 죽었거나(재시작) 판단 불가로 멈춘 것.
    // 죽은 경우만 상한 안에서 다시 띄운다. 판단 불가(blocked)·이동 실패는 사람을 기다린다.
    const last = latestAgentStageRun(project.id, iid, kind)
    if (last && last.verdict) return null
  }
  const allowed = isAutomationAllowed(project, iid, issue)
  if (!allowed.ok) { note(project.id, iid, `작성자(${allowed.author || '알 수 없음'})가 허용 목록 밖 — 자동 실행 승인 필요`); return null }

  const key = `${kind}:${project.id}:${iid}`
  const now = Date.now()
  if (now - (lastCheckAt.get(key) || 0) < CHECK_INTERVAL_MS) return null
  lastCheckAt.set(key, now)

  const agent = getAgent(agentId)
  if (!agent) { note(project.id, iid, `${label} 에이전트가 삭제되었습니다`); return null }
  const notReady = agentNotReady(project, agent, kind, busy, now)
  if (notReady) { note(project.id, iid, notReady); return null }
  return agent
}

export async function dispatchStageWorkers(project: Project, issues: StageIssue[], token: string): Promise<void> {
  const busy = new Set<string>()
  // 우선순위(긴급 → 높음 → 보통) 높은 것부터, 같으면 먼저 생성된 것부터 — 에이전트가 하나씩 집으므로 순서가 곧 처리 순서다
  const priorityMap = getAssignModeMap(project.id)
  const order = new Map(byPriorityThenOldest(issues.map(i => ({ iid: i.issue.iid as number, created_at: i.issue.created_at as string | undefined })), iid => priorityMap.get(iid)?.priority ?? 0).map((x, n) => [x.iid, n]))
  issues = [...issues].sort((a, b) => (order.get(a.issue.iid) ?? 0) - (order.get(b.issue.iid) ?? 0))
  await dispatchVerify(project, issues.filter(i => i.stage === 'verify_waiting' || i.stage === 'verifying'), token, busy)
  await dispatchConfirm(project, issues.filter(i => i.stage === 'confirm_waiting' || i.stage === 'confirming'), token, busy)
}

const SAME_AS_PROCESSOR = '검증 에이전트가 이 이슈를 처리한 에이전트와 같습니다 — 검증자를 다시 지정해 주세요'

/**
 * 지금 검증할 수 있는가 — dev-{iid} MR 이 닫혀 있지 않은가. 할 수 있으면 그 MR(없으면 null — 코드 변경 없는 작업).
 */
async function resolveVerifyMR(project: Project, iid: number, token: string): Promise<{ ok: true; mr: any } | { ok: false; reason: string }> {
  let mr: any = null
  try { mr = await fetchMRByBranch(project, token, `dev-${iid}`) } catch (e) { slog.warn(`MR lookup failed #${iid}: ${(e as Error).message}`) }
  // MR 이 없으면 코드 변경 없이 끝난 작업(질문·조사·보고 등) — 코드 대신 작업자가 처리한 결과(마지막 보고)를 검증한다
  if (mr?.state === 'closed') return { ok: false, reason: `dev-${iid} MR 이 닫혀 있습니다 — 사람 검증 필요` }
  return { ok: true, mr }
}

function launchVerify(
  project: Project, issue: any, stage: 'verify_waiting' | 'verifying', agent: Agent, token: string, mr: any, target: string, busy: Set<string>,
) {
  const iid: number = issue.iid
  busy.add(agent.id)
  note(project.id, iid, null)
  const executionId = newStageExecutionId('verify')
  slog.info(`[DISPATCH] verify ${project.name} #${iid} → ${agent.name} (${mr ? `target ${target}` : '코드 변경 없음 — 작업자 보고 검증'})`)
  runVerifyWorker({
    project, issue, agent, token, stage, targetBranch: target,
    mrIid: mr ? (mr.iid ?? mr.number ?? null) : null, mrUrl: mr ? (mr.web_url || mr.html_url || null) : null, noChange: !mr,
  }, executionId).catch(err => slog.error({ err }, `[VERIFY] #${iid} failed`))
}

/** ③ 검증 — W/V 이고 검증자가 에이전트인 이슈 */
async function dispatchVerify(project: Project, verifyIssues: StageIssue[], token: string, busy: Set<string>): Promise<void> {
  let target: string | null = null
  for (const { issue, stage } of verifyIssues) {
    const iid: number = issue.iid
    const preset = getPresetRoles(project.id, iid).verifier
    if (preset.mode !== 'agent' || !preset.agentId) continue       // 사람이 검증 — 종전대로 기다린다
    if (hasOpenStageExecution(project.id, iid, 'verify')) continue  // 이미 누가(사람·에이전트) 검증 중
    // 자기 작업을 자기가 검수하지 않는다 — 실제로 처리한 에이전트 기준
    if (lastProcessorAgentId(project.id, iid) === preset.agentId) { note(project.id, iid, SAME_AS_PROCESSOR); continue }
    const agent = passGate(project, iid, issue, stage, 'verify', preset.agentId, busy)
    if (!agent) continue

    const r = await resolveVerifyMR(project, iid, token)
    if (!r.ok) { note(project.id, iid, r.reason); continue }
    target ??= await resolveStagingBranch(project, token)
    launchVerify(project, issue, stage as 'verify_waiting' | 'verifying', agent, token, r.mr, target, busy)
  }
}

/** 확인 작업자에게 넘길 확인 기준 — 배포된 커밋·머지 커밋(코드 변경 없는 작업이면 noChange) */
interface ConfirmTarget { deployedCommit: string; mergeCommit: string | null; mrUrl: string | null; noChange?: boolean; desc: string }
/** 한 번 훑는 동안 staging 설정·배포 커밋은 한 번만 읽는다 */
interface ConfirmLookup { staging: ConfigResult<StagingConfig> | null; deployed: ConfigResult<string> | null }
type TargetResult = { ok: true; target: ConfirmTarget } | { ok: false; reason: string; quiet?: boolean }

/**
 * 지금 확인할 수 있는가 — MR 머지 커밋이 staging 에 배포됐는가(코드 변경 없는 작업은 바로).
 * 못 하면 그 이유(quiet = 일시적인 조회 실패라 이슈 메모에 남기지 않는다).
 */
async function resolveConfirmTarget(project: Project, iid: number, token: string, lookup: ConfirmLookup): Promise<TargetResult> {
  let mergeCommit: string | null = null
  let mrUrl: string | null = null
  // 예전 묶음 배포로 staging 에 푸시된 이슈(묶음 배포를 없애기 전 기록) — 그 묶음의 머지 커밋이 기준
  const item = getLatestBundleItem(project.id, iid)
  if (item?.status === 'pushed' && item.mergeSha) {
    mergeCommit = item.mergeSha
    mrUrl = item.mrUrl
  } else {
    // MR 의 머지 커밋이 기준 — 검증 통과 즉시 IVE 가 머지했거나 사람이 머지했다
    let mr: any = null
    try { mr = await fetchMRByBranch(project, token, `dev-${iid}`) } catch (e) {
      slog.warn(`MR lookup failed #${iid}: ${(e as Error).message}`)
      return { ok: false, reason: `MR 조회 실패: ${(e as Error).message}`, quiet: true }
    }
    // MR 이 없으면 코드 변경 없이 끝난 작업(질문·조사·보고 등) — 배포를 기다리지 않고 처리 결과가 요건을 충족했는지 확인한다
    if (!mr) return { ok: true, target: { deployedCommit: '', mergeCommit: null, mrUrl: null, noChange: true, desc: '코드 변경 없음 — 처리 결과 확인' } }
    const merged = mr.state === 'merged' || !!mr.merged_at
    if (!merged) return { ok: false, reason: 'MR 이 아직 머지되지 않음 — 머지·배포 대기' }
    // fast-forward 머지는 머지 커밋이 없다 — MR 머리 커밋이 그대로 대상 브랜치에 올라간다
    mergeCommit = mr.merge_commit_sha || mr.squash_commit_sha || mr.sha || null
    mrUrl = mr.web_url || mr.html_url || null
    if (!mergeCommit) return { ok: false, reason: '머지 커밋을 알 수 없음 — 자동 확인 불가' }
  }

  // 코드 변경이 있는 작업은 staging 에 배포된 뒤 확인한다
  const staging = lookup.staging ??= resolveStagingConfig(project)
  if (!staging.ok) return { ok: false, reason: `${staging.reason} — 자동 확인 불가, 사람 확인 필요` }
  const deployed = lookup.deployed ??= await fetchDeployedCommit(staging.value, project, token)
  if (!deployed.ok) return { ok: false, reason: `staging 배포 커밋 확인 실패: ${deployed.reason}` }
  const included = await isAncestorCommit(project, token, mergeCommit, deployed.value)
  if (included === null) return { ok: false, reason: `배포 커밋(${deployed.value.slice(0, 8)}) 포함 여부 판정 불가 — 대기` }
  if (!included) return { ok: false, reason: `staging 배포 대기 (현재 ${deployed.value.slice(0, 8)}, 머지 ${mergeCommit.slice(0, 8)} 미포함)` }
  return { ok: true, target: { deployedCommit: deployed.value, mergeCommit, mrUrl, desc: `deployed ${deployed.value.slice(0, 8)} ⊇ merge ${mergeCommit.slice(0, 8)}` } }
}

function launchConfirm(
  project: Project, issue: any, stage: 'confirm_waiting' | 'confirming', agent: Agent, token: string,
  lookup: ConfirmLookup, target: ConfirmTarget, busy: Set<string>,
) {
  const iid: number = issue.iid
  busy.add(agent.id)
  note(project.id, iid, null)
  const executionId = newStageExecutionId('confirm')
  slog.info(`[DISPATCH] confirm ${project.name} #${iid} → ${agent.name} (${target.desc})`)
  const staging = lookup.staging ??= resolveStagingConfig(project)
  const st: StagingConfig = staging.ok ? staging.value : { url: '', versionSource: 'url', versionUrl: '', commitField: '', branch: null, notes: null }
  runConfirmWorker({
    project, issue, agent, token, stage,
    // 프로젝트 설정에 저장된 staging 비밀값(테스트 계정 등)을 환경변수로 넘긴다
    staging: st, deployedCommit: target.deployedCommit, mergeCommit: target.mergeCommit,
    mrUrl: target.mrUrl, secrets: getStagingSecrets(project.id), noChange: target.noChange,
  }, executionId).catch(err => slog.error({ err }, `[CONFIRM] #${iid} failed`))
}

/** ④ 확인 — P/C 이고 확인자가 에이전트인 이슈. MR 이 머지(검증 통과 즉시 IVE 가, 또는 사람이)되어 staging 에 배포된 뒤 기동한다 */
async function dispatchConfirm(project: Project, confirmIssues: StageIssue[], token: string, busy: Set<string>): Promise<void> {
  if (confirmIssues.length === 0) return
  const lookup: ConfirmLookup = { staging: null, deployed: null }

  for (const { issue, stage } of confirmIssues) {
    const iid: number = issue.iid
    const preset = getPresetRoles(project.id, iid).confirmer
    if (preset.mode !== 'agent' || !preset.agentId) continue       // 사람이 확인 — 종전대로 기다린다
    if (hasOpenStageExecution(project.id, iid, 'confirm')) continue // 이미 누가(사람·에이전트) 확인 중

    const agent = passGate(project, iid, issue, stage, 'confirm', preset.agentId, busy)
    if (!agent) continue

    const r = await resolveConfirmTarget(project, iid, token, lookup)
    if (!r.ok) { if (!r.quiet) note(project.id, iid, r.reason); continue }
    launchConfirm(project, issue, stage as 'confirm_waiting' | 'confirming', agent, token, lookup, r.target, busy)
  }
}

export type HandOffCheck =
  | { ok: true; agent: Agent; launch: () => void }
  | { ok: false; reason: string }

/** 검증대기·검증 중·확인대기·확인 중 — 사람이 그 단계 일을 에이전트에게 맡길 수 있는 단계 */
export type HandOffStage = 'verify_waiting' | 'verifying' | 'confirm_waiting' | 'confirming'

export function handOffKind(stage: string): 'verify' | 'confirm' | null {
  if (stage === 'verify_waiting' || stage === 'verifying') return 'verify'
  if (stage === 'confirm_waiting' || stage === 'confirming') return 'confirm'
  return null
}

/**
 * 「에이전트에게 맡기기」의 자동 배정 — 명부에서 그 역할을 가진 에이전트 중 지금 맡을 수 있는 것을 고른다.
 * 그 단계에 지정된 검증자·확인자 에이전트를 먼저 보고, 나머지는 한가한 순. 검증은 이 이슈를 처리한 에이전트를 뺀다.
 */
function pickHandOffAgent(project: Project, iid: number, kind: 'verify' | 'confirm'): { ok: true; agent: Agent } | { ok: false; reason: string } {
  const label = ROLE_LABEL[kind]
  const processor = kind === 'verify' ? lastProcessorAgentId(project.id, iid) : null
  const preset = getPresetRoles(project.id, iid)[kind === 'verify' ? 'verifier' : 'confirmer']
  const presetId = preset.mode === 'agent' ? preset.agentId : null
  const candidates = getRoleCandidates(project.id, kind)
    .filter(c => c.subjectType === 'agent' && c.subjectId !== processor)
    .map(c => ({ agent: getAgent(c.subjectId), load: getAgentRoleLoad(c.subjectId) }))
    .filter((c): c is { agent: Agent; load: number } => !!c.agent)
    .sort((a, b) => Number(b.agent.id === presetId) - Number(a.agent.id === presetId) || a.load - b.load || a.agent.name.localeCompare(b.agent.name))
  if (candidates.length === 0) {
    return { ok: false, reason: `명부에 ${label} 역할 에이전트가 없습니다 — 프로젝트 설정의 역할 명부에 넣거나, 입력창 위에서 작업자(에이전트)를 골라 주세요` }
  }
  const busy = new Set<string>()
  let firstReason: string | null = null
  for (const c of candidates) {
    const notReady = agentNotReady(project, c.agent, kind, busy)
    if (!notReady) return { ok: true, agent: c.agent }
    firstReason ??= notReady
  }
  return { ok: false, reason: candidates.length === 1 ? firstReason! : `지금 ${label}을 맡을 수 있는 에이전트가 없습니다 (${firstReason})` }
}

/**
 * 사람이 화면에서 「에이전트에게 맡기기」를 눌렀을 때 — 지금 바로 그 단계(검증·확인) 작업자를 띄울 수 있는지 본다.
 * agentId 가 없으면 맡을 수 있는 에이전트를 자동으로 고르고(pickHandOffAgent), 있으면 그 에이전트에게 맡긴다
 * — 이 작업의 작업자로 지정된 에이전트(입력창 위 작업자 선택)는 명부에 그 역할이 없어도 된다.
 *
 * 스캐너 관문(passGate)과 달리 사람이 직접 맡긴 것이라 자동 순환 상한·판단 불가(blocked) 뒤 대기·판정 간격은 보지 않는다.
 * 작성자 허용(외부 이슈 본문은 곧 프롬프트)·에이전트 자격·다른 작업·동시 실행 상한은 같은 기준으로 보고,
 * 검증은 처리자 ≠ 검증자·MR 이 닫혀 있지 않은가, 확인은 배포 사실을 스캐너와 같은 기준으로 본다.
 * 아무것도 바꾸지 않는다 — 호출 측이 검증자·확인자 배정과 사람 기록을 정리한 뒤 launch() 를 부른다.
 */
export async function checkStageHandOff(
  project: Project, issue: any, stage: HandOffStage, agentId: string | null, token: string,
): Promise<HandOffCheck> {
  const iid: number = issue.iid
  const kind = handOffKind(stage)!
  const label = ROLE_LABEL[kind]
  let agent: Agent
  if (agentId) {
    const picked = getAgent(agentId)
    if (!picked) return { ok: false, reason: `${label} 에이전트가 삭제되었습니다` }
    if (kind === 'verify' && lastProcessorAgentId(project.id, iid) === picked.id) return { ok: false, reason: SAME_AS_PROCESSOR }
    const designated = getAssignMode(project.id, iid)
    const notReady = agentNotReady(project, picked, kind, new Set(), Date.now(), designated.mode === 'agent' && designated.agentId === picked.id)
    if (notReady) return { ok: false, reason: notReady }
    agent = picked
  } else {
    const auto = pickHandOffAgent(project, iid, kind)
    if (!auto.ok) return auto
    agent = auto.agent
  }
  const allowed = isAutomationAllowed(project, iid, issue)
  if (!allowed.ok) return { ok: false, reason: `작성자(${allowed.author || '알 수 없음'})가 허용 목록 밖 — 자동 실행 승인 필요` }

  if (kind === 'verify') {
    const r = await resolveVerifyMR(project, iid, token)
    if (!r.ok) return { ok: false, reason: r.reason }
    const target = await resolveStagingBranch(project, token)
    return { ok: true, agent, launch: () => launchVerify(project, issue, stage as 'verify_waiting' | 'verifying', agent, token, r.mr, target, new Set()) }
  }
  const lookup: ConfirmLookup = { staging: null, deployed: null }
  const r = await resolveConfirmTarget(project, iid, token, lookup)
  if (!r.ok) return { ok: false, reason: r.reason }
  return { ok: true, agent, launch: () => launchConfirm(project, issue, stage as 'confirm_waiting' | 'confirming', agent, token, lookup, r.target, new Set()) }
}
