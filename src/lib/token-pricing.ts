import { getAllTokenPricing, findTokenPricingForModel, upsertTokenPricing } from './db'
import { TokenPricing } from '@/types'

/**
 * 실행의 모델명으로 DB 단가를 조회하여 비용을 계산합니다.
 *
 * 우선순위:
 *   1. modelName → DB 정확 매칭 (case-insensitive)
 *   2. modelName → DB 키워드 매칭 (opus, haiku 등 구별력 있는 키워드)
 *   3. 매칭 실패 시 0 반환 (단가 미등록 모델)
 */
export function calcCostFromDb(inputTokens: number, outputTokens: number, modelName?: string): number {
  if (!modelName) return 0
  const pricing = findTokenPricingForModel(modelName)
  if (!pricing) return 0
  return (inputTokens * pricing.inputPrice + outputTokens * pricing.outputPrice) / 1_000_000
}

/**
 * 실행 기록의 최종 비용을 결정합니다.
 *
 * CLI 비용:
 *   - costUsd > 0 이면 CLI가 직접 계산한 실제 비용 사용
 *   - 그 외 DB 단가 기반 계산 (calcCostFromDb)
 *
 * 사람 비용 (추가):
 *   - 사람이 직접 개발한 시간 (assigneeType === 'user')
 *   - 검증에 소요된 시간 (verifyStartedAt → verifiedAt/rejectedAt)
 */
export function resolveExecutionCost(
  e: {
    costUsd: number; inputTokens: number; outputTokens: number;
    modelName?: string | null; assigneeType?: string;
    startedAt?: string; endedAt?: string | null;
    verifyStartedAt?: string | null; verifiedAt?: string | null; rejectedAt?: string | null;
  },
  humanMonthlySalary: number,
): number {
  let cost = e.costUsd > 0 ? e.costUsd : 0

  // CLI 비용 계산
  if (cost === 0 && e.assigneeType !== 'user') {
    cost = calcCostFromDb(e.inputTokens, e.outputTokens, e.modelName ?? undefined)
  }

  // 사람 비용 추가
  if (humanMonthlySalary > 0) {
    // 월급 → 분당 비용: 월 160시간 (20일 × 8h) = 9600분
    const costPerMin = humanMonthlySalary / 9600

    // 사람이 직접 개발한 시간
    if (e.assigneeType === 'user' && e.startedAt && e.endedAt) {
      const ms = new Date(e.endedAt).getTime() - new Date(e.startedAt).getTime()
      if (ms > 0) cost += (ms / 60000) * costPerMin
    }

    // 검증 시간
    const verifyEnd = e.verifiedAt || e.rejectedAt
    if (verifyEnd) {
      const vStart = e.verifyStartedAt || e.endedAt
      if (vStart) {
        const ms = new Date(verifyEnd).getTime() - new Date(vStart).getTime()
        if (ms > 0) cost += (ms / 60000) * costPerMin
      }
    }
  }

  return cost
}

/** DB에서 human 단가의 월급(inputPrice)을 조회 */
export function getHumanMonthlySalary(): number {
  const all = getAllTokenPricing()
  const human = all.find(p => p.cliName === 'human')
  return human?.inputPrice ?? 0
}

/** 최신 단가 정보 (2026년 기준 공식 가격표) — 모델 기준, CLI 무관 */
const LATEST_PRICING: { id: string; cliName: string; modelName: string; input: number; output: number }[] = [
  // Anthropic Claude
  { id: 'tp-sonnet', cliName: 'model', modelName: 'Claude Sonnet 4.6', input: 3.00, output: 15.00 },
  { id: 'tp-opus',   cliName: 'model', modelName: 'Claude Opus 4',     input: 15.00, output: 75.00 },
  { id: 'tp-haiku',  cliName: 'model', modelName: 'Claude Haiku 4.5',  input: 0.80, output: 4.00 },
  // Google Gemini
  { id: 'tp-gemini-pro',   cliName: 'model', modelName: 'Gemini 2.5 Pro',   input: 1.25, output: 10.00 },
  { id: 'tp-gemini-flash', cliName: 'model', modelName: 'Gemini 2.5 Flash', input: 0.075, output: 0.30 },
  // OpenAI
  { id: 'tp-gpt41', cliName: 'model', modelName: 'GPT-4.1',  input: 2.00, output: 8.00 },
  { id: 'tp-o3',    cliName: 'model', modelName: 'o3',       input: 10.00, output: 40.00 },
  // 사람
  { id: 'tp-human', cliName: 'human', modelName: '관리자 (월급 USD)', input: 5000.00, output: 0.00 },
]

/** 최신 단가로 DB를 업데이트하고 결과 반환 */
export function applyLatestPricing(): TokenPricing[] {
  const now = new Date().toISOString()
  for (const lp of LATEST_PRICING) {
    upsertTokenPricing({
      id: lp.id,
      cliName: lp.cliName,
      modelName: lp.modelName,
      inputPrice: lp.input,
      outputPrice: lp.output,
      updatedAt: now,
    })
  }
  return getAllTokenPricing()
}
