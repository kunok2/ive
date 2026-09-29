/**
 * 이력 탭(닫힌 이슈) 페이지 조회.
 *
 * 종전엔 닫힌 이슈 전체(Meta-Shop 1,744건 = 18페이지 순차, 약 36초·10MB)를 매번 받았다.
 * 이제 한 페이지만 받고 정렬·검색은 provider 에 맡긴다. 여기서는
 *   - 쿼리스트링 해석(범위 밖 값 보정)
 *   - GitLab/GitHub 요청 URL(정렬·검색·이슈번호)과 다음 페이지 판정
 * 을 fetch 를 흉내 내어 확인한다.
 */
import { describe, it, expect, vi, afterEach } from 'vitest'
import { parseClosedPageOptions, isGitLabSearchable, parseIidSearch } from '@/lib/closed-issues'
import Database from 'better-sqlite3'
import { setupTestDb, teardownTestDb, seedUser, seedProject, seedExecution, seedIssueStage } from './helpers/test-db'
import { findIssueIidsByTitle } from '@/lib/db/issues'
import { fetchClosedProjectIssuesPage as gitlabPage } from '@/lib/gitlab/issues'
import { fetchClosedProjectIssuesPage as githubPage } from '@/lib/github/issues'
import type { Project } from '@/types'

const glProject = { id: 'p1', provider: 'gitlab', repoUrl: 'https://gitlab.com/acme/shop', authType: 'token' } as unknown as Project
const ghProject = { id: 'p2', provider: 'github', repoUrl: 'https://github.com/acme/shop', authType: 'token' } as unknown as Project

function mockFetch(body: unknown, headers: Record<string, string> = {}, status = 200) {
  const fn = vi.fn().mockResolvedValue(new Response(JSON.stringify(body), { status, headers }))
  vi.stubGlobal('fetch', fn)
  return fn
}
const calledUrl = (fn: ReturnType<typeof vi.fn>) => new URL(String(fn.mock.calls[0][0]))

afterEach(() => vi.unstubAllGlobals())

describe('parseClosedPageOptions', () => {
  it('기본값: 1페이지·50건·최신순·검색 없음', () => {
    expect(parseClosedPageOptions(new URLSearchParams())).toEqual({ page: 1, perPage: 50, sort: 'desc', search: undefined })
  })
  it('범위 밖 값은 보정한다 (page≥1, perPage 1~100, sort 는 asc/desc 만)', () => {
    const o = parseClosedPageOptions(new URLSearchParams({ page: '-3', perPage: '5000', sort: 'weird', q: '  버그  ' }))
    expect(o).toEqual({ page: 1, perPage: 100, sort: 'desc', search: '버그' })
  })
})

describe('GitLab fetchClosedProjectIssuesPage', () => {
  it('한 번만 요청하고 생성일 정렬·페이지를 넘긴다, 다음 페이지는 X-Next-Page', async () => {
    const fn = mockFetch([{ iid: 1 }, { iid: 2 }], { 'x-total': '1744', 'x-next-page': '3' })
    const r = await gitlabPage(glProject, 't', { page: 2, perPage: 50, sort: 'asc' })
    expect(fn).toHaveBeenCalledOnce()
    const u = calledUrl(fn)
    expect(u.searchParams.get('state')).toBe('closed')
    expect(u.searchParams.get('order_by')).toBe('created_at')
    expect(u.searchParams.get('sort')).toBe('asc')
    expect(u.searchParams.get('page')).toBe('2')
    expect(u.searchParams.get('per_page')).toBe('50')
    expect(r).toEqual({ issues: [{ iid: 1 }, { iid: 2 }], total: 1744, hasMore: true })
  })
  it('마지막 페이지: X-Next-Page 가 비면 hasMore=false', async () => {
    mockFetch([{ iid: 1 }], { 'x-total': '1', 'x-next-page': '' })
    const r = await gitlabPage(glProject, 't', { page: 1, perPage: 50, sort: 'desc' })
    expect(r.hasMore).toBe(false)
  })
  it('검색어는 search, 숫자(#12)는 이슈 번호(iids[])로 보낸다', async () => {
    let fn = mockFetch([])
    await gitlabPage(glProject, 't', { page: 1, perPage: 50, sort: 'desc', search: '로그인 오류' })
    expect(calledUrl(fn).searchParams.get('search')).toBe('로그인 오류')
    fn = mockFetch([])
    await gitlabPage(glProject, 't', { page: 1, perPage: 50, sort: 'desc', search: '#12' })
    expect(calledUrl(fn).searchParams.getAll('iids[]')).toEqual(['12'])
    expect(calledUrl(fn).searchParams.get('search')).toBeNull()
  })
  it('label 을 주면 Git 조회 단계에서 거른다 (페이지·건수가 실제 목록과 일치)', async () => {
    const fn = mockFetch([])
    await gitlabPage(glProject, 't', { page: 1, perPage: 50, sort: 'desc', label: 'IVE' })
    expect(calledUrl(fn).searchParams.get('labels')).toBe('IVE')
  })
  it('Git 오류는 빈 목록으로 숨기지 않고 던진다', async () => {
    mockFetch({ message: 'nope' }, {}, 401)
    await expect(gitlabPage(glProject, 't', { page: 1, perPage: 50, sort: 'desc' })).rejects.toThrow()
  })
})

describe('GitHub fetchClosedProjectIssuesPage', () => {
  const ghIssue = (n: number, extra: Record<string, unknown> = {}) => ({ number: n, title: `t${n}`, state: 'closed', labels: [], ...extra })

  it('PR 은 걸러내고, 다음 페이지는 Link rel="next"', async () => {
    const fn = mockFetch([ghIssue(1), ghIssue(2, { pull_request: {} })], { link: '<https://api.github.com/x?page=2>; rel="next"' })
    const r = await githubPage(ghProject, 't', { page: 1, perPage: 50, sort: 'desc' })
    const u = calledUrl(fn)
    expect(u.searchParams.get('sort')).toBe('created')
    expect(u.searchParams.get('direction')).toBe('desc')
    expect(r.issues.map((i: { iid: number }) => i.iid)).toEqual([1])
    expect(r.hasMore).toBe(true)
    expect(r.total).toBeNull()
  })
  it('검색어는 Search API(제목·본문), total_count 로 다음 페이지 판정', async () => {
    const fn = mockFetch({ total_count: 120, items: [ghIssue(5)] })
    const r = await githubPage(ghProject, 't', { page: 2, perPage: 50, sort: 'asc', search: 'crash' })
    const u = calledUrl(fn)
    expect(u.pathname).toBe('/search/issues')
    expect(u.searchParams.get('q')).toBe('repo:acme/shop is:issue is:closed crash')
    expect(u.searchParams.get('order')).toBe('asc')
    expect(r).toMatchObject({ total: 120, hasMore: true }) // 2*50 < 120
  })
  it('label 을 주면 목록은 labels=, 검색은 label:"…" 로 거른다', async () => {
    let fn = mockFetch([], {})
    await githubPage(ghProject, 't', { page: 1, perPage: 50, sort: 'desc', label: 'IVE' })
    expect(calledUrl(fn).searchParams.get('labels')).toBe('IVE')
    fn = mockFetch({ total_count: 0, items: [] })
    await githubPage(ghProject, 't', { page: 1, perPage: 50, sort: 'desc', label: 'IVE', search: 'crash' })
    expect(calledUrl(fn).searchParams.get('q')).toBe('repo:acme/shop is:issue is:closed label:"IVE" crash')
  })
  it('숫자 검색은 단건 조회 — 열린 이슈·PR 이면 빈 결과', async () => {
    mockFetch(ghIssue(7))
    expect((await githubPage(ghProject, 't', { page: 1, perPage: 50, sort: 'desc', search: '7' })).issues).toHaveLength(1)
    mockFetch(ghIssue(7, { state: 'open' }))
    expect((await githubPage(ghProject, 't', { page: 1, perPage: 50, sort: 'desc', search: '7' })).issues).toHaveLength(0)
  })
})

describe('짧은 검색어 (GitLab 은 3글자 미만 단어를 무시)', () => {
  it('isGitLabSearchable: 모든 단어가 3글자 이상일 때만 GitLab 검색에 맡긴다', () => {
    expect(isGitLabSearchable('모니터링')).toBe(true)
    expect(isGitLabSearchable('영어')).toBe(false)
    expect(isGitLabSearchable('영어 모드에서')).toBe(false)
    expect(isGitLabSearchable('ResizeObserver loop')).toBe(true)
  })
  it('parseIidSearch: #123 / 123 만 번호로 본다', () => {
    expect(parseIidSearch('#123')).toBe(123)
    expect(parseIidSearch('123')).toBe(123)
    expect(parseIidSearch('12a')).toBeNull()
  })
  it('GitLab: iids 로 한정하면 search 대신 iids[] 를 보내고, 빈 배열이면 요청하지 않는다', async () => {
    let fn = mockFetch([])
    await gitlabPage(glProject, 't', { page: 1, perPage: 50, sort: 'desc', search: '영어', iids: [5, 9] })
    expect(calledUrl(fn).searchParams.getAll('iids[]')).toEqual(['5', '9'])
    expect(calledUrl(fn).searchParams.get('search')).toBeNull()
    fn = mockFetch([])
    const r = await gitlabPage(glProject, 't', { page: 1, perPage: 50, sort: 'desc', search: '영어', iids: [] })
    expect(fn).not.toHaveBeenCalled()
    expect(r).toEqual({ issues: [], total: 0, hasMore: false })
  })

  describe('findIssueIidsByTitle', () => {
    let db: Database.Database
    afterEach(() => teardownTestDb())
    it('실행 기록·단계 스냅샷의 제목에서 모든 단어를 포함하는 번호를 최신순으로', () => {
      db = setupTestDb()
      seedUser(db, 'u1', 'Owner')
      seedProject(db, 'p1', 'u1', 'T')
      seedProject(db, 'p2', 'u1', 'Other')
      seedExecution(db, { id: 'e1', projectId: 'p1', agentId: null, issueIid: 10, issueTitle: '영어 모드에서 번역 누락', status: 'success', startedAt: '2026-09-01T00:00:00Z' })
      seedExecution(db, { id: 'e2', projectId: 'p1', agentId: null, issueIid: 11, issueTitle: '한국어 모드 문구', status: 'success', startedAt: '2026-09-01T00:00:00Z' })
      seedIssueStage(db, { projectId: 'p1', issueIid: 12, cachedStage: 'done', issueTitle: '영어 메뉴 순서' })
      seedExecution(db, { id: 'e3', projectId: 'p2', agentId: null, issueIid: 13, issueTitle: '영어 다른 프로젝트', status: 'success', startedAt: '2026-09-01T00:00:00Z' })
      expect(findIssueIidsByTitle('p1', '영어')).toEqual([12, 10])
      expect(findIssueIidsByTitle('p1', '영어 모드')).toEqual([10])
      expect(findIssueIidsByTitle('p1', '100%')).toEqual([]) // LIKE 와일드카드는 문자 그대로
    })
  })
})
