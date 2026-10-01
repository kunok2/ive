/**
 * 묶음 배포(3.5.1) — 검증(③) 통과 이슈를 모아 staging 에 한 번 푸시한다.
 *
 * 스캐너가 프로젝트를 훑을 때마다 tickBundles 를 부른다. 판단은 DB 상태(대기열·묶음 상태)로 한다.
 *   1) 대기 중에 확인대기(P)를 벗어난 이슈는 대기열에서 뺀다
 *   2) 진행 중 묶음이 있으면 그 단계를 한 걸음 진행한다
 *        departing → (머지·검사·푸시) → pushed → (파이프라인 성공) → deployed → (실린 이슈 확인 끝) → done
 *   3) 진행 중·보류 묶음이 없고 출발 조건(대기 N건 · T분 조용 · 정해진 시각)이 차면 새 묶음을 만든다
 *      자동 머지가 꺼져 있으면 「승인 대기」로 두고 사람이 승인해야 출발한다
 *
 * 출발 절차: staging 최신본을 받아 대기 이슈의 검증된 커밋을 차례로 머지(--no-ff) → 충돌은 묶음에서 빼고 처리자에게 되돌림
 *   → 합친 결과로 검사 명령 1회 → 실패면 원인 이슈를 찾아(앞에서부터 하나씩 더해 처음 깨지는 이슈) 빼고 다시 → staging 에 한 번 푸시.
 * 확인(④)은 stage-dispatch 가 배포 커밋에 이 묶음의 머지 커밋이 들어 있는지 보고 기동한다.
 */
import fs from 'fs'
import path from 'path'
import { promisify } from 'util'
import { getLogger } from '../logger'
import { Project } from '@/types'
import {
  getProjectAutomation, listWaitingBundleItems, listBundleItems, updateBundleItem, updateBundle, createBundle,
  getInFlightBundle, getHoldingBundle, getLastBundleCreatedAt, removeWaitingBundleItem, resetIssueScheduledAt, getActiveBundleItem, getBundle,
  setStageWorkerNote, stageFromLabels, getDb, type StageBundle, type BundleItem, type BundleSettings,
} from '../db'
import { addIssueComment, fetchSingleIssue, fetchMRByBranch, fetchBranchPipelines, closeMR, reopenIssue, isIssueClosedByGit } from '../provider'
import { addGitLabMRNote } from '../gitlab'
import { addGitHubPRNote } from '../github'
import { applyStageAction } from '../stage-apply'
import { notifyStageTransition } from '../slack-notify'
import { parseCheckCommands, runCheckCommands, checksPassed, type CheckResult } from '../stage-checks'
import { maskSecrets } from '../secret-mask'
import { resolveStagingBranch } from '../staging-config'
import { authedRepoUrl } from './git-ops'
import { resolveProjectLocale } from './stage-worker'

const execFile = promisify(require('child_process').execFile)
const slog = getLogger('Bundle')
const GIT_ID = ['-c', 'user.name=IVE', '-c', 'user.email=ive@localhost']

/** 푸시 후 Git 이 MR 을 머지로 인식하기를 기다리는 시간 — 넘으면 IVE 가 닫고 머지 커밋을 남긴다 */
const MR_SETTLE_MS = 3 * 60_000
/** 푸시한 커밋의 파이프라인이 이 시간 안에 보이지 않으면 CI 가 없는 저장소로 본다 */
const NO_PIPELINE_MS = 5 * 60_000

declare global {
  // eslint-disable-next-line no-var
  var __iveBundleRunning: Set<number> | undefined
}
const running: Set<number> = (global.__iveBundleRunning ??= new Set<number>())

// ── 시각 ──

/** SQLite datetime('now') (UTC, 'YYYY-MM-DD HH:MM:SS') 또는 ISO → ms */
export function dbTimeMs(s: string | null | undefined): number {
  if (!s) return 0
  const iso = /[zZ]|[+-]\d\d:?\d\d$/.test(s) ? s : `${s.replace(' ', 'T')}Z`
  const t = Date.parse(iso)
  return Number.isFinite(t) ? t : 0
}

function tzOffsetMs(at: Date, timeZone: string): number {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone, hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit',
  }).formatToParts(at)
  const g = (t: string) => Number(parts.find(p => p.type === t)?.value)
  return Date.UTC(g('year'), g('month') - 1, g('day'), g('hour'), g('minute'), g('second')) - Math.floor(at.getTime() / 1000) * 1000
}

/** 그 시간대의 「오늘 HH:MM」(과 내일 것) — ms */
function scheduledToday(now: Date, timeZone: string, hhmm: string): number[] {
  const m = hhmm.match(/^(\d{1,2}):(\d{2})$/)
  if (!m) return []
  const off = tzOffsetMs(now, timeZone)
  const local = new Date(now.getTime() + off)
  const base = Date.UTC(local.getUTCFullYear(), local.getUTCMonth(), local.getUTCDate(), Number(m[1]), Number(m[2])) - off
  return [base, base + 86_400_000]
}

export interface DepartDecision {
  go: boolean
  reason: 'count' | 'quiet' | 'scheduled' | null
  /** 다음 출발 예정 (화면 표시) — 대기가 없으면 null */
  nextAt: number | null
}

/** 출발 조건 판정 (순수 함수) — 먼저 오는 것: 대기 N건 · 마지막 추가 후 T분 조용 · 정해진 시각 */
export function decideDeparture(
  waiting: { queuedAt: string }[], s: BundleSettings, now: Date, lastBundleCreatedAt: string | null, timeZone: string,
): DepartDecision {
  if (!waiting.length) return { go: false, reason: null, nextAt: null }
  if (waiting.length >= s.maxWaiting) return { go: true, reason: 'count', nextAt: now.getTime() }
  const lastQueued = Math.max(...waiting.map(w => dbTimeMs(w.queuedAt)))
  const quietAt = lastQueued + s.quietMin * 60_000
  if (now.getTime() >= quietAt) return { go: true, reason: 'quiet', nextAt: now.getTime() }
  const lastBundle = dbTimeMs(lastBundleCreatedAt)
  const firstQueued = Math.min(...waiting.map(w => dbTimeMs(w.queuedAt)))
  let nextAt = quietAt
  for (const t of (s.times || '').split(',').map(x => x.trim()).filter(Boolean)) {
    for (const at of scheduledToday(now, timeZone, t)) {
      // 지난 시각인데 그 뒤로 묶음이 없었고, 그 시각 전에 대기한 이슈가 있으면 출발
      if (at <= now.getTime() && lastBundle < at && firstQueued <= at) return { go: true, reason: 'scheduled', nextAt: now.getTime() }
      if (at > now.getTime()) nextAt = Math.min(nextAt, at)
    }
  }
  return { go: false, reason: null, nextAt }
}

// ── git ──

async function git(cwd: string, args: string[]): Promise<string> {
  const r = await execFile('git', args, { cwd, maxBuffer: 64 * 1024 * 1024 })
  return String(r.stdout)
}

async function hasCommit(cwd: string, sha: string): Promise<boolean> {
  try { await git(cwd, ['cat-file', '-e', `${sha}^{commit}`]); return true } catch { return false }
}

interface MergeOutcome { merged: { item: BundleItem; mergeSha: string }[]; conflicts: { item: BundleItem; files: string[] }[] }

/** base 위에 items 를 차례로 머지한다. 충돌한 것은 건너뛴다. */
async function mergeOnto(cwd: string, baseSha: string, items: BundleItem[], bundle: StageBundle): Promise<MergeOutcome> {
  await git(cwd, ['checkout', '-q', '-f', '-B', `ive-bundle-${bundle.id}`, baseSha])
  const out: MergeOutcome = { merged: [], conflicts: [] }
  for (const item of items) {
    try {
      await git(cwd, [...GIT_ID, 'merge', '--no-ff', '-m', `Merge dev-${item.issueIid} into ${bundle.targetBranch} (IVE bundle #${bundle.id}, #${item.issueIid})`, item.sourceSha])
      out.merged.push({ item, mergeSha: (await git(cwd, ['rev-parse', 'HEAD'])).trim() })
    } catch {
      let files: string[] = []
      try { files = (await git(cwd, ['diff', '--name-only', '--diff-filter=U'])).split('\n').map(s => s.trim()).filter(Boolean) } catch { /* ignore */ }
      try { await git(cwd, ['merge', '--abort']) } catch { /* ignore */ }
      out.conflicts.push({ item, files: files.length ? files : ['(머지 실패)'] })
    }
  }
  return out
}

// ── 이슈 되돌리기·코멘트 ──

async function returnToProcessor(project: Project, token: string, item: BundleItem, bundle: StageBundle, title: string, detail: string, isKo: boolean) {
  const iid = item.issueIid
  try {
    const issue = await fetchSingleIssue(project, iid, token)
    const stage = issue && issue.state !== 'closed' ? stageFromLabels(issue.labels || [], project, { hasActiveExec: false }) : null
    const body = `## ${title}\n\n${detail}\n\n- ${isKo ? '묶음' : 'Bundle'} #${bundle.id} · ${isKo ? '대상' : 'target'} \`${bundle.targetBranch}\` · ${isKo ? '검증한 커밋' : 'verified commit'} \`${item.sourceSha.slice(0, 12)}\``
    await addIssueComment(project, iid, token, body)
    if (stage === 'confirm_waiting') {
      await applyStageAction(project, iid, token, 'confirm_waiting', 'return_to_dev', { source: 'bundle', reason: 'bundle_failed', detail: { bundleId: bundle.id, title } })
      resetIssueScheduledAt(project.id, iid)
    } else {
      setStageWorkerNote(project.id, iid, `${title} — ${isKo ? '단계가 이미 바뀌어 옮기지 않았습니다' : 'stage already changed'}`)
    }
  } catch (e) {
    slog.warn(`return #${iid} to processor failed: ${(e as Error).message}`)
    setStageWorkerNote(project.id, iid, `${title} — ${isKo ? '되돌리기 실패, 사람이 옮겨 주세요' : 'could not move back'}`)
  }
}

function checkTail(r: CheckResult | undefined): string {
  if (!r) return ''
  return `\`${r.command}\` → ${r.timedOut ? 'timeout' : `exit ${r.exitCode}`}\n\n\`\`\`\n${r.outputTail.slice(-1500)}\n\`\`\``
}

// ── 출발 ──

/**
 * 묶음 출발: 머지 → 검사(실패 시 원인 이슈 찾기) → 푸시. 실패는 묶음 상태·메모로 남긴다.
 * 같은 묶음을 두 번 돌리지 않는다(메모리 잠금). 재시작으로 끊기면 다음 스캔이 처음부터 다시 한다(푸시 전까지는 부작용이 없다).
 */
export async function runBundleDeparture(project: Project, token: string, bundle: StageBundle): Promise<void> {
  if (running.has(bundle.id)) return
  running.add(bundle.id)
  const { isKo } = resolveProjectLocale(project)
  const ws = path.join(process.cwd(), 'workspaces', project.id, `bundle-${bundle.id}`)
  const settings = getProjectAutomation(project.id).bundle
  const secrets = [token]
  try {
    // 재시작으로 중간에 끊긴 묶음이면 머지 결과를 버리고 다시 한다
    for (const it of listBundleItems(bundle.id)) if (it.status === 'merged') updateBundleItem(it.id, { status: 'in_bundle', mergeSha: null })

    for (let attempt = 1; attempt <= 2; attempt++) {
      const items = listBundleItems(bundle.id).filter(i => i.status === 'in_bundle')
      if (!items.length) { updateBundle(bundle.id, { status: 'empty', note: isKo ? '실을 이슈가 없습니다' : 'nothing to ship', finishedAt: true }); return }

      if (fs.existsSync(ws)) fs.rmSync(ws, { recursive: true, force: true })
      fs.mkdirSync(ws, { recursive: true })
      await execFile('git', ['clone', '--filter=blob:none', '--branch', bundle.targetBranch, authedRepoUrl(project, token), '.'], { cwd: ws, maxBuffer: 16 * 1024 * 1024 })
      const baseSha = (await git(ws, ['rev-parse', 'HEAD'])).trim()
      updateBundle(bundle.id, { baseSha })

      // 대상 이슈 확인: 아직 확인대기(P)이고 검증한 커밋을 받을 수 있어야 한다
      const ready: BundleItem[] = []
      for (const item of items) {
        let stage: string | null = null
        try {
          const issue = await fetchSingleIssue(project, item.issueIid, token)
          stage = issue && issue.state !== 'closed' ? stageFromLabels(issue.labels || [], project, { hasActiveExec: false }) : 'closed'
        } catch { stage = null }
        if (stage !== 'confirm_waiting') {
          updateBundleItem(item.id, { status: 'removed', note: `${isKo ? '출발 시 단계' : 'stage at departure'}: ${stage ?? '?'}` })
          continue
        }
        try { await git(ws, ['fetch', 'origin', `+refs/heads/dev-${item.issueIid}:refs/remotes/origin/dev-${item.issueIid}`]) } catch { /* 브랜치가 지워졌을 수 있다 */ }
        if (!(await hasCommit(ws, item.sourceSha))) {
          try { await git(ws, ['fetch', 'origin', item.sourceSha]) } catch { /* ignore */ }
        }
        if (!(await hasCommit(ws, item.sourceSha))) {
          updateBundleItem(item.id, { status: 'removed', note: isKo ? '검증한 커밋을 찾을 수 없습니다' : 'verified commit not found' })
          setStageWorkerNote(project.id, item.issueIid, isKo ? '묶음 배포: 검증한 커밋을 찾을 수 없어 빠졌습니다 — 다시 검증이 필요합니다' : 'Bundle: verified commit missing')
          continue
        }
        ready.push(item)
      }

      // 1) 머지 — 충돌은 빼고 처리자에게
      let outcome = await mergeOnto(ws, baseSha, ready, bundle)
      for (const c of outcome.conflicts) {
        updateBundleItem(c.item.id, { status: 'conflict', note: c.files.join(', ') })
        await returnToProcessor(project, token, c.item, bundle,
          isKo ? '📦 묶음 배포: staging 최신본과 충돌 — 다시 처리합니다' : '📦 Bundle: conflicts with staging — back to processing',
          `${isKo ? '충돌 파일' : 'Conflicting files'}: ${c.files.map(f => `\`${f}\``).join(', ')}`, isKo)
      }

      // 2) 합친 결과로 검사 1회 — 실패하면 앞에서부터 하나씩 더해 처음 깨지는 이슈를 원인으로 빼고 다시
      const commands = parseCheckCommands(settings.checkCommands)
      if (commands.length && outcome.merged.length) {
        let pool = outcome.merged.map(m => m.item)
        for (let guard = 0; guard <= ready.length && pool.length; guard++) {
          const res = await runCheckCommands(ws, commands, settings.checkTimeoutMin, secrets)
          if (checksPassed(res)) break
          // 원인 찾기: 접두 길이에 대해 이분 탐색 (가장 짧은 실패 접두의 마지막 이슈)
          let lo = 1, hi = pool.length, culpritIdx = pool.length - 1
          let culpritCheck: CheckResult | undefined = res.find(r => !r.ok)
          while (lo <= hi) {
            const mid = Math.floor((lo + hi) / 2)
            await mergeOnto(ws, baseSha, pool.slice(0, mid), bundle)
            const r = await runCheckCommands(ws, commands, settings.checkTimeoutMin, secrets)
            if (checksPassed(r)) lo = mid + 1
            else { culpritIdx = mid - 1; culpritCheck = r.find(x => !x.ok); hi = mid - 1 }
          }
          // 모든 짧은 접두가 통과하고 전체만 실패하면(이슈 사이의 상호작용) 마지막 이슈를 원인으로 본다
          const culprit = pool[culpritIdx]
          updateBundleItem(culprit.id, { status: 'check_failed', note: culpritCheck?.command || '' })
          await returnToProcessor(project, token, culprit, bundle,
            isKo ? '📦 묶음 배포: 합친 결과 검사 실패 — 다시 처리합니다' : '📦 Bundle: checks failed after merging — back to processing',
            `${isKo ? '이 이슈를 더했을 때 처음 검사가 실패했습니다' : 'Checks first failed when this issue was added'}:\n\n${maskSecrets(checkTail(culpritCheck), secrets)}`, isKo)
          pool = pool.filter(p => p.id !== culprit.id)
          outcome = await mergeOnto(ws, baseSha, pool, bundle)
          for (const c of outcome.conflicts) {
            // 원인을 뺀 뒤 순서가 바뀌어 새로 충돌하는 경우
            updateBundleItem(c.item.id, { status: 'conflict', note: c.files.join(', ') })
            await returnToProcessor(project, token, c.item, bundle,
              isKo ? '📦 묶음 배포: staging 최신본과 충돌 — 다시 처리합니다' : '📦 Bundle: conflicts with staging — back to processing',
              `${isKo ? '충돌 파일' : 'Conflicting files'}: ${c.files.map(f => `\`${f}\``).join(', ')}`, isKo)
          }
          pool = outcome.merged.map(m => m.item)
        }
        if (!pool.length) outcome = { merged: [], conflicts: [] }
      }

      if (!outcome.merged.length) {
        updateBundle(bundle.id, { status: 'empty', note: isKo ? '충돌·검사 실패로 실을 이슈가 남지 않았습니다' : 'no issue left to ship', finishedAt: true })
        return
      }
      for (const m of outcome.merged) updateBundleItem(m.item.id, { status: 'merged', mergeSha: m.mergeSha })

      // 3) staging 에 한 번 푸시 (빨리감기만 — 그사이 누가 푸시했으면 처음부터 다시)
      try {
        await git(ws, ['push', 'origin', `HEAD:refs/heads/${bundle.targetBranch}`])
      } catch (e) {
        const msg = maskSecrets((e as Error).message, secrets)
        if (attempt < 2 && /non-fast-forward|rejected|fetch first/i.test(msg)) {
          slog.info(`[BUNDLE] #${bundle.id} push rejected (target moved) — retry from latest`)
          for (const m of outcome.merged) updateBundleItem(m.item.id, { status: 'in_bundle', mergeSha: null })
          continue
        }
        for (const m of outcome.merged) updateBundleItem(m.item.id, { status: 'in_bundle', mergeSha: null })
        updateBundle(bundle.id, { status: 'failed', note: `${isKo ? '푸시 실패' : 'push failed'}: ${msg.slice(0, 300)}` })
        return
      }
      const pushedSha = (await git(ws, ['rev-parse', 'HEAD'])).trim()
      for (const m of outcome.merged) updateBundleItem(m.item.id, { status: 'pushed' })
      updateBundle(bundle.id, { status: 'pushed', pushedSha, pushedAt: true, note: null })
      slog.info(`[BUNDLE] ${project.name} #${bundle.id} pushed ${pushedSha.slice(0, 12)} → ${bundle.targetBranch} (${outcome.merged.length} issues)`)

      const list = outcome.merged.map(m => `#${m.item.issueIid}`).join(' ')
      for (const m of outcome.merged) {
        setStageWorkerNote(project.id, m.item.issueIid, null)
        try {
          await addIssueComment(project, m.item.issueIid, token, isKo
            ? `## 📦 묶음 #${bundle.id} — staging 반영\n\n- 대상: \`${bundle.targetBranch}\` · 머지 커밋 \`${m.mergeSha.slice(0, 12)}\` · 푸시 \`${pushedSha.slice(0, 12)}\`\n- 함께 실린 이슈: ${list}\n- 배포(파이프라인)가 끝나면 확인(④)이 시작됩니다.`
            : `## 📦 Bundle #${bundle.id} — shipped to staging\n\n- Target: \`${bundle.targetBranch}\` · merge commit \`${m.mergeSha.slice(0, 12)}\` · pushed \`${pushedSha.slice(0, 12)}\`\n- Shipped together: ${list}\n- Confirmation starts after the deployment pipeline.`)
        } catch (e) { slog.warn(`bundle comment #${m.item.issueIid} failed: ${(e as Error).message}`) }
      }
      return
    }
  } catch (e) {
    const msg = maskSecrets((e as Error).message, secrets)
    slog.error(`[BUNDLE] #${bundle.id} departure failed: ${msg}`)
    for (const it of listBundleItems(bundle.id)) if (it.status === 'merged') updateBundleItem(it.id, { status: 'in_bundle', mergeSha: null })
    updateBundle(bundle.id, { status: 'failed', note: `${isKo ? '출발 실패' : 'departure failed'}: ${msg.slice(0, 300)}` })
  } finally {
    running.delete(bundle.id)
    try { if (fs.existsSync(ws)) fs.rmSync(ws, { recursive: true, force: true }) } catch { /* ignore */ }
  }
}

// ── 푸시 후: MR 정리·배포 감시 ──

async function settleMergeRequests(project: Project, token: string, bundle: StageBundle, isKo: boolean) {
  const pushedAt = dbTimeMs(bundle.pushedAt)
  for (const item of listBundleItems(bundle.id).filter(i => i.status === 'pushed' && !i.mrResult)) {
    let mr: any = null
    try { mr = await fetchMRByBranch(project, token, `dev-${item.issueIid}`) } catch { /* ignore */ }
    if (!mr) { updateBundleItem(item.id, { mrResult: 'no_mr' }); continue }
    if (mr.state === 'merged' || mr.merged_at) { updateBundleItem(item.id, { mrResult: 'merged_by_push' }); continue }
    if (Date.now() - pushedAt < MR_SETTLE_MS) continue
    // Git 이 머지로 인식하지 못했다 — 닫고 머지 커밋을 남긴다
    const note = isKo
      ? `IVE 묶음 #${bundle.id} 으로 \`${bundle.targetBranch}\` 에 머지되었습니다 — 머지 커밋 \`${item.mergeSha}\` (푸시 \`${bundle.pushedSha}\`)`
      : `Merged into \`${bundle.targetBranch}\` by IVE bundle #${bundle.id} — merge commit \`${item.mergeSha}\``
    try {
      if (project.provider === 'github') await addGitHubPRNote(project, token, mr.iid ?? mr.number, note)
      else await addGitLabMRNote(project, token, mr.iid, note)
      await closeMR(project, token, mr.iid ?? mr.number)
      updateBundleItem(item.id, { mrResult: 'closed_by_ive' })
    } catch (e) {
      slog.warn(`close MR for #${item.issueIid} failed: ${(e as Error).message}`)
    }
  }
}

async function watchPipeline(project: Project, token: string, bundle: StageBundle, isKo: boolean) {
  let pipelines: any[] = []
  try { pipelines = ((await fetchBranchPipelines(project, token, bundle.targetBranch)) as any[]) || [] } catch { /* 다음 스캔에 다시 */ }
  const p = pipelines.find(x => x?.sha && x.sha === bundle.pushedSha)
  const age = Date.now() - dbTimeMs(bundle.pushedAt)
  if (p) {
    if (p.status !== bundle.pipelineStatus || p.web_url !== bundle.pipelineUrl) updateBundle(bundle.id, { pipelineStatus: p.status, pipelineUrl: p.web_url || null })
    if (p.status === 'success') return markDeployed(project, token, bundle)
    if (p.status === 'failed' || p.status === 'canceled' || p.status === 'cancelled') {
      updateBundle(bundle.id, { status: 'failed', note: isKo ? `배포 파이프라인 ${p.status} — 사람 확인 필요` : `pipeline ${p.status}` }, 'pushed')
      for (const it of listBundleItems(bundle.id).filter(i => i.status === 'pushed')) {
        setStageWorkerNote(project.id, it.issueIid, isKo ? `묶음 #${bundle.id} 배포 파이프라인 실패 — 사람 확인 필요` : `Bundle #${bundle.id} pipeline failed`)
      }
    }
    return
  }
  if (age > NO_PIPELINE_MS) {
    // 푸시한 커밋의 파이프라인이 보이지 않는다 — CI 가 없는 저장소. 배포 확인은 확인(④) 기동 조건(배포 커밋 포함)이 맡는다
    updateBundle(bundle.id, { pipelineStatus: 'none' })
    return markDeployed(project, token, bundle)
  }
}

async function markDeployed(project: Project, token: string, bundle: StageBundle) {
  if (!updateBundle(bundle.id, { status: 'deployed', deployedAt: true }, 'pushed')) return
  slog.info(`[BUNDLE] ${project.name} #${bundle.id} deployed`)
  // 확인자가 사람이면 「이제 확인하세요」 DM (에이전트는 dispatch 가 바로 기동한다)
  for (const it of listBundleItems(bundle.id).filter(i => i.status === 'pushed')) {
    void notifyStageTransition(project, it.issueIid, token, 'confirm')
  }
}

/** 이 묶음 푸시 이후 에이전트 확인이 실패한 이슈 수 */
function confirmFailuresSince(projectId: string, iids: number[], sinceMs: number): number[] {
  if (!iids.length) return []
  const rows = getDb().prepare(`
    SELECT issue_iid as iid, stage_verdict as v, started_at FROM task_executions
    WHERE project_id = ? AND id LIKE 'ex-confirm-%' AND assignee_type = 'agent' AND stage_verdict = 'fail'
      AND issue_iid IN (${iids.map(() => '?').join(',')})
  `).all(projectId, ...iids) as { iid: number; v: string; started_at: string }[]
  return Array.from(new Set(rows.filter(r => dbTimeMs(r.started_at) >= sinceMs).map(r => r.iid)))
}

/**
 * 묶음으로 staging 에 실려 확인을 기다리는 이슈를 Git 이 닫았으면(커밋 메시지·MR 의 닫기 키워드가 기본 브랜치에 들어옴) 다시 연다.
 * 이슈는 확인(④)이 끝나 완료(E)가 될 때 IVE 가 닫는다. 사람이 직접 닫은 이슈는 건드리지 않는다.
 * @returns 다시 열었으면 true
 */
export async function reopenIfClosedByGit(project: Project, token: string, iid: number, issue?: any): Promise<boolean> {
  const it = getActiveBundleItem(project.id, iid)
  if (!it || (it.status !== 'pushed' && it.status !== 'merged')) return false
  const cur = issue ?? await fetchSingleIssue(project, iid, token).catch(() => null)
  if (!cur || cur.state !== 'closed') return false
  const st = stageFromLabels(cur.labels || [], project, { hasActiveExec: false })
  if (st !== 'confirm_waiting' && st !== 'confirming') return false
  if ((await isIssueClosedByGit(project, iid, token)) !== true) return false
  const { isKo } = resolveProjectLocale(project)
  await reopenIssue(project, iid, token)
  slog.info(`[BUNDLE] ${project.name} #${iid} reopened — closed by a commit before confirmation`)
  try {
    await addIssueComment(project, iid, token, isKo
      ? `## 🔓 이슈를 다시 열었습니다

묶음 #${it.bundleId} 이 \`${getBundle(it.bundleId!)?.targetBranch ?? ''}\` 에 실리면서 커밋 메시지의 닫기 키워드로 Git 이 이 이슈를 닫았습니다. 아직 확인(④) 전이라 다시 엽니다 — 확인이 끝나 완료되면 IVE 가 닫습니다.`
      : `## 🔓 Reopened

Git closed this issue via a closing keyword when bundle #${it.bundleId} shipped. Confirmation is still pending — IVE closes it when it is done.`)
  } catch { /* 코멘트 실패는 무시 */ }
  return true
}

/**
 * 이슈의 지금 단계. 이번 스캔 목록에 있으면 그 값, 없으면 한 건 직접 조회한다
 * (목록 조회가 오류 없이 비어 돌아오는 경우가 있어, 목록에 없다는 것만으로 닫혔다고 보지 않는다).
 */
function stageResolver(project: Project, token: string, stages: Map<number, string | null>) {
  const cache = new Map<number, string | null | undefined>()
  return async (iid: number): Promise<string | null | undefined> => {
    if (stages.has(iid)) return stages.get(iid)
    if (cache.has(iid)) return cache.get(iid)
    let st: string | null | undefined
    try {
      const issue = await fetchSingleIssue(project, iid, token)
      if (issue && issue.state === 'closed' && await reopenIfClosedByGit(project, token, iid, issue)) issue.state = 'opened'
      st = !issue ? undefined : issue.state === 'closed' ? 'closed' : stageFromLabels(issue.labels || [], project, { hasActiveExec: false })
    } catch { st = undefined }   // 조회 실패 = 모름 — 아무것도 바꾸지 않는다
    cache.set(iid, st)
    return st
  }
}

async function progressDeployed(project: Project, bundle: StageBundle, stageOf: (iid: number) => Promise<string | null | undefined>, isKo: boolean) {
  const items = listBundleItems(bundle.id).filter(i => i.status === 'pushed')
  const failed = confirmFailuresSince(project.id, items.map(i => i.issueIid), dbTimeMs(bundle.deployedAt || bundle.pushedAt))
  if (failed.length >= 2) {
    // 여러 이슈의 확인이 동시에 실패 — 이슈별 재작업이 아니라 staging 이 깨진 것으로 본다
    updateBundle(bundle.id, { status: 'broken', note: isKo ? `확인 동시 실패 ${failed.map(i => `#${i}`).join(' ')} — staging 이 깨진 것으로 보고 다음 묶음을 보류합니다` : `simultaneous confirm failures ${failed.join(',')}` }, 'deployed')
    return
  }
  for (const it of items) {
    const st = await stageOf(it.issueIid)
    if (st === undefined) continue
    if (st !== 'confirm_waiting' && st !== 'confirming') updateBundleItem(it.id, { status: 'done' })
  }
  if (!listBundleItems(bundle.id).some(i => i.status === 'pushed')) {
    updateBundle(bundle.id, { status: 'done', finishedAt: true }, 'deployed')
    slog.info(`[BUNDLE] ${project.name} #${bundle.id} done`)
  }
}

// ── 스캔마다 ──

export interface BundleView {
  waiting: BundleItem[]
  inFlight: StageBundle | null
  holding: StageBundle | null
  nextAt: number | null
}

export function bundleNextDeparture(project: Project, waiting: BundleItem[], settings: BundleSettings): number | null {
  const { timezone } = resolveProjectLocale(project)
  return decideDeparture(waiting, settings, new Date(), getLastBundleCreatedAt(project.id), timezone).nextAt
}

/**
 * @param stages 이번 스캔에서 본 열린 이슈의 단계 (없는 이슈 = 닫혔거나 라벨이 빠짐)
 */
export async function tickBundles(project: Project, token: string, stages: Map<number, string | null>): Promise<void> {
  const { isKo, timezone } = resolveProjectLocale(project)
  const stageOf = stageResolver(project, token, stages)

  // 1) 대기 중에 확인대기를 벗어난 이슈는 대기열에서 뺀다
  for (const w of listWaitingBundleItems(project.id)) {
    const st = await stageOf(w.issueIid)
    if (st === undefined) continue
    if (st !== 'confirm_waiting') removeWaitingBundleItem(project.id, w.issueIid, `${isKo ? '대기 중 단계 변경' : 'stage changed while waiting'}: ${st ?? '-'}`)
  }

  // 2) 진행 중 묶음
  const cur = getInFlightBundle(project.id)
  if (cur) {
    if (cur.status === 'departing') {
      if (!running.has(cur.id)) void runBundleDeparture(project, token, cur).catch(e => slog.error({ err: e }, 'bundle departure'))
    } else if (cur.status === 'pushed') {
      await settleMergeRequests(project, token, cur, isKo)
      await watchPipeline(project, token, cur, isKo)
    } else if (cur.status === 'deployed') {
      await settleMergeRequests(project, token, cur, isKo)
      await progressDeployed(project, cur, stageOf, isKo)
    }
    return
  }
  if (getHoldingBundle(project.id)) return

  // 3) 출발 조건
  const waiting = listWaitingBundleItems(project.id)
  const settings = getProjectAutomation(project.id).bundle
  const d = decideDeparture(waiting, settings, new Date(), getLastBundleCreatedAt(project.id), timezone)
  if (!d.go) return
  const target = await resolveStagingBranch(project, token)
  const pick = waiting.slice(0, Math.max(1, settings.maxSize)).map(w => w.id)
  const b = createBundle(project.id, target, pick, settings.agentMerge ? 'departing' : 'awaiting_approval')
  if (!b) return
  slog.info(`[BUNDLE] ${project.name} #${b.id} created (${d.reason}, ${pick.length} issues, ${b.status})`)
  if (b.status === 'departing') void runBundleDeparture(project, token, b).catch(e => slog.error({ err: e }, 'bundle departure'))
}
