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
import { buildPrompt, devResultOf, DEV_RESULT_MARKER, DEV_REQUIREMENT_LINES, DEV_REPO_RULES_LINE } from '@/lib/scanner/prompt-builder'
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

// 2026-10-03: 실행마다 시작 코멘트 + 에이전트 결과 코멘트 + IVE 완료 노트가 겹쳐 붙고, 완료 노트엔 처리 중 말까지 실렸다.
//   P-8: 시작·진행 코멘트 지시가 없고, 최종 메시지를 짧은 보고서로 쓰라는 규약이 기본·덮어쓰기 양쪽에 있다
describe('buildPrompt — 결과 노트 규약', () => {
  it('P-8: 시작 코멘트 지시 없음 + 보고서 규약 포함 (기본·덮어쓰기)', () => {
    const base = buildPrompt(makeProject(), issue, 1, false, false, true, 1, '', '', false, 'agent-1')
    const over = buildPrompt(makeProject(), issue, 1, false, false, true, 1, '', '', false, 'agent-1', 0, '- 내 지침')
    for (const p of [base, over]) {
      expect(p).not.toContain('start comment on the issue when you begin')
      expect(p).toContain('do NOT post start, progress or result comments')
      expect(p).toContain('**원인** / **수정** / **검증**')
    }
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

// #1788: 17분에 끝난 수정 뒤로 33분을 브라우저 라이브러리 우회·검사 스크립트 신설에 썼다.
//   P-7: 범위 밖 검사 스크립트 신설·수정 금지 지시
//   P-8: 검증 환경을 우회하지 말고 「확인 못 했다」로 보고하라는 지시
//   P-9: 시간 상한이 있으면 프롬프트에 그 값을 알린다 / 0 이면 알리지 않는다
describe('buildPrompt — 범위·검증 환경·시간 예산 (#1788)', () => {
  it('P-7: 범위 밖 검사 스크립트 작업 금지', () => {
    const p = buildPrompt(makeProject(), issue, 1, false, false, true, 1, '', '')
    expect(p).toContain('Do NOT create or modify shared lint/check scripts')
  })

  it('P-8: 시스템 패키지 설치·우회 금지 + 미검증 명시', () => {
    const p = buildPrompt(makeProject(), issue, 1, false, false, true, 1, '', '')
    expect(p).toContain('Do NOT install system packages')
    expect(p).toContain('확인 못 했다')
  })

  it('P-9: 시간 상한 전달 시 분 단위로 안내, 0 이면 생략', () => {
    const withLimit = buildPrompt(makeProject(), issue, 1, false, false, true, 1, '', '', false, 'a', 40)
    expect(withLimit).toContain('force-stopped after 40 minutes')
    const noLimit = buildPrompt(makeProject(), issue, 1, false, false, true, 1, '', '', false, 'a', 0)
    expect(noLimit).not.toContain('force-stopped')
  })
})

// #1972·#1975 (2026-10-04): 1회차가 요건 4개 중 1개만 하고 끝났는데, 2회차부터 「피드백이 유일한 지시 —
//   원래 요건은 이미 끝났다」를 받아 반려 노트의 증상만 고쳤다. 공용 목록 부품을 바꾸며 쓰는 곳을 훑지 않아 회귀,
//   「IVE 제약이 CLAUDE.md 보다 우선」·「상한 60% 안에 끝내라」로 요건이 남은 채 스스로 끝냈다.
//   P-10: 반복 실행 프롬프트는 원래 요건이 유효하다고 말하고, 「ONLY instruction」「do NOT re-implement」가 없다
//   P-11: 요건 전수·공용 부품 전수·저장소 규칙 적용 줄이 기본·덮어쓰기 양쪽에 있다(덮어쓰기로 못 지운다)
//   P-12: 「CLAUDE.md 보다 우선」·「60% 목표」·「검증이 길면 멈춰라」가 없다
//   P-13: 결과 표시(IVE-RESULT) 지시가 있고, devResultOf 가 마지막 표시를 읽는다
describe('buildPrompt — 요건 완수 (#1972·#1975)', () => {
  const body = { title: 't', description: '요건 1·2·3·4' }
  it('P-10: 반복 실행에서도 원래 요건이 유효', () => {
    const p = buildPrompt(makeProject(), body, 5, false, false, true, 3, '> **검증자**: 반려', '', false, 'a', 40)
    expect(p).not.toContain('ONLY instruction')
    expect(p).not.toContain('do NOT re-implement')
    expect(p).toContain('The original issue below is still in force')
    expect(p).toContain('requirements still in force')
    expect(p).toContain('요건 1·2·3·4')
  })
  it('P-11: 요건·공용 부품 전수·저장소 규칙 줄 (기본·덮어쓰기)', () => {
    const base = buildPrompt(makeProject(), body, 5, false, false, true, 1, '', '', false, 'a', 40)
    const over = buildPrompt(makeProject(), body, 5, false, false, true, 1, '', '', false, 'a', 40, '- 내 지침')
    for (const p of [base, over]) {
      expect(p).toContain(DEV_REQUIREMENT_LINES)
      expect(p).toContain(DEV_REPO_RULES_LINE)
      expect(p).toContain('grep every usage')
    }
  })
  it('P-12: 규칙 무력화·조기 종료 문구 없음', () => {
    const p = buildPrompt(makeProject(), body, 5, false, false, true, 1, '', '', false, 'a', 40)
    expect(p).not.toContain('take precedence over repository instructions')
    expect(p).not.toContain('finish well within')
    expect(p).not.toContain('stop and report what remains unverified')
  })
  it('P-13: 결과 표시 지시 + 읽기', () => {
    const p = buildPrompt(makeProject(), body, 5, false, false, true, 1, '', '', false, 'a', 40)
    expect(p).toContain(`${DEV_RESULT_MARKER} incomplete`)
    expect(devResultOf('…\n**요건 대조**\n- ❌ 2\n\nIVE-RESULT: incomplete')).toBe('incomplete')
    expect(devResultOf('IVE-RESULT: `complete`')).toBe('complete')
    expect(devResultOf('IVE-RESULT: incomplete\n…\nIVE-RESULT: complete')).toBe('complete')
    expect(devResultOf('표시 없음')).toBeNull()
  })
})
