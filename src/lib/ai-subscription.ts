/**
 * AI 구독(정액) 과금 — 실지출 산정.
 *
 * 배경: exec 에 기록된 cost_usd 는 CLI 가 계산한 "종량제 API 였다면 청구되었을 금액"이다.
 * 종량제 API 키를 쓰면 그게 곧 실지출이지만, 정액 구독(Claude Max, ChatGPT Plus 등)을
 * 쓰면 실지출은 사용량과 무관한 월 구독료다. 이 둘을 구분하지 않으면 원가가 수십 배로
 * 부풀려진다 (운영 2026-08: 월 구독 $200 인데 cost_usd 합계 $16,919 — 85배).
 *
 * 그래서 비용을 두 갈래로 나눈다.
 *   - 실지출(actual)  : 총원가에 들어가는 값. 구독이면 구독료 배부액, 종량제면 cost_usd.
 *   - 명목가(notional): "종량제였다면 얼마" — 효율 지표 전용. 총원가에 더하지 않는다.
 *
 * 배부 방식은 사람 비용과 대칭이다.
 *   사람      : 월급(정액)     ÷ 월 근무시간 → 작업시간에 비례 배부
 *   AI(구독)  : 월 구독료(정액) ÷ 기간 사용량 → 토큰에 비례 배부
 * 정액 고정비를 조업도로 배부하는 표준 방식이다.
 */
import { getAllTokenPricing } from './db'

/**
 * 구독료를 담는 token_pricing 행의 model_name.
 * ⚠️ token_pricing.model_name 은 UNIQUE 라 CLI 마다 값이 달라야 한다.
 * 공통 문자열 하나를 쓰면 두 번째 CLI 저장에서 제약 위반으로 실패한다.
 */
export const SUBSCRIPTION_PREFIX = 'subscription ('
export function subscriptionModelName(cli: string): string {
  return `${SUBSCRIPTION_PREFIX}${cli})`
}

/** 구독료가 설정된 CLI → 월 구독료(USD). 0 이하는 미설정으로 보고 제외한다. */
export function getAiSubscriptions(): Record<string, number> {
  const out: Record<string, number> = {}
  for (const p of getAllTokenPricing()) {
    if (p.cliName === 'human' || !p.modelName.startsWith(SUBSCRIPTION_PREFIX)) continue
    if (p.inputPrice > 0) out[p.cliName] = p.inputPrice
  }
  return out
}

/**
 * 모델명으로 CLI 를 역추적한다.
 * 툴 직접개발(ive-meta) exec 은 agent_id 가 비어 cli_name 조인이 안 되므로 이 경로를 탄다.
 */
export function cliFromModelName(model?: string | null): string | null {
  if (!model) return null
  const m = model.toLowerCase()
  if (m.includes('claude') || m.includes('opus') || m.includes('sonnet') || m.includes('haiku') || m.includes('fable') || m.includes('mythos')) return 'claude'
  if (m.includes('gemini')) return 'gemini'
  if (m.includes('gpt') || m.includes('codex') || /\bo[34]\b/.test(m)) return 'codex'
  if (m.includes('opencode')) return 'opencode'
  return null
}

/** exec 의 CLI. 에이전트 처리는 조인된 cli_name, 툴 직접개발은 모델명으로 추정. */
export function resolveExecCli(e: { cliName?: string; modelName?: string | null }): string | null {
  if (e.cliName) return e.cliName
  return cliFromModelName(e.modelName)
}

const DAY_MS = 86_400_000
const KST_OFFSET_MS = 9 * 60 * 60 * 1000

/**
 * 월 구독료를 보고 기간만큼 일할 계산한다.
 *
 * 달마다 일수가 달라 "기간일수/30" 같은 근사를 쓰면 월 경계를 넘는 주간 보고서에서
 * 오차가 난다. 하루씩 훑으며 그 날이 속한 달의 실제 일수로 나눠 더한다.
 * (예: 1/29~2/4 → 1월분 3일 × 월액/31 + 2월분 4일 × 월액/28)
 */
export function subscriptionCostForPeriod(monthlyUsd: number, startISO: string, endISO: string): number {
  if (!(monthlyUsd > 0)) return 0
  const s = new Date(startISO).getTime()
  const e = new Date(endISO).getTime()
  if (!isFinite(s) || !isFinite(e) || e <= s) return 0
  // 폭주 방지(루프 상한). 정상적인 보고 기간은 최대 1년.
  const end = Math.min(e, s + 366 * DAY_MS)

  let total = 0
  // KST 시계로 환산해 UTC 메서드로 다룬다 (date-utils / businessMinutesKST 와 동일 관례).
  for (let t = Math.floor((s + KST_OFFSET_MS) / DAY_MS) * DAY_MS; t < end + KST_OFFSET_MS; t += DAY_MS) {
    const d = new Date(t)
    const daysInMonth = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 0)).getUTCDate()
    total += monthlyUsd / daysInMonth
  }
  return total
}

export interface AiCostPolicy {
  /** exec id → 구독 배부 실지출(USD). 구독 대상 exec 만 담긴다. */
  actualById: Map<string, number>
  /** 구독료가 설정된 CLI. 여기 속한 exec 은 cost_usd 를 실지출로 쓰지 않는다. */
  subscribedClis: Set<string>
  /** 기간에 배부된 구독료 총액(USD). 리포트 표시용. */
  periodSubscriptionUsd: number
}

interface AllocExec {
  id?: string
  cliName?: string
  modelName?: string | null
  inputTokens: number
  outputTokens: number
}

/**
 * 기간 구독료를 그 기간 exec 들에 토큰 비례로 배부한다.
 *
 * ⚠️ execs 에는 **보고 기간의 전체 exec** 을 넘겨야 한다. 프로젝트로 걸러진 부분집합을
 * 넘기면 그 프로젝트가 구독료 전액을 뒤집어쓴다. 배부는 전체로 하고, 조회만 id 로 한다.
 */
export function buildAiCostPolicy(execs: AllocExec[], startISO: string, endISO: string): AiCostPolicy {
  const subs = getAiSubscriptions()
  const subscribedClis = new Set(Object.keys(subs))
  const actualById = new Map<string, number>()
  let periodSubscriptionUsd = 0

  for (const [cli, monthly] of Object.entries(subs)) {
    const periodCost = subscriptionCostForPeriod(monthly, startISO, endISO)
    if (periodCost <= 0) continue
    periodSubscriptionUsd += periodCost

    const mine = execs.filter(e => resolveExecCli(e) === cli)
    const totalTokens = mine.reduce((s, e) => s + (e.inputTokens || 0) + (e.outputTokens || 0), 0)
    // 사용 기록이 없으면 배부할 대상이 없다. 구독료는 여전히 나가지만 귀속시킬 작업이
    // 없으므로 exec 단위 원가에는 넣지 않는다 (periodSubscriptionUsd 로만 드러난다).
    if (totalTokens <= 0) continue

    for (const e of mine) {
      if (!e.id) continue
      const w = ((e.inputTokens || 0) + (e.outputTokens || 0)) / totalTokens
      actualById.set(e.id, periodCost * w)
    }
  }

  return { actualById, subscribedClis, periodSubscriptionUsd }
}
