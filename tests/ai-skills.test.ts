import { describe, it, expect, vi, beforeEach } from 'vitest'
import type { Project } from '@/types'
import { generateIveSkills, generateIveRoutineFiles } from '@/lib/ai-skills'

const files: Record<string, string | null> = {}
const upserts: { path: string; content: string }[] = []
vi.mock('@/lib/provider', async (orig) => ({
  ...(await orig<typeof import('@/lib/provider')>()),
  getDefaultBranch: async () => 'main',
  readRepoFile: async (_p: Project, _t: string, path: string) => (files[path] == null ? null : { content: files[path] }),
  createBranch: async () => true,
  upsertRepoFile: async (_p: Project, _t: string, path: string, content: string) => { upserts.push({ path, content }); return { created: true, updated: false, unchanged: false } },
  createMR: async () => ({ web_url: 'https://git/mr/1' }),
}))
import { installAiGuide } from '@/lib/ai-guide'

const gl = {
  id: 'p', name: 'P', provider: 'gitlab', repoUrl: 'https://gitlab.com/kojoung/dazzlepf.git',
  labelTarget: 'ive', labelSchedule: 'ive:todo', labelDev: 'ive:doing', labelVerifyWait: 'ive:verify-wait',
  labelVerify: 'ive:verifying', labelConfirmWait: 'ive:confirm-wait', labelConfirm: 'ive:confirming', labelEnd: 'ive:done',
  baseBranch: 'staging',
} as unknown as Project
const gh = { ...gl, provider: 'github', repoUrl: 'https://github.com/acme/shop', baseBranch: undefined } as unknown as Project

describe('IVE 스킬 생성', () => {
  it('3종이 front matter 와 프로젝트 레이블·저장소로 채워진다 (GitLab)', () => {
    const sk = generateIveSkills(gl)
    expect(sk.map(s => s.path)).toEqual(['.claude/skills/ive-handle/SKILL.md', '.claude/skills/ive-verify/SKILL.md', '.claude/skills/ive-confirm/SKILL.md'])
    for (const s of sk) {
      expect(s.content.startsWith('---\nname: ive-')).toBe(true)
      expect(s.content).not.toMatch(/\$\{|undefined/)
    }
    expect(sk[0].content).toContain('projects/kojoung%2Fdazzlepf/issues/<번호>')
    expect(sk[0].content).toContain('remove_labels=ive:todo')
    expect(sk[1].content).toContain('`staging`')
    expect(sk[2].content).toContain('add_labels=ive:done')
    expect(sk[0].content).toContain('## 처리 루틴')
    expect(sk[0].content).toContain('Monitor')
    expect(sk[1].content).toContain('## 검증 루틴')
    expect(sk[2].content).not.toContain('/loop')
  })
  it('GitHub 은 gh 명령을 쓰고 목표 브랜치 미등록이면 묻게 한다', () => {
    const sk = generateIveSkills(gh)
    expect(sk[0].content).toContain('gh issue edit <번호> -R acme/shop')
    expect(sk[1].content).toContain('gh pr merge')
    expect(sk[1].content).toContain('사용자에게 어느 브랜치')
    expect(sk[2].content).toContain('.ive-assets/')
  })
})

describe('스킬 설치', () => {
  beforeEach(() => { upserts.length = 0; for (const k of Object.keys(files)) delete files[k] })
  it('설치하면 가이드·배너·훅·스킬 3종이 한 번에 올라간다', async () => {
    await installAiGuide(gl, 't')
    const paths = upserts.map(u => u.path)
    for (const p of ['CLAUDE.md', '.claude/ive-banner.json', '.claude/ive-banner-chat.json', '.claude/settings.json', '.claude/skills/ive-handle/SKILL.md', '.claude/skills/ive-verify/SKILL.md', '.claude/skills/ive-confirm/SKILL.md']) expect(paths).toContain(p)
  })
  it('레이블 갱신은 이미 있는 스킬만 고친다', async () => {
    files['CLAUDE.md'] = '<!-- ive:begin -->\nx\n<!-- ive:end -->'
    files['.claude/skills/ive-handle/SKILL.md'] = 'old'
    await installAiGuide(gl, 't', { onlyInstalled: true, reason: 'labels' })
    const paths = upserts.map(u => u.path)
    expect(paths).toContain('.claude/skills/ive-handle/SKILL.md')
    expect(paths).not.toContain('.claude/skills/ive-verify/SKILL.md')
    expect(paths).not.toContain('.claude/ive-banner.json')
  })
})

describe('IVE 구간은 요약만, 본문은 스킬로', () => {
  beforeEach(() => { upserts.length = 0; for (const k of Object.keys(files)) delete files[k] })
  it('CLAUDE.md 구간은 작고 긴 본문은 ive-register·ive-stages 에 있다', async () => {
    await installAiGuide(gl, 't')
    const guide = upserts.find(u => u.path === 'CLAUDE.md')!.content
    expect(guide.length).toBeLessThan(5000)
    expect(guide).toContain('ive-register')
    expect(guide).not.toContain('ive-meta\nmodel:')
    const reg = upserts.find(u => u.path === '.claude/skills/ive-register/SKILL.md')!.content
    const st = upserts.find(u => u.path === '.claude/skills/ive-stages/SKILL.md')!.content
    expect(reg.startsWith('---\nname: ive-register')).toBe(true)
    expect(reg).toContain('<!-- ive-meta')
    expect(st.startsWith('---\nname: ive-stages')).toBe(true)
    expect(st).toContain('stage: verify')
    expect(`${reg}${st}`).not.toMatch(/\$\{|undefined/)
  })
  it('레이블 갱신에서도 요약이 가리키는 스킬은 없으면 만든다', async () => {
    files['CLAUDE.md'] = '<!-- ive:begin -->\nx\n<!-- ive:end -->'
    await installAiGuide(gl, 't', { onlyInstalled: true, reason: 'labels' })
    const paths = upserts.map(u => u.path)
    expect(paths).toContain('.claude/skills/ive-register/SKILL.md')
    expect(paths).toContain('.claude/skills/ive-stages/SKILL.md')
  })
})

describe('루틴 비용 절감 부품', () => {
  beforeEach(() => { upserts.length = 0; for (const k of Object.keys(files)) delete files[k] })
  it('루틴은 /loop 가 아니라 폴러 Monitor 와 ive-worker 로 돈다', () => {
    const [h, v] = generateIveSkills(gl)
    for (const s of [h, v]) {
      expect(s.content).toContain('.claude/ive-routine-poll.sh')
      expect(s.content).toContain('subagent_type=ive-worker')
      expect(s.content).not.toContain('/loop 5m')
    }
    expect(h.content).toContain('ive-routine-poll.sh ive:todo 60 mine')
    expect(v.content).toContain('ive-routine-poll.sh ive:verify-wait 60 any')
  })
  it('폴러는 저장소·제공자를 박아 넣고 ive-worker 는 도구를 좁힌다', () => {
    const [gp, gw] = generateIveRoutineFiles(gl)
    expect(gp.content).toContain('projects/kojoung%2Fdazzlepf/issues')
    expect(gp.content).toContain('${1:?')
    expect(gw.content).toMatch(/tools: Bash, Read, Edit, Write, Grep, Glob\n/)
    const [hp] = generateIveRoutineFiles(gh)
    expect(hp.content).toContain('gh issue list -R acme/shop')
  })
  it('설치하면 폴러와 ive-worker 도 올라간다', async () => {
    await installAiGuide(gl, 't')
    const paths = upserts.map(u => u.path)
    expect(paths).toContain('.claude/ive-routine-poll.sh')
    expect(paths).toContain('.claude/agents/ive-worker.md')
  })
})
