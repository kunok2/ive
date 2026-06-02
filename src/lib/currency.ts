// 표시 통화 / 환율 변환 — 클라이언트·서버 공용 (순수, DB 의존 없음)
//
// 원칙:
//  - 비용은 내부적으로 항상 USD로 계산·저장한다. 이 모듈은 "표시 시점" 환산만 담당.
//  - 환율 캐시/조회/자동 갱신 등 DB·네트워크가 필요한 로직은 ./currency-server 에 둔다.

/** 지원 통화 (ISO 4217). USD = 기준 통화(환산 없음). */
export const SUPPORTED_CURRENCIES = [
  { code: 'USD', label: 'US Dollar', symbol: '$' },
  { code: 'KRW', label: 'Korean Won', symbol: '₩' },
  { code: 'JPY', label: 'Japanese Yen', symbol: '¥' },
  { code: 'EUR', label: 'Euro', symbol: '€' },
  { code: 'CNY', label: 'Chinese Yuan', symbol: '¥' },
  { code: 'GBP', label: 'British Pound', symbol: '£' },
] as const

export type CurrencyCode = typeof SUPPORTED_CURRENCIES[number]['code']

const VALID_CODES = new Set(SUPPORTED_CURRENCIES.map(c => c.code))

export function isSupportedCurrency(code: string): code is CurrencyCode {
  return VALID_CODES.has(code as CurrencyCode)
}

export interface ResolvedCurrency {
  code: string              // 표시 통화 코드 (USD 면 환산 안 함)
  rate: number              // 적용 환율 (USD→code). USD 또는 미해석 시 1
  source: 'usd' | 'manual' | 'auto'  // 환율 출처
  updatedAt: string | null  // 자동 환율 갱신 시각 (ISO). manual/usd 면 null
}

/** USD 금액을 표시 통화로 환산해 통화기호 포함 문자열로 포맷. */
export function formatMoney(usd: number, code: string, rate: number, locale?: string): string {
  const amount = usd * (rate || 1)
  const loc = locale === 'ko' ? 'ko-KR' : locale === 'en' ? 'en-US' : undefined
  try {
    return new Intl.NumberFormat(loc, {
      style: 'currency',
      currency: code,
      // 보고서 가독성을 위해 정수로 표시(기존 동작과 동일)
      maximumFractionDigits: 0,
    }).format(amount)
  } catch {
    // 알 수 없는 통화코드 폴백
    return `$${Math.round(amount).toLocaleString()}`
  }
}
