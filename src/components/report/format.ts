/**
 * 보고서 화면·메일 공용 표기. 숫자에는 색을 쓰지 않는다(디자인 가이드). 색은 상태·증감 의미에만.
 */
export type Tr = (key: string, params?: Record<string, string | number>) => string

/** 시간(시) → "1일 6시간" / "4시간" / "35분" */
export function fmtHours(tr: Tr, h: number | null | undefined): string {
  if (h == null || !Number.isFinite(h)) return tr('none')
  if (h < 1) return tr('durMin', { m: Math.max(1, Math.round(h * 60)) })
  if (h < 24) return tr('durHour', { h: Math.round(h) })
  const d = Math.floor(h / 24), r = Math.round(h - d * 24)
  return r > 0 ? tr('durDayHour', { d, h: r }) : tr('durDay', { d })
}

export function pct(v: number | null | undefined, digits = 0): string {
  if (v == null || !Number.isFinite(v)) return '—'
  return `${(v * 100).toFixed(digits)}%`
}

/**
 * 증감 표시. goodWhenUp: 늘면 좋은 맥락(완료)이면 true, 늘면 나쁜 맥락(보유·비용)이면 false.
 * ±5% 이하나 이전 값이 없으면 중립(색 없음).
 */
export function deltaTone(cur: number, prev: number | null | undefined, goodWhenUp: boolean): 'good' | 'bad' | 'neutral' {
  if (prev == null || prev === 0) return 'neutral'
  const r = (cur - prev) / prev
  if (Math.abs(r) <= 0.05) return 'neutral'
  return (r > 0) === goodWhenUp ? 'good' : 'bad'
}

export const toneClass = { good: 'text-ive-cyan', bad: 'text-ive-red', neutral: 'text-ive-text-secondary' } as const
