/**
 * fetchGitHubPRByBranch — 「PR 없음」과 「조회 실패」 구분
 *
 * 중요한 로직:
 *   작업 상세의 코드 리뷰·머지 영역은 /mr API 가 PR 을 돌려줄 때만 보인다.
 *   /mr 은 접속자 토큰으로 먼저 조회하고, 실패(throw)하면 프로젝트 토큰으로 다시 조회한다(withGitToken).
 *   조회 실패를 null 로 삼키면 재시도가 걸리지 않아 PR 이 있어도 버튼이 통째로 사라진다.
 *
 * 불변식:
 *   P-1: PR 이 없으면(200 + 빈 목록) null
 *   P-2: 조회 실패(401/403/404/5xx)는 throw — GitHub 은 권한 없는 비공개 저장소에 404 를 준다
 *   P-3: 접속자 토큰이 실패하면 프로젝트 토큰으로 다시 조회해 PR 을 찾는다
 *   P-4: getGitHubPR(스캐너 PR 생성 경로)은 종전대로 실패를 null 로 돌려준다
 */
import { describe, it, expect, vi, afterEach } from 'vitest'
import { fetchGitHubPRByBranch, getGitHubPR } from '@/lib/github'
import type { Project } from '@/types'

const project = { name: 'demo', provider: 'github', repoUrl: 'https://github.com/acme/demo.git', authType: 'token' } as Project

const pr = { number: 7, id: 70, title: 'fix', state: 'open', head: { ref: 'dev-12', sha: 'abc' }, base: { ref: 'main' }, html_url: 'https://github.com/acme/demo/pull/7' }
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, statusText: status === 404 ? 'Not Found' : 'OK' })

afterEach(() => { vi.unstubAllGlobals() })

describe('fetchGitHubPRByBranch', () => {
  it('P-1: PR 이 없으면 null', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => json([])))
    expect(await fetchGitHubPRByBranch(project, 't', 'dev-12')).toBeNull()
  })

  it('열린 PR 이 없으면 닫힌(머지된) PR 을 찾는다', async () => {
    const fetchMock = vi.fn(async (url: string) => json(url.includes('state=closed') ? [{ ...pr, state: 'closed', merged_at: '2026-10-01T00:00:00Z' }] : []))
    vi.stubGlobal('fetch', fetchMock)
    const found = await fetchGitHubPRByBranch(project, 't', 'dev-12')
    expect(found?.state).toBe('merged')
    expect(String(fetchMock.mock.calls[0][0])).toContain(`head=${encodeURIComponent('acme:dev-12')}`)
  })

  it.each([401, 403, 404, 500])('P-2: %i 응답은 throw', async (status) => {
    vi.stubGlobal('fetch', vi.fn(async () => json({ message: 'x' }, status)))
    await expect(fetchGitHubPRByBranch(project, 't', 'dev-12')).rejects.toThrow(String(status))
  })

  it('P-3: 접속자 토큰이 404 면 프로젝트 토큰으로 다시 조회한다', async () => {
    vi.stubGlobal('fetch', vi.fn(async (_url: string, init: { headers: Record<string, string> }) =>
      init.headers.Authorization === 'Bearer user' ? json({ message: 'Not Found' }, 404) : json([pr])))
    // withGitToken 의 재시도 규칙 그대로 — 접속자 토큰 실패(throw) 시 프로젝트 토큰
    const lookup = (token: string) => fetchGitHubPRByBranch(project, token, 'dev-12')
    const found = await lookup('user').catch(() => lookup('project'))
    expect(found?.iid).toBe(7)
  })

  it('P-4: getGitHubPR 은 실패를 null 로 돌려준다', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {})
    vi.stubGlobal('fetch', vi.fn(async () => json({ message: 'x' }, 500)))
    expect(await getGitHubPR(project, 't', 'dev-12')).toBeNull()
  })
})
