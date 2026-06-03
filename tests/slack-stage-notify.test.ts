import { describe, it, expect } from 'vitest'
import { buildStageMessage } from '../src/lib/slack-notify'

const base = {
  iid: 42,
  title: '테스트 이슈',
  iveUrl: 'https://ive.example.com/issues/p1/42',
  webUrl: 'https://gitlab.example.com/g/p/-/issues/42',
  providerLabel: 'GitLab' as const,
}

describe('buildStageMessage', () => {
  it('검증/확인/완료 각 단계 + 제목·번호 포함 (ko)', () => {
    expect(buildStageMessage('verify', 'ko', base)).toContain('검증 요청')
    expect(buildStageMessage('confirm', 'ko', base)).toContain('확인 요청')
    expect(buildStageMessage('done', 'ko', base)).toContain('작업 완료')
    expect(buildStageMessage('verify', 'ko', base)).toContain('#42 "테스트 이슈"')
  })

  it('로케일에 따라 언어 전환 (en)', () => {
    expect(buildStageMessage('verify', 'en', base)).toContain('Verification needed')
    expect(buildStageMessage('confirm', 'en', base)).toContain('Confirmation needed')
    expect(buildStageMessage('done', 'en', base)).toContain('Task complete')
  })

  it('IVE 링크가 provider 링크보다 먼저 온다', () => {
    const msg = buildStageMessage('verify', 'ko', base)
    expect(msg).toContain('• IVE: https://ive.example.com/issues/p1/42')
    expect(msg).toContain('• GitLab: https://gitlab.example.com/g/p/-/issues/42')
    expect(msg.indexOf('• IVE:')).toBeLessThan(msg.indexOf('• GitLab:'))
  })

  it('provider 라벨은 프로젝트 종류를 따른다 (GitHub)', () => {
    const msg = buildStageMessage('done', 'en', { ...base, providerLabel: 'GitHub' })
    expect(msg).toContain('• GitHub: ')
  })

  it('IVE 베이스가 없으면 IVE 줄은 생략되고 provider 링크만', () => {
    const msg = buildStageMessage('verify', 'ko', { ...base, iveUrl: '' })
    expect(msg).not.toContain('• IVE:')
    expect(msg).toContain('• GitLab:')
  })
})
