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
  // 지금도 이 프로젝트의 명부에 그 역할로 있고, 소유자가 여전히 프로젝트 소유자·editor 인 에이전트만 돌린다
  if (!hasRole(project.id, kind, 'agent', agent.id) || !isAgentEligibleForProject(project, agent)) {
    note(project.id, iid, `${label} 에이전트 '${agent.name}' 이(가) 이 프로젝트 명부에 없습니다 — ${label}자를 다시 지정해 주세요`)
    return null
  }
  if (!isAgentAvailableNow(agent, now)) { note(project.id, iid, `${label} 에이전트 '${agent.name}' 사용중지/휴가`); return null }
  if (busy.has(agent.id) || countActiveExecutionsByAgent(agent.id) > 0) { note(project.id, iid, `${label} 에이전트 '${agent.name}' 다른 작업 중 — 대기`); return null }
  // 이번 판에 띄운 작업자도 실행 행이 즉시 생기므로 countRunningAgentStage 에 이미 들어 있다(따로 더하지 않는다)
  const projectCap = kind === 'verify' ? limits.verifyMaxConcurrent : limits.confirmMaxConcurrent
  if (countRunningAgentStage(kind) >= globalCap(kind) || countRunningAgentStage(kind, project.id) >= projectCap) {
    note(project.id, iid, `${label} 작업자 동시 실행 상한 — 대기`)
    return null
  }
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

/** ③ 검증 — W/V 이고 검증자가 에이전트인 이슈 */
async function dispatchVerify(project: Project, verifyIssues: StageIssue[], token: string, busy: Set<string>): Promise<void> {
  let target: string | null = null
  for (const { issue, stage } of verifyIssues) {
    const iid: number = issue.iid
    const preset = getPresetRoles(project.id, iid).verifier
    if (preset.mode !== 'agent' || !preset.agentId) continue       // 사람이 검증 — 종전대로 기다린다
    if (hasOpenStageExecution(project.id, iid, 'verify')) continue  // 이미 누가(사람·에이전트) 검증 중
    // 자기 작업을 자기가 검수하지 않는다 — 실제로 처리한 에이전트 기준
    if (lastProcessorAgentId(project.id, iid) === preset.agentId) {
      note(project.id, iid, '검증 에이전트가 이 이슈를 처리한 에이전트와 같습니다 — 검증자를 다시 지정해 주세요')
      continue
    }
    const agent = passGate(project, iid, issue, stage, 'verify', preset.agentId, busy)
    if (!agent) continue

    let mr: any = null
    try { mr = await fetchMRByBranch(project, token, `dev-${iid}`) } catch (e) { slog.warn(`MR lookup failed #${iid}: ${(e as Error).message}`) }
    // MR 이 없으면 코드 변경 없이 끝난 작업(질문·조사·보고 등) — 코드 대신 작업자가 처리한 결과(마지막 보고)를 검증한다
    if (mr?.state === 'closed') { note(project.id, iid, `dev-${iid} MR 이 닫혀 있습니다 — 사람 검증 필요`); continue }

    target ??= await resolveStagingBranch(project, token)
    busy.add(agent.id)
    note(project.id, iid, null)
    const executionId = newStageExecutionId('verify')
    slog.info(`[DISPATCH] verify ${project.name} #${iid} → ${agent.name} (${mr ? `target ${target}` : '코드 변경 없음 — 작업자 보고 검증'})`)
    runVerifyWorker({
      project, issue, agent, token, stage: stage as 'verify_waiting' | 'verifying', targetBranch: target,
      mrIid: mr ? (mr.iid ?? mr.number ?? null) : null, mrUrl: mr ? (mr.web_url || mr.html_url || null) : null, noChange: !mr,
    }, executionId).catch(err => slog.error({ err }, `[VERIFY] #${iid} failed`))
  }
}

/** ④ 확인 — P/C 이고 확인자가 에이전트인 이슈. MR 이 머지(검증 통과 즉시 IVE 가, 또는 사람이)되어 staging 에 배포된 뒤 기동한다 */
async function dispatchConfirm(project: Project, confirmIssues: StageIssue[], token: string, busy: Set<string>): Promise<void> {
  if (confirmIssues.length === 0) return
  let staging: ConfigResult<StagingConfig> | null = null
  let deployed: ConfigResult<string> | null = null

  for (const { issue, stage } of confirmIssues) {
    const iid: number = issue.iid
    const preset = getPresetRoles(project.id, iid).confirmer
    if (preset.mode !== 'agent' || !preset.agentId) continue       // 사람이 확인 — 종전대로 기다린다
    if (hasOpenStageExecution(project.id, iid, 'confirm')) continue // 이미 누가(사람·에이전트) 확인 중

    const agent = passGate(project, iid, issue, stage, 'confirm', preset.agentId, busy)
    if (!agent) continue

    staging ??= resolveStagingConfig(project)
    // 프로젝트 설정에 저장된 staging 비밀값(테스트 계정 등)을 환경변수로 넘긴다
    const secrets = getStagingSecrets(project.id)
    const launch = (args: { deployedCommit: string; mergeCommit: string | null; mrUrl: string | null; noChange?: boolean; desc: string }) => {
      busy.add(agent.id)
      note(project.id, iid, null)
      const executionId = newStageExecutionId('confirm')
      slog.info(`[DISPATCH] confirm ${project.name} #${iid} → ${agent.name} (${args.desc})`)
      const st: StagingConfig = staging!.ok ? staging!.value : { url: '', versionSource: 'url', versionUrl: '', commitField: '', branch: null, notes: null }
      runConfirmWorker({
        project, issue, agent, token, stage: stage as 'confirm_waiting' | 'confirming',
        staging: st, deployedCommit: args.deployedCommit, mergeCommit: args.mergeCommit,
        mrUrl: args.mrUrl, secrets, noChange: args.noChange,
      }, executionId).catch(err => slog.error({ err }, `[CONFIRM] #${iid} failed`))
    }

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
      try { mr = await fetchMRByBranch(project, token, `dev-${iid}`) } catch (e) { slog.warn(`MR lookup failed #${iid}: ${(e as Error).message}`); continue }
      // MR 이 없으면 코드 변경 없이 끝난 작업(질문·조사·보고 등) — 배포를 기다리지 않고 처리 결과가 요건을 충족했는지 확인한다
      if (!mr) { launch({ deployedCommit: '', mergeCommit: null, mrUrl: null, noChange: true, desc: '코드 변경 없음 — 처리 결과 확인' }); continue }
      const merged = mr.state === 'merged' || !!mr.merged_at
      if (!merged) { note(project.id, iid, 'MR 이 아직 머지되지 않음 — 머지·배포 대기'); continue }
      // fast-forward 머지는 머지 커밋이 없다 — MR 머리 커밋이 그대로 대상 브랜치에 올라간다
      mergeCommit = mr.merge_commit_sha || mr.squash_commit_sha || mr.sha || null
      mrUrl = mr.web_url || mr.html_url || null
      if (!mergeCommit) { note(project.id, iid, '머지 커밋을 알 수 없음 — 자동 확인 불가'); continue }
    }

    // 코드 변경이 있는 작업은 staging 에 배포된 뒤 확인한다
    if (!staging.ok) { note(project.id, iid, `${staging.reason} — 자동 확인 불가, 사람 확인 필요`); continue }
    deployed ??= await fetchDeployedCommit(staging.value, project, token)
    if (!deployed.ok) { note(project.id, iid, `staging 배포 커밋 확인 실패: ${deployed.reason}`); continue }
    const included = await isAncestorCommit(project, token, mergeCommit, deployed.value)
    if (included === null) { note(project.id, iid, `배포 커밋(${deployed.value.slice(0, 8)}) 포함 여부 판정 불가 — 대기`); continue }
    if (!included) { note(project.id, iid, `staging 배포 대기 (현재 ${deployed.value.slice(0, 8)}, 머지 ${mergeCommit.slice(0, 8)} 미포함)`); continue }

    launch({ deployedCommit: deployed.value, mergeCommit, mrUrl, desc: `deployed ${deployed.value.slice(0, 8)} ⊇ merge ${mergeCommit.slice(0, 8)}` })
  }
}
