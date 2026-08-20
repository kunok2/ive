import { NextRequest, NextResponse } from 'next/server'
import { getCurrentUser } from '@/lib/auth'
import { getAllTokenPricing, upsertTokenPricing, getSystemSetting, setSystemSetting, appendRate } from '@/lib/db'
import { subscriptionModelName, SUBSCRIPTION_PREFIX, getAiSubscriptions } from '@/lib/ai-subscription'
import { isSupportedCurrency } from '@/lib/currency'
import { getSupportedRates } from '@/lib/currency-server'
import { logActivity } from '@/lib/activity'
import { CliName } from '@/types'

const CLIS: CliName[] = ['claude', 'codex', 'gemini', 'opencode']
const SETTING_INPUT_CURRENCY = 'ai.subscriptionInputCurrency'

/**
 * AI 구독(정액) 요금 조회.
 *  - 사람 단가와 동일하게 월 요금은 항상 USD 로 저장하고, 표시만 마지막 입력 통화로 한다.
 *  - 값이 0(미설정)인 CLI 는 종량제로 간주되어 exec 의 청구액이 그대로 실지출이 된다.
 */
export async function GET() {
  const user = await getCurrentUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const subs = getAiSubscriptions()
  const inputCurrency = getSystemSetting(SETTING_INPUT_CURRENCY) || 'USD'
  const rates = await getSupportedRates()

  return NextResponse.json({
    subscriptions: Object.fromEntries(CLIS.map(c => [c, subs[c] ?? 0])),
    inputCurrency: isSupportedCurrency(inputCurrency) ? inputCurrency : 'USD',
    rates,
  })
}

/**
 * AI 구독 요금 저장 (관리자).
 *  body: { cliName, amount(선택 통화 기준), currency }
 *  amount 0 이면 해당 CLI 는 종량제로 되돌아간다.
 */
export async function PUT(req: NextRequest) {
  const user = await getCurrentUser()
  if (!user?.isAdmin) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const body = await req.json().catch(() => ({}))
  const cliName = String(body.cliName ?? '')
  const rawAmount = typeof body.amount === 'number' ? body.amount : parseFloat(String(body.amount ?? ''))
  const currency = typeof body.currency === 'string' ? body.currency : 'USD'

  if (!CLIS.includes(cliName as CliName)) {
    return NextResponse.json({ error: 'Invalid cliName' }, { status: 400 })
  }
  if (!isFinite(rawAmount) || rawAmount < 0) {
    return NextResponse.json({ error: 'Invalid amount' }, { status: 400 })
  }
  if (currency !== 'USD' && !isSupportedCurrency(currency)) {
    return NextResponse.json({ error: 'Invalid currency' }, { status: 400 })
  }

  // 입력 통화 → USD 환산. amount_in_currency = usd × rate  ⇒  usd = amount / rate
  let monthlyUsd = rawAmount
  if (currency !== 'USD') {
    const rates = await getSupportedRates()
    const rate = rates[currency]
    if (!rate || !isFinite(rate) || rate <= 0) {
      return NextResponse.json({ error: 'rate_unavailable' }, { status: 502 })
    }
    monthlyUsd = rawAmount / rate
  }
  monthlyUsd = Math.round(monthlyUsd * 100) / 100

  const existing = getAllTokenPricing().find(p => p.cliName === cliName && p.modelName.startsWith(SUBSCRIPTION_PREFIX))
  upsertTokenPricing({
    id: existing?.id ?? `tp-sub-${cliName}`,
    cliName,
    modelName: subscriptionModelName(cliName),
    inputPrice: monthlyUsd,
    outputPrice: 0,
    updatedAt: new Date().toISOString(),
  })
  setSystemSetting(SETTING_INPUT_CURRENCY, currency)
  // 단가 이력: 요금제를 바꿔도 과거 보고서는 그때 요금으로 계산되게 한다.
  appendRate({ kind: 'ai_subscription', key: cliName, inputPrice: monthlyUsd, outputPrice: 0, meta: null, effectiveFrom: new Date().toISOString() })

  logActivity({
    userId: user.id, category: 'settings', action: 'update_ai_subscription',
    detail: `AI 구독 요금: ${cliName} = ${monthlyUsd} USD/월 (입력 ${rawAmount} ${currency})`, req,
  })

  const subs = getAiSubscriptions()
  const rates = await getSupportedRates()
  return NextResponse.json({
    subscriptions: Object.fromEntries(CLIS.map(c => [c, subs[c] ?? 0])),
    inputCurrency: currency,
    rates,
  })
}
