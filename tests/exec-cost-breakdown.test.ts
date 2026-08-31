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

  it('에이전트가 대신한 검증: 사람 시간 0, 비용은 AI 토큰으로만', () => {
    // 코멘트의 ive-meta(stage: verify)로 토큰이 채워진 ex-verify 행.
    // 라벨이 30분 열려 있었어도 사람이 앉아 있던 시간이 아니다.
    const b = resolveExecutionCostBreakdown({
      ...base, id: 'ex-verify-agent-1', assigneeType: 'user', costUsd: 0.42,
      verifyStartedAt: '2026-08-11T09:00:00+09:00', verifiedAt: '2026-08-11T09:30:00+09:00',
    }, rate)
    expect(b.human).toBe(0)
    expect(b.ai).toBeCloseTo(0.42)
  })

  it('에이전트 검증 판정은 cost_usd 없이 토큰만 있어도 성립한다', () => {
    const b = resolveExecutionCostBreakdown({
      ...base, id: 'ex-confirm-agent-1', assigneeType: 'user',
      inputTokens: 120_000, outputTokens: 4_000, modelName: 'no-such-model-xyz',
      verifyStartedAt: '2026-08-11T09:00:00+09:00', verifiedAt: '2026-08-11T10:00:00+09:00',
    }, rate)
    expect(b.human).toBe(0)
  })

  it('단가 미등록 모델 + cost_usd 없음 → AI 비용 0 (과대계상하지 않음)', () => {
    const b = resolveExecutionCostBreakdown({
      ...base, id: 'ex-ext-p-1-0-y', assigneeType: 'user',
      inputTokens: 8_000_000, outputTokens: 200_000, modelName: 'no-such-model-xyz',
    }, rate)
    expect(b.ai).toBe(0)
  })
})

describe('구독(정액) 과금 — 실지출 vs 명목가', () => {
  // 운영 2026-08-10~16 실측 축소판: 명목가는 크지만 실지출은 구독료 배부액이어야 한다.
  const policy = {
    subscribedClis: new Set(['claude']),
    actualById: new Map([['ex-a', 30], ['ex-b', 15.16]]),  // 주간 $45.16 을 토큰 비례로 배부
    periodSubscriptionUsd: 45.16,
  }

  it('구독 CLI: 실지출은 배부액, 명목가는 별도로 보존된다', () => {
    const b = resolveExecutionCostBreakdown(
      { ...base, id: 'ex-a', assigneeType: 'user', costUsd: 1308.62, modelName: 'claude-opus-5', workSec: 3600 },
      rate, policy)
    expect(b.ai).toBeCloseTo(30)            // 총원가에 들어가는 값
    expect(b.aiNotional).toBeCloseTo(1308.62) // "종량제였다면" — 효율 지표용
    expect(b.total).toBeCloseTo(30 + 60)    // 명목가는 총원가에 더해지지 않는다
  })

  it('구독 CLI인데 배부 대상이 아니면 실지출 0 (명목가는 그대로)', () => {
    const b = resolveExecutionCostBreakdown(
      { ...base, id: 'ex-없음', assigneeType: 'user', costUsd: 500, modelName: 'claude-opus-5' },
      rate, policy)
    expect(b.ai).toBe(0)
    expect(b.aiNotional).toBeCloseTo(500)
  })

  it('구독 미설정 CLI는 종량제 — 청구액이 그대로 실지출', () => {
    const b = resolveExecutionCostBreakdown(
      { ...base, id: 'ex-c', assigneeType: 'user', costUsd: 12.5, modelName: 'gemini-2.5-pro' },
      rate, policy)
    expect(b.ai).toBeCloseTo(12.5)
    expect(b.aiNotional).toBeCloseTo(12.5)
  })

  it('policy 미전달이면 종전대로 동작한다 (구독 미설정 사용자 영향 없음)', () => {
    const b = resolveExecutionCostBreakdown(
      { ...base, id: 'ex-a', assigneeType: 'user', costUsd: 1308.62, modelName: 'claude-opus-5' }, rate)
    expect(b.ai).toBeCloseTo(1308.62)
    expect(b.aiNotional).toBeCloseTo(1308.62)
  })

  it('에이전트 exec 도 구독 배부 대상이다 (cliName 으로 판별)', () => {
    const b = resolveExecutionCostBreakdown(
      { ...base, id: 'ex-b', assigneeType: 'agent', cliName: 'claude', costUsd: 900 }, rate, policy)
    expect(b.ai).toBeCloseTo(15.16)
    expect(b.human).toBe(0)
  })
})
