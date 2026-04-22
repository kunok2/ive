/**
 * prompt-builder 골든 테스트 (GitLab 인증 헤더 + 에이전트 마커 지시)
 *
 * 중요한 로직:
 *   에이전트에게 프롬프트로 "어떤 헤더로 GitLab API 를 호출할지" 지시한다.
 *   OAuth 토큰이면 Bearer, PAT 이면 PRIVATE-TOKEN. 틀리면 401 → 에이전트가
 *   "토큰 만료"로 오해하고 glab CLI fallback 같은 헛수고를 한다.
 *
 *   또한 에이전트가 직접 쓴 코멘트가 IVE UI 에서 에이전트 이름으로 표시되려면
 *   매 코멘트 최상단에 `<!-- ive-agent:{agentId} -->` 를 삽입하라는 지시가 있어야 한다.
 *
 * 불변식:
 *   P-1: isOAuthToken=true 이면 프롬프트에 `Authorization: Bearer $IVE_GITLAB_TOKEN` 포함
 *   P-2: isOAuthToken=true 이면 PRIVATE-TOKEN 은 "쓰지 말라" 경고 포함
 *   P-3: isOAuthToken=false (기본) 이면 `PRIVATE-TOKEN: $IVE_GITLAB_TOKEN` 포함
 *   P-4: GitHub 프로젝트는 Bearer 고정 (둘 다 같은 헤더)
 *   P-5: agentId 제공 시 `<!-- ive-agent:{id} -->` 지시 포함
 *   P-6: agentId 없으면 마커 지시 없음 (conflict 작업 등)
 */
import { describe, it, expect } from 'vitest'
import { buildPrompt } from '@/lib/scanner/prompt-builder'
import type { Project } from '@/types'

function makeProject(opts: { provider?: 'github' | 'gitlab'; repoUrl?: string } = {}): Project {
  return {
    id: 'p1', userId: 'u1', name: 'Test',
    provider: opts.provider ?? 'gitlab',
    repoUrl: opts.repoUrl ?? 'https://gitlab.com/owner/repo',
    authType: 'token', gitUsername: '', accessToken: '', color: '#4ade80',
    labelTarget: 'IVE', labelSchedule: 'IVE-S', labelDev: 'IVE-D',
    labelVerifyWait: 'IVE-W', labelVerify: 'IVE-V', labelEnd: 'IVE-E',
    showToolUsage: false, checkInterval: 1, scannerActive: false,
    usesOAuthToken: false, sortOrder: 0, avatarUrl: '',
    snapshotInterval: 1, sparklinePoints: 60, statsRetention: 7,
    conflictCount: 0, createdAt: '2026-01-01T00:00:00Z',
  } as any
}

const issue = { title: 'test', description: '' }

describe('buildPrompt — GitLab 인증 헤더 분기', () => {
  it('P-1: isOAuthToken=true → Bearer 헤더 지시', () => {
    const p = buildPrompt(makeProject(), issue, 1, false, false, false, 1, '', '', true, 'agent-1')
    expect(p).toContain('Authorization: Bearer $IVE_GITLAB_TOKEN')
  })

  it('P-2: isOAuthToken=true → PRIVATE-TOKEN 쓰지 말라 경고', () => {
    const p = buildPrompt(makeProject(), issue, 1, false, false, false, 1, '', '', true, 'agent-1')
    expect(p).toContain('Do NOT use `PRIVATE-TOKEN`')
  })

  it('P-3: isOAuthToken=false → PRIVATE-TOKEN 헤더 지시', () => {
    const p = buildPrompt(makeProject(), issue, 1, false, false, false, 1, '', '', false, 'agent-1')
    expect(p).toContain('PRIVATE-TOKEN: $IVE_GITLAB_TOKEN')
    expect(p).not.toContain('Authorization: Bearer $IVE_GITLAB_TOKEN')
  })

  it('P-3b: isOAuthToken 파라미터 미지정 (기본 false) → PAT 헤더', () => {
    const p = buildPrompt(makeProject(), issue, 1, false, false, false, 1, '', '')
    expect(p).toContain('PRIVATE-TOKEN: $IVE_GITLAB_TOKEN')
  })
})

describe('buildPrompt — GitHub 분기', () => {
  it('P-4: GitHub 은 isOAuthToken 무관하게 Bearer 고정', () => {
    const ghProject = makeProject({ provider: 'github', repoUrl: 'https://github.com/owner/repo' })
    const withOAuth = buildPrompt(ghProject, issue, 1, false, true, false, 1, '', '', true, 'agent-1')
    const withPat = buildPrompt(ghProject, issue, 1, false, true, false, 1, '', '', false, 'agent-1')
    expect(withOAuth).toContain('Authorization: Bearer $IVE_GITHUB_TOKEN')
    expect(withPat).toContain('Authorization: Bearer $IVE_GITHUB_TOKEN')
  })
})

describe('buildPrompt — agent 마커 지시', () => {
  it('P-5: agentId 제공 시 ive-agent 마커 지시 포함', () => {
    const p = buildPrompt(makeProject(), issue, 1, false, false, false, 1, '', '', false, 'agent-42')
    expect(p).toContain('<!-- ive-agent:agent-42 -->')
    expect(p).toMatch(/prepend|prepend/i)
  })

  it('P-6: agentId 없으면 ive-agent 지시 없음', () => {
    const p = buildPrompt(makeProject(), issue, 1, false, false, false, 1, '', '', false)
    expect(p).not.toContain('ive-agent:')
  })
})

describe('buildPrompt — 언어 지시', () => {
  it('한국어: isKo=true 면 한국어 지시 포함', () => {
    const p = buildPrompt(makeProject(), issue, 1, false, false, true, 1, '', '', false, 'agent-1')
    expect(p).toContain('한국어')
  })

  it('영어: isKo=false 면 English 지시 포함', () => {
    const p = buildPrompt(makeProject(), issue, 1, false, false, false, 1, '', '', false, 'agent-1')
    expect(p).toContain('English')
  })
})
