/**
 * ④ 확인(confirm) 단계 작업자 — staging 에 배포된 수정이 이슈의 증상을 실제로 없앴는지 확인자 에이전트가 본다.
 *
 * 기동 조건(DB 상태 + 배포 사실)은 stage-dispatch 가 판정한다. 여기서는:
 *   1) P 면 C 로 옮기고(start_confirmation) 실행 기록 ex-confirm-* 를 연다(에이전트, 중복 방지)
 *      staging 주소·안내·비밀값은 IVE 프로젝트 설정에서 온다(대상 저장소 파일을 읽지 않는다)
 *   2) 배포된 커밋으로 워크스페이스를 만든다(읽기 전용)
 *   3) Playwright MCP 로 staging 을 직접 열어 확인 + 재현 스크립트가 있으면 3엔진 실행
 *   4) 에이전트가 쓴 .ive-out/result.json 으로 판정 → 증적 보관·업로드 → 증적 코멘트 하나(+ ive-meta stage: confirm)
 *   5) 통과 → accept(→E), 실패 → 스케줄(→S, 증적 코멘트가 다음 처리의 피드백), 확인 불가 → C 에 두고 사람을 기다린다
 *
 * 코멘트·단계 이동은 IVE 가 한다(에이전트는 파일만 쓴다) — 형식이 흔들리지 않고 비밀값이 코멘트로 새지 않는다.
 */
import fs from 'fs'
import path from 'path'
import { execFileSync } from 'child_process'
import { getLogger } from '../logger'
import { Project, Agent } from '@/types'
import {
  getExecution, getSystemSetting, updateExecutionStatus, markIssueConfirmStarted, markIssueConfirmed,
  setStageWorkerNote, getProjectAutomation, stageFromLabels,
} from '../db'
import { addIssueComment, fetchSingleIssue, fetchIssueNotes } from '../provider'
import { applyStageAction } from '../stage-apply'
import { agentActor } from '../event-actor'
import { maskSecrets } from '../secret-mask'
import { notifyStageTransition, getIveBaseUrl } from '../slack-notify'
import { buildConfirmPrompt, resolveEditable, CONFIRM_EDITABLE_DEFAULT, CONFIRM_RESULT_MARKER } from '../role-prompts'
import { collectEvidence, evidenceDir, evidenceStamp, uploadEvidenceFile } from '../evidence'
import type { StagingConfig } from '../staging-config'
import { cloneAtCommit } from './git-ops'
import { downloadIssueImages, extractImageUrls } from './issue-images'
import { openAgentStageExecution, setStageVerdict } from './stage-records'
import { runStageWorker, type StageKindSpec, type StageContext } from './stage-worker'

const slog = getLogger('ConfirmWorker')

/** 확인 탐색에 쓰는 Playwright MCP 판 — IVE 컨테이너에 전역 설치(Dockerfile)된 것과 같아야 한다 */
export const PLAYWRIGHT_MCP_PACKAGE = '@playwright/mcp@0.0.78'
const OUT_DIR = '.ive-out'

export interface ConfirmInput {
  project: Project
  issue: any
  agent: Agent
  token: string
  /** 기동 시점 단계: confirm_waiting(P) 이면 C 로 옮기고 시작, confirming(C) 이면 이어서 */
  stage: 'confirm_waiting' | 'confirming'
  staging: StagingConfig
  deployedCommit: string
  mergeCommit: string | null
  mrUrl: string | null
  secrets: Record<string, string>
}

interface ConfirmPrep {
  /** 처리자의 결과 보고 + 검증 통과 노트(요건 대조) — 확인 항목의 근거 */
  priorWork: string
  /** 사람이 쓴 이슈 코멘트(요건 정정·재작업 지시) */
  comments: string
  e2eScript: string | null
  imagesSection: string
  imagePaths: string[]
  secretsFile: string | null
  mcpServers: Record<string, any>
  startedAt: string
}

type Verdict = 'pass' | 'fail' | 'blocked'

/** 확인 항목 하나 — 이슈의 증상 또는 처리·검증 결과의 요건. 증거(스크린샷·측정값)가 있어야 증명된 것 */
export interface ConfirmCheck { item: string; how: string; result: 'gone' | 'present' | 'unverified'; evidence: string[] }

export interface ConfirmResult {
  verdict: Verdict
  summary: string
  reason: string
  items: ConfirmCheck[]
  engines: { engine: string; status: string; note?: string }[]
  screenshots: { file: string; caption?: string }[]
  commands: string[]
  newDefects: string[]
}

/** 컨테이너(또는 로컬)의 Playwright chromium 실행 파일 — 가장 높은 리비전 */
export function findChromiumExecutable(): string | null {
  const roots = [
    process.env.PLAYWRIGHT_BROWSERS_PATH,
    path.join(process.env.HOME || '', 'Library', 'Caches', 'ms-playwright'),
    path.join(process.env.HOME || '', '.cache', 'ms-playwright'),
  ].filter((r): r is string => !!r && fs.existsSync(r))
  const rel = [
    'chrome-linux64/chrome', 'chrome-linux/chrome',
    'chrome-mac-arm64/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing',
    'chrome-mac/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing',
    'chrome-mac/Chromium.app/Contents/MacOS/Chromium',
  ]
  for (const root of roots) {
    const dirs = fs.readdirSync(root)
      .filter(d => /^chromium-\d+$/.test(d))
      .sort((a, b) => Number(b.split('-')[1]) - Number(a.split('-')[1]))
    for (const d of dirs) {
      for (const r of rel) {
        const p = path.join(root, d, r)
        if (fs.existsSync(p)) return p
      }
    }
  }
  return null
}

function playwrightMcpCommand(): string[] {
  const configured = getSystemSetting('stage.playwrightMcpCommand')
  if (configured && configured.trim()) return configured.trim().split(/\s+/)
  try {
    const p = execFileSync('sh', ['-c', 'command -v playwright-mcp'], { encoding: 'utf8' }).trim()
    if (p) return [p]
  } catch { /* 전역 설치 없음 */ }
  return ['npx', '-y', PLAYWRIGHT_MCP_PACKAGE]
}

/**
 * 확인 작업자용 MCP 설정 — 시스템 MCP + Playwright MCP(헤드리스 chromium, 스크린샷은 outDir, 비밀값 가림).
 * opencode 형식({ type:'local', command:[...] })으로 돌려주면 CLI 별 변환은 cli-invocation 이 한다.
 */
export function buildConfirmMcpServers(outDir: string, secretsFile: string | null): { mcpServers: Record<string, any>; chromium: string | null } {
  const chromium = findChromiumExecutable()
  const command = [
    ...playwrightMcpCommand(), '--headless', '--isolated', '--browser', 'chromium',
    ...(chromium ? ['--executable-path', chromium] : []),
    '--output-dir', outDir,
    ...(process.platform === 'linux' ? ['--no-sandbox'] : []),
    ...(secretsFile ? ['--secrets', secretsFile] : []),
  ]
  return { mcpServers: { ...systemMcpServers(), playwright: { type: 'local', command } }, chromium }
}

function systemMcpServers(): Record<string, any> {
  const raw = getSystemSetting('mcp.config')
  if (!raw) return {}
  try { return JSON.parse(raw) || {} } catch { return {} }
}

function excludeFromGit(workspacePath: string, entries: string[]) {
  try {
    const excludePath = path.join(workspacePath, '.git', 'info', 'exclude')
    const cur = fs.existsSync(excludePath) ? fs.readFileSync(excludePath, 'utf8') : ''
    const add = entries.filter(e => !cur.includes(e))
    if (add.length) fs.appendFileSync(excludePath, `\n${add.join('\n')}\n`)
  } catch { /* ignore */ }
}

function kstIso(iso: string): string {
  const d = new Date(new Date(iso).getTime() + 9 * 3600_000)
  return d.toISOString().replace(/\.\d{3}Z$/, '+09:00')
}

export function parseResult(workspacePath: string, logPath: string): ConfirmResult {
  const empty: ConfirmResult = { verdict: 'blocked', summary: '', reason: '', items: [], engines: [], screenshots: [], commands: [], newDefects: [] }
  let raw: any = null
  try { raw = JSON.parse(fs.readFileSync(path.join(workspacePath, OUT_DIR, 'result.json'), 'utf8')) } catch { /* 없음 */ }
  let marker: Verdict | null = null
  try {
    const m = fs.readFileSync(logPath, 'utf8').match(new RegExp(`${CONFIRM_RESULT_MARKER}\\s*(pass|fail|blocked)`, 'gi'))
    if (m && m.length) marker = m[m.length - 1].split(/\s+/).pop()!.toLowerCase() as Verdict
  } catch { /* ignore */ }
  if (!raw) {
    return { ...empty, verdict: 'blocked', reason: marker ? `결과 파일(result.json)이 없습니다 (마지막 출력: ${marker})` : '확인 작업자가 결과 파일(result.json)을 남기지 않았습니다' }
  }
  const v = String(raw.verdict || '').toLowerCase()
  const verdict: Verdict = v === 'pass' || v === 'fail' || v === 'blocked' ? v : 'blocked'
  const arr = (x: unknown) => (Array.isArray(x) ? x : [])
  return {
    verdict,
    summary: String(raw.summary || ''),
    reason: String(raw.reason || (verdict === 'blocked' && !v ? '판정 값이 없습니다' : '')),
    items: arr(raw.items).map((c: any) => {
      const r = String(c?.result || '').toLowerCase()
      return {
        item: String(c?.item || ''), how: String(c?.how || ''),
        result: (r === 'gone' || r === 'present' ? r : 'unverified') as ConfirmCheck['result'],
        evidence: arr(c?.evidence).map(String).filter(Boolean),
      }
    }).filter(c => c.item),
    engines: arr(raw.engines).map((e: any) => ({ engine: String(e?.engine || ''), status: String(e?.status || ''), note: e?.note ? String(e.note) : '' })),
    screenshots: arr(raw.screenshots).map((s: any) => ({ file: String(s?.file || ''), caption: s?.caption ? String(s.caption) : '' })).filter(s => s.file),
    commands: arr(raw.commands).map(String),
    newDefects: arr(raw.newDefects).map(String),
  }
}

/**
 * 에이전트 판정에 확인 규약을 덮는다 — 증상이 사라졌음을 증거로 보이지 못한 통과는 통과가 아니다.
 *   - 증상이 남은 항목(present)이 있으면 fail(재처리)
 *   - pass 인데 남은 스크린샷이 없거나, 증거 없는/확인 못 한 항목이 있으면 blocked(사람 확인) — 처리자 잘못이 아니라 증명이 안 된 것
 */
export function enforceConfirmVerdict(r: ConfirmResult, savedScreens: number, isKo = true): ConfirmResult {
  const present = r.items.filter(c => c.result === 'present')
  if (r.verdict !== 'fail' && present.length) {
    return { ...r, verdict: 'fail', reason: [isKo ? `증상이 남은 항목 ${present.length}개` : `${present.length} item(s) still present`, r.reason].filter(Boolean).join(' — ') }
  }
  if (r.verdict !== 'pass') return r
  const reasons: string[] = []
  if (savedScreens === 0) reasons.push(isKo ? '증거 스크린샷이 없습니다' : 'no evidence screenshots')
  if (!r.items.length) reasons.push(isKo ? '확인 항목(items)이 없습니다' : 'no items listed')
  const unproven = r.items.filter(c => c.result !== 'gone' || !c.evidence.length)
  if (unproven.length) reasons.push(isKo ? `증거로 보이지 못한 항목 ${unproven.length}개` : `${unproven.length} item(s) without evidence`)
  if (!reasons.length) return r
  return { ...r, verdict: 'blocked', reason: reasons.join(' / ') }
}

const VERDICT_TITLE: Record<Verdict, { ko: string; en: string }> = {
  pass: { ko: '✅ 확인 통과', en: '✅ Confirmed' },
  fail: { ko: '❌ 확인 실패 — 재작업 필요', en: '❌ Not fixed — rework needed' },
  blocked: { ko: '⚠️ 확인 불가 — 사람 확인 필요', en: '⚠️ Could not confirm — needs a person' },
}

async function buildEvidenceComment(
  ctx: StageContext, input: ConfirmInput, prep: ConfirmPrep, result: ConfirmResult, destDir: string, runDir: string,
): Promise<string> {
  const { project, iid, agent, token, executionId, isKo } = ctx
  const t = (ko: string, en: string) => (isKo ? ko : en)

  // 수정 후 스크린샷 업로드 (GitLab). GitHub 는 IVE 증적 화면 링크.
  const after: string[] = []
  const shots = result.screenshots.length
    ? result.screenshots
    : fs.existsSync(path.join(destDir, 'screens'))
      ? fs.readdirSync(path.join(destDir, 'screens')).filter(f => /\.(png|jpe?g|webp)$/i.test(f)).map(f => ({ file: `screens/${f}`, caption: '' }))
      : []
  for (const s of shots.slice(0, 8)) {
    const rel = s.file.replace(/^\.?\/?\.ive-out\//, '').replace(/^\//, '')
    const segs = rel.split('/').map(seg => seg.replace(/[^\w.\-]/g, '_'))
    if (segs.some(seg => !seg || seg === '.' || seg === '..')) continue        // 경로 탈출 거부
    const abs = path.join(destDir, ...segs)
    if (!abs.startsWith(destDir + path.sep)) continue
    let st: fs.Stats
    try { st = fs.lstatSync(abs) } catch { continue }
    if (!st.isFile()) continue                                                 // 링크·디렉터리 거부
    const up = await uploadEvidenceFile(project, token, abs)
    if (up) after.push(`${up.markdown}${s.caption ? `<br>${s.caption}` : ''}`)
  }
  const base = getIveBaseUrl()
  const evidenceLink = base ? `${base}/issues/${project.id}/${iid}?tab=evidence&run=${encodeURIComponent(runDir)}` : ''

  // 수정 전: Phase 1 에는 재현 단계가 없으므로 이슈에 첨부된 이미지가 수정 전 증적이다.
  const before = extractImageUrls(input.issue.description || '').slice(0, 2).map(u => `![](${u})`)

  const lines: string[] = []
  lines.push(`<!-- ive-agent:${agent.id} -->`)
  lines.push(`## ${isKo ? VERDICT_TITLE[result.verdict].ko : VERDICT_TITLE[result.verdict].en}`)
  lines.push('')
  if (result.summary) lines.push(result.summary, '')
  if (result.reason && result.verdict !== 'pass') lines.push(`**${t('사유', 'Reason')}**: ${result.reason}`, '')
  // 확인 항목 — 몇 개 중 몇 개 증상이 사라짐(증거 있음). 사라지지 않은·증명 못 한 항목만 줄로 보인다
  if (result.items.length) {
    const proven = result.items.filter(c => c.result === 'gone' && c.evidence.length).length
    lines.push(`**${t('확인 항목', 'Checks')}**: ${t(`${result.items.length}개 중 ${proven}개 증상 사라짐(증거 있음)`, `${proven} of ${result.items.length} gone (with evidence)`)}`)
    for (const c of result.items.filter(c => !(c.result === 'gone' && c.evidence.length)).slice(0, 15)) {
      lines.push(`- ${c.result === 'present' ? t('❌ 증상 그대로', '❌ still present') : t('⚠️ 증명 못 함', '⚠️ not proven')}: ${c.item}${c.how ? ` — ${c.how}` : ''}`)
    }
    lines.push('')
  }

  if (before.length && after.length) {
    lines.push(`| ${t('수정 전 (이슈 첨부)', 'Before (issue)')} | ${t('수정 후 (staging)', 'After (staging)')} |`)
    lines.push('|---|---|')
    const n = Math.max(before.length, after.length)
    for (let i = 0; i < n; i++) lines.push(`| ${before[i] || ''} | ${after[i] || ''} |`)
    lines.push('')
  } else if (after.length) {
    // 수정 전 이미지가 없으면(이슈에 첨부 없음) 빈 칸 표 대신 수정 후만
    lines.push(`**${t('수정 후 (staging)', 'After (staging)')}**`, '')
    for (const a of after) lines.push(a, '')
  } else if (evidenceLink) {
    lines.push(`${t('스크린샷', 'Screenshots')}: ${evidenceLink}`, '')
  }

  if (result.engines.length) {
    lines.push(`| ${t('엔진', 'Engine')} | ${t('결과', 'Result')} | ${t('비고', 'Note')} |`, '|---|---|---|')
    for (const e of result.engines) lines.push(`| ${e.engine} | ${e.status} | ${e.note || ''} |`)
    lines.push('')
  }
  if (result.newDefects.length) {
    lines.push(`**${t('새로 발견한 결함 (이 이슈와 별개)', 'New defects found (separate from this issue)')}**`)
    for (const d of result.newDefects) lines.push(`- ${d}`)
    lines.push('')
  }
  const mergeShort = input.mergeCommit ? input.mergeCommit.slice(0, 12) : '-'
  lines.push('<details>')
  lines.push(`<summary>${t('확인 항목·환경·실행 명령', 'Checks, environment & commands')}</summary>`, '')
  for (const c of result.items.slice(0, 30)) {
    const mark = c.result === 'gone' ? '✅' : c.result === 'present' ? '❌' : '⚠️'
    lines.push(`- ${mark} ${c.item}${c.how ? ` — ${c.how}` : ''}${c.evidence.length ? ` (${c.evidence.slice(0, 3).map(e => `\`${e.replace(/`/g, "'")}\``).join(', ')})` : ''}`)
  }
  if (result.items.length) lines.push('')
  // IVE 설정 값이라도 주소에 넣은 계정(user:pass@)은 가린다
  lines.push(`- staging: ${maskSecrets(input.staging.url)}`)
  lines.push(`- ${t('배포 커밋', 'Deployed commit')}: \`${input.deployedCommit.slice(0, 12)}\` · ${t('머지 커밋', 'Merge commit')}: \`${mergeShort}\` (${t('포함 확인', 'included')})`)
  if (input.mrUrl) lines.push(`- MR: ${maskSecrets(input.mrUrl)}`)
  lines.push(`- ${t('확인 에이전트', 'Confirmer agent')}: ${agent.name} · ${t('재현 스크립트', 'Repro script')}: ${prep.e2eScript || t('없음', 'none')}`)
  for (const c of result.commands.slice(0, 20)) lines.push(`- \`${c.replace(/`/g, "'")}\``)
  if (evidenceLink) lines.push(`- ${t('전체 증적', 'All evidence')}: ${evidenceLink}`)
  lines.push('', '</details>', '')

  // ive-meta (stage: confirm) — 보고서가 확인 비용을 AI 토큰으로 집계한다(stage-records)
  const ex = getExecution(executionId)
  const endedAt = new Date().toISOString()
  lines.push('<!-- ive-meta')
  lines.push('stage: confirm')
  lines.push(`model: ${ex?.modelName || agent.modelName || agent.cliName}`)
  lines.push(`input_tokens: ${ex?.inputTokens ?? 0}`)
  lines.push(`output_tokens: ${ex?.outputTokens ?? 0}`)
  lines.push(`cost_usd: ${Number(ex?.costUsd ?? 0).toFixed(4)}`)
  lines.push(`turns: ${ex?.turns ?? 0}`)
  lines.push(`started_at: ${kstIso(prep.startedAt)}`)
  lines.push(`ended_at: ${kstIso(endedAt)}`)
  lines.push('-->')
  return lines.join('\n')
}

function confirmSpec(input: ConfirmInput): StageKindSpec<ConfirmPrep> {
  return {
    kind: 'confirm',
    label: '확인(④)',

    register(ctx) {
      return openAgentStageExecution(ctx.project.id, ctx.iid, 'confirm', {
        executionId: ctx.executionId, agentId: ctx.agent.id, agentName: ctx.agent.name, agentAvatar: ctx.agent.avatar,
        issueTitle: ctx.issue.title, issueCreatedAt: ctx.issue.created_at, logPath: ctx.logPath,
      })
    },

    async prepare(ctx) {
      const { project, iid, token, workspacePath, log, executionId, logDir } = ctx
      const startedAt = new Date().toISOString()
      setStageWorkerNote(project.id, iid, null)

      if (input.stage === 'confirm_waiting') {
        const next = await applyStageAction(project, iid, token, 'confirm_waiting', 'start_confirmation', { actor: agentActor(ctx.agent, executionId), executionId })
        markIssueConfirmStarted(project.id, iid)
        log(`단계: 확인대기 → ${next === 'confirming' ? '확인 중' : next}`, 'system')
      }
      log(`staging: ${input.staging.url}`, 'system')
      log(`배포 커밋: ${input.deployedCommit} (머지 커밋 ${input.mergeCommit ?? '?'} 포함 확인됨)`, 'system')

      await cloneAtCommit(project, workspacePath, token, input.staging.branch || project.baseBranch || null, input.deployedCommit, log)
      fs.mkdirSync(path.join(workspacePath, OUT_DIR, 'screens'), { recursive: true })
      excludeFromGit(workspacePath, [`${OUT_DIR}/`, '.mcp.json', '.issue-attachments/', '.agents/', '.octmp/'])

      const script = `.ive/e2e/issue-${iid}.spec.ts`
      const e2eScript = fs.existsSync(path.join(workspacePath, script)) ? script : null
      log(`재현 스크립트: ${e2eScript || '없음'}`, 'system')

      const imagePaths = await downloadIssueImages(
        project, token, [input.issue.description || ''], path.join(workspacePath, '.issue-attachments'), log,
      ).catch(() => [] as string[])
      const imagesSection = imagePaths.length
        ? `\n## 이슈 첨부 이미지 (수정 전 증상)\n${imagePaths.map(p => `- ${path.relative(workspacePath, p)}`).join('\n')}\n`
        : ''

      // MCP 비밀값 파일(가림 처리용) — 워크스페이스 밖에 두고 끝나면 지운다
      let secretsFile: string | null = null
      if (Object.keys(input.secrets).length) {
        secretsFile = path.join(logDir, `${executionId}.secrets.env`)
        fs.writeFileSync(secretsFile, Object.entries(input.secrets).map(([k, v]) => `${k}=${v}`).join('\n'), { mode: 0o600 })
      }

      const { mcpServers, chromium } = buildConfirmMcpServers(path.join(workspacePath, OUT_DIR, 'screens'), secretsFile)
      log(`Playwright MCP: chromium ${chromium ? chromium.split(path.sep).find(seg => /^chromium-\d+$/.test(seg)) || chromium : '(기본)'}`, 'system')

      // 처리·검증 결과와 사람 코멘트 — 확인자가 「무엇이 구현됐어야 하는지」를 알고 재현·대조하게 한다
      let priorWork = '', comments = ''
      try {
        const notes = (await fetchIssueNotes(project, iid, token)) as any[]
        const body = (n: any) => String(n?.body || '')
        const lastOf = (re: RegExp) => [...notes].reverse().find(n => re.test(body(n)))
        const stripMeta = (x: string) => x.replace(/<!--[\s\S]*?-->/g, '').trim()
        const dev = lastOf(/^## ✅ 개발 완료/m)
        const devReport = dev ? (body(dev).split(/^### 📝 (?:결과|수행 작업)\s*$/m)[1] || '') : ''
        const ver = lastOf(/^## ✅ 검증 통과/m)
        priorWork = [
          devReport.trim() ? `### 처리자 결과 보고\n${stripMeta(devReport).slice(0, 4000)}` : '',
          ver ? `### 검증 통과 노트(요건 대조)\n${stripMeta(body(ver)).replace(/^## .*$/m, '').trim().slice(0, 4000)}` : '',
        ].filter(Boolean).join('\n\n')
        comments = notes
          .filter(n => !n.system && body(n) && !body(n).includes('<!-- ive-bot -->') && !body(n).includes('<!-- ive-agent:') && !body(n).includes('IVE(봇)'))
          .map(n => `- ${n.author?.name || n.author?.username || n.user?.login || '?'} (${String(n.created_at || '').slice(0, 16)}): ${body(n).trim()}`)
          .join('\n').slice(-8000)
      } catch (e) { log(`이슈 코멘트 조회 실패 — 본문만으로 확인합니다: ${(e as Error).message}`, 'warn') }

      return { e2eScript, imagesSection, imagePaths, secretsFile, mcpServers, startedAt, priorWork, comments }
    },

    buildPrompt(ctx, prep) {
      const { editable, version } = resolveEditable(ctx.project.id, 'confirm')
      const limits = getProjectAutomation(ctx.project.id).limits
      const prompt = buildConfirmPrompt({
        iid: ctx.iid, title: ctx.issue.title, body: ctx.issue.description || '', isKo: ctx.isKo,
        priorWork: prep.priorWork, comments: prep.comments,
        stagingUrl: input.staging.url, deployedCommit: input.deployedCommit, mergeCommit: input.mergeCommit,
        mrUrl: input.mrUrl, stagingNotes: input.staging.notes,
        e2eScript: prep.e2eScript, secretEnvNames: Object.keys(input.secrets), outDir: OUT_DIR,
        imagesSection: prep.imagesSection, maxRunMinutes: limits.confirmTimeoutMin,
      }, editable ?? CONFIRM_EDITABLE_DEFAULT)
      return { prompt, promptVersion: version, imagePaths: prep.imagePaths }
    },

    runOptions(ctx, prep) {
      const limits = getProjectAutomation(ctx.project.id).limits
      return {
        maxTurns: limits.confirmMaxTurns,
        maxRunMinutes: limits.confirmTimeoutMin,
        mcpServers: prep.mcpServers,
        extraEnv: input.secrets,
      }
    },

    async onResult(ctx, prep, _cli) {
      const { project, iid, agent, token, executionId, workspacePath, logPath, log, isKo } = ctx
      const raw = parseResult(workspacePath, logPath)
      // 에이전트가 쓴 칸만 가린다 — IVE 가 만든 줄(ive-meta 숫자·커밋 SHA)은 짧은 비밀값과 우연히 겹쳐도 그대로 둔다
      const m = (x: string) => maskSecrets(x, ctx.secrets)
      const masked: ConfirmResult = {
        ...raw,
        summary: m(raw.summary), reason: m(raw.reason), commands: raw.commands.map(m), newDefects: raw.newDefects.map(m),
        engines: raw.engines.map(e => ({ engine: m(e.engine), status: m(e.status), note: e.note ? m(e.note) : e.note })),
        screenshots: raw.screenshots.map(sh => ({ ...sh, caption: sh.caption ? m(sh.caption) : sh.caption })),
        items: raw.items.map(c => ({ ...c, item: m(c.item), how: m(c.how), evidence: c.evidence.map(m) })),
      }

      // 증적 보관 (원본) — 결과 JSON 은 IVE 가 정리한 형태로 덮어쓴다
      const stamp = evidenceStamp()
      const destDir = evidenceDir(project.id, iid, 'confirm', stamp)
      const saved = collectEvidence(path.join(workspacePath, OUT_DIR), destDir)
      fs.mkdirSync(destDir, { recursive: true })
      // 증거로 남은 스크린샷 수 — 증거 없는 통과는 통과가 아니다(enforceConfirmVerdict)
      const screensDir = path.join(destDir, 'screens')
      const savedScreens = fs.existsSync(screensDir) ? fs.readdirSync(screensDir).filter(f => /\.(png|jpe?g|webp)$/i.test(f)).length : 0
      const result = enforceConfirmVerdict(masked, savedScreens, isKo)
      log(`판정: ${result.verdict}${result.reason ? ` — ${result.reason}` : ''}${result.verdict !== masked.verdict ? ` (에이전트 판정 ${masked.verdict} → IVE 규약으로 ${result.verdict})` : ''}`, 'system')
      fs.writeFileSync(path.join(destDir, 'result.json'), JSON.stringify({
        ...result, executionId, agent: agent.name, deployedCommit: input.deployedCommit, mergeCommit: input.mergeCommit,
        stagingUrl: input.staging.url,
      }, null, 2))
      log(`증적 ${saved.length}개 보관: ${path.relative(process.cwd(), destDir)}`, 'system')

      const comment = await buildEvidenceComment(ctx, input, prep, result, destDir, `confirm-${stamp}`)
      try {
        await addIssueComment(project, iid, token, comment)
      } catch (e) {
        log(`증적 코멘트 작성 실패: ${(e as Error).message}`, 'warn')
      }

      setStageVerdict(executionId, result.verdict)
      updateExecutionStatus(executionId, result.verdict === 'pass' ? 'success' : 'failed', new Date().toISOString())

      // 확인하는 동안 사람이 단계를 옮겼으면(재작업 요청·직접 완료 등) 그 결정을 덮어쓰지 않는다 — 결과만 남긴다.
      let nowStage: string | null = null
      try {
        const fresh = await fetchSingleIssue(project, iid, token)
        nowStage = fresh && fresh.state !== 'closed' ? stageFromLabels(fresh.labels || [], project, { hasActiveExec: false }) : 'closed'
      } catch { /* 조회 실패 — 아래에서 단계를 옮기지 않는다 */ }
      if (nowStage !== 'confirming') {
        log(`단계가 이미 바뀌어(${nowStage ?? '조회 실패'}) 라벨은 옮기지 않고 결과만 기록합니다`, 'warn')
        setStageWorkerNote(project.id, iid, `${isKo ? '확인 결과' : 'Confirm result'}: ${result.verdict} — ${isKo ? '확인 중 단계가 바뀌어 단계는 옮기지 않았습니다' : 'stage changed meanwhile, not moved'}`)
        return
      }

      const move = async (action: 'accept' | 'retry', label: string) => {
        try {
          await applyStageAction(project, iid, token, 'confirming', action, { actor: agentActor(agent, executionId), executionId, reason: result.verdict, detail: result.reason ? { reason: String(result.reason).slice(0, 500) } : null })
          log(label, 'system')
          return true
        } catch (e) {
          log(`단계 이동 실패: ${(e as Error).message}`, 'error')
          setStageWorkerNote(project.id, iid, `${isKo ? '확인 결과' : 'Confirm result'}: ${result.verdict} — ${isKo ? '단계 이동 실패, 사람이 옮겨 주세요' : 'stage move failed, move it manually'}`)
          return false
        }
      }

      if (result.verdict === 'pass') {
        markIssueConfirmed(project.id, iid, { name: agent.name, avatar: agent.avatar, userId: null })
        if (await move('accept', '단계: 확인 중 → 완료')) void notifyStageTransition(project, iid, token, 'done')
      } else if (result.verdict === 'fail') {
        // 확인 실패 = 수정이 증상을 없애지 못함 → 처리 재요청(스케줄). 증적 코멘트가 다음 처리의 피드백이 된다.
        await move('retry', '단계: 확인 중 → 스케줄 (재작업)')
      } else {
        setStageWorkerNote(project.id, iid, `${isKo ? '확인 불가' : 'Could not confirm'}: ${result.reason || '-'}`)
        log('단계: 확인 중에 머무름 — 사람 확인 필요', 'warn')
      }
    },

    async onError(ctx, _prep, err) {
      setStageWorkerNote(ctx.project.id, ctx.iid, `${ctx.isKo ? '확인 작업자 오류' : 'Confirm worker error'}: ${maskSecrets(err.message, ctx.secrets).slice(0, 300)}`)
    },

    afterRun(ctx) {
      const f = path.join(ctx.logDir, `${ctx.executionId}.secrets.env`)
      try { if (fs.existsSync(f)) fs.rmSync(f) } catch { /* ignore */ }
    },
  }
}

export async function runConfirmWorker(input: ConfirmInput, executionId: string): Promise<void> {
  const workspacePath = path.join(process.cwd(), 'workspaces', input.project.id, `issue-${input.issue.iid}-confirm`)
  slog.info(`[CONFIRM] ${input.project.name} #${input.issue.iid} agent=${input.agent.name} deployed=${input.deployedCommit.slice(0, 12)}`)
  await runStageWorker(confirmSpec(input), {
    project: input.project, issue: input.issue, agent: input.agent, token: input.token,
    executionId, workspacePath, extraSecrets: Object.values(input.secrets),
  })
}
