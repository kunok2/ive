/**
 * isIssueAssignee / isIssueAuthor 골든 테스트
 *
 * 중요한 로직:
 *   "이 이슈를 이 사용자가 진행/닫기/머지할 수 있나" 를 결정하는 권한 판정.
 *   이 로직이 깨지면:
 *   - 이슈 작성자가 자기 이슈의 검증 팝업을 못 봄
 *   - 담당자가 자기 MR 머지 버튼이 안 보임
 *   - 로컬 계정(비-OAuth) 사용자가 어떤 이슈도 처리 못 함
 *
 * 판정 규칙 (클라이언트 isAssignee 와 동일):
 *   1) 이슈에 assignees 있음  → Git user id 매치 필요 (OAuth 사용자만)
 *   2) assignees 비어있음     → 작성자를 담당자로 간주
 *       (a) ive-author 마커의 IVE user.id 가 현재 사용자 id 와 일치 (로컬 계정 포함)
 *       (b) Git author.id 가 현재 사용자 oauthUserId 와 일치 (OAuth)
 *
 * 불변식:
 *   A-1: 담당자 지정 있으면 IVE 마커만으로는 권한 없음 (assignees 우선)
 *   A-2: 담당자 없음 + Git author 매치 → true (OAuth 사용자)
 *   A-3: 담당자 없음 + ive-author 마커 매치 → true (로컬 계정 포함)
 *   A-4: 아무도 매치 안 되면 false
 *   A-5: 사용자 식별자가 아예 없으면 false (방어)
 *   A-6: isIssueAuthor 는 Git author 와 ive-author 마커 "둘 다" 체크 (OR)
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { setupTestDb, teardownTestDb } from './helpers/test-db'

// fetchSingleIssue 를 mock 해서 Git 이슈 데이터를 주입한다.
let mockIssue: any = null
vi.mock('@/lib/provider', () => ({
  fetchSingleIssue: vi.fn(async () => mockIssue),
}))

import { isIssueAssignee, isIssueAuthor } from '@/lib/db/shares'
import type { Project } from '@/types'

const project: Project = {
  id: 'p1', userId: 'u-owner', name: 'Test', provider: 'gitlab',
  repoUrl: 'https://gitlab.com/x/y', authType: 'token', gitUsername: '',
  accessToken: '', color: '#4ade80', labelTarget: 'IVE',
  labelSchedule: 'IVE-S', labelDev: 'IVE-D', labelVerifyWait: 'IVE-W',
  labelVerify: 'IVE-V', labelEnd: 'IVE-E',
  showToolUsage: false, checkInterval: 1, scannerActive: false,
  usesOAuthToken: false, sortOrder: 0, avatarUrl: '',
  snapshotInterval: 1, sparklinePoints: 60, statsRetention: 7,
  conflictCount: 0, createdAt: '2026-01-01T00:00:00Z',
} as any

beforeEach(() => { setupTestDb() })
afterEach(() => { teardownTestDb(); mockIssue = null })

describe('isIssueAssignee', () => {
  describe('A-1: 담당자 지정 있음', () => {
    it('Git assignee 에 본인이 있으면 true', async () => {
      mockIssue = {
        assignees: [{ id: 100 }, { id: 200 }],
        author: { id: 999 },
        description: '',
      }
      const r = await isIssueAssignee(project, 1, 'tok', { id: 'u-me', oauthUserId: '100' })
      expect(r).toBe(true)
    })

    it('Git assignee 에 본인이 없으면 false (마커 있어도)', async () => {
      mockIssue = {
        assignees: [{ id: 100 }],
        author: { id: 999 },
        description: '<!-- ive-author:u-me -->\n본문',  // 마커는 있지만 assignees 우선
      }
      const r = await isIssueAssignee(project, 1, 'tok', { id: 'u-me', oauthUserId: '200' })
      expect(r).toBe(false)
    })

    it('로컬 계정 사용자 + 담당자 지정 있음 → false (OAuth 식별자 없어서 매치 불가)', async () => {
      mockIssue = { assignees: [{ id: 100 }], author: { id: 999 }, description: '' }
      const r = await isIssueAssignee(project, 1, 'tok', { id: 'u-local', oauthUserId: null })
      expect(r).toBe(false)
    })
  })

  describe('A-2: 담당자 없음 + Git author 매치 (OAuth)', () => {
    it('Git author.id 가 oauthUserId 와 일치 → true', async () => {
      mockIssue = { assignees: [], author: { id: 11213017 }, description: '' }
      const r = await isIssueAssignee(project, 1, 'tok', { id: 'u-oauth', oauthUserId: '11213017' })
      expect(r).toBe(true)
    })

    it('Git author.id 다르면 false', async () => {
      mockIssue = { assignees: [], author: { id: 11213017 }, description: '' }
      const r = await isIssueAssignee(project, 1, 'tok', { id: 'u-other', oauthUserId: '999' })
      expect(r).toBe(false)
    })
  })

  describe('A-3: 담당자 없음 + ive-author 마커 매치 (로컬 계정 핵심)', () => {
    it('마커 userId 가 현재 user.id 와 일치 → true (OAuth 없어도)', async () => {
      mockIssue = {
        assignees: [],
        author: { id: 2914693 }, // 프로젝트 소유자
        description: '<!-- ive-author:u-local -->\n균옥이가 쓴 이슈',
      }
      const r = await isIssueAssignee(project, 1, 'tok', { id: 'u-local', oauthUserId: null })
      expect(r).toBe(true)
    })

    it('마커가 다른 사용자면 false', async () => {
      mockIssue = {
        assignees: [],
        author: { id: 2914693 },
        description: '<!-- ive-author:u-other -->\n다른 사용자 이슈',
      }
      const r = await isIssueAssignee(project, 1, 'tok', { id: 'u-local', oauthUserId: null })
      expect(r).toBe(false)
    })

    it('OAuth 사용자 + 마커로도 매치 가능', async () => {
      mockIssue = {
        assignees: [],
        author: { id: 2914693 },
        description: '<!-- ive-author:u-oauth -->\n내 이슈',
      }
      const r = await isIssueAssignee(project, 1, 'tok', { id: 'u-oauth', oauthUserId: '11213017' })
      expect(r).toBe(true)
    })
  })

  describe('A-4: 아무도 매치 안 됨', () => {
    it('assignees 없음, author 불일치, 마커 없음 → false', async () => {
      mockIssue = { assignees: [], author: { id: 2914693 }, description: '본문' }
      const r = await isIssueAssignee(project, 1, 'tok', { id: 'u-me', oauthUserId: '999' })
      expect(r).toBe(false)
    })
  })

  describe('A-5: 방어 케이스', () => {
    it('user.id 와 oauthUserId 둘 다 없으면 false', async () => {
      mockIssue = { assignees: [], author: { id: 2914693 }, description: '<!-- ive-author:x -->' }
      const r = await isIssueAssignee(project, 1, 'tok', {})
      expect(r).toBe(false)
    })

    it('issue 자체가 null 이면 false', async () => {
      mockIssue = null
      const r = await isIssueAssignee(project, 1, 'tok', { id: 'u-me', oauthUserId: '1' })
      expect(r).toBe(false)
    })
  })
})

describe('isIssueAuthor', () => {
  it('A-6a: ive-author 마커 일치 → true (로컬 계정)', async () => {
    mockIssue = {
      assignees: [],
      author: { id: 2914693 },
      description: '<!-- ive-author:u-local -->\n',
    }
    const r = await isIssueAuthor(project, 1, 'tok', { id: 'u-local', oauthUserId: null })
    expect(r).toBe(true)
  })

  it('A-6b: Git author.id 가 oauthUserId 와 일치 → true', async () => {
    mockIssue = { assignees: [], author: { id: 11213017 }, description: '' }
    const r = await isIssueAuthor(project, 1, 'tok', { id: 'u-oauth', oauthUserId: '11213017' })
    expect(r).toBe(true)
  })

  it('A-6c: 둘 다 일치 안 하면 false', async () => {
    mockIssue = { assignees: [], author: { id: 999 }, description: '<!-- ive-author:other -->' }
    const r = await isIssueAuthor(project, 1, 'tok', { id: 'u-me', oauthUserId: '1' })
    expect(r).toBe(false)
  })

  it('A-6d: 담당자가 있어도 isIssueAuthor 는 작성자 기준으로 판정 (assignees 무시)', async () => {
    mockIssue = {
      assignees: [{ id: 200 }],           // 나와 다른 사람이 담당자
      author: { id: 11213017 },          // 내가 원래 Git 저자
      description: '',
    }
    const r = await isIssueAuthor(project, 1, 'tok', { id: 'u-me', oauthUserId: '11213017' })
    expect(r).toBe(true)
  })
})
