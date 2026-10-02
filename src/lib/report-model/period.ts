/**
 * 보고 기간 — 화면·메일·확정본이 함께 쓰는 단 하나의 기간 계산(KST 기준, 끝은 미포함).
 *
 * 날짜를 Date 의 지역 시간으로 다루면 서버 시간대에 따라 하루씩 밀린다. 그래서 'YYYY-MM-DD' 문자열을
 * UTC 자정 Date 로만 다뤄 시간대와 무관하게 계산한다.
 */
export type ReportType = 'weekly' | 'monthly' | 'yearly'
export interface Period { type: ReportType; start: string; end: string }

const DAY = 86_400_000
const pad = (n: number) => String(n).padStart(2, '0')
const toDate = (s: string) => new Date(`${s}T00:00:00Z`)
const fmt = (d: Date) => `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`

export function addDays(day: string, n: number): string {
  return fmt(new Date(toDate(day).getTime() + n * DAY))
}

/** 지금의 KST 날짜 */
export function kstToday(now: Date = new Date()): string {
  return fmt(new Date(now.getTime() + 9 * 3_600_000))
}

/** 날짜가 속한 기간. 주간은 월요일 시작. */
export function periodOf(type: ReportType, day: string): Period {
  const d = toDate(day)
  if (type === 'weekly') {
    const dow = d.getUTCDay() // 0=일
    const start = addDays(day, -(dow === 0 ? 6 : dow - 1))
    return { type, start, end: addDays(start, 7) }
  }
  const y = d.getUTCFullYear(), m = d.getUTCMonth()
  if (type === 'monthly') {
    const start = `${y}-${pad(m + 1)}-01`
    const end = m === 11 ? `${y + 1}-01-01` : `${y}-${pad(m + 2)}-01`
    return { type, start, end }
  }
  return { type, start: `${y}-01-01`, end: `${y + 1}-01-01` }
}

/** 바로 앞 기간 */
export function previousPeriod(p: Period): Period {
  return periodOf(p.type, addDays(p.start, -1))
}

/** 다음 기간 */
export function nextPeriod(p: Period): Period {
  return periodOf(p.type, p.end)
}

/** 기간이 다 지났는가(끝 시각이 지났는가). 끝 = 끝 날짜 KST 0시. */
export function isClosed(p: Period, now: Date = new Date()): boolean {
  return kstToday(now) >= p.end
}

/** 기간 안의 날짜들(연간은 월 첫날들). */
export function buckets(p: Period): string[] {
  const out: string[] = []
  if (p.type === 'yearly') {
    const y = Number(p.start.slice(0, 4))
    for (let m = 1; m <= 12; m++) out.push(`${y}-${pad(m)}-01`)
    return out
  }
  for (let d = p.start; d < p.end; d = addDays(d, 1)) out.push(d)
  return out
}

/** KST 날짜 → 그날 0시의 UTC ISO */
export function kstDayStartISO(day: string): string {
  return new Date(toDate(day).getTime() - 9 * 3_600_000).toISOString()
}

/** UTC ISO → KST 날짜 */
export function kstDayOf(iso: string): string {
  const t = new Date(iso).getTime()
  return isNaN(t) ? '' : fmt(new Date(t + 9 * 3_600_000))
}

/** 직전 N개 월 기간(이번 달 포함, 오래된 순) */
export function lastMonths(endMonth: Period, n: number): Period[] {
  const out: Period[] = [endMonth]
  let cur = endMonth
  for (let i = 1; i < n; i++) { cur = previousPeriod(cur); out.unshift(cur) }
  return out
}
