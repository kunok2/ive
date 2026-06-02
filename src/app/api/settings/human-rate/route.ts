import { NextRequest, NextResponse } from 'next/server'
import { getCurrentUser } from '@/lib/auth'
import { getAllTokenPricing, upsertTokenPricing, getSystemSetting, setSystemSetting } from '@/lib/db'
import { getHumanRate, computeHumanRate, DEFAULT_DAYS_PER_WEEK, DEFAULT_HOURS_PER_DAY } from '@/lib/token-pricing'
import { isSupportedCurrency } from '@/lib/currency'
import { getSupportedRates } from '@/lib/currency-server'
import { logActivity } from '@/lib/activity'

const HUMAN_ID = 'tp-human'
const HUMAN_MODEL = '관리자 (월급 USD)'
const SETTING_DAYS = 'human.daysPerWeek'
const SETTING_HOURS = 'human.hoursPerDay'
const SETTING_INPUT_CURRENCY = 'human.inputCurrency'

/**
 * 사람 단가 조회.
 *  - 월급은 항상 USD 로 저장된다. UI 표시는 마지막 입력 통화 기준.
 *  - rates: 지원 통화별 USD→통화 환율 (입력 통화 전환 시 클라이언트에서 즉시 환산용).
 */
export async function GET() {
  const user = await getCurrentUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const rate = getHumanRate()
  const inputCurrency = getSystemSetting(SETTING_INPUT_CURRENCY) || 'USD'
  const rates = await getSupportedRates()

  return NextResponse.json({
    monthlySalaryUsd: rate.monthlySalary,
    daysPerWeek: rate.daysPerWeek,
    hoursPerDay: rate.hoursPerDay,
    monthlyMinutes: rate.monthlyMinutes,
    costPerMinUsd: rate.costPerMin,
    inputCurrency: isSupportedCurrency(inputCurrency) ? inputCurrency : 'USD',
    rates,
  })
}

/**
 * 사람 단가 저장 (관리자).
 *  body: { salary: number(선택 통화 기준 입력값), currency: 통화코드, daysPerWeek, hoursPerDay }
 *  - 입력 월급을 환율로 USD 로 환산해 token_pricing(human) 에 저장.
 *  - 근무 일정은 system_settings 에 저장. 입력 통화도 기억한다.
 */
export async function PUT(req: NextRequest) {
  const user = await getCurrentUser()
  if (!user?.isAdmin) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const body = await req.json().catch(() => ({}))
  const rawSalary = typeof body.salary === 'number' ? body.salary : parseFloat(String(body.salary ?? ''))
  const currency = typeof body.currency === 'string' ? body.currency : 'USD'
  const days = parseFloat(String(body.daysPerWeek ?? '')) || DEFAULT_DAYS_PER_WEEK
  const hours = parseFloat(String(body.hoursPerDay ?? '')) || DEFAULT_HOURS_PER_DAY

  if (!isFinite(rawSalary) || rawSalary < 0) {
    return NextResponse.json({ error: 'Invalid salary' }, { status: 400 })
  }
  if (currency !== 'USD' && !isSupportedCurrency(currency)) {
    return NextResponse.json({ error: 'Invalid currency' }, { status: 400 })
  }
  if (days <= 0 || days > 7 || hours <= 0 || hours > 24) {
    return NextResponse.json({ error: 'Invalid work schedule' }, { status: 400 })
  }

  // 입력 통화 → USD 환산. amount_in_currency = usd × rate  ⇒  usd = amount / rate
  let salaryUsd = rawSalary
  if (currency !== 'USD') {
    const rates = await getSupportedRates()
    const rate = rates[currency]
    if (!rate || !isFinite(rate) || rate <= 0) {
      return NextResponse.json({ error: 'rate_unavailable' }, { status: 502 })
    }
    salaryUsd = rawSalary / rate
  }
  salaryUsd = Math.round(salaryUsd * 100) / 100

  // 월급(USD) 저장 — human row 의 다른 필드는 보존
  const existing = getAllTokenPricing().find(p => p.cliName === 'human')
  upsertTokenPricing({
    id: existing?.id ?? HUMAN_ID,
    cliName: 'human',
    modelName: existing?.modelName ?? HUMAN_MODEL,
    inputPrice: salaryUsd,
    outputPrice: existing?.outputPrice ?? 0,
    updatedAt: new Date().toISOString(),
  })
  setSystemSetting(SETTING_DAYS, String(days))
  setSystemSetting(SETTING_HOURS, String(hours))
  setSystemSetting(SETTING_INPUT_CURRENCY, currency)

  logActivity({ userId: user.id, category: 'settings', action: 'update_human_rate', detail: `사람 단가: ${salaryUsd} USD (입력 ${rawSalary} ${currency}), 주 ${days}일 × ${hours}h`, req })

  const computed = computeHumanRate(salaryUsd, days, hours)
  const rates = await getSupportedRates()
  return NextResponse.json({
    monthlySalaryUsd: computed.monthlySalary,
    daysPerWeek: computed.daysPerWeek,
    hoursPerDay: computed.hoursPerDay,
    monthlyMinutes: computed.monthlyMinutes,
    costPerMinUsd: computed.costPerMin,
    inputCurrency: currency,
    rates,
  })
}
