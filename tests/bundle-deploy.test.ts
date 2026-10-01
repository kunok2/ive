/**
 * ③ 검증 기동 판정 · 3.5.1 묶음 배포 — DB 는 실제 스키마(initSchema), git 은 실제 저장소(임시 bare repo).
 * Git 호스팅 API(이슈·MR·파이프라인)·단계 이동·작업자 실행만 가짜로 바꾼다.
 *
 *   B-1 출발 조건: 대기 N건 · 마지막 추가 후 T분 조용 · 정해진 시각 (먼저 오는 것), 다음 출발 예정
 *   B-2 대기열: 같은 이슈 재검증은 대기 줄을 새 커밋으로 바꾼다, 진행 중·보류 묶음이 있으면 새 묶음을 만들지 않는다
 *   B-3 출발(실제 git): 차례로 머지 → 충돌은 빼고 처리자에게 → 합친 결과 검사 실패 원인 이슈를 찾아 빼고 → 한 번 푸시
 *   B-4 푸시 후: 파이프라인 성공 → 배포됨, Git 이 머지로 못 잡은 MR 은 닫고 머지 커밋을 남김, 확인 끝나면 완료
 *   B-5 여러 이슈 확인 동시 실패 → staging 깨짐(보류)
 *   B-6 자동 머지 꺼짐 → 승인 대기에서 멈춤
 *   B-7 묶음으로 실린 뒤 Git 이 커밋 메시지(닫기 키워드)로 이슈를 닫으면 다시 열고 확인을 기다린다 — 사람이 닫은 것은 두고, 완료로 치지 않는다
 *   V-1 검증 판정: 검사 실패·충돌은 에이전트 판정과 무관하게 fail, 결과 파일 없음 → blocked
 *   V-2 검증 기동: 사람 검증자면 아무것도 안 함, 처리한 에이전트와 같으면 안 띄움, MR 없으면 안 띄움, 갖춰지면 기동
 *   C-1 확인 기동: 묶음 대기 중이면 기다리고, 푸시된 묶음의 머지 커밋으로 확인한다(MR 조회 없이)
 *   K-1 검사 명령: 종료 코드로 판정, 토큰 환경변수를 넘기지 않는다
 *   S-1 배포 커밋 확인 방법 「브랜치 파이프라인」: 버전 주소 없이도 설정 유효, 마지막 성공 파이프라인 커밋
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import Database from 'better-sqlite3'
import fs from 'fs'
import os from 'os'
import path from 'path'
import { execFileSync } from 'child_process'

const providerMock = vi.hoisted(() => ({
  fetchSingleIssue: vi.fn(),
  addIssueComment: vi.fn(async () => undefined),
  fetchMRByBranch: vi.fn(),
  fetchBranchPipelines: vi.fn(),
  closeMR: vi.fn(async () => undefined),
  isAncestorCommit: vi.fn(async () => true),
  getDefaultBranch: vi.fn(async () => 'main'),
  addIssueLabels: vi.fn(async () => undefined),
  removeIssueLabels: vi.fn(async () => undefined),
  reopenIssue: vi.fn(async () => undefined),
  isIssueClosedByGit: vi.fn(async () => true),
}))
const applyMock = vi.hoisted(() => ({ applyStageAction: vi.fn(async () => 'waiting') }))
const gitlabMock = vi.hoisted(() => ({ addGitLabMRNote: vi.fn(async () => undefined) }))
const workerMock = vi.hoisted(() => ({
  runVerifyWorker: vi.fn(() => Promise.resolve()),
  runConfirmWorker: vi.fn(() => Promise.resolve()),
}))
vi.mock('@/lib/provider', () => providerMock)
vi.mock('@/lib/stage-apply', () => applyMock)
vi.mock('@/lib/gitlab', () => gitlabMock)
vi.mock('@/lib/github', () => ({ addGitHubPRNote: vi.fn() }))
vi.mock('@/lib/slack-notify', () => ({ notifyStageTransition: vi.fn(async () => undefined), getIveBaseUrl: () => '' }))
vi.mock('@/lib/scanner/verify-worker', async (orig) => ({ ...(await orig<typeof import('@/lib/scanner/verify-worker')>()), runVerifyWorker: workerMock.runVerifyWorker }))
vi.mock('@/lib/scanner/confirm-worker', () => ({ runConfirmWorker: workerMock.runConfirmWorker }))

// 실제 git 저장소를 만들고 머지·푸시한다 — 전체 테스트를 병렬로 돌리면 기본 10초를 넘길 수 있다
vi.setConfig({ testTimeout: 60_000 })

import { initSchema } from '@/lib/db/schema'
import {
  enqueueBundleItem, listWaitingBundleItems, createBundle, getBundle, listBundleItems, updateBundle, getInFlightBundle,
  updateProjectAutomation, setPresetRoles, setRosterEntry, getStageWorkerNote, createExecution, replaceProjectMembers,
  DEFAULT_BUNDLE, getLatestBundleItem,
} from '@/lib/db'
import { decideDeparture, runBundleDeparture, tickBundles } from '@/lib/scanner/bundle-deploy'
import { enforceVerifyVerdict, parseVerifyResult } from '@/lib/scanner/verify-worker'
import { dispatchStageWorkers } from '@/lib/scanner/stage-dispatch'
import { openAgentStageExecution, setStageVerdict } from '@/lib/scanner/stage-records'
import { runCheckCommand, parseCheckCommands, type CheckResult } from '@/lib/stage-checks'
import { resolveStagingConfig, fetchDeployedCommit } from '@/lib/staging-config'
import type { Project } from '@/types'

const P = 'p1'
let db: Database.Database
let tmp: string
let bare: string
let project: Project
const sha = (cwd: string, ref = 'HEAD') => execFileSync('git', ['rev-parse', ref], { cwd }).toString().trim()
const g = (cwd: string, ...args: string[]) => execFileSync('git', ['-c', 'user.name=t', '-c', 'user.email=t@x', ...args], { cwd, stdio: 'pipe' }).toString()

beforeEach(() => {
  vi.clearAllMocks()
  // 앞 테스트의 출발 작업이 남긴 진행 중 표시를 비운다 (묶음 id 가 테스트마다 1부터라 겹친다)
  ;(globalThis as any).__iveBundleRunning?.clear()
  db = new Database(':memory:')
  ;(globalThis as any).db = db
  initSchema(db)
  db.prepare(`INSERT INTO users (id, email, password, name, locale, timezone) VALUES ('owner', 'o@x', '', 'Owner', 'ko', 'Asia/Seoul')`).run()
  db.prepare(`INSERT INTO projects (id, user_id, name, provider, repo_url, access_token) VALUES (?, 'owner', 'Proj', 'gitlab', 'https://gitlab.com/g/r', '')`).run(P)
  for (const [id, name] of [['a1', 'Alpha'], ['a2', 'Beta']]) {
    db.prepare(`INSERT INTO agents (id, user_id, name, cli_name, cli_path) VALUES (?, 'owner', ?, 'claude', 'claude')`).run(id, name)
  }
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'ive-bundle-'))
  bare = path.join(tmp, 'origin.git')
  project = { id: P, name: 'Proj', userId: 'owner', provider: 'gitlab', repoUrl: bare, baseBranch: 'main', labelTarget: 'IVE', testSiteUrl: '' } as unknown as Project
  providerMock.fetchSingleIssue.mockImplementation(async (_p: Project, iid: number) => ({ iid, state: 'opened', labels: ['IVE', 'IVE-P'] }))
})

afterEach(() => { try { fs.rmSync(tmp, { recursive: true, force: true }) } catch { /* ignore */ } })

/** origin(main: a.txt) + dev-1(b.txt 추가) dev-2(a.txt 수정) dev-3(a.txt 같은 줄 다르게 → dev-2 뒤에 충돌) dev-4(bad.txt → 검사 실패) */
function makeRepo(): Record<number, string> {
  execFileSync('git', ['init', '--bare', '-b', 'main', bare])
  const w = path.join(tmp, 'w')
  execFileSync('git', ['clone', bare, w], { stdio: 'pipe' })
  fs.writeFileSync(path.join(w, 'a.txt'), 'line\n')
  g(w, 'add', '.'); g(w, 'commit', '-m', 'init'); g(w, 'push', 'origin', 'HEAD:main')
  const out: Record<number, string> = {}
  const branch = (n: number, file: string, content: string) => {
    g(w, 'checkout', '-q', '-B', `dev-${n}`, 'origin/main')
    fs.writeFileSync(path.join(w, file), content)
    g(w, 'add', '.'); g(w, 'commit', '-m', `dev-${n}`); g(w, 'push', '-f', 'origin', `dev-${n}`)
    out[n] = sha(w)
  }
  branch(1, 'b.txt', 'b\n')
  branch(2, 'a.txt', 'two\n')
  branch(3, 'a.txt', 'three\n')
  branch(4, 'bad.txt', 'x\n')
  return out
}

describe('B-1 출발 조건', () => {
  const s = { ...DEFAULT_BUNDLE, maxWaiting: 3, quietMin: 30, times: '' }
  const at = (iso: string) => ({ queuedAt: iso })
  const now = new Date('2026-10-01T03:00:00Z')

  it('대기가 없으면 출발하지 않고 예정도 없다', () => {
    expect(decideDeparture([], s, now, null, 'Asia/Seoul')).toEqual({ go: false, reason: null, nextAt: null })
  })
  it('대기 N건이면 바로 출발', () => {
    expect(decideDeparture([at('2026-10-01 02:59:00'), at('2026-10-01 02:59:30'), at('2026-10-01 02:59:50')], s, now, null, 'Asia/Seoul').reason).toBe('count')
  })
  it('마지막 추가 후 T분 조용하면 출발, 아니면 그 시각이 다음 예정', () => {
    expect(decideDeparture([at('2026-10-01 02:20:00')], s, now, null, 'Asia/Seoul').reason).toBe('quiet')
    const d = decideDeparture([at('2026-10-01 02:50:00')], s, now, null, 'Asia/Seoul')
    expect(d.go).toBe(false)
    expect(new Date(d.nextAt!).toISOString()).toBe('2026-10-01T03:20:00.000Z')
  })
  it('정해진 시각(프로젝트 시간대)이 지났고 그 뒤 묶음이 없으면 출발, 다음 예정은 더 이른 쪽', () => {
    const t = { ...s, times: '11:50, 12:10' }   // KST — UTC 02:50, 03:10
    expect(decideDeparture([at('2026-10-01 02:45:00')], t, now, null, 'Asia/Seoul').reason).toBe('scheduled')
    // 11:50 이후에 이미 묶음이 있었으면 그 시각으로는 다시 출발하지 않는다 → 다음은 12:10(03:10Z)
    const d = decideDeparture([at('2026-10-01 02:55:00')], t, now, '2026-10-01 02:52:00', 'Asia/Seoul')
    expect(d.go).toBe(false)
    expect(new Date(d.nextAt!).toISOString()).toBe('2026-10-01T03:10:00.000Z')
  })
})

describe('B-2 대기열', () => {
  it('같은 이슈를 다시 올리면 대기 줄을 새 커밋으로 바꾼다', () => {
    enqueueBundleItem(P, 1, { sourceSha: 'aaa' })
    enqueueBundleItem(P, 1, { sourceSha: 'bbb' })
    expect(listWaitingBundleItems(P).map(i => i.sourceSha)).toEqual(['bbb'])
  })
  it('진행 중·보류 묶음이 있으면 새 묶음을 만들지 않는다', () => {
    const i1 = enqueueBundleItem(P, 1, { sourceSha: 'aaa' })!
    const b = createBundle(P, 'main', [i1.id], 'awaiting_approval')!
    const i2 = enqueueBundleItem(P, 2, { sourceSha: 'ccc' })!
    expect(createBundle(P, 'main', [i2.id], 'departing')).toBeNull()
    updateBundle(b.id, { status: 'failed' })
    expect(createBundle(P, 'main', [i2.id], 'departing')).toBeNull()   // 보류
    updateBundle(b.id, { status: 'released' })
    expect(createBundle(P, 'main', [i2.id], 'departing')).not.toBeNull()
  })
  it('이미 묶음에 실려 진행 중인 이슈는 다시 올리지 않는다', () => {
    const i1 = enqueueBundleItem(P, 1, { sourceSha: 'aaa' })!
    createBundle(P, 'main', [i1.id], 'departing')
    expect(enqueueBundleItem(P, 1, { sourceSha: 'zzz' })).toBeNull()
  })
})

describe('B-3 출발 — 실제 git', () => {
  it('머지 → 충돌 제외 → 검사 실패 원인 제외 → 한 번 푸시', async () => {
    const shas = makeRepo()
    const base = sha(bare, 'main')
    updateProjectAutomation(P, { bundle: { checkCommands: 'test ! -f bad.txt', agentMerge: true } }, 'owner')
    const ids = [1, 2, 3, 4].map(n => enqueueBundleItem(P, n, { sourceSha: shas[n], issueTitle: `t${n}` })!.id)
    const b = createBundle(P, 'main', ids, 'departing')!
    await runBundleDeparture(project, 'tok', b)

    const after = getBundle(b.id)!
    expect(after.status).toBe('pushed')
    const items = Object.fromEntries(listBundleItems(b.id).map(i => [i.issueIid, i]))
    expect(items[1].status).toBe('pushed')
    expect(items[2].status).toBe('pushed')
    expect(items[3].status).toBe('conflict')        // dev-2 와 같은 줄
    expect(items[4].status).toBe('check_failed')    // bad.txt 를 더했을 때 처음 검사 실패
    // 원격 main 이 푸시된 커밋이고, 이슈 1·2 의 검증 커밋과 머지 커밋이 들어 있다. 3·4 는 없다
    const head = sha(bare, 'main')
    expect(head).toBe(after.pushedSha)
    expect(after.baseSha).toBe(base)
    const isAnc = (a: string) => { try { execFileSync('git', ['merge-base', '--is-ancestor', a, head], { cwd: bare }); return true } catch { return false } }
    expect(isAnc(shas[1]) && isAnc(shas[2]) && isAnc(items[1].mergeSha!) && isAnc(items[2].mergeSha!)).toBe(true)
    expect(isAnc(shas[3]) || isAnc(shas[4])).toBe(false)
    // 빠진 이슈는 처리자에게 되돌린다 (확인대기 → 재작업)
    const back = applyMock.applyStageAction.mock.calls.map(c => [c[1], c[3], c[4]])
    expect(back).toEqual(expect.arrayContaining([[3, 'confirm_waiting', 'return_to_dev'], [4, 'confirm_waiting', 'return_to_dev']]))
    expect(back.length).toBe(2)
    // 실린 이슈에는 묶음 반영 코멘트
    const commented = providerMock.addIssueComment.mock.calls.map(c => c[1])
    expect(commented).toEqual(expect.arrayContaining([1, 2, 3, 4]))
  })

  it('출발 때 확인대기를 벗어난 이슈는 싣지 않는다', async () => {
    const shas = makeRepo()
    providerMock.fetchSingleIssue.mockImplementation(async (_p: Project, iid: number) => ({ iid, state: 'opened', labels: ['IVE', iid === 1 ? 'IVE-S' : 'IVE-P'] }))
    const ids = [1, 2].map(n => enqueueBundleItem(P, n, { sourceSha: shas[n] })!.id)
    const b = createBundle(P, 'main', ids, 'departing')!
    await runBundleDeparture(project, 'tok', b)
    const items = Object.fromEntries(listBundleItems(b.id).map(i => [i.issueIid, i.status]))
    expect(items).toEqual({ 1: 'removed', 2: 'pushed' })
  })
})

describe('B-4/B-5 푸시 후', () => {
  async function pushedBundle() {
    const shas = makeRepo()
    const ids = [1, 2].map(n => enqueueBundleItem(P, n, { sourceSha: shas[n] })!.id)
    const b = createBundle(P, 'main', ids, 'departing')!
    await runBundleDeparture(project, 'tok', b)
    return getBundle(b.id)!
  }

  it('파이프라인 성공 → 배포됨, 못 잡힌 MR 은 닫고 머지 커밋을 남긴다, 확인 끝나면 완료', async () => {
    const b = await pushedBundle()
    db.prepare(`UPDATE stage_bundles SET pushed_at = datetime('now', '-10 minutes') WHERE id = ?`).run(b.id)
    providerMock.fetchMRByBranch.mockImplementation(async (_p: Project, _t: string, br: string) =>
      br === 'dev-1' ? { iid: 11, state: 'merged' } : { iid: 12, state: 'opened' })
    providerMock.fetchBranchPipelines.mockResolvedValue([{ sha: b.pushedSha, status: 'success', web_url: 'https://ci/1' }])
    const stages = new Map<number, string | null>([[1, 'confirm_waiting'], [2, 'confirm_waiting']])
    await tickBundles(project, 'tok', stages)
    expect(getBundle(b.id)!.status).toBe('deployed')
    const items = Object.fromEntries(listBundleItems(b.id).map(i => [i.issueIid, i.mrResult]))
    expect(items).toEqual({ 1: 'merged_by_push', 2: 'closed_by_ive' })
    expect(providerMock.closeMR).toHaveBeenCalledWith(project, 'tok', 12)
    expect(gitlabMock.addGitLabMRNote.mock.calls[0][3]).toMatch(/머지 커밋/)

    // 확인 진행 중엔 그대로, 둘 다 다음 단계로 가면 완료
    await tickBundles(project, 'tok', new Map([[1, 'done'], [2, 'confirming']]))
    expect(getBundle(b.id)!.status).toBe('deployed')
    await tickBundles(project, 'tok', new Map([[1, 'done'], [2, 'done']]))
    expect(getBundle(b.id)!.status).toBe('done')
    expect(getInFlightBundle(P)).toBeNull()
  })

  it('목록에 없는 이슈는 한 건 조회해 판정한다 (빈 목록을 닫힘으로 오인하지 않는다)', async () => {
    const b = await pushedBundle()
    updateBundle(b.id, { status: 'deployed' })
    providerMock.fetchSingleIssue.mockImplementation(async (_p: Project, iid: number) => ({ iid, state: 'opened', labels: ['IVE', 'IVE-C'] }))
    await tickBundles(project, 'tok', new Map())
    expect(listBundleItems(b.id).map(i => i.status)).toEqual(['pushed', 'pushed'])
  })

  it('파이프라인 실패 → 실패(보류)', async () => {
    const b = await pushedBundle()
    providerMock.fetchMRByBranch.mockResolvedValue({ iid: 1, state: 'merged' })
    providerMock.fetchBranchPipelines.mockResolvedValue([{ sha: b.pushedSha, status: 'failed' }])
    await tickBundles(project, 'tok', new Map())
    expect(getBundle(b.id)!.status).toBe('failed')
    expect(getStageWorkerNote(P, 1)).toMatch(/파이프라인 실패/)
  })

  it('B-5 여러 이슈의 확인이 동시에 실패하면 staging 깨짐으로 보류', async () => {
    const b = await pushedBundle()
    updateBundle(b.id, { status: 'deployed', deployedAt: true })
    providerMock.fetchMRByBranch.mockResolvedValue({ iid: 1, state: 'merged' })
    for (const iid of [1, 2]) {
      const id = `ex-confirm-${iid}-x`
      openAgentStageExecution(P, iid, 'confirm', { executionId: id, agentId: 'a1', agentName: 'Alpha', logPath: '' })
      db.prepare(`UPDATE task_executions SET started_at = ? WHERE id = ?`).run(new Date(Date.now() + 1000).toISOString(), id)
      setStageVerdict(id, 'fail')
    }
    await tickBundles(project, 'tok', new Map([[1, 'waiting'], [2, 'waiting']]))
    expect(getBundle(b.id)!.status).toBe('broken')
  })
})

describe('B-7 Git 이 확인 전에 닫은 이슈', () => {
  async function deployedBundle() {
    const shas = makeRepo()
    const ids = [1].map(n => enqueueBundleItem(P, n, { sourceSha: shas[n] })!.id)
    const b = createBundle(P, 'main', ids, 'departing')!
    await runBundleDeparture(project, 'tok', b)
    updateBundle(b.id, { status: 'deployed', deployedAt: true })
    providerMock.fetchMRByBranch.mockResolvedValue({ iid: 1, state: 'merged' })
    providerMock.addIssueComment.mockClear()
    return b
  }
  it('커밋으로 닫혔으면 다시 열고, 묶음은 확인을 계속 기다린다', async () => {
    const b = await deployedBundle()
    providerMock.fetchSingleIssue.mockImplementation(async (_p: Project, iid: number) => ({ iid, state: 'closed', labels: ['IVE', 'IVE-P'] }))
    await tickBundles(project, 'tok', new Map())
    expect(providerMock.reopenIssue).toHaveBeenCalledWith(project, 1, 'tok')
    expect(providerMock.addIssueComment.mock.calls[0][3]).toMatch(/다시 열었습니다/)
    expect(listBundleItems(b.id)[0].status).toBe('pushed')
    expect(getBundle(b.id)!.status).toBe('deployed')
  })
  it('사람이 직접 닫았으면 다시 열지 않는다', async () => {
    const b = await deployedBundle()
    providerMock.isIssueClosedByGit.mockResolvedValue(false)
    providerMock.fetchSingleIssue.mockImplementation(async (_p: Project, iid: number) => ({ iid, state: 'closed', labels: ['IVE', 'IVE-P'] }))
    await tickBundles(project, 'tok', new Map())
    expect(providerMock.reopenIssue).not.toHaveBeenCalled()
    expect(getBundle(b.id)!.status).toBe('done')
  })
})

describe('B-6 자동 머지 꺼짐', () => {
  it('출발 조건이 차도 승인 대기에서 멈춘다', async () => {
    updateProjectAutomation(P, { bundle: { maxWaiting: 1 } }, 'owner')
    enqueueBundleItem(P, 1, { sourceSha: 'aaa' })
    await tickBundles(project, 'tok', new Map([[1, 'confirm_waiting']]))
    const b = getInFlightBundle(P)!
    expect(b.status).toBe('awaiting_approval')
    expect(listBundleItems(b.id).map(i => i.status)).toEqual(['in_bundle'])
  })
})

describe('V-1 검증 판정', () => {
  const ok: CheckResult = { command: 'npm test', ok: true, exitCode: 0, timedOut: false, durationSec: 1, outputTail: '' }
  const bad: CheckResult = { ...ok, ok: false, exitCode: 1 }
  const pass = { verdict: 'pass' as const, summary: 's', reason: '', findings: [], commands: [] }
  it('검사 실패·충돌이면 에이전트가 pass 라도 fail', () => {
    expect(enforceVerifyVerdict(pass, [ok], []).verdict).toBe('pass')
    expect(enforceVerifyVerdict(pass, [bad], [])).toMatchObject({ verdict: 'fail', reason: expect.stringMatching(/npm test/) })
    expect(enforceVerifyVerdict(pass, [ok], ['a.txt'])).toMatchObject({ verdict: 'fail', reason: expect.stringMatching(/a\.txt/) })
    expect(enforceVerifyVerdict({ ...pass, verdict: 'blocked' }, [bad], []).verdict).toBe('fail')
  })
  it('결과 파일이 없으면 blocked, 있으면 그대로 읽는다', () => {
    const ws = fs.mkdtempSync(path.join(os.tmpdir(), 'ive-v-'))
    const log = path.join(ws, 'x.log'); fs.writeFileSync(log, '')
    expect(parseVerifyResult(ws, log).verdict).toBe('blocked')
    fs.mkdirSync(path.join(ws, '.ive-out'))
    fs.writeFileSync(path.join(ws, '.ive-out', 'result.json'), JSON.stringify({ verdict: 'fail', summary: 's', reason: 'r', findings: [{ severity: 'major', file: 'a.ts', line: 3, note: 'n' }, { note: '' }] }))
    expect(parseVerifyResult(ws, log)).toMatchObject({ verdict: 'fail', findings: [{ severity: 'major', file: 'a.ts', line: 3, note: 'n' }] })
    fs.rmSync(ws, { recursive: true, force: true })
  })
})

describe('V-2 검증 기동 판정', () => {
  const issue = (iid: number) => ({ iid, title: `t${iid}`, author: { username: 'kim' }, created_at: '2026-10-01T00:00:00Z' })
  beforeEach(() => {
    replaceProjectMembers(P, [{ username: 'kim', name: 'Kim', avatarUrl: '', provider: 'gitlab', gitUserId: '1' }])
    setRosterEntry(P, { subjectType: 'agent', subjectId: 'a2', roles: { process: false, verify: true, confirm: false } }, 'owner')
    providerMock.fetchMRByBranch.mockResolvedValue({ iid: 5, state: 'opened', web_url: 'https://gl/mr/5' })
  })
  const agentVerifier = (iid: number) => setPresetRoles(P, iid, { verifier: { mode: 'agent', userId: null, username: null, agentId: 'a2' } })

  it('사람 검증자면 아무것도 하지 않는다', async () => {
    await dispatchStageWorkers(project, [{ issue: issue(21), stage: 'verify_waiting' }], 'tok')
    expect(workerMock.runVerifyWorker).not.toHaveBeenCalled()
    expect(providerMock.fetchMRByBranch).not.toHaveBeenCalled()
  })
  it('이 이슈를 처리한 에이전트와 같으면 띄우지 않는다', async () => {
    agentVerifier(22)
    createExecution({ id: 'ex-1', projectId: P, agentId: 'a2', issueIid: 22, issueTitle: 't', status: 'success', startedAt: new Date().toISOString(), logPath: '', inputTokens: 0, outputTokens: 0, costUsd: 0, turns: 0, issueCreatedAt: new Date().toISOString() } as any)
    await dispatchStageWorkers(project, [{ issue: issue(22), stage: 'verify_waiting' }], 'tok')
    expect(workerMock.runVerifyWorker).not.toHaveBeenCalled()
    expect(getStageWorkerNote(P, 22)).toMatch(/처리한 에이전트와 같습니다/)
  })
  it('MR 이 없으면 띄우지 않는다', async () => {
    agentVerifier(23)
    providerMock.fetchMRByBranch.mockResolvedValue(null)
    await dispatchStageWorkers(project, [{ issue: issue(23), stage: 'verify_waiting' }], 'tok')
    expect(workerMock.runVerifyWorker).not.toHaveBeenCalled()
    expect(getStageWorkerNote(P, 23)).toMatch(/MR 이 없습니다/)
  })
  it('갖춰지면 기동 — staging 브랜치와 MR 을 넘긴다', async () => {
    agentVerifier(24)
    updateProjectAutomation(P, { staging: { branch: 'staging' } }, 'owner')
    await dispatchStageWorkers(project, [{ issue: issue(24), stage: 'verify_waiting' }], 'tok')
    expect(workerMock.runVerifyWorker).toHaveBeenCalledTimes(1)
    const [input] = workerMock.runVerifyWorker.mock.calls[0] as unknown as [any]
    expect(input).toMatchObject({ targetBranch: 'staging', mrIid: 5, mrUrl: 'https://gl/mr/5', stage: 'verify_waiting' })
    expect(input.agent.id).toBe('a2')
  })
})

describe('C-1 확인 기동 — 묶음', () => {
  const issue = (iid: number) => ({ iid, title: `t${iid}`, author: { username: 'kim' }, created_at: '2026-10-01T00:00:00Z' })
  beforeEach(() => {
    replaceProjectMembers(P, [{ username: 'kim', name: 'Kim', avatarUrl: '', provider: 'gitlab', gitUserId: '1' }])
    setRosterEntry(P, { subjectType: 'agent', subjectId: 'a1', roles: { process: false, verify: false, confirm: true } }, 'owner')
    updateProjectAutomation(P, { staging: { url: 'https://stg', versionSource: 'pipeline' } }, 'owner')
    setPresetRoles(P, 31, { confirmer: { mode: 'agent', userId: null, username: null, agentId: 'a1' } })
  })
  it('묶음 대기 중이면 기다린다', async () => {
    enqueueBundleItem(P, 31, { sourceSha: 'aaa' })
    await dispatchStageWorkers(project, [{ issue: issue(31), stage: 'confirm_waiting' }], 'tok')
    expect(workerMock.runConfirmWorker).not.toHaveBeenCalled()
    expect(getStageWorkerNote(P, 31)).toMatch(/묶음 배포 대기/)
  })
  it('푸시된 묶음의 머지 커밋으로 확인한다 (MR 조회 없이)', async () => {
    const it0 = enqueueBundleItem(P, 31, { sourceSha: 'aaa', mrUrl: 'https://gl/mr/9' })!
    const b = createBundle(P, 'main', [it0.id], 'departing')!
    db.prepare(`UPDATE stage_bundle_items SET status = 'pushed', merge_sha = 'mmmmmmm1' WHERE id = ?`).run(it0.id)
    updateBundle(b.id, { status: 'deployed' })
    providerMock.fetchBranchPipelines.mockResolvedValue([{ sha: 'ddddddd1', status: 'success' }])
    await dispatchStageWorkers(project, [{ issue: issue(31), stage: 'confirm_waiting' }], 'tok')
    expect(providerMock.fetchMRByBranch).not.toHaveBeenCalled()
    expect(providerMock.isAncestorCommit).toHaveBeenCalledWith(project, 'tok', 'mmmmmmm1', 'ddddddd1')
    expect(workerMock.runConfirmWorker).toHaveBeenCalledTimes(1)
    const [input] = workerMock.runConfirmWorker.mock.calls[0] as unknown as [any]
    expect(input).toMatchObject({ mergeCommit: 'mmmmmmm1', deployedCommit: 'ddddddd1', mrUrl: 'https://gl/mr/9' })
    expect(getLatestBundleItem(P, 31)!.status).toBe('pushed')
  })
})

describe('K-1 검사 명령', () => {
  it('종료 코드로 판정하고 토큰 환경변수를 넘기지 않는다', async () => {
    process.env.GITLAB_TOKEN_FOR_TEST = 'sekret-value'
    const r = await runCheckCommand(os.tmpdir(), 'echo "[$GITLAB_TOKEN_FOR_TEST]"; exit 3', 1, [])
    delete process.env.GITLAB_TOKEN_FOR_TEST
    expect(r).toMatchObject({ ok: false, exitCode: 3, timedOut: false })
    expect(r.outputTail).toContain('[]')
    expect(parseCheckCommands('npm ci\n\n# 주석\n npm test ')).toEqual(['npm ci', 'npm test'])
  })
  it('시간 제한을 넘기면 끊는다', async () => {
    const r = await runCheckCommand(os.tmpdir(), 'sleep 5', 0.01, [])
    expect(r).toMatchObject({ ok: false, timedOut: true })
  }, 10_000)
})

describe('S-1 배포 커밋 — 브랜치 파이프라인', () => {
  it('버전 주소 없이도 설정이 유효하고, 마지막 성공 파이프라인 커밋을 쓴다', async () => {
    updateProjectAutomation(P, { staging: { url: 'https://stg', versionSource: 'pipeline' } }, 'owner')
    const cfg = resolveStagingConfig(project)
    expect(cfg.ok).toBe(true)
    if (!cfg.ok) return
    providerMock.fetchBranchPipelines.mockResolvedValue([{ sha: 'run', status: 'running' }, { sha: 'abc1234', status: 'success' }])
    expect(await fetchDeployedCommit(cfg.value, project, 'tok')).toEqual({ ok: true, value: 'abc1234' })
    expect(providerMock.fetchBranchPipelines).toHaveBeenCalledWith(project, 'tok', 'main')
    providerMock.fetchBranchPipelines.mockResolvedValue([{ sha: 'run', status: 'running' }])
    expect((await fetchDeployedCommit(cfg.value, project, 'tok')).ok).toBe(false)
  })
})
