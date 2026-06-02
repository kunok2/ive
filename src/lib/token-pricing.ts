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

// ─── 근무시간(KST 평일 09:00–18:00) 내 경과(분) ───
const WORK_START_H = 9
const WORK_END_H = 18
const KST_OFFSET_MS = 9 * 60 * 60 * 1000
const DAY_MS = 86_400_000

/**
 * [start, end] 구간 중 "근무시간(KST 평일 09–18)"에 해당하는 분만 합산.
 * 검증/확인을 열어두고 퇴근하면 밤·주말이 빠지고 실제 근무 중 방치한 만큼만 남는다(상한 없음).
 */
export function businessMinutesKST(startISO?: string | null, endISO?: string | null): number {
  if (!startISO || !endISO) return 0
  const s0 = new Date(startISO).getTime()
  const e0 = new Date(endISO).getTime()
  if (!isFinite(s0) || !isFinite(e0) || e0 <= s0) return 0
  // KST 시계로 환산해 UTC 메서드로 다룬다.
  const s = s0 + KST_OFFSET_MS
  let e = e0 + KST_OFFSET_MS
  // 폭주 방지(루프 상한, 값 자체의 상한은 아님): 비정상적으로 긴 구간만 보호.
  if (e - s > 366 * DAY_MS) e = s + 366 * DAY_MS
  let total = 0
  for (let d = Math.floor(s / DAY_MS) * DAY_MS; d < e; d += DAY_MS) {
    const dow = new Date(d).getUTCDay() // 0=일 .. 6=토 (KST 시계)
    if (dow === 0 || dow === 6) continue
    const winStart = d + WORK_START_H * 3_600_000
    const winEnd = d + WORK_END_H * 3_600_000
    const ov = Math.min(e, winEnd) - Math.max(s, winStart)
    if (ov > 0) total += ov
  }
  return total / 60_000
}

interface CostExec {
  id?: string
  costUsd: number; inputTokens: number; outputTokens: number;
  modelName?: string | null; assigneeType?: string;
  startedAt?: string; endedAt?: string | null;
  verifyStartedAt?: string | null; verifiedAt?: string | null; rejectedAt?: string | null;
  workSec?: number | null;  // 툴 직접개발 확정 작업시간(초): ive-meta>/spend>0 (스캐너 산정)
  rateMultiplier?: number | null;  // 사람단가 배수 (기본 1). 사람 비용 = 작업시간 × 기본단가 × 배수.
}

/**
 * exec 1건의 "사람 작업시간(분)"을 산정한다. (원가 = 낮을수록 좋음)
 *   - IVE 처리(에이전트 exec): 0 — 처리는 AI 비용(토큰)으로 계산.
 *   - 검증/확인(ex-verify, ex-confirm): 근무시간 내 (검증시작→검증완료) 경과. 상한 없음(방치 시 증가).
 *   - 툴 직접개발(그 외 user exec): work_sec(확정 작업시간). 스캐너가 ive-meta>/spend>0 으로 산정해 저장.
 *     (이슈 열린 기간 created→등록 으로 부풀리지 않음.)
 */
export function humanWorkMinutes(e: CostExec): number {
  if (e.assigneeType === 'agent') return 0
  const id = e.id || ''
  if (id.startsWith('ex-verify') || id.startsWith('ex-confirm')) {
    return businessMinutesKST(e.verifyStartedAt || e.startedAt, e.verifiedAt || e.rejectedAt || e.endedAt)
  }
  // 툴 직접개발: 확정 작업시간(work_sec)만 사용.
  return (e.workSec || 0) / 60
}

export interface ExecutionCostBreakdown {
  ai: number      // AI 모델 토큰 비용 (costUsd 또는 토큰×단가) — IVE 처리분
  human: number   // 사람 작업 시간 비용 (검증·확인 근무시간 + 툴개발 ive-meta 구간) × 분당단가
  total: number
}

/** 단일 execution의 비용을 AI/사람으로 나누어 계산 */
export function resolveExecutionCostBreakdown(e: CostExec, humanRate: HumanRate): ExecutionCostBreakdown {
  // AI 비용: IVE 처리(에이전트 exec)의 토큰 비용. 실제 청구액 우선, 없으면 토큰×단가.
  let ai = 0
  if (e.assigneeType !== 'user') {
    ai = e.costUsd > 0 ? e.costUsd : calcCostFromDb(e.inputTokens, e.outputTokens, e.modelName ?? undefined)
  }
  // 사람 비용: 작업시간(분) × 분당단가 × 사용자별 단가 배수(능력/보수 차이 반영, 기본 1)
  let human = 0
  if (humanRate.costPerMin > 0) {
    const m = humanWorkMinutes(e)
    if (m > 0) {
      const mult = e.rateMultiplier != null && e.rateMultiplier > 0 ? e.rateMultiplier : 1
      human = m * humanRate.costPerMin * mult
    }
  }
  return { ai, human, total: ai + human }
}

/** 하위 호환: 총 비용만 반환 */
export function resolveExecutionCost(e: CostExec, humanRate: HumanRate): number {
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
