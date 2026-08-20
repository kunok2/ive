// AI 구독(정액) 실지출 산정.
//
// exec 의 cost_usd 는 "종량제 API 였다면 청구되었을 금액"(명목가)이다. 정액 구독을 쓰면
// 실지출은 사용량과 무관한 월 구독료이므로, 명목가를 총원가에 넣으면 수십 배로 부풀려진다
// (운영 2026-08: 구독 $200 인데 cost_usd 합계 $16,919). 여기서는 월 요금 → 기간 일할 환산과
// 토큰 비례 배부가 맞는지 고정한다.
import { describe, it, expect } from 'vitest'
import { subscriptionCostForPeriod, cliFromModelName } from '../src/lib/ai-subscription'

describe('subscriptionCostForPeriod — 월 요금 → 보고 기간 환산', () => {
  it('8월 한 주(7일)는 월 요금의 7/31', () => {
    const v = subscriptionCostForPeriod(200, '2026-08-10T00:00:00+09:00', '2026-08-17T00:00:00+09:00')
    expect(v).toBeCloseTo(200 * 7 / 31, 6)   // $45.16
  })

  it('2월 한 주(7일)는 월 요금의 7/28 — 달 길이를 반영한다', () => {
    const v = subscriptionCostForPeriod(200, '2026-02-02T00:00:00+09:00', '2026-02-09T00:00:00+09:00')
    expect(v).toBeCloseTo(200 * 7 / 28, 6)   // $50.00
  })

  it('월 경계를 넘는 주는 각 달의 일수로 나눠 더한다', () => {
    // 1/29~2/5 → 1월분 3일(/31) + 2월분 4일(/28). "기간일수/30" 같은 근사와 다르다.
    const v = subscriptionCostForPeriod(200, '2026-01-29T00:00:00+09:00', '2026-02-05T00:00:00+09:00')
    expect(v).toBeCloseTo(200 * 3 / 31 + 200 * 4 / 28, 6)
  })

  it('한 달 전체는 정확히 월 요금', () => {
    const v = subscriptionCostForPeriod(200, '2026-08-01T00:00:00+09:00', '2026-09-01T00:00:00+09:00')
    expect(v).toBeCloseTo(200, 6)
  })

  it('요금 미설정(0)이거나 기간이 뒤집히면 0', () => {
    expect(subscriptionCostForPeriod(0, '2026-08-01T00:00:00+09:00', '2026-08-08T00:00:00+09:00')).toBe(0)
    expect(subscriptionCostForPeriod(200, '2026-08-08T00:00:00+09:00', '2026-08-01T00:00:00+09:00')).toBe(0)
  })
})

describe('cliFromModelName — 툴 직접개발 exec 의 CLI 역추적', () => {
  it.each([
    ['claude-opus-5', 'claude'],
    ['claude-fable-5', 'claude'],
    ['claude-opus-4-8', 'claude'],
    ['gemini-2.5-pro', 'gemini'],
    ['gpt-4.1', 'codex'],
    ['o3', 'codex'],
    ['알수없는모델', null],
    ['', null],
  ])('%s → %s', (model, expected) => {
    expect(cliFromModelName(model)).toBe(expected)
  })
})
