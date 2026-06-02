// 표시 통화 / 환율 — 서버 전용 (DB 캐시 + 외부 FX API)
//
//  - 환율(USD→통화)은 글로벌 시장 데이터라 사용자별로 다르지 않다 → system_settings 에 통화코드별 1개씩 캐시.
//  - 사용자는 (1) 표시 통화 코드, (2) 선택적 수동 고정 환율 을 가진다(수동이 자동보다 우선).
//  - 보고서 렌더링은 절대 외부 API 를 직접 호출하지 않는다 → 항상 캐시값만 읽어 즉시 응답.
//    캐시 갱신은 백그라운드 스케줄러가 하루 1회 수행하며, fetch 실패 시 기존 캐시(=마지막 값)를 그대로 유지한다.

import { getSystemSetting, setSystemSetting, getAllUsers } from './db'
import { isSupportedCurrency, SUPPORTED_CURRENCIES, type ResolvedCurrency } from './currency'

/** 자동 환율 캐시 키 — 통화코드별로 1개. */
const rateKey = (code: string) => `currency.rate.${code}`
const rateAtKey = (code: string) => `currency.rate.${code}.at`

/** 캐시된 자동 환율(USD→code) 조회. 없으면 null. */
export function getCachedRate(code: string): { rate: number; updatedAt: string | null } | null {
  if (code === 'USD') return { rate: 1, updatedAt: null }
  const raw = getSystemSetting(rateKey(code))
  if (!raw) return null
  const rate = parseFloat(raw)
  if (!isFinite(rate) || rate <= 0) return null
  return { rate, updatedAt: getSystemSetting(rateAtKey(code)) }
}

/**
 * 사용자 기준 표시 통화/환율 해석.
 *  우선순위: 수동 고정 환율 > 자동 캐시 환율 > (캐시 없으면) USD 폴백.
 */
export function resolveUserCurrency(user: { currency?: string | null; currencyRate?: number | null } | null): ResolvedCurrency {
  const code = user?.currency
  if (!code || code === 'USD' || !isSupportedCurrency(code)) {
    return { code: 'USD', rate: 1, source: 'usd', updatedAt: null }
  }
  // 수동 고정 환율 우선
  if (user?.currencyRate && isFinite(user.currencyRate) && user.currencyRate > 0) {
    return { code, rate: user.currencyRate, source: 'manual', updatedAt: null }
  }
  // 자동 캐시 환율
  const cached = getCachedRate(code)
  if (cached) {
    return { code, rate: cached.rate, source: 'auto', updatedAt: cached.updatedAt }
  }
  // 캐시도 없으면 USD 폴백 (보고서가 깨지지 않도록)
  return { code: 'USD', rate: 1, source: 'usd', updatedAt: null }
}

// ─── 자동 환율 갱신 (백그라운드) ───

const FX_URL = 'https://open.er-api.com/v6/latest/USD'
const FETCH_TIMEOUT_MS = 4000

/** 외부 FX API 에서 USD 기준 환율 테이블을 가져온다. 실패/타임아웃 시 null. */
async function fetchUsdRates(): Promise<Record<string, number> | null> {
  const ctrl = new AbortController()
  const timer = setTimeout(() => ctrl.abort(), FETCH_TIMEOUT_MS)
  try {
    const res = await fetch(FX_URL, { signal: ctrl.signal })
    if (!res.ok) return null
    const data = await res.json() as any
    if (data?.result !== 'success' || !data.rates) return null
    return data.rates as Record<string, number>
  } catch {
    return null
  } finally {
    clearTimeout(timer)
  }
}

/**
 * 사용자들이 실제로 선택한 통화 코드들의 환율을 갱신해 캐시에 저장.
 * fetch 실패 시 기존 캐시를 건드리지 않는다(마지막 값 유지 = 백업).
 * @returns 갱신된 통화 코드 목록
 */
export async function refreshCurrencyRates(): Promise<string[]> {
  // 사용 중인 통화 코드 수집 (USD 제외)
  const inUse = new Set<string>()
  for (const u of getAllUsers()) {
    const c = u.currency
    if (c && c !== 'USD' && isSupportedCurrency(c)) inUse.add(c)
  }
  if (inUse.size === 0) return []

  const rates = await fetchUsdRates()
  if (!rates) {
    console.warn('[Currency] 환율 fetch 실패 — 기존 캐시 유지')
    return []
  }

  const now = new Date().toISOString()
  const updated: string[] = []
  for (const code of inUse) {
    const rate = rates[code]
    if (typeof rate === 'number' && isFinite(rate) && rate > 0) {
      setSystemSetting(rateKey(code), String(rate))
      setSystemSetting(rateAtKey(code), now)
      updated.push(code)
    }
  }
  if (updated.length > 0) console.log(`[Currency] 환율 갱신: ${updated.join(', ')}`)
  return updated
}

/**
 * 지원 통화 전체의 USD→통화 환율 맵을 반환 (입력 통화 선택 UI 용).
 * 캐시 우선, 누락된 코드가 하나라도 있으면 전체 테이블을 1회 fetch 해 캐시에 채운다.
 * fetch 실패 시 캐시에 있는 것만 반환(USD 는 항상 1).
 */
export async function getSupportedRates(): Promise<Record<string, number>> {
  const out: Record<string, number> = { USD: 1 }
  const missing: string[] = []
  for (const c of SUPPORTED_CURRENCIES) {
    if (c.code === 'USD') continue
    const cached = getCachedRate(c.code)
    if (cached) out[c.code] = cached.rate
    else missing.push(c.code)
  }
  if (missing.length === 0) return out

  const rates = await fetchUsdRates()
  if (!rates) return out  // fetch 실패 — 캐시분만 반환
  const now = new Date().toISOString()
  for (const code of missing) {
    const rate = rates[code]
    if (typeof rate === 'number' && isFinite(rate) && rate > 0) {
      setSystemSetting(rateKey(code), String(rate))
      setSystemSetting(rateAtKey(code), now)
      out[code] = rate
    }
  }
  return out
}

/** 특정 통화 1개만 강제 갱신 (사용자가 "지금 갱신" 누를 때). 성공 시 갱신값 반환. */
export async function refreshSingleRate(code: string): Promise<{ rate: number; updatedAt: string } | null> {
  if (!isSupportedCurrency(code) || code === 'USD') return null
  const rates = await fetchUsdRates()
  const rate = rates?.[code]
  if (typeof rate !== 'number' || !isFinite(rate) || rate <= 0) return null
  const now = new Date().toISOString()
  setSystemSetting(rateKey(code), String(rate))
  setSystemSetting(rateAtKey(code), now)
  return { rate, updatedAt: now }
}
