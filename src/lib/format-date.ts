/**
 * 사용자 설정 기반 날짜 포맷 유틸리티
 * locale과 timezone은 User 객체에서 가져온다.
 */

const DEFAULT_TIMEZONE = 'Asia/Seoul'
const DEFAULT_LOCALE = 'ko-KR'

function resolveLocale(locale?: string): string {
  if (!locale) return DEFAULT_LOCALE
  // 'ko' → 'ko-KR', 'en' → 'en-US'
  const map: Record<string, string> = { ko: 'ko-KR', en: 'en-US' }
  return map[locale] || locale
}

function resolveTz(timezone?: string): string {
  return timezone || DEFAULT_TIMEZONE
}

/**
 * SQLite datetime('now') 형식('YYYY-MM-DD HH:MM:SS')을 ISO 8601로 정규화.
 * 브라우저가 timezone 지시자 없는 문자열을 로컬 시간으로 해석하는 것을 방지.
 */
function parseDate(iso: string): Date {
  if (/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/.test(iso)) {
    return new Date(iso.replace(' ', 'T'))
  }
  return new Date(iso)
}

/** 예: "3월 28일 14:30" */
export function formatDateLong(iso: string, locale?: string, timezone?: string): string {
  try {
    const d = parseDate(iso)
    return d.toLocaleString(resolveLocale(locale), {
      timeZone: resolveTz(timezone),
      month: 'long', day: 'numeric', hour: '2-digit', minute: '2-digit', hour12: false,
    })
  } catch { return iso }
}

/** 예: "03/28 14:30" */
export function formatDateShort(iso: string, locale?: string, timezone?: string): string {
  try {
    const d = parseDate(iso)
    return d.toLocaleString(resolveLocale(locale), {
      timeZone: resolveTz(timezone),
      month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hour12: false,
    })
  } catch { return iso }
}

/** 예: "3월 28일 14:30" (short month) */
export function formatDateMedium(iso: string, locale?: string, timezone?: string): string {
  try {
    const d = parseDate(iso)
    return d.toLocaleString(resolveLocale(locale), {
      timeZone: resolveTz(timezone),
      month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit', hour12: false,
    })
  } catch { return iso }
}

/** 예: "14:30" */
export function formatTime(iso: string, locale?: string, timezone?: string): string {
  try {
    const d = parseDate(iso)
    return d.toLocaleString(resolveLocale(locale), {
      timeZone: resolveTz(timezone),
      hour: '2-digit', minute: '2-digit', hour12: false,
    })
  } catch { return iso }
}

/** 예: "14:30:59" — 시:분:초 (사용자 타임존 적용) */
export function formatTimeWithSeconds(iso: string, locale?: string, timezone?: string): string {
  try {
    const d = parseDate(iso)
    return d.toLocaleString(resolveLocale(locale), {
      timeZone: resolveTz(timezone),
      hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false,
    })
  } catch { return iso }
}

/** 예: "03/28 14:30:59" */
export function formatDateWithSeconds(iso: string, locale?: string, timezone?: string): string {
  try {
    const d = parseDate(iso)
    return d.toLocaleString(resolveLocale(locale), {
      timeZone: resolveTz(timezone),
      month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false,
    })
  } catch { return iso }
}

/** 풀 포맷 (toLocaleString 기본) */
export function formatDateFull(iso: string, locale?: string, timezone?: string): string {
  try {
    const d = parseDate(iso)
    return d.toLocaleString(resolveLocale(locale), { timeZone: resolveTz(timezone) })
  } catch { return iso }
}
