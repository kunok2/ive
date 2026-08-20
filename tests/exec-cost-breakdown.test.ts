// 실행 1건의 비용 분해(AI/사람) 규칙.
//
// 회귀 방지: 예전에는 assigneeType === 'user' 인 exec 의 AI 비용을 무조건 0 으로 두었다.
// 그 결과 "작업등록해!"(= 이슈 본문 ive-meta)로 편입된 툴 직접개발 건은 리포트에
// 토큰은 합산되는데 AI 비용만 0 으로 찍혀, 같은 화면에서 "토큰 43억 / AI 0원" 이라는
// 자기모순이 났다(2026-08 주간보고서). AI 비용은 assigneeType 이 아니라
// "그 실행이 실제로 소비한 토큰/청구액" 으로 판단한다.
import { describe, it, expect } from 'vitest'
import { resolveExecutionCostBreakdown, computeHumanRate } from '../src/lib/token-pricing'

// 월급 $9,600 · 주5일 8h → 월 9,600분 → 분당 $1
const rate = computeHumanRate(9600, 5, 8)
const base = { inputTokens: 0, outputTokens: 0, costUsd: 0, startedAt: '2026-08-11T09:00:00Z' }

describe('resolveExecutionCostBreakdown', () => {
  it('에이전트 처리: 실측 청구액이 AI 비용, 사람 비용은 0', () => {
    const b = resolveExecutionCostBreakdown({ ...base, id: 'ex-1', assigneeType: 'agent', costUsd: 2.14 }, rate)
    expect(b.ai).toBeCloseTo(2.14)
    expect(b.human).toBe(0)
  })

  it('툴 직접개발(ive-meta): AI 비용이 0 이 아니라 cost_usd 로 잡힌다', () => {
    // work_sec 3600 초 = 60 분 → 사람 $60
    const b = resolveExecutionCostBreakdown(
      { ...base, id: 'ex-ext-p-1-0-x', assigneeType: 'user', costUsd: 48, workSec: 3600 }, rate)
    expect(b.ai).toBeCloseTo(48)      // 회귀 지점: 예전에는 0 이었다
    expect(b.human).toBeCloseTo(60)
    expect(b.total).toBeCloseTo(108)
  })

  it('사용자별 단가 배수는 사람 비용에만 적용된다', () => {
    const b = resolveExecutionCostBreakdown(
      { ...base, id: 'ex-ext-p-1-0-x', assigneeType: 'user', costUsd: 48, workSec: 3600, rateMultiplier: 1.5 }, rate)
    expect(b.ai).toBeCloseTo(48)
    expect(b.human).toBeCloseTo(90)
  })

  it('검증 exec: 토큰·청구액이 없으므로 AI 비용은 0, 근무시간만 사람 비용', () => {
    const b = resolveExecutionCostBreakdown({
      ...base, id: 'ex-verify-9', assigneeType: 'user',
      verifyStartedAt: '2026-08-11T09:00:00+09:00', verifiedAt: '2026-08-11T09:30:00+09:00',
    }, rate)
    expect(b.ai).toBe(0)
    expect(b.human).toBeCloseTo(30)
  })

  it('단가 미등록 모델 + cost_usd 없음 → AI 비용 0 (과대계상하지 않음)', () => {
    const b = resolveExecutionCostBreakdown({
      ...base, id: 'ex-ext-p-1-0-y', assigneeType: 'user',
      inputTokens: 8_000_000, outputTokens: 200_000, modelName: 'no-such-model-xyz',
    }, rate)
    expect(b.ai).toBe(0)
  })
})
