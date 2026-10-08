// 프로젝트 설정에서 단계 레이블 이름을 바꾸면 저장소 레이블도 «이름 변경»한다 — 붙어 있는 이슈가 따라오게.
// 설정만 바꾸면 저장소엔 옛 레이블이 남고 이슈도 옛 이름이라 IVE 가 못 본다(2026-10-08 Meta-Shop·IVE 이전 때 손으로 한 절차).
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import type { Project } from '@/types'
import { LEGACY_LABELS, DEFAULT_LABELS } from '@/lib/labels'

const renameLabel = vi.fn()
vi.mock('@/lib/provider', async (orig) => ({
  ...(await orig<typeof import('@/lib/provider')>()),
  renameLabel: (...a: unknown[]) => renameLabel(...a),
}))

import { diffLabels, labelChangeProblem, renameRepoLabels } from '@/lib/label-rename'
import { renameGitHubLabel } from '@/lib/github/labels'
import { renameGitLabLabel } from '@/lib/gitlab/labels'

const legacy = {
  labelTarget: LEGACY_LABELS.target, labelSchedule: LEGACY_LABELS.schedule, labelDev: LEGACY_LABELS.dev,
  labelVerifyWait: LEGACY_LABELS.verifyWait, labelVerify: LEGACY_LABELS.verify, labelConfirmWait: LEGACY_LABELS.confirmWait,
  labelConfirm: LEGACY_LABELS.confirm, labelEnd: LEGACY_LABELS.end, labelNotify: LEGACY_LABELS.notify,
}
const project = { id: 'p', provider: 'gitlab', repoUrl: 'https://gitlab.com/g/r', authType: 'token', ...legacy } as unknown as Project
const allNew = {
  labelTarget: DEFAULT_LABELS.target, labelSchedule: DEFAULT_LABELS.schedule, labelDev: DEFAULT_LABELS.dev,
  labelVerifyWait: DEFAULT_LABELS.verifyWait, labelVerify: DEFAULT_LABELS.verify, labelConfirmWait: DEFAULT_LABELS.confirmWait,
  labelConfirm: DEFAULT_LABELS.confirm, labelEnd: DEFAULT_LABELS.end, labelNotify: DEFAULT_LABELS.notify,
}

describe('바뀐 레이블 판정', () => {
  it('이름이 달라진 칸만 — 빈 칸·같은 값·레이블 아닌 필드는 빼고', () => {
    const c = diffLabels(project, { labelVerifyWait: 'ive:verify-wait', labelVerify: 'IVE-V', labelEnd: '  ', name: 'x' } as never)
    expect(c).toEqual([{ field: 'labelVerifyWait', from: 'IVE-W', to: 'ive:verify-wait' }])
  })
  it('레이블을 안 보낸 저장(스캐너 켜기 등)은 바뀐 것 없음', () => {
    expect(diffLabels(project, { scannerActive: true } as never)).toEqual([])
  })
  it('전체 새 이름으로 — 9칸 모두', () => {
    expect(diffLabels(project, allNew)).toHaveLength(9)
    expect(labelChangeProblem(project, allNew, diffLabels(project, allNew))).toBeNull()
  })
  it('두 칸에 같은 이름이면 막는다', () => {
    const body = { labelVerify: 'IVE-W' }
    expect(labelChangeProblem(project, body, diffLabels(project, body))).toMatch(/두 칸/)
  })
  it('다른 단계의 지금 이름으로 바꾸는 맞바꾸기는 막는다', () => {
    const body = { labelVerify: 'IVE-W', labelVerifyWait: 'IVE-V' }
    expect(labelChangeProblem(project, body, diffLabels(project, body))).toMatch(/맞바꾸/)
  })
})

describe('저장소 이름 변경 — 실패하면 되돌린다', () => {
  beforeEach(() => renameLabel.mockReset())
  it('모두 성공하면 바꾼 것만 돌려준다(이미 바뀐 것·없는 것은 빼고)', async () => {
    renameLabel.mockResolvedValueOnce('renamed').mockResolvedValueOnce('already').mockResolvedValueOnce('absent')
    const changes = diffLabels(project, { labelSchedule: 'a', labelDev: 'b', labelVerifyWait: 'c' })
    const { renamed } = await renameRepoLabels(project, 't', changes)
    expect(renamed.map(c => c.to)).toEqual(['a'])
  })
  it('중간에 실패하면 앞서 바꾼 것을 원래 이름으로 되돌리고 예외', async () => {
    renameLabel
      .mockResolvedValueOnce('renamed')          // IVE-S → a
      .mockResolvedValueOnce('renamed')          // IVE-D → b
      .mockRejectedValueOnce(new Error('둘 다 있음')) // IVE-W → c
      .mockResolvedValue('renamed')              // 되돌리기
    const changes = diffLabels(project, { labelSchedule: 'a', labelDev: 'b', labelVerifyWait: 'c' })
    await expect(renameRepoLabels(project, 't', changes)).rejects.toThrow(/둘 다 있음.*되돌렸습니다/)
    expect(renameLabel.mock.calls.slice(3).map(c => [c[2], c[3]])).toEqual([['b', 'IVE-D'], ['a', 'IVE-S']])
  })
})

// ── provider 이름 변경 (fetch 가짜) ──
type L = { id: number; name: string; is_project_label?: boolean }
function mockRepo(labels: L[]) {
  const calls: { method: string; url: string; body?: any }[] = []
  ;(globalThis as any).fetch = async (u: string, init?: any) => {
    const method = init?.method || 'GET'
    calls.push({ method, url: u, body: init?.body ? JSON.parse(init.body) : undefined })
    if (method === 'GET') {
      const page = Number(new URL(u).searchParams.get('page') || 1)
      return new Response(JSON.stringify(page === 1 ? labels : []), { status: 200 })
    }
    return new Response('{}', { status: 200 })
  }
  return calls
}
const realFetch = globalThis.fetch
afterEach(() => { globalThis.fetch = realFetch })
const gh = { ...project, provider: 'github', repoUrl: 'https://github.com/o/r' } as Project

describe('GitHub 레이블 이름 변경', () => {
  it('옛 이름만 있으면 PATCH 로 이름 변경', async () => {
    const calls = mockRepo([{ id: 1, name: 'IVE-W' }])
    expect(await renameGitHubLabel(gh, 't', 'IVE-W', 'ive:verify-wait')).toBe('renamed')
    const p = calls.find(c => c.method === 'PATCH')!
    expect(p.url).toMatch(/\/labels\/IVE-W$/)
    expect(p.body).toEqual({ new_name: 'ive:verify-wait' })
  })
  it('대소문자만 다른 이름(IVE → ive)도 바꾼다 — GitHub 은 같은 레이블로 본다', async () => {
    const calls = mockRepo([{ id: 1, name: 'IVE' }])
    expect(await renameGitHubLabel(gh, 't', 'IVE', 'ive')).toBe('renamed')
    expect(calls.some(c => c.method === 'PATCH')).toBe(true)
  })
  it('새 이름만 있으면 이미 바뀐 것', async () => {
    mockRepo([{ id: 1, name: 'ive:verify-wait' }])
    expect(await renameGitHubLabel(gh, 't', 'IVE-W', 'ive:verify-wait')).toBe('already')
  })
  it('둘 다 없으면 absent(만들지 않는다)', async () => {
    const calls = mockRepo([])
    expect(await renameGitHubLabel(gh, 't', 'IVE-W', 'ive:verify-wait')).toBe('absent')
    expect(calls.every(c => c.method === 'GET')).toBe(true)
  })
  it('둘 다 있으면 합칠 수 없어 예외', async () => {
    mockRepo([{ id: 1, name: 'IVE-W' }, { id: 2, name: 'ive:verify-wait' }])
    await expect(renameGitHubLabel(gh, 't', 'IVE-W', 'ive:verify-wait')).rejects.toThrow(/둘 다/)
  })
})

describe('GitLab 레이블 이름 변경', () => {
  it('프로젝트 레이블은 id 로 PUT new_name', async () => {
    const calls = mockRepo([{ id: 77, name: 'IVE-W', is_project_label: true }])
    expect(await renameGitLabLabel(project, 't', 'IVE-W', 'ive:verify-wait')).toBe('renamed')
    const p = calls.find(c => c.method === 'PUT')!
    expect(p.url).toMatch(/\/labels\/77$/)
    expect(p.body).toEqual({ new_name: 'ive:verify-wait' })
  })
  it('그룹 레이블은 프로젝트에서 못 바꿔 예외', async () => {
    mockRepo([{ id: 77, name: 'IVE-W', is_project_label: false }])
    await expect(renameGitLabLabel(project, 't', 'IVE-W', 'ive:verify-wait')).rejects.toThrow(/그룹 레이블/)
  })
  it('GitLab 은 대소문자를 가린다 — IVE 와 ive 는 다른 레이블', async () => {
    mockRepo([{ id: 1, name: 'IVE', is_project_label: true }, { id: 2, name: 'ive', is_project_label: true }])
    await expect(renameGitLabLabel(project, 't', 'IVE', 'ive')).rejects.toThrow(/둘 다/)
  })
})
