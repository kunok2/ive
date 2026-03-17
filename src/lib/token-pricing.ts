import { getAllTokenPricing, upsertTokenPricing } from './db'
import { TokenPricing } from '@/types'

/** DB에서 CLI별 단가를 조회하여 비용 계산 */
export function calcCostFromDb(cliName: string, inputTokens: number, outputTokens: number): number {
  const all = getAllTokenPricing()
  const pricing = all.find(p => p.cliName === cliName) ?? all[0]
  if (!pricing) return 0
  return (inputTokens * pricing.inputPrice + outputTokens * pricing.outputPrice) / 1_000_000
}

/** 모든 CLI 단가를 맵으로 반환 */
export function getPricingMap(): Record<string, { input: number; output: number }> {
  const all = getAllTokenPricing()
  const map: Record<string, { input: number; output: number }> = {}
  for (const p of all) {
    map[p.cliName] = { input: p.inputPrice, output: p.outputPrice }
  }
  return map
}

/** 주어진 단가맵으로 비용 계산 */
export function calcCost(
  pricingMap: Record<string, { input: number; output: number }>,
  cliName: string,
  inputTokens: number,
  outputTokens: number,
): number {
  const p = pricingMap[cliName] ?? Object.values(pricingMap)[0]
  if (!p) return 0
  return (inputTokens * p.input + outputTokens * p.output) / 1_000_000
}

/** 최신 단가 정보 (2026년 3월 기준 공식 가격표) */
const LATEST_PRICING: { cliName: string; modelName: string; input: number; output: number }[] = [
  // Anthropic
  { cliName: 'claude', modelName: 'Claude Sonnet 4.6', input: 3.00, output: 15.00 },
  // Google
  { cliName: 'gemini', modelName: 'Gemini 2.5 Pro', input: 1.25, output: 10.00 },
  // OpenAI
  { cliName: 'codex', modelName: 'GPT-4.1', input: 2.00, output: 8.00 },
]

/** 최신 단가로 DB를 업데이트하고 결과 반환 */
export function applyLatestPricing(): TokenPricing[] {
  const now = new Date().toISOString()
  for (const lp of LATEST_PRICING) {
    upsertTokenPricing({
      id: `tp-${lp.cliName}`,
      cliName: lp.cliName,
      modelName: lp.modelName,
      inputPrice: lp.input,
      outputPrice: lp.output,
      updatedAt: now,
    })
  }
  return getAllTokenPricing()
}
