// 레이블 이름 변경 뒤 가이드 갱신 — IVE 구간이 설치된 파일만 새 이름으로 다시 쓴다(가이드를 안 쓰는 저장소엔 만들지 않는다).
import { describe, it, expect, vi, beforeEach } from 'vitest'
import type { Project } from '@/types'

const files: Record<string, string | null> = {}
const upserts: { path: string; content: string }[] = []
const createMR = vi.fn(async () => ({ web_url: 'https://git/mr/9' }))
vi.mock('@/lib/provider', async (orig) => ({
  ...(await orig<typeof import('@/lib/provider')>()),
  getDefaultBranch: async () => 'main',
  readRepoFile: async (_p: Project, _t: string, path: string) => (files[path] == null ? null : { content: files[path] }),
  createBranch: async () => true,
  upsertRepoFile: async (_p: Project, _t: string, path: string, content: string) => { upserts.push({ path, content }); return { created: false, updated: true, unchanged: false } },
  createMR: (...a: unknown[]) => createMR(...(a as [])),
}))
import { installAiGuide, IVE_MARKER_BEGIN, IVE_MARKER_END } from '@/lib/ai-guide'

const project = {
  id: 'p', name: 'P', provider: 'gitlab', repoUrl: 'https://gitlab.com/g/r',
  labelTarget: 'ive', labelSchedule: 'ive:todo', labelDev: 'ive:doing', labelVerifyWait: 'ive:verify-wait',
  labelVerify: 'ive:verifying', labelConfirmWait: 'ive:confirm-wait', labelConfirm: 'ive:confirming',
  labelEnd: 'ive:done', labelNotify: 'ive:notify',
} as unknown as Project

describe('가이드 갱신 (onlyInstalled)', () => {
  beforeEach(() => { upserts.length = 0; createMR.mockClear(); for (const k of Object.keys(files)) delete files[k] })

  it('IVE 구간이 있는 파일만 새 이름으로 갱신하고, 구간 밖 내용은 그대로', async () => {
    files['CLAUDE.md'] = `# 내 규칙\n\n${IVE_MARKER_BEGIN}\n옛 구간 \`IVE-W\`\n${IVE_MARKER_END}\n\n끝 문단\n`
    files['AGENTS.md'] = '# 에이전트 규칙 (IVE 구간 없음)\n'
    const { mrUrl } = await installAiGuide(project, 't', { onlyInstalled: true, reason: 'labels' })
    expect(upserts.map(u => u.path)).toEqual(['CLAUDE.md'])
    const c = upserts[0].content
    expect(c.startsWith('# 내 규칙')).toBe(true)
    expect(c.trimEnd().endsWith('끝 문단')).toBe(true)
    expect(c).toContain('ive:verify-wait')
    expect(c).not.toContain('`IVE-W`')
    expect(mrUrl).toBe('https://git/mr/9')
    expect((createMR.mock.calls[0] as any)[2].title).toMatch(/단계 레이블 이름 갱신/)
  })

  it('가이드가 하나도 설치돼 있지 않으면 아무것도 만들지 않는다', async () => {
    files['CLAUDE.md'] = '# 내 규칙\n'
    files['AGENTS.md'] = null
    const { mrUrl } = await installAiGuide(project, 't', { onlyInstalled: true, reason: 'labels' })
    expect(upserts).toEqual([])
    expect(mrUrl).toBeNull()
    expect(createMR).not.toHaveBeenCalled()
  })
})
