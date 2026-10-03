/**
 * ③ 검증 → 바로 머지 → ④ 확인 기동 — DB 는 실제 스키마(initSchema). Git 호스팅 API·단계 이동·작업자 실행만 가짜로 바꾼다.
 *
 *   M-1 검증 통과 즉시 머지: 자동 머지 꺼짐이면 머지하지 않음, 켜지면 검증한 커밋(sha)으로 머지,
 *       MR 대상이 staging 브랜치와 다르거나 검증 뒤 새 커밋이 올라왔으면 사람에게 넘김, 머지 실패도 사람에게(다시 시도 안 함)
 *   C-1 확인 기동: MR 머지 커밋(fast-forward 면 MR 머리 커밋)이 배포 커밋에 들어 있으면 기동, 아직 머지 전이면 기다림,
 *       예전 묶음으로 푸시된 이슈는 그 묶음의 머지 커밋으로
 *   L-1 예전 묶음 대기열: 확인대기 이슈는 한 번 바로 머지로 넘기고, 줄은 닫혀 다시 나오지 않는다
 *   R-1 확인 전 Git 이 닫은 이슈: 에이전트 검증 통과로 IVE 가 머지한 이슈만 다시 연다
 *   V-1 검증 판정 · V-2 검증 기동 · K-1 검사 명령 · S-1 배포 커밋(브랜치 파이프라인)
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import Database from 'better-sqlite3'
import fs from 'fs'
import os from 'os'
import path from 'path'

const providerMock = vi.hoisted(() => ({
  fetchSingleIssue: vi.fn(),
  addIssueComment: vi.fn(async () => undefined),
  fetchMRByBranch: vi.fn(),
  fetchBranchPipelines: vi.fn(),
  mergeMR: vi.fn(async () => ({ merge_commit_sha: 'mmmmmmm2' })),
  isAncestorCommit: vi.fn(async () => true),
  getDefaultBranch: vi.fn(async () => 'main'),
  addIssueLabels: vi.fn(async () => undefined),
  removeIssueLabels: vi.fn(async () => undefined),
  reopenIssue: vi.fn(async () => undefined),
  isIssueClosedByGit: vi.fn(async () => true),
}))
const applyMock = vi.hoisted(() => ({ applyStageAction: vi.fn(async () => 'waiting') }))
const workerMock = vi.hoisted(() => ({
  runVerifyWorker: vi.fn(() => Promise.resolve()),
  runConfirmWorker: vi.fn(() => Promise.resolve()),
}))
const watcherMock = vi.hoisted(() => ({ notifyConfirmerOnApprove: vi.fn(async () => undefined) }))
vi.mock('@/lib/provider', () => providerMock)
vi.mock('@/lib/stage-apply', () => applyMock)
vi.mock('@/lib/merge-watcher', () => watcherMock)
vi.mock('@/lib/slack-notify', () => ({ notifyStageTransition: vi.fn(async () => undefined), getIveBaseUrl: () => '' }))
vi.mock('@/lib/scanner/verify-worker', async (orig) => ({ ...(await orig<typeof import('@/lib/scanner/verify-worker')>()), runVerifyWorker: workerMock.runVerifyWorker }))
vi.mock('@/lib/scanner/confirm-worker', async (orig) => ({ ...(await orig<typeof import('@/lib/scanner/confirm-worker')>()), runConfirmWorker: workerMock.runConfirmWorker }))

import { initSchema } from '@/lib/db/schema'
import {
  updateProjectAutomation, setPresetRoles, setRosterEntry, getStageWorkerNote, createExecution, replaceProjectMembers,
  getLatestBundleItem, getProjectAutomation, setIssuePriority, getAssignModeMap, byPriorityThenOldest,
} from '@/lib/db'
import { enforceVerifyVerdict, parseVerifyResult } from '@/lib/scanner/verify-worker'
import { buildVerifyPrompt, VERIFY_EDITABLE_DEFAULT, buildConfirmPrompt, CONFIRM_EDITABLE_DEFAULT } from '@/lib/role-prompts'
import { enforceConfirmVerdict } from '@/lib/scanner/confirm-worker'
import { dispatchStageWorkers } from '@/lib/scanner/stage-dispatch'
import { openAgentStageExecution, setStageVerdict } from '@/lib/scanner/stage-records'
import { mergeVerified, handOffLegacyBundleQueue, reopenIfClosedBeforeConfirm } from '@/lib/scanner/auto-merge'
import { runCheckCommand, parseCheckCommands, type CheckResult } from '@/lib/stage-checks'
import { resolveStagingConfig, fetchDeployedCommit } from '@/lib/staging-config'
import type { Project } from '@/types'

const P = 'p1'
let db: Database.Database
let tmp: string
let project: Project

beforeEach(() => {
  vi.clearAllMocks()
  db = new Database(':memory:')
  ;(globalThis as any).db = db
  initSchema(db)
  db.prepare(`INSERT INTO users (id, email, password, name, locale, timezone) VALUES ('owner', 'o@x', '', 'Owner', 'ko', 'Asia/Seoul')`).run()
  db.prepare(`INSERT INTO projects (id, user_id, name, provider, repo_url, access_token) VALUES (?, 'owner', 'Proj', 'gitlab', 'https://gitlab.com/g/r', '')`).run(P)
  for (const [id, name] of [['a1', 'Alpha'], ['a2', 'Beta']]) {
    db.prepare(`INSERT INTO agents (id, user_id, name, cli_name, cli_path) VALUES (?, 'owner', ?, 'claude', 'claude')`).run(id, name)
  }
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'ive-merge-'))
  project = { id: P, name: 'Proj', userId: 'owner', provider: 'gitlab', repoUrl: 'https://gitlab.com/g/r', baseBranch: 'main', labelTarget: 'IVE', testSiteUrl: '' } as unknown as Project
  providerMock.fetchSingleIssue.mockImplementation(async (_p: Project, iid: number) => ({ iid, state: 'opened', labels: ['IVE', 'IVE-P'] }))
})

afterEach(() => { try { fs.rmSync(tmp, { recursive: true, force: true }) } catch { /* ignore */ } })

describe('M-1 검증 통과 즉시 머지', () => {
  const run = () => mergeVerified({ project, token: 'tok', iid: 7, sourceSha: 'aaaaaaaa1', targetBranch: 'main', isKo: true })
  beforeEach(() => {
    providerMock.fetchMRByBranch.mockResolvedValue({ iid: 5, state: 'opened', target_branch: 'main', sha: 'aaaaaaaa1', web_url: 'https://gl/mr/5' })
  })
  it('자동 머지가 꺼져 있으면 머지하지 않고 사람이 머지한다고 남긴다', async () => {
    expect(await run()).toMatchObject({ merged: false, reason: 'off' })
    expect(providerMock.mergeMR).not.toHaveBeenCalled()
    expect(getStageWorkerNote(P, 7)).toMatch(/자동 머지가 꺼져/)
  })
  it('켜져 있으면 검증한 커밋으로 바로 머지하고 확인자에게 알린다', async () => {
    updateProjectAutomation(P, { merge: { agentMerge: true } }, 'owner')
    expect(await run()).toEqual({ merged: true, mergeCommit: 'mmmmmmm2' })
    expect(providerMock.mergeMR).toHaveBeenCalledWith(project, 'tok', 5, { sha: 'aaaaaaaa1' })
    expect(watcherMock.notifyConfirmerOnApprove).toHaveBeenCalledWith(project, 7, 'tok')
    expect(getStageWorkerNote(P, 7)).toBeNull()
    expect(String((providerMock.addIssueComment.mock.calls[0] as unknown[])[3])).toMatch(/MR 머지/)
  })
  it('MR 대상이 staging 브랜치와 다르면 머지하지 않는다', async () => {
    updateProjectAutomation(P, { merge: { agentMerge: true } }, 'owner')
    providerMock.fetchMRByBranch.mockResolvedValue({ iid: 5, state: 'opened', target_branch: 'develop', sha: 'aaaaaaaa1' })
    expect(await run()).toMatchObject({ merged: false, reason: 'skipped' })
    expect(providerMock.mergeMR).not.toHaveBeenCalled()
    expect(getStageWorkerNote(P, 7)).toMatch(/MR 대상/)
  })
  it('검증한 뒤 새 커밋이 올라왔으면 머지하지 않는다', async () => {
    updateProjectAutomation(P, { merge: { agentMerge: true } }, 'owner')
    providerMock.fetchMRByBranch.mockResolvedValue({ iid: 5, state: 'opened', target_branch: 'main', sha: 'bbbbbbbb2' })
    expect(await run()).toMatchObject({ merged: false, reason: 'skipped' })
    expect(providerMock.mergeMR).not.toHaveBeenCalled()
    expect(getStageWorkerNote(P, 7)).toMatch(/새 커밋/)
  })
  it('머지 API 가 실패하면 사람에게 넘기고 다시 시도하지 않는다', async () => {
    updateProjectAutomation(P, { merge: { agentMerge: true } }, 'owner')
    providerMock.mergeMR.mockRejectedValueOnce(new Error('머지 불가 (405): pipeline must succeed'))
    expect(await run()).toMatchObject({ merged: false, reason: 'failed' })
    expect(providerMock.mergeMR).toHaveBeenCalledTimes(1)
    expect(getStageWorkerNote(P, 7)).toMatch(/MR 머지 실패/)
    expect(String((providerMock.addIssueComment.mock.calls[0] as unknown[])[3])).toMatch(/사람이 머지/)
  })
  it('이미 머지된 MR 은 건드리지 않는다', async () => {
    updateProjectAutomation(P, { merge: { agentMerge: true } }, 'owner')
    providerMock.fetchMRByBranch.mockResolvedValue({ iid: 5, state: 'merged', target_branch: 'main', sha: 'aaaaaaaa1' })
    expect(await run()).toMatchObject({ merged: false, reason: 'already' })
    expect(providerMock.mergeMR).not.toHaveBeenCalled()
  })
  it('설정은 머지·검사 값만 남는다 — 예전 묶음 출발 조건은 읽지도 쓰지도 않는다', () => {
    db.prepare(`INSERT INTO project_automation (project_id, bundle) VALUES (?, ?)`).run(P, JSON.stringify({ agentMerge: true, maxWaiting: 5, times: '09:00', checkCommands: 'npm test', checkTimeoutMin: 7 }))
    expect(getProjectAutomation(P).merge).toEqual({ agentMerge: true, checkCommands: 'npm test', checkTimeoutMin: 7 })
    updateProjectAutomation(P, { merge: { checkTimeoutMin: 9 } }, 'owner')
    const raw = JSON.parse((db.prepare('SELECT bundle FROM project_automation WHERE project_id = ?').get(P) as any).bundle)
    expect(raw).toEqual({ agentMerge: true, checkCommands: 'npm test', checkTimeoutMin: 9 })
  })
})

describe('C-1 확인 기동', () => {
  const issue = (iid: number) => ({ iid, title: `t${iid}`, author: { username: 'kim' }, created_at: '2026-10-01T00:00:00Z' })
  beforeEach(() => {
    replaceProjectMembers(P, [{ username: 'kim', name: 'Kim', avatarUrl: '', provider: 'gitlab', gitUserId: '1' }])
    setRosterEntry(P, { subjectType: 'agent', subjectId: 'a1', roles: { process: false, verify: false, confirm: true } }, 'owner')
    updateProjectAutomation(P, { staging: { url: 'https://stg', versionSource: 'pipeline' } }, 'owner')
    providerMock.fetchBranchPipelines.mockResolvedValue([{ sha: 'ddddddd1', status: 'success' }])
  })
  const confirmer = (iid: number) => setPresetRoles(P, iid, { confirmer: { mode: 'agent', userId: null, username: null, agentId: 'a1' } })

  it('MR 이 아직 머지되지 않았으면 기다린다', async () => {
    confirmer(31)
    providerMock.fetchMRByBranch.mockResolvedValue({ iid: 9, state: 'opened' })
    await dispatchStageWorkers(project, [{ issue: issue(31), stage: 'confirm_waiting' }], 'tok')
    expect(workerMock.runConfirmWorker).not.toHaveBeenCalled()
    expect(getStageWorkerNote(P, 31)).toMatch(/아직 머지되지 않음/)
  })
  it('머지 커밋이 배포 커밋에 들어 있으면 기동한다', async () => {
    confirmer(32)
    providerMock.fetchMRByBranch.mockResolvedValue({ iid: 9, state: 'merged', merge_commit_sha: 'mmmmmmm1', web_url: 'https://gl/mr/9' })
    await dispatchStageWorkers(project, [{ issue: issue(32), stage: 'confirm_waiting' }], 'tok')
    expect(providerMock.isAncestorCommit).toHaveBeenCalledWith(project, 'tok', 'mmmmmmm1', 'ddddddd1')
    const [input] = workerMock.runConfirmWorker.mock.calls[0] as unknown as [any]
    expect(input).toMatchObject({ mergeCommit: 'mmmmmmm1', deployedCommit: 'ddddddd1', mrUrl: 'https://gl/mr/9' })
  })
  it('fast-forward 머지(머지 커밋 없음)는 MR 머리 커밋으로 본다', async () => {
    confirmer(33)
    providerMock.fetchMRByBranch.mockResolvedValue({ iid: 9, state: 'merged', merge_commit_sha: null, squash_commit_sha: null, sha: 'hhhhhhh1' })
    await dispatchStageWorkers(project, [{ issue: issue(33), stage: 'confirm_waiting' }], 'tok')
    expect(providerMock.isAncestorCommit).toHaveBeenCalledWith(project, 'tok', 'hhhhhhh1', 'ddddddd1')
    expect(workerMock.runConfirmWorker).toHaveBeenCalledTimes(1)
  })
  it('예전 묶음으로 푸시된 이슈는 그 묶음의 머지 커밋으로 확인한다(MR 조회 없이)', async () => {
    confirmer(34)
    db.prepare(`INSERT INTO stage_bundle_items (project_id, issue_iid, status, source_sha, mr_url, merge_sha) VALUES (?, 34, 'pushed', 'aaa', 'https://gl/mr/4', 'mmmmmmm4')`).run(P)
    await dispatchStageWorkers(project, [{ issue: issue(34), stage: 'confirm_waiting' }], 'tok')
    expect(providerMock.fetchMRByBranch).not.toHaveBeenCalled()
    const [input] = workerMock.runConfirmWorker.mock.calls[0] as unknown as [any]
    expect(input).toMatchObject({ mergeCommit: 'mmmmmmm4', mrUrl: 'https://gl/mr/4' })
  })
})

describe('L-1 예전 묶음 대기열', () => {
  it('확인대기 이슈는 한 번 바로 머지로 넘기고, 줄은 다시 나오지 않는다', async () => {
    updateProjectAutomation(P, { merge: { agentMerge: true } }, 'owner')
    const ins = db.prepare(`INSERT INTO stage_bundle_items (project_id, issue_iid, status, source_sha) VALUES (?, ?, ?, ?)`)
    ins.run(P, 41, 'waiting', 's41'); ins.run(P, 42, 'in_bundle', 's42'); ins.run(P, 43, 'pushed', 's43')
    providerMock.fetchMRByBranch.mockImplementation(async (_p: Project, _t: string, br: string) => ({ iid: Number(br.slice(4)), state: 'opened', target_branch: 'main', sha: `s${br.slice(4)}` }))
    const stages = new Map<number, string | null>([[41, 'confirm_waiting'], [42, 'waiting'], [43, 'confirm_waiting']])
    await handOffLegacyBundleQueue(project, 'tok', stages)
    expect(providerMock.mergeMR).toHaveBeenCalledTimes(1)                 // #41 만 — #42 는 단계가 바뀌었고 #43 은 이미 푸시됨
    expect(providerMock.mergeMR).toHaveBeenCalledWith(project, 'tok', 41, { sha: 's41' })
    expect(getLatestBundleItem(P, 41)!.status).toBe('removed')
    expect(getLatestBundleItem(P, 42)!.status).toBe('removed')
    expect(getLatestBundleItem(P, 43)!.status).toBe('pushed')
    await handOffLegacyBundleQueue(project, 'tok', stages)
    expect(providerMock.mergeMR).toHaveBeenCalledTimes(1)
  })
})

describe('R-1 확인 전에 Git 이 닫은 이슈', () => {
  const closed = { iid: 51, state: 'closed', labels: ['IVE', 'IVE-P'] }
  const verifyRow = (assignee: 'agent' | 'user', verdict: string) => {
    db.prepare(`INSERT INTO task_executions (id, project_id, issue_iid, agent_id, assignee_type, status, started_at, stage_verdict) VALUES (?, ?, 51, 'a2', ?, 'success', ?, ?)`)
      .run(`ex-verify-${assignee}`, P, assignee, new Date().toISOString(), verdict)
  }
  it('에이전트 검증 통과로 IVE 가 머지한 이슈면 다시 연다', async () => {
    verifyRow('agent', 'pass')
    expect(await reopenIfClosedBeforeConfirm(project, 'tok', 51, closed)).toBe(true)
    expect(providerMock.reopenIssue).toHaveBeenCalledWith(project, 51, 'tok')
  })
  it('사람이 검증·머지했거나 사람이 직접 닫았으면 두고 본다', async () => {
    verifyRow('user', 'pass')
    expect(await reopenIfClosedBeforeConfirm(project, 'tok', 51, closed)).toBe(false)
    db.prepare(`DELETE FROM task_executions`).run()
    verifyRow('agent', 'pass')
    providerMock.isIssueClosedByGit.mockResolvedValueOnce(false)
    expect(await reopenIfClosedBeforeConfirm(project, 'tok', 51, closed)).toBe(false)
    expect(providerMock.reopenIssue).not.toHaveBeenCalled()
  })
})

describe('V-1 검증 판정', () => {
  const ok: CheckResult = { command: 'npm test', ok: true, exitCode: 0, timedOut: false, durationSec: 1, outputTail: '' }
  const bad: CheckResult = { ...ok, ok: false, exitCode: 1 }
  const pass = { verdict: 'pass' as const, summary: 's', reason: '', requirements: [], findings: [], commands: [] }
  it('검사 실패·충돌이면 에이전트가 pass 라도 fail', () => {
    expect(enforceVerifyVerdict(pass, [ok], []).verdict).toBe('pass')
    expect(enforceVerifyVerdict(pass, [bad], [])).toMatchObject({ verdict: 'fail', reason: expect.stringMatching(/npm test/) })
    expect(enforceVerifyVerdict(pass, [ok], ['a.txt'])).toMatchObject({ verdict: 'fail', reason: expect.stringMatching(/a\.txt/) })
    expect(enforceVerifyVerdict({ ...pass, verdict: 'blocked' }, [bad], []).verdict).toBe('fail')
    // 검증 기준(누락 0·오류 0)과 어긋난 통과는 반려로 — 요건 하나라도 missing, 지적 하나라도 있으면
    expect(enforceVerifyVerdict({ ...pass, requirements: [{ item: 'x', status: 'missing', where: '' }] }, [ok], [])).toMatchObject({ verdict: 'fail', reason: expect.stringMatching(/구현되지 않은 요건 1개/) })
    expect(enforceVerifyVerdict({ ...pass, findings: [{ kind: 'defect', severity: 'defect', file: 'a', line: null, note: 'n' }] }, [ok], [])).toMatchObject({ verdict: 'fail', reason: expect.stringMatching(/지적 1건/) })
    expect(enforceVerifyVerdict({ ...pass, requirements: [{ item: 'x', status: 'done', where: 'a:1' }] }, [ok], []).verdict).toBe('pass')
  })
  it('결과 파일이 없으면 blocked, 있으면 그대로 읽는다', () => {
    const ws = fs.mkdtempSync(path.join(os.tmpdir(), 'ive-v-'))
    const log = path.join(ws, 'x.log'); fs.writeFileSync(log, '')
    expect(parseVerifyResult(ws, log).verdict).toBe('blocked')
    fs.mkdirSync(path.join(ws, '.ive-out'))
    fs.writeFileSync(path.join(ws, '.ive-out', 'result.json'), JSON.stringify({ verdict: 'fail', summary: 's', reason: 'r', findings: [{ severity: 'major', file: 'a.ts', line: 3, note: 'n' }, { note: '' }] }))
    expect(parseVerifyResult(ws, log)).toMatchObject({ verdict: 'fail', findings: [{ severity: 'major', file: 'a.ts', line: 3, note: 'n' }] })
    // 새 형식 — 요건 대조와 누락/오류 두 종류
    fs.writeFileSync(path.join(ws, '.ive-out', 'result.json'), JSON.stringify({ verdict: 'fail', summary: 's', requirements: [{ item: '요건1', status: 'done', where: 'a.ts:1' }, { item: '요건2', status: 'nope' }], findings: [{ kind: 'missing', file: 'b.ts', note: '요건2 없음' }, { kind: 'defect', file: 'a.ts', line: 2, note: '빈 값' }] }))
    expect(parseVerifyResult(ws, log)).toMatchObject({
      requirements: [{ item: '요건1', status: 'done', where: 'a.ts:1' }, { item: '요건2', status: 'missing' }],
      findings: [{ kind: 'missing', severity: 'missing' }, { kind: 'defect', line: 2 }],
    })
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
  it('MR 이 없으면(코드 변경 없는 작업) 작업자 보고를 검증하도록 띄운다', async () => {
    agentVerifier(23)
    providerMock.fetchMRByBranch.mockResolvedValue(null)
    await dispatchStageWorkers(project, [{ issue: issue(23), stage: 'verify_waiting' }], 'tok')
    expect(workerMock.runVerifyWorker).toHaveBeenCalledTimes(1)
    const [input] = workerMock.runVerifyWorker.mock.calls[0] as unknown as [any]
    expect(input).toMatchObject({ noChange: true, mrIid: null, mrUrl: null })
  })
  it('코드 변경 없는 작업의 검증 프롬프트 — 작업자 보고가 대상이고, 「할 수 없다」는 방법을 적어 반려한다', () => {
    const base = { iid: 91, title: '내일의 날씨는?', body: '내일 날씨 알려줘', isKo: true, mrUrl: null, targetBranch: 'main', sourceSha: 'abc', behindTarget: false,
      conflictFiles: [], changedFiles: [], diffPath: '.ive-out/mr.diff', checksSection: '', e2eScript: null, outDir: '.ive-out', maxRunMinutes: 30 }
    const p = buildVerifyPrompt({ ...base, noChange: true, reportPath: '.ive-out/report.md' }, VERIFY_EDITABLE_DEFAULT)
    expect(p).toContain('코드 변경 없이')
    expect(p).toContain('.ive-out/report.md')
    expect(p).toContain('구체적인 방법')
    expect(p).not.toContain('변경 전체 diff')
    const code = buildVerifyPrompt(base, VERIFY_EDITABLE_DEFAULT)
    expect(code).toContain('변경 전체 diff')
    expect(code).toContain('할 수 없다')   // 코드 작업에도 같은 규칙
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


describe('P-1 우선순위', () => {
  it('높은 것 먼저, 같으면 먼저 들어온 것 먼저 — 값은 IVE DB(issue_stages.priority)', () => {
    setIssuePriority(P, 3, 1)
    setIssuePriority(P, 4, 2)
    setIssuePriority(P, 5, 0)
    const m = getAssignModeMap(P)
    expect([3, 4, 5].map(i => m.get(i)?.priority)).toEqual([1, 2, 0])
    const issues = [
      { iid: 1, created_at: '2026-10-01T00:00:00Z' }, { iid: 2, created_at: '2026-09-01T00:00:00Z' },
      { iid: 3, created_at: '2026-10-02T00:00:00Z' }, { iid: 4, created_at: '2026-10-03T00:00:00Z' },
    ]
    expect(byPriorityThenOldest(issues, i => m.get(i)?.priority ?? 0).map(i => i.iid)).toEqual([4, 3, 2, 1])
  })
  it('검증 에이전트가 하나뿐이면 긴급 작업을 먼저 집는다', async () => {
    replaceProjectMembers(P, [{ username: 'kim', name: 'Kim', avatarUrl: '', provider: 'gitlab', gitUserId: '1' }])
    setRosterEntry(P, { subjectType: 'agent', subjectId: 'a2', roles: { process: false, verify: true, confirm: false } }, 'owner')
    providerMock.fetchMRByBranch.mockResolvedValue({ iid: 5, state: 'opened', web_url: 'https://gl/mr/5' })
    for (const iid of [61, 62]) setPresetRoles(P, iid, { verifier: { mode: 'agent', userId: null, username: null, agentId: 'a2' } })
    setIssuePriority(P, 62, 2)
    const issue = (iid: number, created: string) => ({ iid, title: `t${iid}`, author: { username: 'kim' }, created_at: created })
    await dispatchStageWorkers(project, [
      { issue: issue(61, '2026-09-01T00:00:00Z'), stage: 'verify_waiting' },
      { issue: issue(62, '2026-10-01T00:00:00Z'), stage: 'verify_waiting' },
    ], 'tok')
    expect(workerMock.runVerifyWorker).toHaveBeenCalledTimes(1)
    const [input] = workerMock.runVerifyWorker.mock.calls[0] as unknown as [any]
    expect(input.issue.iid).toBe(62)
  })
})

describe('W-1 진행 중 실행을 눌렀을 때 갈 곳', async () => {
  const { execHref } = await import('@/lib/active-work')
  it('에이전트 실행은 처리·검증·확인 모두 트레이스, 사람 작업·채팅은 이슈 상세', () => {
    expect(execHref({ id: 'ex-1', assigneeType: 'agent', issueIid: 9 }, P)).toBe('/executions/ex-1')
    expect(execHref({ id: 'ex-verify-2', assigneeType: 'agent', issueIid: 9 }, P)).toBe('/executions/ex-verify-2')
    expect(execHref({ id: 'ex-confirm-3', assigneeType: 'agent', issueIid: 9 }, P)).toBe('/executions/ex-confirm-3')
    expect(execHref({ id: 'ex-verify-4', assigneeType: 'user', issueIid: 9 }, P)).toBe(`/issues/${P}/9`)
    expect(execHref({ id: 'exec-chat-5', assigneeType: 'agent', issueIid: 9 }, P)).toBe(`/issues/${P}/9`)
  })
})

describe('C-2 코드 변경 없는 작업의 확인', () => {
  const issue = (iid: number) => ({ iid, title: `t${iid}`, author: { username: 'kim' }, created_at: '2026-10-01T00:00:00Z' })
  beforeEach(() => {
    replaceProjectMembers(P, [{ username: 'kim', name: 'Kim', avatarUrl: '', provider: 'gitlab', gitUserId: '1' }])
    setRosterEntry(P, { subjectType: 'agent', subjectId: 'a1', roles: { process: false, verify: false, confirm: true } }, 'owner')
    setPresetRoles(P, 71, { confirmer: { mode: 'agent', userId: null, username: null, agentId: 'a1' } })
  })
  it('MR 이 없으면 배포를 기다리지 않고 처리 결과 확인으로 기동한다 — staging 설정이 없어도', async () => {
    providerMock.fetchMRByBranch.mockResolvedValue(null)
    await dispatchStageWorkers(project, [{ issue: issue(71), stage: 'confirm_waiting' }], 'tok')
    expect(workerMock.runConfirmWorker).toHaveBeenCalledTimes(1)
    const [input] = workerMock.runConfirmWorker.mock.calls[0] as unknown as [any]
    expect(input).toMatchObject({ noChange: true, deployedCommit: '', mergeCommit: null })
    expect(providerMock.fetchBranchPipelines).not.toHaveBeenCalled()
  })
  it('MR 조회가 실패하면 코드 변경 없는 작업으로 오인하지 않는다', async () => {
    providerMock.fetchMRByBranch.mockRejectedValue(new Error('502'))
    await dispatchStageWorkers(project, [{ issue: issue(71), stage: 'confirm_waiting' }], 'tok')
    expect(workerMock.runConfirmWorker).not.toHaveBeenCalled()
  })
  it('증거는 스크린샷이 아니어도 되지만 항목마다 있어야 한다', () => {
    const r = { verdict: 'pass' as const, summary: '', reason: '', engines: [], screenshots: [], commands: [], newDefects: [],
      items: [{ item: '내일 날씨', how: '기상청 단기예보', result: 'gone' as const, evidence: ['https://www.weather.go.kr … 맑음 18℃'] }] }
    expect(enforceConfirmVerdict(r, 0, true, false).verdict).toBe('pass')
    expect(enforceConfirmVerdict(r, 0, true, true).verdict).toBe('blocked')
    expect(enforceConfirmVerdict({ ...r, items: [{ ...r.items[0], evidence: [] }] }, 0, true, false).verdict).toBe('blocked')
  })
  it('프롬프트 — 처리 결과를 독립된 근거로 대조한다', () => {
    const p = buildConfirmPrompt({ iid: 91, title: '내일의 날씨는?', body: '', isKo: true, stagingUrl: '', deployedCommit: '', mergeCommit: null, mrUrl: null,
      stagingNotes: null, e2eScript: null, secretEnvNames: [], outDir: '.ive-out', imagesSection: '', maxRunMinutes: 30, noChange: true, priorWork: '### 처리자 결과 보고\n맑음' }, CONFIRM_EDITABLE_DEFAULT)
    expect(p).toContain('코드 변경 없이')
    expect(p).toContain('독립된 근거')
    expect(p).not.toContain('staging 이 내보내는 커밋')
  })
})
