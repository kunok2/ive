import { describe, it, expect } from 'vitest'
import { buildGuestGuide, guideKindOf } from '@/lib/guest-stage-guide'

const labels = { verifying: 'ive:verifying', confirming: 'ive:confirming', confirmWait: 'ive:confirm-wait', verifyWait: 'ive:verify-wait', schedule: 'ive:todo', end: 'ive:done' }

describe('guest stage guide', () => {
  it('검증 중·확인 중만 안내 대상이다', () => {
    expect(guideKindOf('verifying')).toBe('verify')
    expect(guideKindOf('confirming')).toBe('confirm')
    for (const s of ['verify_waiting', 'confirm_waiting', 'dev', 'done', null]) expect(guideKindOf(s as any)).toBeNull()
  })
  it('검증: 통과→확인대기, 반려→처리대기, 담당자 지정 안내', () => {
    const b = buildGuestGuide({ kind: 'verify', isKo: true, username: 'kim', labels, iveUrl: 'https://ive.example/issues/p/1' })
    expect(b).toContain('`ive:verifying` → `ive:confirm-wait`')
    expect(b).toContain('`ive:verifying` → `ive:todo`')
    expect(b).toContain('담당자를 확인할 사람으로')
    expect(b).toContain('담당자를 다시 고칠 사람으로')
    expect(b).toContain('@kim')
    expect(b).toContain('https://ive.example/issues/p/1')
  })
  it('확인: 통과→완료, 반려→검증대기, 영어', () => {
    const b = buildGuestGuide({ kind: 'confirm', isKo: false, username: null, labels, iveUrl: '' })
    expect(b).toContain('`ive:confirming` → `ive:done`')
    expect(b).toContain('`ive:confirming` → `ive:verify-wait`')
    expect(b).toContain('re-verify')
    expect(b).not.toContain('https://')
  })
})
