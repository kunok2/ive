/**
 * ④ 확인 작업자 기동 판정(stage-dispatch) — DB 상태 + 배포 사실로만 기동하는가.
 * Git API·staging 버전 주소·작업자 실행은 가짜로 바꾸고, DB 는 실제 스키마(initSchema)를 쓴다.
 *
 *   D-1 확인자가 사람이면 아무것도 하지 않는다(종전 동작).
 *   D-2 staging 설정(IVE 프로젝트 설정)이 없으면 기동하지 않고 이유를 남긴다 — 저장소 파일을 읽지 않는다.
 *   D-3 MR 이 머지 전이면 기다린다.
 *   D-4 배포 커밋에 머지 커밋이 없으면 기다린다.
 *   D-5 모두 갖춰지면 기동하고, 프로젝트 설정의 staging 값·비밀값을 넘긴다. 테스트 사이트 URL 폴백.
 *   D-6 열린 확인 실행이 있으면 다시 띄우지 않는다.
 *   D-7 자동 확인 실패가 상한에 닿으면 기동하지 않는다.
 *   D-8 허용 목록 밖 작성자는 승인 전에는 기동하지 않는다.
 *   D-9 확인 중(C)에서 판정을 남기고 끝난 실행 뒤에는 다시 띄우지 않는다(확인 불가는 사람 대기).
 *   D-10 명부에서 빠진 에이전트, 소유자가 편집 권한을 잃은 에이전트는 돌리지 않는다.
 *   D-11 IVE 가 봇 계정으로 만든 이슈는 본문의 ive-author(실제 등록자)로 판정한다 — 프로젝트 사람이면 허용.
 *        마커는 Git 작성자가 봇일 때만 믿는다.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest'
import Database from 'better-sqlite3'

const providerMock = vi.hoisted(() => ({
  fetchMRByBranch: vi.fn(),
  isAncestorCommit: vi.fn(),
  readRepoFile: vi.fn(),
}))
const workerMock = vi.hoisted(() => ({ runConfirmWorker: vi.fn(() => Promise.resolve()) }))
vi.mock('@/lib/provider', () => providerMock)
vi.mock('@/lib/scanner/confirm-worker', () => workerMock)

import { initSchema } from '@/lib/db/schema'
import { setIssueIntakeChannel, setPresetRoles, updateProjectAutomation, getStageWorkerNote, approveIssueAutomation, replaceProjectMembers, setRosterEntry, getPresetRoles, getRoster, updateProjectShareRole } from '@/lib/db'
import { openAgentStageExecution, setStageVerdict } from '@/lib/scanner/stage-records'
import { dispatchStageWorkers, isAutomationAllowed } from '@/lib/scanner/stage-dispatch'
import type { Project } from '@/types'

const P = 'p1'
let db: Database.Database
let iidSeq = 100
const project = { id: P, userId: 'owner', provider: 'gitlab', repoUrl: 'https://gitlab.com/g/r', testSiteUrl: '', baseBranch: 'staging' } as unknown as Project
const issue = (iid: number, author = 'kim') => ({ iid, title: `t${iid}`, author: { username: author }, created_at: '2026-10-01T00:00:00Z', description: '' })
const agentConfirmer = (iid: number) => setPresetRoles(P, iid, {
  confirmer: { mode: 'agent', userId: null, username: null, agentId: 'a1' },
})
const configure = (extra: Record<string, string> = {}) => updateProjectAutomation(P, {
  staging: { url: 'https://stg.example.com', versionUrl: 'https://stg.example.com/version.json', commitField: 'commit', branch: 'staging', ...extra },
  stagingSecrets: { PF_USER: 'tester01' },
}, 'owner')

function mockDeployed(commit: string) {
  vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ commit }), { status: 200 })))
}

beforeEach(() => {
  vi.clearAllMocks()
  db = new Database(':memory:')
  ;(globalThis as any).db = db
  initSchema(db)
  db.prepare(`INSERT INTO users (id, email, password, name) VALUES ('owner', 'o@x', '', 'Owner')`).run()
  db.prepare(`INSERT INTO projects (id, user_id, name, provider, repo_url, access_token) VALUES (?, 'owner', 'Proj', 'gitlab', 'https://gitlab.com/g/r', '')`).run(P)
  db.prepare(`INSERT INTO agents (id, user_id, name, cli_name, cli_path) VALUES ('a1', 'owner', 'Alpha', 'claude', 'claude')`).run()
  replaceProjectMembers(P, [{ username: 'kim', name: 'Kim', avatarUrl: '', provider: 'gitlab', gitUserId: '1' }])
  setRosterEntry(P, { subjectType: 'agent', subjectId: 'a1', roles: { process: false, verify: false, confirm: true } }, 'owner')
  providerMock.fetchMRByBranch.mockResolvedValue({ state: 'merged', merge_commit_sha: 'aaaaaaa1', web_url: 'https://gitlab.com/g/r/-/merge_requests/1' })
  providerMock.isAncestorCommit.mockResolvedValue(true)
  mockDeployed('bbbbbbb2')
  iidSeq += 1
})

describe('확인 작업자 기동 판정', () => {
  it('D-1 확인자가 사람이면 아무것도 하지 않는다', async () => {
    const iid = iidSeq
    configure()
    await dispatchStageWorkers(project, [{ issue: issue(iid), stage: 'confirm_waiting' }], 'tok')
    expect(workerMock.runConfirmWorker).not.toHaveBeenCalled()
    expect(providerMock.fetchMRByBranch).not.toHaveBeenCalled()
    expect(getStageWorkerNote(P, iid)).toBeNull()
  })

  it('D-2 staging 설정이 없으면 기동하지 않고 이유를 남긴다 (저장소 파일을 읽지 않는다)', async () => {
    const iid = iidSeq
    agentConfirmer(iid)
    await dispatchStageWorkers(project, [{ issue: issue(iid), stage: 'confirm_waiting' }], 'tok')
    expect(workerMock.runConfirmWorker).not.toHaveBeenCalled()
    expect(providerMock.readRepoFile).not.toHaveBeenCalled()
    expect(getStageWorkerNote(P, iid)).toMatch(/staging 주소가 설정되지 않았습니다/)
  })

  it('D-3 MR 이 머지 전이면 기다린다', async () => {
    const iid = iidSeq
    agentConfirmer(iid); configure()
    providerMock.fetchMRByBranch.mockResolvedValue({ state: 'opened', merge_commit_sha: null })
    await dispatchStageWorkers(project, [{ issue: issue(iid), stage: 'confirm_waiting' }], 'tok')
    expect(workerMock.runConfirmWorker).not.toHaveBeenCalled()
    expect(getStageWorkerNote(P, iid)).toMatch(/머지되지 않음/)
  })

  it('D-4 배포 커밋에 머지 커밋이 없으면 기다린다', async () => {
    const iid = iidSeq
    agentConfirmer(iid); configure()
    providerMock.isAncestorCommit.mockResolvedValue(false)
    await dispatchStageWorkers(project, [{ issue: issue(iid), stage: 'confirm_waiting' }], 'tok')
    expect(workerMock.runConfirmWorker).not.toHaveBeenCalled()
    expect(providerMock.isAncestorCommit).toHaveBeenCalledWith(project, 'tok', 'aaaaaaa1', 'bbbbbbb2')
    expect(getStageWorkerNote(P, iid)).toMatch(/staging 배포 대기/)
  })

  it('D-5 모두 갖춰지면 기동 — IVE 설정의 staging 값과 비밀값을 넘긴다', async () => {
    const iid = iidSeq
    agentConfirmer(iid); configure({ notes: '로그인은 /login' })
    await dispatchStageWorkers(project, [{ issue: issue(iid), stage: 'confirm_waiting' }], 'tok')
    expect(workerMock.runConfirmWorker).toHaveBeenCalledTimes(1)
    const [input] = workerMock.runConfirmWorker.mock.calls[0] as unknown as [any]
    expect(input.staging).toEqual({ url: 'https://stg.example.com', versionSource: 'url', versionUrl: 'https://stg.example.com/version.json', commitField: 'commit', branch: 'staging', notes: '로그인은 /login' })
    expect(input.deployedCommit).toBe('bbbbbbb2')
    expect(input.mergeCommit).toBe('aaaaaaa1')
    expect(input.secrets).toEqual({ PF_USER: 'tester01' })
    expect(input.agent.id).toBe('a1')
    expect(getStageWorkerNote(P, iid)).toBeNull()
  })

  it('D-5 staging 주소가 비면 프로젝트의 테스트 사이트 URL 을 쓴다', async () => {
    const iid = iidSeq
    agentConfirmer(iid)
    updateProjectAutomation(P, { staging: { url: '', versionUrl: 'https://site.example.com/version.json' } }, 'owner')
    await dispatchStageWorkers({ ...project, testSiteUrl: 'https://site.example.com' } as Project, [{ issue: issue(iid), stage: 'confirm_waiting' }], 'tok')
    const [input] = workerMock.runConfirmWorker.mock.calls[0] as unknown as [any]
    expect(input.staging.url).toBe('https://site.example.com')
  })

  it('D-6 열린 확인 실행이 있으면 다시 띄우지 않는다', async () => {
    const iid = iidSeq
    agentConfirmer(iid); configure()
    openAgentStageExecution(P, iid, 'confirm', { executionId: `ex-confirm-open-${iid}`, agentId: 'a1', agentName: 'Alpha', logPath: '' })
    await dispatchStageWorkers(project, [{ issue: issue(iid), stage: 'confirming' }], 'tok')
    expect(workerMock.runConfirmWorker).not.toHaveBeenCalled()
  })

  it('D-7 자동 확인 실패가 상한에 닿으면 기동하지 않는다', async () => {
    const iid = iidSeq
    agentConfirmer(iid); configure()
    updateProjectAutomation(P, { limits: { maxAutoCycles: 1 } }, 'owner')
    const id = `ex-confirm-f-${iid}`
    openAgentStageExecution(P, iid, 'confirm', { executionId: id, agentId: 'a1', agentName: 'Alpha', logPath: '' })
    setStageVerdict(id, 'fail')
    db.prepare(`UPDATE task_executions SET status = 'failed' WHERE id = ?`).run(id)
    await dispatchStageWorkers(project, [{ issue: issue(iid), stage: 'confirm_waiting' }], 'tok')
    expect(workerMock.runConfirmWorker).not.toHaveBeenCalled()
    expect(getStageWorkerNote(P, iid)).toMatch(/자동 확인 실패 1회/)
  })

  it('D-8 허용 목록 밖 작성자는 승인 전에는 기동하지 않는다', async () => {
    const iid = iidSeq
    agentConfirmer(iid); configure()
    await dispatchStageWorkers(project, [{ issue: issue(iid, 'support-bot'), stage: 'confirm_waiting' }], 'tok')
    expect(workerMock.runConfirmWorker).not.toHaveBeenCalled()
    expect(getStageWorkerNote(P, iid)).toMatch(/허용 목록 밖/)
    approveIssueAutomation(P, iid, 'owner')
    // 같은 이슈의 외부 확인은 1분에 한 번 — 승인 직후 바로 다시 판정되도록 다른 iid 로 확인하지 않고 시간 제한을 넘긴다
    vi.useFakeTimers({ now: Date.now() + 120_000, toFake: ['Date'] })
    await dispatchStageWorkers(project, [{ issue: issue(iid, 'support-bot'), stage: 'confirm_waiting' }], 'tok')
    vi.useRealTimers()
    expect(workerMock.runConfirmWorker).toHaveBeenCalledTimes(1)
  })

  it('D-9 확인 중(C)에서 판정이 남은 실행 뒤에는 다시 띄우지 않는다', async () => {
    const iid = iidSeq
    agentConfirmer(iid); configure()
    const id = `ex-confirm-b-${iid}`
    openAgentStageExecution(P, iid, 'confirm', { executionId: id, agentId: 'a1', agentName: 'Alpha', logPath: '' })
    setStageVerdict(id, 'blocked')
    db.prepare(`UPDATE task_executions SET status = 'failed' WHERE id = ?`).run(id)
    await dispatchStageWorkers(project, [{ issue: issue(iid), stage: 'confirming' }], 'tok')
    expect(workerMock.runConfirmWorker).not.toHaveBeenCalled()
  })

  it('D-10 명부에서 확인 역할을 끄면 그 이슈는 사람 확인으로 돌아간다', async () => {
    const iid = iidSeq
    agentConfirmer(iid); configure()
    setRosterEntry(P, { subjectType: 'agent', subjectId: 'a1', roles: { process: false, verify: false, confirm: false } }, 'owner')
    expect(getPresetRoles(P, iid).confirmer.mode).toBe('creator')   // 아무도 맡지 않은 채 멈추지 않는다
    await dispatchStageWorkers(project, [{ issue: issue(iid), stage: 'confirm_waiting' }], 'tok')
    expect(workerMock.runConfirmWorker).not.toHaveBeenCalled()
  })

  it('D-10 (이중 방어) 명부 밖 에이전트가 배정에 남아 있어도 돌리지 않고 이유를 남긴다', async () => {
    const iid = iidSeq
    configure()
    db.prepare(`INSERT INTO agents (id, user_id, name, cli_name, cli_path) VALUES ('a2', 'owner', 'Beta', 'claude', 'claude')`).run()
    db.prepare(`INSERT INTO issue_stages (project_id, issue_iid, stage, preset_confirmer_mode, preset_confirmer_agent_id) VALUES (?, ?, '', 'agent', 'a2')`).run(P, iid)
    await dispatchStageWorkers(project, [{ issue: issue(iid), stage: 'confirm_waiting' }], 'tok')
    expect(workerMock.runConfirmWorker).not.toHaveBeenCalled()
    expect(getStageWorkerNote(P, iid)).toMatch(/명부에 없습니다/)
  })

  it('D-10 공유 해제·viewer 하향 시 그 사람의 에이전트는 명부에서 빠지고 배정은 사람으로', async () => {
    const iid = iidSeq
    db.prepare(`INSERT INTO users (id, email, password, name) VALUES ('ed2', 'e2@x', '', 'Ed2')`).run()
    db.prepare(`INSERT INTO agents (id, user_id, name, cli_name, cli_path) VALUES ('a8', 'ed2', 'Ed2Agent', 'claude', 'claude')`).run()
    db.prepare(`INSERT INTO project_shares (id, project_id, user_id, role) VALUES ('s2', ?, 'ed2', 'editor')`).run(P)
    setRosterEntry(P, { subjectType: 'agent', subjectId: 'a8', roles: { process: false, verify: false, confirm: true } }, 'owner')
    setPresetRoles(P, iid, { confirmer: { mode: 'agent', userId: null, username: null, agentId: 'a8' } })
    updateProjectShareRole('s2', 'viewer')
    expect(getPresetRoles(P, iid).confirmer.mode).toBe('creator')
    expect(getRoster(P).some(r => r.subjectId === 'a8')).toBe(false)
  })

  it('D-10 소유자가 편집 권한을 잃은 에이전트는 돌리지 않는다', async () => {
    const iid = iidSeq
    db.prepare(`INSERT INTO users (id, email, password, name) VALUES ('ed', 'e@x', '', 'Editor')`).run()
    db.prepare(`INSERT INTO agents (id, user_id, name, cli_name, cli_path) VALUES ('a9', 'ed', 'EdAgent', 'claude', 'claude')`).run()
    setRosterEntry(P, { subjectType: 'agent', subjectId: 'a9', roles: { process: false, verify: false, confirm: true } }, 'owner')
    setPresetRoles(P, iid, { confirmer: { mode: 'agent', userId: null, username: null, agentId: 'a9' } })
    configure()
    // 편집 권한(share) 없음 → 돌리지 않음
    await dispatchStageWorkers(project, [{ issue: issue(iid), stage: 'confirm_waiting' }], 'tok')
    expect(workerMock.runConfirmWorker).not.toHaveBeenCalled()
    // editor 로 공유하면 돈다
    db.prepare(`INSERT INTO project_shares (id, project_id, user_id, role) VALUES ('s1', ?, 'ed', 'editor')`).run(P)
    vi.useFakeTimers({ now: Date.now() + 120_000, toFake: ['Date'] })
    await dispatchStageWorkers(project, [{ issue: issue(iid), stage: 'confirm_waiting' }], 'tok')
    vi.useRealTimers()
    expect(workerMock.runConfirmWorker).toHaveBeenCalledTimes(1)
  })
})

describe('D-11 IVE 가 봇 계정으로 만든 이슈', () => {
  const body = (uid: string) => `<!-- ive-author:${uid} -->\n본문`
  const bot = 'project_80982920_bot_005908af'
  beforeEach(() => {
    db.prepare(`INSERT INTO users (id, email, password, name) VALUES ('stranger', 's@x', '', 'Stranger')`).run()
  })
  it('등록자가 프로젝트 소유자면 허용, 프로젝트와 무관한 사용자면 막는다', () => {
    expect(isAutomationAllowed(project, 1, { author: { username: bot }, description: body('owner') })).toEqual({ ok: true, author: 'Owner' })
    expect(isAutomationAllowed(project, 2, { author: { username: bot }, description: body('stranger') }).ok).toBe(false)
    expect(isAutomationAllowed(project, 3, { author: { username: bot }, description: '마커 없음' }).ok).toBe(false)
  })
  it('작업 접수 페이지 이슈는 프로젝트가 「승인 없이 자동 실행」을 켰을 때만 허용', () => {
    setIssueIntakeChannel(P, 5, 'report')
    const anon = { author: { username: bot }, description: '익명 접수' }
    expect(isAutomationAllowed(project, 5, anon).ok).toBe(false)
    updateProjectAutomation(P, { defaultRoles: { autoAllAgents: false, intakeAutoRun: true } }, 'owner')
    expect(isAutomationAllowed(project, 5, anon).ok).toBe(true)
    // 접수 페이지가 아닌(Git 직접) 외부인 이슈는 그대로 막는다
    expect(isAutomationAllowed(project, 6, { author: { username: 'outsider' }, description: '' }).ok).toBe(false)
  })
  it('사람이 Git 에 직접 만든 이슈의 마커는 믿지 않는다', () => {
    expect(isAutomationAllowed(project, 4, { author: { username: 'outsider' }, description: body('owner') }).ok).toBe(false)
  })
})
