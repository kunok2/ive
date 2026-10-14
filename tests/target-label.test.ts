/**
 * 대상 라벨(IVE)과 단계 라벨을 함께 달지 않는다.
 *
 * 단계 라벨이 곧 IVE 관리 표시라, IVE 가 단계 라벨을 붙일 때 대상 라벨을 뗀다.
 *   L-1: 단계 라벨만 있어도 IVE 관리 이슈다(stageFromLabels 가 단계를 판정한다). 예전 이슈(둘 다)도 그대로.
 *   L-2: 단계 라벨을 붙이는 전이는 대상 라벨을 뗀다 — 모든 TRANSITIONS 에서 결과에 IVE 와 단계 라벨이 같이 남지 않는다.
 *   L-3: 단계 라벨을 떼기만 하는 전이(유입으로)는 대상 라벨을 붙인다 — 라벨이 다 빠져 이슈를 놓치지 않게.
 *   L-4: 이력 탭 — GitLab 은 OR 이 없어 (IVE) + (IVE-E 이면서 IVE 아님) 두 조회를 합친다, GitHub 은 Search API 의 쉼표 OR.
 */
import { describe, it, expect, vi, afterEach } from 'vitest'
import { TRANSITIONS, allStageLabels, staleStageLabelsToRemove, withTargetLabelSwap, isIveManaged } from '@/lib/stage-transitions'
import { stageFromLabels } from '@/lib/db/issues'
import { fetchClosedProjectIssuesPage as gitlabPage } from '@/lib/gitlab/issues'
import { fetchClosedProjectIssuesPage as githubPage } from '@/lib/github/issues'
import type { Project } from '@/types'

const project = {
  id: 'p1', provider: 'gitlab', repoUrl: 'https://gitlab.com/acme/shop', authType: 'token',
  labelTarget: 'ive', labelSchedule: 'ive:todo', labelDev: 'ive:doing',
  labelVerifyWait: 'ive:verify-wait', labelVerify: 'ive:verifying',
  labelConfirmWait: 'ive:confirm-wait', labelConfirm: 'ive:confirming',
  labelEnd: 'ive:done', labelNotify: 'ive:notify',
} as unknown as Project

describe('L-1 관리 대상 판정', () => {
  it('단계 라벨만 있어도 관리 이슈, 단계 판정도 된다', () => {
    expect(isIveManaged(['ive:done'], project)).toBe(true)
    expect(stageFromLabels(['ive:done'], project)).toBe('done')
    expect(stageFromLabels(['ive:verify-wait', 'bug'], project)).toBe('verify_waiting')
  })
  it('예전 이슈(대상+단계)도 그대로', () => {
    expect(stageFromLabels(['ive', 'ive:done'], project)).toBe('done')
  })
  it('대상 라벨만 = 관리 이슈, 단계 없음 / 둘 다 없으면 관리 밖', () => {
    expect(isIveManaged(['ive'], project)).toBe(true)
    expect(stageFromLabels(['ive'], project)).toBeNull()
    expect(isIveManaged(['bug', 'ive:notify'], project)).toBe(false)
  })
})

/** 전이를 라벨 집합에 적용 — 화면 단계 버튼·stage-apply 와 같은 계산 + swapIssueLabels 의 대상 라벨 정리 */
function apply(labels: string[], stage: string, action: string): string[] {
  const t = TRANSITIONS[stage].find(x => x.action === action)!
  const addL = t.addLabels(project)
  const keep = addL[0] || ''
  const removeL = keep ? [...new Set([...t.removeLabels(project), ...staleStageLabelsToRemove(project, keep)])] : t.removeLabels(project)
  const { add, remove } = withTargetLabelSwap(project, addL, removeL)
  const rm = remove.filter(l => !add.includes(l))
  return [...new Set([...labels.filter(l => !rm.includes(l)), ...add])]
}

describe('L-2/L-3 전이 후 라벨', () => {
  const stages = allStageLabels(project)
  for (const [stage, list] of Object.entries(TRANSITIONS)) {
    for (const t of list) {
      it(`${stage}.${t.action}: 대상 라벨과 단계 라벨이 함께 남지 않고, 관리 이슈로 남는다`, () => {
        // 예전 이슈(대상 라벨 있음)와 새 이슈(없음) 둘 다
        for (const start of [['ive', 'bug'], ['bug']]) {
          const after = apply(start, stage, t.action)
          const stageCount = after.filter(l => stages.includes(l)).length
          expect(stageCount).toBeLessThanOrEqual(1)
          expect(after.includes('ive') && stageCount > 0).toBe(false)
          expect(isIveManaged(after, project)).toBe(true)
          expect(after).toContain('bug')
        }
      })
    }
  }
  it('유입 → 스케줄: ive 를 떼고 ive:todo', () => {
    expect(apply(['ive'], 'none', 'schedule').sort()).toEqual(['ive:todo'])
  })
  it('검증대기 → 유입: ive:verify-wait 를 떼고 ive 를 붙인다', () => {
    expect(apply(['ive:verify-wait'], 'verify_waiting', 'to_inflow')).toEqual(['ive'])
  })
})

describe('L-4 이력 탭: 대상 라벨 OR 종료 라벨', () => {
  afterEach(() => vi.unstubAllGlobals())

  it('GitLab: 겹치지 않는 두 조회를 갱신순으로 합쳐 한 페이지', async () => {
    const fn = vi.fn(async (url: string) => {
      const u = new URL(url)
      const body = u.searchParams.get('labels') === 'ive'
        ? [{ iid: 1, updated_at: '2026-10-05T00:00:00Z' }, { iid: 2, updated_at: '2026-10-01T00:00:00Z' }]
        : [{ iid: 3, updated_at: '2026-10-03T00:00:00Z' }]
      return new Response(JSON.stringify(body), { headers: { 'x-total': String(body.length), 'x-next-page': '' } })
    })
    vi.stubGlobal('fetch', fn)
    const r = await gitlabPage(project, 't', { page: 1, perPage: 2, sort: 'desc', label: 'ive', orLabel: 'ive:done' })
    const urls = fn.mock.calls.map(c => new URL(String(c[0])))
    expect(urls).toHaveLength(2)
    const second = urls.find(u => u.searchParams.get('labels') === 'ive:done')!
    expect(second.searchParams.get('not[labels]')).toBe('ive')
    expect(r.issues.map((i: { iid: number }) => i.iid)).toEqual([1, 3])
    expect(r.total).toBe(3)
    expect(r.hasMore).toBe(true)
  })

  it('GitLab: 단계 라벨만 달고 닫힌 이슈도 — 라벨마다 앞선 라벨을 뺀 조회', async () => {
    const fn = vi.fn(async () => new Response('[]', { headers: { 'x-total': '0', 'x-next-page': '' } }))
    vi.stubGlobal('fetch', fn)
    await gitlabPage(project, 't', { page: 1, perPage: 2, sort: 'desc', label: 'ive', orLabel: 'ive:done', orLabels: ['ive:confirm-wait', 'ive:done'] })
    const urls = fn.mock.calls.map(c => new URL(String((c as unknown[])[0])))
    expect(urls.map(u => [u.searchParams.get('labels'), u.searchParams.get('not[labels]')])).toEqual([
      ['ive', null], ['ive:done', 'ive'], ['ive:confirm-wait', 'ive,ive:done'],
    ])
  })

  it('GitHub: Search API 한 번, label:"ive","ive:done"', async () => {
    const fn = vi.fn().mockResolvedValue(new Response(JSON.stringify({ total_count: 0, items: [] })))
    vi.stubGlobal('fetch', fn)
    await githubPage({ ...project, provider: 'github', repoUrl: 'https://github.com/acme/shop' } as Project, 't',
      { page: 1, perPage: 50, sort: 'desc', label: 'ive', orLabel: 'ive:done' })
    expect(fn).toHaveBeenCalledOnce()
    const u = new URL(String(fn.mock.calls[0][0]))
    expect(u.pathname).toBe('/search/issues')
    expect(u.searchParams.get('q')).toBe('repo:acme/shop is:issue is:closed label:"ive","ive:done"')
  })
})
