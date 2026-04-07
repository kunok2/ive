import { getAllTokenPricing, upsertTokenPricing, getTokenPricingByModel } from './db'
import { TokenPricing } from '@/types'

/**
 * 알려진 모델명 키워드 → 단가 매핑 (코드 내장 기본값)
 * DB에 일치하는 항목이 없을 때 모델명 패턴으로 단가를 결정합니다.
 * 단위: USD / 1M tokens
 */
const BUILTIN_MODEL_PRICING: { pattern: RegExp; input: number; output: number }[] = [
  // Anthropic Claude - Opus (가장 비쌈, 먼저 매칭)
  { pattern: /opus/i,   input: 15.00,  output: 75.00  },
  // Anthropic Claude - Haiku (가장 저렴, Sonnet보다 먼저)
  { pattern: /haiku/i,  input:  0.80,  output:  4.00  },
  // Anthropic Claude - Sonnet (기본)
  { pattern: /sonnet/i, input:  3.00,  output: 15.00  },
  // Google Gemini
  { pattern: /flash/i,  input:  0.075, output:  0.30  },
  { pattern: /gemini/i, input:  1.25,  output: 10.00  },
  // OpenAI
  { pattern: /gpt-4o/i, input:  2.50,  output: 10.00  },
  { pattern: /gpt-4/i,  input:  2.00,  output:  8.00  },
  { pattern: /o1/i,     input: 15.00,  output: 60.00  },
  { pattern: /o3/i,     input: 10.00,  output: 40.00  },
]

/** 모델명으로 내장 단가를 조회합니다 (DB 조회 실패 시 폴백용) */
export function getBuiltinPricingByModel(modelName: string): { input: number; output: number } | null {
  for (const entry of BUILTIN_MODEL_PRICING) {
    if (entry.pattern.test(modelName)) return { input: entry.input, output: entry.output }
  }
  return null
}

/** DB에서 모델명 우선, CLI명 차순으로 단가를 조회하여 비용 계산 */
export function calcCostFromDb(cliName: string, inputTokens: number, outputTokens: number, modelName?: string): number {
  // 1) DB에서 모델명 정확 매칭 시도
  if (modelName) {
    const dbPricing = getTokenPricingByModel(modelName)
    if (dbPricing) {
      return (inputTokens * dbPricing.inputPrice + outputTokens * dbPricing.outputPrice) / 1_000_000
    }
    // 2) DB에 없으면 내장 모델 키워드 매핑으로 폴백 (선택된 모델 기반 정확한 단가)
    const builtin = getBuiltinPricingByModel(modelName)
    if (builtin) {
      return (inputTokens * builtin.input + outputTokens * builtin.output) / 1_000_000
    }
  }
  // 3) CLI명으로 DB 조회 (관리자가 설정한 기본 단가)
  const all = getAllTokenPricing()
  const pricing = all.find(p => p.cliName === cliName) ?? all[0] ?? null
  if (!pricing) return 0
  return (inputTokens * pricing.inputPrice + outputTokens * pricing.outputPrice) / 1_000_000
}

/**
 * 실행 기록의 비용을 결정합니다.
 * - DB에 costUsd가 저장되어 있으면 그 값을 우선 사용 (CLI가 정확히 계산한 실제 비용)
 * - costUsd가 없으면 실제 사용 모델명 기반으로 계산 (선택된 모델 반영)
 * - 모델명도 없으면 CLI명 기반 단가(관리자 설정)로 폴백
 */
export function resolveExecutionCost(
  e: { costUsd: number; cliName: string; inputTokens: number; outputTokens: number; modelName?: string },
  pricingMap: Record<string, { input: number; output: number }>,
): number {
  if (e.costUsd > 0) return e.costUsd
  if (e.modelName) {
    const builtin = getBuiltinPricingByModel(e.modelName)
    if (builtin) {
      return (e.inputTokens * builtin.input + e.outputTokens * builtin.output) / 1_000_000
    }
  }
  return calcCost(pricingMap, e.cliName, e.inputTokens, e.outputTokens)
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

/** 최신 단가 정보 (2026년 기준 공식 가격표) - 모델별 단가 정의 */
const LATEST_PRICING: { cliName: string; modelName: string; input: number; output: number }[] = [
  // Anthropic - Claude Code CLI (claude)
  { cliName: 'claude', modelName: 'Claude Sonnet 4.6', input: 3.00,  output: 15.00 },
  // Google - Gemini CLI
  { cliName: 'gemini', modelName: 'Gemini 2.5 Pro',    input: 1.25,  output: 10.00 },
  // OpenAI - Codex CLI
  { cliName: 'codex',  modelName: 'GPT-4.1',           input: 2.00,  output:  8.00 },
  // OpenCode - 기본 모델
  { cliName: 'opencode', modelName: 'Claude Sonnet 4.6', input: 3.00, output: 15.00 },
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
