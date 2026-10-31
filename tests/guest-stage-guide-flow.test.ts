/**
 * 비회원 담당자 안내 노트 흐름: 한 번만 달고, 회원·에이전트·대기 단계에는 달지 않고, 코멘트가 실패하면 다시 시도한다.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest'
import Database from 'better-sqlite3'

let db: Database.Database
let members: Record<string, boolean> = {}
let humanHeld = true
const addIssueComment = vi.fn(async (..._a: any[]) => {})

vi.mock('@/lib/db', () => ({
  getDb: () => db,
  getUserByOAuthId: (_p: string, id: string) => (members[id] ? { id: 'u' } : null),
  getUserByGitUsername: (_p: string, n: string) => (members[n] ? { id: 'u' } : null),
}))
vi.mock('@/lib/stage-person', () => ({ hasOpenHumanStageExec: () => humanHeld }))
vi.mock('@/lib/provider', () => ({ addIssueComment: (...a: any[]) => addIssueComment(...a) }))
vi.mock('@/lib/slack-notify', () => ({ getIveBaseUrl: () => 'https://ive.example' }))
vi.mock('@/lib/scanner/stage-worker', () => ({ resolveProjectLocale: () => ({ isKo: true, timezone: 'Asia/Seoul' }) }))
vi.mock('@/lib/logger', () => ({ getLogger: () => ({ info() {}, warn() {}, error() {} }) }))

import { postGuestGuideIfNeeded } from '@/lib/guest-stage-guide'

const project: any = { id: 'p1', name: 'P', provider: 'github', labelVerify: 'ive:verifying', labelConfirm: 'ive:confirming', labelConfirmWait: 'ive:confirm-wait', labelVerifyWait: 'ive:verify-wait', labelSchedule: 'ive:todo', labelEnd: 'ive:done' }
const guest = [{ id: 100, login: 'gyehyun-bak' }]

beforeEach(() => {
  db = new Database(':memory:')
  db.exec(`CREATE TABLE guest_stage_guides (project_id TEXT, issue_iid INTEGER, stage TEXT, person_key TEXT, created_at TEXT DEFAULT (datetime('now')), PRIMARY KEY (project_id, issue_iid, stage, person_key));`)
  members = {}; humanHeld = true; addIssueComment.mockClear(); addIssueComment.mockImplementation(async () => {})
})

describe('postGuestGuideIfNeeded', () => {
  it('비회원 담당자 검증 중: 한 번만 단다', async () => {
    expect(await postGuestGuideIfNeeded(project, 't', 1735, 'verifying', guest)).toBe(true)
    expect(await postGuestGuideIfNeeded(project, 't', 1735, 'verifying', guest)).toBe(false)
    expect(addIssueComment).toHaveBeenCalledTimes(1)
    expect(addIssueComment.mock.calls[0][3]).toContain('`ive:verifying` → `ive:confirm-wait`')
  })
  it('담당자가 바뀌면 새 담당자에게 다시 단다, 단계가 바뀌어도 단다', async () => {
    await postGuestGuideIfNeeded(project, 't', 1, 'verifying', guest)
    expect(await postGuestGuideIfNeeded(project, 't', 1, 'verifying', [{ id: 200, login: 'other' }])).toBe(true)
    expect(await postGuestGuideIfNeeded(project, 't', 1, 'confirming', guest)).toBe(true)
  })
  it('회원·봇·에이전트 담당·대기 단계에는 달지 않는다', async () => {
    members['100'] = true
    expect(await postGuestGuideIfNeeded(project, 't', 2, 'verifying', guest)).toBe(false)
    members = {}
    expect(await postGuestGuideIfNeeded(project, 't', 2, 'verifying', [{ id: 9, login: 'ci-bot' }])).toBe(false)
    humanHeld = false
    expect(await postGuestGuideIfNeeded(project, 't', 2, 'verifying', guest)).toBe(false)
    humanHeld = true
    expect(await postGuestGuideIfNeeded(project, 't', 2, 'verify_waiting', guest)).toBe(false)
    expect(await postGuestGuideIfNeeded(project, 't', 2, 'verifying', [])).toBe(false)
    expect(addIssueComment).not.toHaveBeenCalled()
  })
  it('코멘트가 실패하면 기록을 지워 다음에 다시 시도한다', async () => {
    addIssueComment.mockRejectedValueOnce(new Error('boom'))
    expect(await postGuestGuideIfNeeded(project, 't', 3, 'confirming', guest)).toBe(false)
    expect(await postGuestGuideIfNeeded(project, 't', 3, 'confirming', guest)).toBe(true)
  })
})
