/** KST(한국 표준시, UTC+9) 기준 날짜 유틸리티 */

const KST_OFFSET_MS = 9 * 60 * 60 * 1000

/** KST 기준 현재 Date 객체를 반환 (UTC 시각에 +9시간 적용) */
function toKST(date: Date = new Date()): Date {
  return new Date(date.getTime() + KST_OFFSET_MS)
}

/** KST 기준 오늘 날짜 문자열 (YYYY-MM-DD) — UI 표시용 */
export function getKSTTodayString(date: Date = new Date()): string {
  return toKST(date).toISOString().slice(0, 10)
}

/** KST 기준 어제 날짜 문자열 (YYYY-MM-DD) — UI 표시용 */
export function getKSTYesterdayString(date: Date = new Date()): string {
  return toKST(new Date(date.getTime() - 86400000)).toISOString().slice(0, 10)
}

/** KST 기준 오늘 자정(00:00:00)의 UTC Date 객체 */
export function getKSTTodayStart(date: Date = new Date()): Date {
  const kstDateStr = getKSTTodayString(date)
  // KST 기준 자정 = UTC 기준 전날 15:00
  return new Date(new Date(kstDateStr).getTime() - KST_OFFSET_MS)
}

/**
 * KST 기준 오늘 자정의 UTC ISO 문자열 — DB 쿼리 필터용
 * started_at(UTC ISO)와 비교할 때 사용
 * 예: KST 2026-03-19 00:00 → '2026-03-18T15:00:00.000Z'
 */
export function getKSTTodayStartISO(date: Date = new Date()): string {
  return getKSTTodayStart(date).toISOString()
}

/**
 * KST 기준 어제 자정의 UTC ISO 문자열 — DB 쿼리 필터용
 */
export function getKSTYesterdayStartISO(date: Date = new Date()): string {
  return getKSTTodayStart(new Date(date.getTime() - 86400000)).toISOString()
}

/**
 * KST 날짜(YYYY-MM-DD)의 자정을 UTC ISO 문자열로 변환 — DB 쿼리 범위 필터용
 * 예: '2026-03-19' → '2026-03-18T15:00:00.000Z' (KST 03-19 00:00 = UTC 03-18 15:00)
 */
export function kstDateToUTCISO(kstDate: string): string {
  return new Date(new Date(kstDate).getTime() - KST_OFFSET_MS).toISOString()
}

/**
 * UTC ISO 문자열을 KST 날짜(YYYY-MM-DD)로 변환 — 버킷 분류용
 * 예: '2026-03-18T17:00:00.000Z' → '2026-03-19' (UTC 03-18 17:00 = KST 03-19 02:00)
 */
export function utcISOToKSTDate(utcISO: string): string {
  return toKST(new Date(utcISO)).toISOString().slice(0, 10)
}

/** UTC ISO 문자열을 KST 날짜+시간(YYYY-MM-DD HH:mm)으로 변환 */
export function utcISOToKSTDateTime(utcISO: string): string {
  const iso = toKST(new Date(utcISO)).toISOString()
  return iso.slice(0, 10) + ' ' + iso.slice(11, 16)
}

/**
 * UTC ISO 문자열을 KST 월(YYYY-MM)로 변환 — 연간 버킷 분류용
 */
export function utcISOToKSTMonth(utcISO: string): string {
  return toKST(new Date(utcISO)).toISOString().slice(0, 7)
}
