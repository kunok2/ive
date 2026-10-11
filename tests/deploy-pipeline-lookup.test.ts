// 배포 상태 판정이 staging 브랜치의 «최근 5건» 파이프라인만 보던 것 —
// 실패가 5번 이어지면 그 앞의 성공(지금 배포된 판)과 더 앞 커밋의 파이프라인을 못 찾았다
// (2026-10-11 Meta-Shop: 확인대기 작업의 배포 배지가 비고, 「배포가 한 번도 끝나지 않았다」로 판단).
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import type { Project } from '@/types'

vi.mock('@/lib/db', () => ({ getProjectAutomation: () => ({ staging: {} }) }))

import { fetchDeployedCommit } from '@/lib/staging-config'
import { fetchGitLabBranchPipelines } from '@/lib/gitlab/mr'

const project = { id: 'p', provider: 'gitlab', repoUrl: 'https://gitlab.com/g/r', authType: 'token' } as unknown as Project
// 최신순 — 실행 중 1, 실패 5, 취소 1(old 커밋), 그 앞에 성공
const ALL = [
  { id: 8, status: 'running', sha: 'h8' }, { id: 7, status: 'failed', sha: 'h7' }, { id: 6, status: 'failed', sha: 'h6' },
  { id: 5, status: 'failed', sha: 'h5' }, { id: 4, status: 'failed', sha: 'h4' }, { id: 3, status: 'failed', sha: 'h3' },
  { id: 2, status: 'canceled', sha: 'old' }, { id: 1, status: 'success', sha: 'good' },
]

describe('staging 파이프라인 조회 — 최근 5건 밖', () => {
  beforeEach(() => {
    // GitLab 처럼 status·sha 로 거른 뒤 per_page 만큼만 돌려준다
    vi.stubGlobal('fetch', vi.fn(async (input: unknown) => {
      const q = new URL(String(input)).searchParams
      const rows = ALL.filter(p => (!q.get('status') || p.status === q.get('status')) && (!q.get('sha') || p.sha === q.get('sha')))
      return new Response(JSON.stringify(rows.slice(0, Number(q.get('per_page') || 20))), { status: 200 })
    }))
  })
  afterEach(() => vi.unstubAllGlobals())

  it('조건 없이 읽으면 최근 5건뿐 — 성공도 old 커밋도 없다(종전 판정의 근거)', async () => {
    const recent = await fetchGitLabBranchPipelines(project, 't', 'staging') as { status: string; sha: string }[]
    expect(recent).toHaveLength(5)
    expect(recent.some(p => p.status === 'success' || p.sha === 'old')).toBe(false)
  })

  it('배포된 판 = 실패가 이어져도 마지막으로 성공한 파이프라인의 커밋', async () => {
    const r = await fetchDeployedCommit({ url: 'https://s', versionSource: 'pipeline', versionUrl: '', commitField: 'commit', branch: 'staging', notes: null }, project, 't')
    expect(r).toEqual({ ok: true, value: 'good' })
  })

  it('커밋으로 물으면 목록에서 밀려난 파이프라인도 찾는다', async () => {
    const mine = await fetchGitLabBranchPipelines(project, 't', 'staging', { sha: 'old' }) as { status: string; sha: string }[]
    expect(mine.map(p => p.status)).toEqual(['canceled'])
  })
})
