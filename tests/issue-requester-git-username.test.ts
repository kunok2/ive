/**
 * 의뢰자(requester) 판정의 git username fallback.
 *
 * 배경 (운영 버그):
 *   의뢰자 판정이 oauth_user_id(숫자 id) 매칭만 하고 있었다. 그래서 GitHub·Slack·이메일 등
 *   **다른 방식으로 IVE 에 가입한 사용자**가 GitLab 이슈에 IVE-S 를 붙여도 식별되지 않고
 *   '프로젝트 오너 fallback' 으로 떨어졌다. 의뢰자 = 프로젝트 오너가 되면 **오너의 에이전트 풀**
 *   에서 작업자가 배정되므로, 사용자는 자기 에이전트 목록에 없는(다른 계정 소유의) 개발자가
 *   자기 이슈를 처리하는 것을 보게 된다. 실제로 운영에서 관리자 계정의 옛 에이전트('똑똑이')가
 *   계속 배정됐다.
 *
 * 검증 불변식:
 *   Q-1: oauth id 가 맞으면 종전대로 그 사용자로 판정한다 (기존 동작 회귀 방지).
 *   Q-2: oauth id 가 안 맞아도 gitlab_username 이 맞으면 그 사용자로 판정한다 (label-actor).
 *   Q-3: 이슈 작성자도 같은 fallback 을 탄다 (author).
 *   Q-4: id·username 모두 못 맞추면 종전대로 프로젝트 오너 fallback 이다.
 *   Q-5: 봇 토큰처럼 IVE 사용자가 아닌 행위자는 오너 fallback 으로 떨어진다 (접수 이슈).
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import Database from 'better-sqlite3'
import { setupTestDb, teardownTestDb, seedUser } from './helpers/test-db'
import { resolveIssueRequesterAsync, resolveIssueRequester } from '@/lib/ive-author'
import type { Project } from '@/types'

let db: Database.Database

const project = {
  id: 'p1', userId: 'owner', name: 'T', provider: 'gitlab', labelSchedule: 'IVE-S',
} as unknown as Project

/** IVE-S 를 붙인 사람 1명짜리 레이블 이벤트 목록 */
function labelEvents(userId: string | null, username: string | null) {
  return async () => [
    { action: 'add' as const, label: 'IVE-S', userId, username, createdAt: '2026-08-18T02:00:00Z' },
  ]
}

const noEvents = async () => []

beforeEach(() => {
  db = setupTestDb()
  db.prepare(`INSERT INTO oauth_providers (id, type, name, base_url, client_id, client_secret)
              VALUES ('gitlab', 'gitlab', 'GitLab', 'https://gitlab.com', 'c', 's')`).run()
  // 프로젝트 오너 (관리자 계정 — git 연동 없음)
  seedUser(db, 'owner', '관리자')
  // gitlab OAuth 로 가입한 사용자
  seedUser(db, 'u-oauth', 'OAuth 사용자', { oauthProviderId: 'gitlab', oauthUserId: '9161738' })
  // GitHub 으로 가입했지만 본인 GitLab 사용자명을 채워둔 사용자
  seedUser(db, 'u-name', '정균옥', {
    oauthProviderId: 'github', oauthUserId: '42708682', gitlabUsername: 'kunok2',
  })
})

afterEach(() => teardownTestDb(db))

describe('의뢰자 판정 — git username fallback', () => {
  it('Q-1: oauth id 가 맞으면 그 사용자로 판정한다', async () => {
    const r = await resolveIssueRequesterAsync(project, {}, labelEvents('9161738', 'someone'))
    expect(r?.user.id).toBe('u-oauth')
    expect(r?.source).toBe('label-actor')
  })

  it('Q-2: oauth id 가 안 맞아도 gitlab_username 으로 판정한다', async () => {
    const r = await resolveIssueRequesterAsync(project, {}, labelEvents('99999999', 'kunok2'))
    expect(r?.user.id).toBe('u-name')
    expect(r?.source).toBe('label-actor')
  })

  it('Q-2b: username 은 대소문자를 무시한다', async () => {
    const r = await resolveIssueRequesterAsync(project, {}, labelEvents('99999999', 'KunOk2'))
    expect(r?.user.id).toBe('u-name')
  })

  it('Q-3: 이슈 작성자도 username fallback 을 탄다', async () => {
    const issue = { author: { id: 99999999, username: 'kunok2' } }
    const r = await resolveIssueRequesterAsync(project, issue, noEvents)
    expect(r?.user.id).toBe('u-name')
    expect(r?.source).toBe('author')

    // 동기 버전(웹 API 용)도 같은 기준이어야 한다
    expect(resolveIssueRequester(project, issue)?.user.id).toBe('u-name')
  })

  it('Q-4: id·username 모두 못 맞추면 프로젝트 오너 fallback', async () => {
    const r = await resolveIssueRequesterAsync(project, {}, labelEvents('123', 'nobody'))
    expect(r?.user.id).toBe('owner')
    expect(r?.source).toBe('owner-fallback')
  })

  it('Q-5: 접수 봇(IVE 프로젝트 토큰)이 붙인 레이블은 오너 fallback 이다', async () => {
    // 외부 서비스 접수로 만들어진 이슈: 작성자·레이블 부착자가 모두 프로젝트 access token
    const botName = 'project_74214165_bot_b5066f483c4346bcba740aead988c22b'
    const issue = { author: { id: 37330289, username: botName } }
    const r = await resolveIssueRequesterAsync(project, issue, labelEvents('37330289', botName))
    expect(r?.user.id).toBe('owner')
    expect(r?.source).toBe('owner-fallback')
  })
})
