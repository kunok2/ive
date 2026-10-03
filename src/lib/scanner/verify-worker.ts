/**
 * ③ 검증(verify) 단계 작업자 — 처리자가 만든 MR 을 검증자 에이전트가 코드 수준에서 검증한다.
 *
 * 기동 조건(DB 상태)은 stage-dispatch 가 판정한다. 여기서는:
 *   1) W 면 V 로 옮기고(start_verification) 실행 기록 ex-verify-* 를 연다(에이전트, 중복 방지)
 *   2) staging 브랜치를 받아 MR 커밋(dev-{iid})과 시험 머지(충돌 확인) → diff 준비 → MR 커밋으로 체크아웃
 *   3) 프로젝트 설정의 검사 명령을 IVE 가 직접 실행(종료 코드로 판정) — 서버를 띄우지 않는다
 *   4) 검증자 에이전트가 diff 를 라인 단위로 리뷰하고 .ive-out/result.json 을 쓴다
 *   5) 판정 → 증적 보관 → 결과 코멘트 하나(+ ive-meta stage: verify)
 *   6) 통과 → approve(→P) + 묶음 대기열에 올림(바로 머지하지 않는다, 3.5.1)
 *      실패 → reject(→S). 결과 코멘트가 다음 처리(D)의 피드백이 된다
 *      판단 불가 → V 에 두고 사람을 기다린다
 *
 * 검사 실패·충돌은 에이전트 판정과 무관하게 IVE 가 fail 로 처리한다(통과를 말로 만들 수 없다).
 */
import fs from 'fs'
import path from 'path'
import { promisify } from 'util'
import { getLogger } from '../logger'
import { Project, Agent } from '@/types'
import {
  getExecution, updateExecutionStatus, markIssueVerifyStarted, markIssueVerified, markIssueVerifyRejected,
  resetIssueScheduledAt, setStageWorkerNote, getProjectAutomation, stageFromLabels, getPresetRoles, enqueueBundleItem,
} from '../db'
import { addIssueComment, fetchSingleIssue, fetchIssueNotes } from '../provider'
import { applyStageAction } from '../stage-apply'
import { agentActor } from '../event-actor'
import { applyRoleAssignee } from '../role-assignee'
import { maskSecrets } from '../secret-mask'
import { getIveBaseUrl } from '../slack-notify'
import { buildVerifyPrompt, resolveEditable, VERIFY_EDITABLE_DEFAULT, VERIFY_RESULT_MARKER } from '../role-prompts'
import { collectEvidence, evidenceDir, evidenceStamp } from '../evidence'
import { parseCheckCommands, runCheckCommands, type CheckResult } from '../stage-checks'
import { authedRepoUrl } from './git-ops'
import { openAgentStageExecution, setStageVerdict } from './stage-records'
import { runStageWorker, type StageKindSpec, type StageContext } from './stage-worker'

const execFile = promisify(require('child_process').execFile)
const slog = getLogger('VerifyWorker')
const OUT_DIR = '.ive-out'
const GIT_ID = ['-c', 'user.name=IVE', '-c', 'user.email=ive@localhost']

export interface VerifyInput {
  project: Project
  issue: any
  agent: Agent
  token: string
  /** 기동 시점 단계: verify_waiting(W) 이면 V 로 옮기고 시작, verifying(V) 이면 이어서 */
  stage: 'verify_waiting' | 'verifying'
  targetBranch: string
  mrIid: number | null
  mrUrl: string | null
}

interface VerifyPrep {
  sourceSha: string
  behindTarget: boolean
  conflictFiles: string[]
  changedFiles: string[]
  checks: CheckResult[]
  checkCommands: string[]
  e2eScript: string | null
  startedAt: string
  /** 사람이 쓴 이슈 코멘트(요건 정정·재작업 지시) — 검증자가 요건을 빠짐없이 대조하도록 프롬프트에 싣는다 */
  comments: string
}

type Verdict = 'pass' | 'fail' | 'blocked'

/**
 * 지적은 두 종류뿐이다 — missing(요건은 있는데 구현 안 됨), defect(구현했는데 틀림).
 * severity 는 예전 결과(blocker/major/minor)와 근거 화면 호환용 — 새 결과는 kind 로 채운다.
 */
export interface VerifyFinding { kind: 'missing' | 'defect' | null; severity: string; file: string; line: number | null; note: string }

/** 이슈에서 뽑은 요건 하나와 구현 여부 */
export interface VerifyRequirement { item: string; status: 'done' | 'missing'; where: string }

export interface VerifyResult {
  verdict: Verdict
  summary: string
  reason: string
  requirements: VerifyRequirement[]
  findings: VerifyFinding[]
  commands: string[]
}

function kstIso(iso: string): string {
  const d = new Date(new Date(iso).getTime() + 9 * 3600_000)
  return d.toISOString().replace(/\.\d{3}Z$/, '+09:00')
}

export function parseVerifyResult(workspacePath: string, logPath: string): VerifyResult {
  let raw: any = null
  try { raw = JSON.parse(fs.readFileSync(path.join(workspacePath, OUT_DIR, 'result.json'), 'utf8')) } catch { /* 없음 */ }
  let marker: Verdict | null = null
  try {
    const m = fs.readFileSync(logPath, 'utf8').match(new RegExp(`${VERIFY_RESULT_MARKER}\\s*(pass|fail|blocked)`, 'gi'))
    if (m && m.length) marker = m[m.length - 1].split(/\s+/).pop()!.toLowerCase() as Verdict
  } catch { /* ignore */ }
  if (!raw) {
    return {
      verdict: 'blocked', summary: '', requirements: [], findings: [], commands: [],
      reason: marker ? `결과 파일(result.json)이 없습니다 (마지막 출력: ${marker})` : '검증 작업자가 결과 파일(result.json)을 남기지 않았습니다',
    }
  }
  const v = String(raw.verdict || '').toLowerCase()
  const verdict: Verdict = v === 'pass' || v === 'fail' || v === 'blocked' ? v : 'blocked'
  const arr = (x: unknown) => (Array.isArray(x) ? x : [])
  return {
    verdict,
    summary: String(raw.summary || ''),
    reason: String(raw.reason || (verdict === 'blocked' && !v ? '판정 값이 없습니다' : '')),
    requirements: arr(raw.requirements).map((q: any) => ({
      item: String(q?.item || ''), status: String(q?.status || '').toLowerCase() === 'done' ? 'done' as const : 'missing' as const, where: String(q?.where || ''),
    })).filter(q => q.item),
    findings: arr(raw.findings).map((f: any) => {
      const k = String(f?.kind || '').toLowerCase()
      const kind: VerifyFinding['kind'] = k === 'missing' || k === 'defect' ? k : null
      return {
        kind, severity: String(f?.severity || kind || 'minor'), file: String(f?.file || ''),
        line: Number.isFinite(Number(f?.line)) && Number(f?.line) > 0 ? Number(f.line) : null, note: String(f?.note || ''),
      }
    }).filter(f => f.note),
    commands: arr(raw.commands).map(String),
  }
}

/**
 * 에이전트 판정에 IVE 가 확인한 사실을 덮는다 — 검사 실패·충돌이면 통과일 수 없다.
 * (에이전트가 blocked 라도 검사 실패·충돌은 처리자가 고칠 일이므로 fail 로 돌려보낸다.)
 */
export function enforceVerifyVerdict(r: VerifyResult, checks: CheckResult[], conflictFiles: string[], isKo = true): VerifyResult {
  const reasons: string[] = []
  // 검증 기준(요건 누락 0 · 구현 오류 0)과 어긋난 통과는 통과가 아니다 — 에이전트 판정보다 그가 적은 사실을 믿는다
  if (r.verdict === 'pass') {
    const missing = r.requirements.filter(q => q.status === 'missing').length
    if (missing) reasons.push(isKo ? `구현되지 않은 요건 ${missing}개` : `${missing} requirement(s) not implemented`)
    if (r.findings.length) reasons.push(isKo ? `지적 ${r.findings.length}건` : `${r.findings.length} finding(s)`)
  }
  const failed = checks.find(c => !c.ok)
  if (failed) reasons.push(isKo ? `검사 명령 실패: \`${failed.command}\`${failed.timedOut ? ' (시간 초과)' : ` (종료 코드 ${failed.exitCode})`}` : `Check failed: \`${failed.command}\``)
  if (conflictFiles.length) reasons.push(isKo ? `staging 최신본과 충돌: ${conflictFiles.join(', ')}` : `Conflicts with staging: ${conflictFiles.join(', ')}`)
  if (!reasons.length) return r
  return { ...r, verdict: 'fail', reason: [reasons.join(' / '), r.verdict === 'fail' ? r.reason : ''].filter(Boolean).join(' — ') }
}

const VERDICT_TITLE: Record<Verdict, { ko: string; en: string }> = {
  pass: { ko: '✅ 검증 통과 — 묶음 배포 대기', en: '✅ Verified — queued for bundle deploy' },
  fail: { ko: '❌ 검증 반려 — 재작업 필요', en: '❌ Rejected — rework needed' },
  blocked: { ko: '⚠️ 검증 불가 — 사람 검증 필요', en: '⚠️ Could not verify — needs a person' },
}

async function git(cwd: string, args: string[]): Promise<string> {
  const r = await execFile('git', args, { cwd, maxBuffer: 64 * 1024 * 1024 })
  return String(r.stdout)
}

function checksSection(checks: CheckResult[], commands: string[], isKo: boolean): string {
  if (!commands.length) return isKo ? '(프로젝트 설정에 검사 명령이 없다 — 리뷰로만 판정한다)' : '(no check commands configured — review only)'
  const lines = checks.map(c => `- \`${c.command}\` → ${c.ok ? '통과' : c.timedOut ? '시간 초과' : `실패(종료 코드 ${c.exitCode})`} (${c.durationSec}s)${c.ok ? '' : `\n\`\`\`\n${c.outputTail.slice(-1500)}\n\`\`\``}`)
  const skipped = commands.slice(checks.length).map(c => `- \`${c}\` → 앞 명령 실패로 실행 안 함`)
  return [...lines, ...skipped].join('\n')
}

async function buildComment(ctx: StageContext, input: VerifyInput, prep: VerifyPrep, result: VerifyResult, runDir: string): Promise<string> {
  const { project, iid, agent, executionId, isKo } = ctx
  const t = (ko: string, en: string) => (isKo ? ko : en)
  const lines: string[] = []
  lines.push(`<!-- ive-agent:${agent.id} -->`)
  lines.push(`## ${isKo ? VERDICT_TITLE[result.verdict].ko : VERDICT_TITLE[result.verdict].en}`)
  lines.push('')
  if (result.summary) lines.push(result.summary, '')
  if (result.reason && result.verdict !== 'pass') lines.push(`**${t('사유', 'Reason')}**: ${result.reason}`, '')
  // 요건 대조 — 몇 개 중 몇 개 구현. 다 구현됐으면 한 줄, 아니면 누락만 지적 사항에서 보인다
  const reqs = result.requirements
  if (reqs.length) {
    const done = reqs.filter(q => q.status === 'done').length
    lines.push(`**${t('요건', 'Requirements')}**: ${t(`${reqs.length}개 중 ${done}개 구현`, `${done} of ${reqs.length} implemented`)}`, '')
  }
  // 지적 — 누락·오류로 나눠 보인다(예전 결과는 severity 그대로)
  const kindLabel = (f: VerifyFinding) => f.kind === 'missing' ? t('누락', 'Missing') : f.kind === 'defect' ? t('오류', 'Defect') : f.severity
  if (result.findings.length) {
    lines.push(`**${t('지적 사항', 'Findings')}**`)
    for (const f of result.findings.slice(0, 30)) {
      const loc = f.file ? ` \`${f.file}${f.line ? `:${f.line}` : ''}\`` : ''
      lines.push(`- [${kindLabel(f)}]${loc} ${f.note}`)
    }
    lines.push('')
  }
  if (prep.checkCommands.length) {
    lines.push(`| ${t('검사 명령', 'Check')} | ${t('결과', 'Result')} | ${t('시간', 'Time')} |`, '|---|---|---|')
    for (const c of prep.checks) lines.push(`| \`${c.command.replace(/\|/g, '\\|')}\` | ${c.ok ? '✅' : c.timedOut ? '⏱️' : `❌ (${c.exitCode})`} | ${c.durationSec}s |`)
    for (const c of prep.checkCommands.slice(prep.checks.length)) lines.push(`| \`${c.replace(/\|/g, '\\|')}\` | – | – |`)
    lines.push('')
  }
  const base = getIveBaseUrl()
  const evidenceLink = base ? `${base}/issues/${project.id}/${iid}?tab=evidence&run=${encodeURIComponent(runDir)}` : ''
  lines.push('<details>')
  lines.push(`<summary>${t('요건 대조·검증 대상·실행 명령', 'Requirements, target & commands')}</summary>`, '')
  if (reqs.length) {
    for (const q of reqs.slice(0, 40)) lines.push(`- ${q.status === 'done' ? '✅' : '❌'} ${q.item}${q.where ? ` — \`${q.where}\`` : ''}`)
    lines.push('')
  }
  if (input.mrUrl) lines.push(`- MR: ${maskSecrets(input.mrUrl)}`)
  lines.push(`- ${t('검증한 커밋', 'Verified commit')}: \`${prep.sourceSha.slice(0, 12)}\` · ${t('대상', 'Target')}: \`${input.targetBranch}\` (${prep.behindTarget ? t('최신본 미포함 — 묶음 때 위에 머지', 'behind — merged on top at bundle time') : t('최신본 위', 'up to date')})`)
  lines.push(`- ${t('바뀐 파일', 'Changed files')}: ${prep.changedFiles.length}`)
  lines.push(`- ${t('검증 에이전트', 'Verifier agent')}: ${agent.name}`)
  for (const c of result.commands.slice(0, 20)) lines.push(`- \`${c.replace(/`/g, "'")}\``)
  if (evidenceLink) lines.push(`- ${t('전체 증적', 'All evidence')}: ${evidenceLink}`)
  lines.push('', '</details>', '')

  // ive-meta (stage: verify) — 보고서가 검증 비용을 AI 토큰으로 집계한다(stage-records)
  const ex = getExecution(executionId)
  lines.push('<!-- ive-meta')
  lines.push('stage: verify')
  lines.push(`model: ${ex?.modelName || agent.modelName || agent.cliName}`)
  lines.push(`input_tokens: ${ex?.inputTokens ?? 0}`)
  lines.push(`output_tokens: ${ex?.outputTokens ?? 0}`)
  lines.push(`cost_usd: ${Number(ex?.costUsd ?? 0).toFixed(4)}`)
  lines.push(`turns: ${ex?.turns ?? 0}`)
  lines.push(`started_at: ${kstIso(prep.startedAt)}`)
  lines.push(`ended_at: ${kstIso(new Date().toISOString())}`)
  lines.push('-->')
  return lines.join('\n')
}

function verifySpec(input: VerifyInput): StageKindSpec<VerifyPrep> {
  return {
    kind: 'verify',
    label: '검증(③)',

    register(ctx) {
      return openAgentStageExecution(ctx.project.id, ctx.iid, 'verify', {
        executionId: ctx.executionId, agentId: ctx.agent.id, agentName: ctx.agent.name, agentAvatar: ctx.agent.avatar,
        issueTitle: ctx.issue.title, issueCreatedAt: ctx.issue.created_at, logPath: ctx.logPath,
      })
    },

    async prepare(ctx) {
      const { project, iid, token, workspacePath, log, logStream, secrets } = ctx
      const startedAt = new Date().toISOString()
      setStageWorkerNote(project.id, iid, null)

      if (input.stage === 'verify_waiting') {
        const next = await applyStageAction(project, iid, token, 'verify_waiting', 'start_verification', { actor: agentActor(ctx.agent, ctx.executionId), executionId: ctx.executionId })
        markIssueVerifyStarted(project.id, iid)
        log(`단계: 검증대기 → ${next === 'verifying' ? '검증 중' : next}`, 'system')
      }

      log('작업 디렉토리 준비 중...', 'system')
      if (fs.existsSync(workspacePath)) fs.rmSync(workspacePath, { recursive: true, force: true })
      fs.mkdirSync(workspacePath, { recursive: true })
      const target = input.targetBranch
      log(`저장소 클론 중... (${target})`, 'system')
      await execFile('git', ['clone', '--filter=blob:none', '--branch', target, authedRepoUrl(project, token), '.'], { cwd: workspacePath, maxBuffer: 16 * 1024 * 1024 })
      await git(workspacePath, ['fetch', 'origin', `+refs/heads/dev-${iid}:refs/remotes/origin/dev-${iid}`])
      const sourceSha = (await git(workspacePath, ['rev-parse', `origin/dev-${iid}`])).trim()
      log(`검증할 커밋: dev-${iid} @ ${sourceSha}`, 'system')

      let behindTarget = false
      try { await git(workspacePath, ['merge-base', '--is-ancestor', `origin/${target}`, sourceSha]) } catch { behindTarget = true }

      // staging 최신본과 시험 머지 — 묶음 배포 때 충돌할지 미리 본다
      let conflictFiles: string[] = []
      await git(workspacePath, ['checkout', '-q', '-B', 'ive-trial-merge', `origin/${target}`])
      try {
        await git(workspacePath, [...GIT_ID, 'merge', '--no-commit', '--no-ff', sourceSha])
      } catch {
        try { conflictFiles = (await git(workspacePath, ['diff', '--name-only', '--diff-filter=U'])).split('\n').map(s => s.trim()).filter(Boolean) } catch { /* ignore */ }
        if (!conflictFiles.length) conflictFiles = ['(머지 실패)']
      }
      try { await git(workspacePath, ['merge', '--abort']) } catch { /* 충돌이 없으면 abort 할 것이 없다 */ }
      log(`staging 최신본 ${behindTarget ? '미포함' : '포함'} · 시험 머지 ${conflictFiles.length ? `충돌 ${conflictFiles.join(', ')}` : '충돌 없음'}`, conflictFiles.length ? 'warn' : 'system')

      fs.mkdirSync(path.join(workspacePath, OUT_DIR), { recursive: true })
      const diff = await git(workspacePath, ['diff', `origin/${target}...${sourceSha}`])
      fs.writeFileSync(path.join(workspacePath, OUT_DIR, 'mr.diff'), diff)
      const changedFiles = (await git(workspacePath, ['diff', '--name-only', `origin/${target}...${sourceSha}`])).split('\n').map(s => s.trim()).filter(Boolean)
      await git(workspacePath, ['checkout', '-q', '-f', '--detach', sourceSha])
      try {
        fs.appendFileSync(path.join(workspacePath, '.git', 'info', 'exclude'), `\n${OUT_DIR}/\n.mcp.json\n.agents/\n.octmp/\n`)
      } catch { /* ignore */ }

      // 검사 명령 — IVE 가 직접 실행하고 종료 코드로 판정한다
      const bundle = getProjectAutomation(project.id).bundle
      const checkCommands = parseCheckCommands(bundle.checkCommands)
      let checks: CheckResult[] = []
      if (checkCommands.length) {
        log(`검사 명령 ${checkCommands.length}개 실행`, 'system')
        checks = await runCheckCommands(workspacePath, checkCommands, bundle.checkTimeoutMin, secrets, log, chunk => logStream.write(chunk))
      } else {
        log('검사 명령 없음(프로젝트 설정) — 리뷰로만 판정', 'system')
      }
      fs.writeFileSync(path.join(workspacePath, OUT_DIR, 'checks.json'), JSON.stringify(checks, null, 2))

      const script = `.ive/e2e/issue-${iid}.spec.ts`
      const e2eScript = fs.existsSync(path.join(workspacePath, script)) ? script : null

      // 사람이 쓴 이슈 코멘트 — 요건 정정·재작업 지시가 본문이 아니라 여기 있다(봇·에이전트 코멘트 제외)
      let comments = ''
      try {
        const notes = (await fetchIssueNotes(project, iid, token)) as any[]
        comments = notes
          .filter(n => !n.system && n.body && !n.body.includes('<!-- ive-bot -->') && !n.body.includes('<!-- ive-agent:') && !n.body.includes('IVE(봇)'))
          .map(n => `- ${n.author?.name || n.author?.username || n.user?.login || '?'} (${String(n.created_at || '').slice(0, 16)}): ${String(n.body).trim()}`)
          .join('\n')
          .slice(-12000)
      } catch (e) { log(`이슈 코멘트 조회 실패 — 본문만으로 요건을 대조합니다: ${(e as Error).message}`, 'warn') }

      return { sourceSha, behindTarget, conflictFiles, changedFiles, checks, checkCommands, e2eScript, startedAt, comments }
    },

    buildPrompt(ctx, prep) {
      const { editable, version } = resolveEditable(ctx.project.id, 'verify')
      const limits = getProjectAutomation(ctx.project.id).limits
      const prompt = buildVerifyPrompt({
        iid: ctx.iid, title: ctx.issue.title, body: ctx.issue.description || ctx.issue.body || '', comments: prep.comments, isKo: ctx.isKo,
        mrUrl: input.mrUrl, targetBranch: input.targetBranch, sourceSha: prep.sourceSha, behindTarget: prep.behindTarget,
        conflictFiles: prep.conflictFiles, changedFiles: prep.changedFiles, diffPath: `${OUT_DIR}/mr.diff`,
        checksSection: checksSection(prep.checks, prep.checkCommands, ctx.isKo), e2eScript: prep.e2eScript,
        outDir: OUT_DIR, maxRunMinutes: limits.verifyTimeoutMin,
      }, editable ?? VERIFY_EDITABLE_DEFAULT)
      return { prompt, promptVersion: version }
    },

    runOptions(ctx) {
      const limits = getProjectAutomation(ctx.project.id).limits
      return { maxTurns: limits.verifyMaxTurns, maxRunMinutes: limits.verifyTimeoutMin }
    },

    async onResult(ctx, prep) {
      const { project, iid, agent, token, executionId, workspacePath, logPath, log, isKo } = ctx
      const m = (x: string) => maskSecrets(x, ctx.secrets)
      const raw = parseVerifyResult(workspacePath, logPath)
      const result = enforceVerifyVerdict({
        ...raw, summary: m(raw.summary), reason: m(raw.reason), commands: raw.commands.map(m),
        findings: raw.findings.map(f => ({ ...f, note: m(f.note), file: m(f.file) })),
        requirements: raw.requirements.map(q => ({ ...q, item: m(q.item), where: m(q.where) })),
      }, prep.checks, prep.conflictFiles, isKo)
      log(`판정: ${result.verdict}${result.reason ? ` — ${result.reason}` : ''}`, 'system')

      // 증적 보관 — 결과 JSON 은 IVE 가 정리한 형태로 덮어쓴다(검사 결과 포함)
      const stamp = evidenceStamp()
      const destDir = evidenceDir(project.id, iid, 'verify', stamp)
      collectEvidence(path.join(workspacePath, OUT_DIR), destDir)
      fs.mkdirSync(destDir, { recursive: true })
      fs.writeFileSync(path.join(destDir, 'result.json'), JSON.stringify({
        ...result, executionId, agent: agent.name, sourceSha: prep.sourceSha, targetBranch: input.targetBranch,
        behindTarget: prep.behindTarget, conflictFiles: prep.conflictFiles, changedFiles: prep.changedFiles,
        checks: prep.checks.map(c => ({ command: c.command, ok: c.ok, exitCode: c.exitCode, timedOut: c.timedOut, durationSec: c.durationSec })),
        mrUrl: input.mrUrl,
      }, null, 2))

      const comment = await buildComment(ctx, input, prep, result, `verify-${stamp}`)
      try { await addIssueComment(project, iid, token, comment) } catch (e) { log(`결과 코멘트 작성 실패: ${(e as Error).message}`, 'warn') }

      // 검증하는 동안 사람이 단계를 옮겼으면 그 결정을 덮어쓰지 않는다 — 결과만 남긴다
      let nowStage: string | null = null
      try {
        const fresh = await fetchSingleIssue(project, iid, token)
        nowStage = fresh && fresh.state !== 'closed' ? stageFromLabels(fresh.labels || [], project, { hasActiveExec: true }) : 'closed'
      } catch { /* 조회 실패 — 아래에서 옮기지 않는다 */ }

      setStageVerdict(executionId, result.verdict)
      const who = { name: agent.name, avatar: agent.avatar }
      // 검증 마커는 검증 실행 행이 열려 있을 때(종료 전) 처리 실행 행에 찍어야 한다(마커 쿼리가 마지막 종료 행을 고른다)
      if (nowStage === 'verifying') {
        if (result.verdict === 'pass') markIssueVerified(project.id, iid, who)
        else if (result.verdict === 'fail') markIssueVerifyRejected(project.id, iid, who)
      }
      updateExecutionStatus(executionId, result.verdict === 'pass' ? 'success' : 'failed', new Date().toISOString())

      if (nowStage !== 'verifying') {
        log(`단계가 이미 바뀌어(${nowStage ?? '조회 실패'}) 라벨은 옮기지 않고 결과만 기록합니다`, 'warn')
        setStageWorkerNote(project.id, iid, `${isKo ? '검증 결과' : 'Verify result'}: ${result.verdict} — ${isKo ? '검증 중 단계가 바뀌어 단계는 옮기지 않았습니다' : 'stage changed meanwhile, not moved'}`)
        return
      }

      const move = async (action: 'approve' | 'reject', label: string) => {
        try {
          await applyStageAction(project, iid, token, 'verifying', action, { actor: agentActor(agent, executionId), executionId, reason: result.verdict, detail: result.reason ? { reason: String(result.reason).slice(0, 500) } : null })
          log(label, 'system')
          return true
        } catch (e) {
          log(`단계 이동 실패: ${(e as Error).message}`, 'error')
          setStageWorkerNote(project.id, iid, `${isKo ? '검증 결과' : 'Verify result'}: ${result.verdict} — ${isKo ? '단계 이동 실패, 사람이 옮겨 주세요' : 'stage move failed, move it manually'}`)
          return false
        }
      }

      if (result.verdict === 'pass') {
        if (!(await move('approve', '단계: 검증 중 → 확인대기 (묶음 배포 대기)'))) return
        // 확인자 배정(사람이면 Git 담당자 교체, 에이전트면 배정 안내) — 화면 승인 경로와 같다
        try { await applyRoleAssignee(project, iid, token, '확인자', getPresetRoles(project.id, iid).confirmer) } catch (e) { log(`확인자 배정 실패: ${(e as Error).message}`, 'warn') }
        const item = enqueueBundleItem(project.id, iid, { sourceSha: prep.sourceSha, mrIid: input.mrIid, mrUrl: input.mrUrl, issueTitle: ctx.issue.title })
        log(item ? `묶음 대기열에 올림 (커밋 ${prep.sourceSha.slice(0, 12)})` : '이미 진행 중인 묶음에 실려 있어 대기열에 다시 올리지 않음', 'system')
      } else if (result.verdict === 'fail') {
        // 반려 = 처리 재요청(스케줄). 결과 코멘트가 다음 처리의 피드백이 된다.
        if (await move('reject', '단계: 검증 중 → 스케줄 (재작업)')) resetIssueScheduledAt(project.id, iid)
      } else {
        setStageWorkerNote(project.id, iid, `${isKo ? '검증 불가' : 'Could not verify'}: ${result.reason || '-'}`)
        log('단계: 검증 중에 머무름 — 사람 검증 필요', 'warn')
      }
    },

    async onError(ctx, _prep, err) {
      setStageWorkerNote(ctx.project.id, ctx.iid, `${ctx.isKo ? '검증 작업자 오류' : 'Verify worker error'}: ${maskSecrets(err.message, ctx.secrets).slice(0, 300)}`)
    },
  }
}

export async function runVerifyWorker(input: VerifyInput, executionId: string): Promise<void> {
  const workspacePath = path.join(process.cwd(), 'workspaces', input.project.id, `issue-${input.issue.iid}-verify`)
  slog.info(`[VERIFY] ${input.project.name} #${input.issue.iid} agent=${input.agent.name} target=${input.targetBranch}`)
  await runStageWorker(verifySpec(input), {
    project: input.project, issue: input.issue, agent: input.agent, token: input.token, executionId, workspacePath,
  })
}
