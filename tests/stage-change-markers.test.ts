import { describe, it, expect } from 'vitest'
import { markersForStageChange } from '../src/lib/stage-transitions'

/**
 * 에이전트가 glab/gh 로 라벨을 옮겨 검증·확인을 진행하는 경로의 회귀 테스트.
 * 종전 스캐너는 verifying → confirm_waiting(정상 승인)을 "반려"로 기록했다.
 */
describe('markersForStageChange', () => {
  it('검증 시작: 임의 단계 → verifying', () => {
    const m = markersForStageChange('verify_waiting', 'verifying')
    expect(m.verifyStarted).toBe(true)
    expect(m.verified).toBe(false)
    expect(m.rejected).toBe(false)
  })

  it('검증 중 재스캔은 시작을 다시 찍지 않는다', () => {
    expect(markersForStageChange('verifying', 'verifying').verifyStarted).toBe(false)
  })

  it('승인: verifying → confirm_waiting (종전엔 반려로 기록되던 회귀)', () => {
    const m = markersForStageChange('verifying', 'confirm_waiting')
    expect(m.verified).toBe(true)
    expect(m.rejected).toBe(false)
  })

  it('승인: verifying → confirming / done 도 승인', () => {
    expect(markersForStageChange('verifying', 'confirming').verified).toBe(true)
    expect(markersForStageChange('verifying', 'done').verified).toBe(true)
    expect(markersForStageChange('verifying', 'confirming').rejected).toBe(false)
    expect(markersForStageChange('verifying', 'done').rejected).toBe(false)
  })

  it('반려: verifying → waiting / verify_waiting / 라벨제거(null)', () => {
    for (const next of ['waiting', 'verify_waiting', null]) {
      const m = markersForStageChange('verifying', next)
      expect(m.rejected, `→ ${next}`).toBe(true)
      expect(m.verified, `→ ${next}`).toBe(false)
    }
  })

  it('확인 시작: 임의 단계 → confirming', () => {
    const m = markersForStageChange('confirm_waiting', 'confirming')
    expect(m.confirmStarted).toBe(true)
    expect(m.confirmed).toBe(false)
    expect(markersForStageChange('confirming', 'confirming').confirmStarted).toBe(false)
  })

  it('확인 완료: confirming/confirm_waiting → done', () => {
    expect(markersForStageChange('confirming', 'done').confirmed).toBe(true)
    expect(markersForStageChange('confirm_waiting', 'done').confirmed).toBe(true)
  })

  it('검증에서 곧장 완료로 건너뛴 것은 확인으로 치지 않는다', () => {
    const m = markersForStageChange('verifying', 'done')
    expect(m.verified).toBe(true)
    expect(m.confirmed).toBe(false)
  })

  it('무관한 전이는 아무 마커도 찍지 않는다', () => {
    const m = markersForStageChange('waiting', 'dev')
    expect(Object.values(m).every(v => v === false)).toBe(true)
  })
})
