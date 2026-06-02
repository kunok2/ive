import { getAllTokenPricing, findTokenPricingForModel, upsertTokenPricing, getSystemSetting } from './db'
import { TokenPricing } from '@/types'

// ─── 사람(관리자/검증자) 단가 기준 ───
//  월급(USD) + 근무 일정(주당 근무일·하루 근무시간)으로 분당 비용을 산정한다.
//  월 환산 근무시간 = 주당근무일 × 하루근무시간 × (월 환산 주수).
//  기본값(주 5일·하루 8h·월 4주)은 5×8×4 = 160h = 9600분 으로, 기존 고정값과 동일하다.
export const WEEKS_PER_MONTH = 4
export const DEFAULT_DAYS_PER_WEEK = 5
export const DEFAULT_HOURS_PER_DAY = 8

const SETTING_DAYS_PER_WEEK = 'human.daysPerWeek'
const SETTING_HOURS_PER_DAY = 'human.hoursPerDay'

export interface HumanRate {
  monthlySalary: number   // 월급 (USD, 내부 저장 기준 통화)
  daysPerWeek: number     // 주당 근무일
  hoursPerDay: number     // 하루 근무시간
  monthlyMinutes: number  // 월 환산 근무 분 (= daysPerWeek × hoursPerDay × WEEKS_PER_MONTH × 60)
  costPerMin: number      // 분당 비용 (USD) = monthlySalary / monthlyMinutes
}

/** 월급·근무일정으로 HumanRate 산정 (순수 함수). 잘못된 일정은 기본값으로 보정. */
export function computeHumanRate(monthlySalary: number, daysPerWeek: number, hoursPerDay: number): HumanRate {
  const d = isFinite(daysPerWeek) && daysPerWeek > 0 ? daysPerWeek : DEFAULT_DAYS_PER_WEEK
  const h = isFinite(hoursPerDay) && hoursPerDay > 0 ? hoursPerDay : DEFAULT_HOURS_PER_DAY
  const salary = isFinite(monthlySalary) && monthlySalary > 0 ? monthlySalary : 0
  const monthlyMinutes = Math.max(1, d * h * WEEKS_PER_MONTH * 60)
  return { monthlySalary: salary, daysPerWeek: d, hoursPerDay: h, monthlyMinutes, costPerMin: salary / monthlyMinutes }
}

/** DB(월급 + 근무일정)에서 현재 사람 단가를 읽어 HumanRate 로 반환. */
export function getHumanRate(): HumanRate {
  const salary = getHumanMonthlySalary()
  const days = parseFloat(getSystemSetting(SETTING_DAYS_PER_WEEK) ?? '') || DEFAULT_DAYS_PER_WEEK
  const hours = parseFloat(getSystemSetting(SETTING_HOURS_PER_DAY) ?? '') || DEFAULT_HOURS_PER_DAY
  return computeHumanRate(salary, days, hours)
}

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
export interface ExecutionCostBreakdown {
  ai: number      // AI 모델 토큰 비용 (costUsd 또는 토큰×단가)
  human: number   // 사람 작업 시간 비용 (user exec 의 duration × 분당 월급)
  total: number
}

/** 단일 execution의 비용을 AI/사람으로 나누어 계산 */
export function resolveExecutionCostBreakdown(
  e: {
    costUsd: number; inputTokens: number; outputTokens: number;
    modelName?: string | null; assigneeType?: string;
    startedAt?: string; endedAt?: string | null;
    verifyStartedAt?: string | null; verifiedAt?: string | null; rejectedAt?: string | null;
  },
  humanRate: HumanRate,
): ExecutionCostBreakdown {
  let ai = 0

  // AI CLI 비용: 실제 청구액이 있으면 우선 사용, 없으면 토큰 단가로 계산
  if (e.assigneeType !== 'user') {
    ai = e.costUsd > 0 ? e.costUsd : calcCostFromDb(e.inputTokens, e.outputTokens, e.modelName ?? undefined)
  }

  // 사람 비용: assigneeType='user' exec의 (ended - started) 구간만 계산
  // 중복 집계 방지: 과거에는 모든 agent exec에도 검증 시간을 더했으나,
  // markIssueVerified가 mass-update로 같은 verified_at을 여러 exec에 찍어
  // 같은 구간이 exec 개수만큼 곱해졌다. user exec 하나에만 계산한다.
  let human = 0
  if (humanRate.monthlySalary > 0 && e.assigneeType === 'user' && e.startedAt && e.endedAt) {
    const ms = new Date(e.endedAt).getTime() - new Date(e.startedAt).getTime()
    if (ms > 0) human = (ms / 60000) * humanRate.costPerMin
  }

  return { ai, human, total: ai + human }
}

/** 하위 호환: 총 비용만 반환 */
export function resolveExecutionCost(
  e: Parameters<typeof resolveExecutionCostBreakdown>[0],
  humanRate: HumanRate,
): number {
  return resolveExecutionCostBreakdown(e, humanRate).total
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
  // OpenAI Codex (GPT-5 계열) — ChatGPT 구독 로그인 시 마진 비용은 0이나, API 과금 시 환산용 단가
  { id: 'tp-gpt5-codex', cliName: 'model', modelName: 'GPT-5 Codex', input: 1.25, output: 10.00 },
  { id: 'tp-gpt5',       cliName: 'model', modelName: 'GPT-5',       input: 1.25, output: 10.00 },
  { id: 'tp-gpt5-mini',  cliName: 'model', modelName: 'GPT-5 mini',  input: 0.25, output: 2.00 },
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
