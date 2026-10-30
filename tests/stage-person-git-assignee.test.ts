// 검증자·확인자는 IVE 계정이 없는 Git 사람이어도 된다 — Git 담당자가 곧 그 단계를 맡은 사람이다.
//
// spider-framework #1735: kunok2 가 「검증 시작」을 눌러 검증 기록이 kunok2 로 열렸고, 그 뒤 Git 담당자를
// IVE 계정이 없는 gyehyun-bak 으로 바꿨지만 상태전이 그래프는 계속 kunok2 를 보였다.
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { getActualRoleAssignees, markIssueVerified } from '@/lib/db'
import { setupTestDb, teardownTestDb, seedUser, seedProject } from './helpers/test-db'
import { openStageExecution } from '@/lib/scanner/stage-records'
import { stagePersonFromGit, followGitAssignee, openStagePerson, moveOpenStageExecs } from '@/lib/stage-person'

const PROJ = 'proj-1'
const IID = 1735
const gyehyun = { id: 9001, username: 'gyehyun-bak', name: '박계현', avatar_url: 'https://x/a.png' }

describe('Git 담당자를 검증자·확인자로', () => {
  beforeEach(() => {
    const db = setupTestDb()
    seedUser(db, 'user-kunok2', 'kunok2', { gitlabUsername: 'kunok2', oauthUserId: '100' })
    seedProject(db, PROJ, 'user-kunok2', 'spider')
  })
  afterEach(() => teardownTestDb())

  it('IVE 계정이 없는 Git 사람은 Git 신원 그대로, 있으면 IVE 계정으로 바뀐다', () => {
    expect(stagePersonFromGit('gitlab', gyehyun)).toMatchObject({ userId: '9001', name: '박계현', username: 'gyehyun-bak', gitUserId: '9001' })
    expect(stagePersonFromGit('gitlab', { id: 555, username: 'kunok2' })).toMatchObject({ userId: 'user-kunok2', name: 'kunok2' })
    expect(stagePersonFromGit('gitlab', null)).toBeNull()
  })

  it('검증 중에 Git 담당자를 바꾸면 검증 기록·화면의 검증자가 그 사람으로 옮겨간다', () => {
    openStageExecution(PROJ, IID, 'verify', { userId: 'user-kunok2', userName: 'kunok2' })
    expect(getActualRoleAssignees(PROJ, IID).verifier?.name).toBe('kunok2')

    expect(followGitAssignee('gitlab', PROJ, IID, 'verifying', [gyehyun])).toBe(true)
    expect(getActualRoleAssignees(PROJ, IID).verifier).toMatchObject({ name: '박계현' })
    // 같은 사람이면 다시 옮기지 않는다
    expect(followGitAssignee('gitlab', PROJ, IID, 'verifying', [gyehyun])).toBe(false)
  })

  it('검증 완료는 버튼을 누른 사람이 아니라 검증을 맡은 사람으로 남는다', () => {
    openStageExecution(PROJ, IID, 'verify', { userId: 'user-kunok2', userName: 'kunok2' })
    followGitAssignee('gitlab', PROJ, IID, 'verifying', [gyehyun])
    const v = openStagePerson(PROJ, IID, 'verify')!
    markIssueVerified(PROJ, IID, { name: v.name, avatar: v.avatar ?? undefined, userId: v.userId })
    expect(getActualRoleAssignees(PROJ, IID).verifier).toMatchObject({ name: '박계현' })
  })

  it('다른 단계거나 담당자가 비었으면 건드리지 않는다', () => {
    openStageExecution(PROJ, IID, 'verify', { userId: 'user-kunok2', userName: 'kunok2' })
    expect(followGitAssignee('gitlab', PROJ, IID, 'confirm-wait', [gyehyun])).toBe(false)
    expect(followGitAssignee('gitlab', PROJ, IID, 'verifying', [])).toBe(false)
    expect(followGitAssignee('gitlab', PROJ, IID, 'confirming', [gyehyun])).toBe(false) // 열린 확인 기록 없음
    expect(getActualRoleAssignees(PROJ, IID).verifier?.name).toBe('kunok2')
  })

  it('확인자도 같은 방식으로 옮긴다', () => {
    openStageExecution(PROJ, IID, 'confirm', { userId: 'user-kunok2', userName: 'kunok2' })
    expect(moveOpenStageExecs(PROJ, IID, 'confirm', stagePersonFromGit('gitlab', gyehyun)!)).toBe(1)
    expect(openStagePerson(PROJ, IID, 'confirm')).toMatchObject({ userId: '9001', name: '박계현' })
  })
})
