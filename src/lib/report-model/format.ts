/**
 * 보고서 표기 — 화면과 메일이 함께 쓴다(같은 값은 같은 글자로).
 * 숫자에는 색을 쓰지 않는다(디자인 가이드). 색은 상태·증감 의미에만.
 */
export type Tr = (key: string, params?: Record<string, string | number>) => string

/** 시간(시) → "1일 6시간" / "4시간" / "35분". 기록이 없으면 "기록 없음" */
export function fmtHours(tr: Tr, h: number | null | undefined): string {
  if (h == null || !Number.isFinite(h)) return tr('noRecord')
  if (h < 1) return tr('durMin', { m: Math.max(1, Math.round(h * 60)) })
  // 전체를 먼저 시 단위로 반올림한 뒤 나눈다(23.6시간이 "24시간", 47.6시간이 "1일 24시간"이 되지 않게)
  const total = Math.round(h)
  if (total < 24) return tr('durHour', { h: total })
  const d = Math.floor(total / 24), r = total - d * 24
  return r > 0 ? tr('durDayHour', { d, h: r }) : tr('durDay', { d })
}

export function pct(v: number | null | undefined): string {
  if (v == null || !Number.isFinite(v)) return '—'
  return `${Math.round(v * 100)}%`
}

/**
 * 증감의 의미. goodWhenUp: 늘면 좋은 맥락(완료)이면 true, 늘면 나쁜 맥락(보유·비용)이면 false.
 * 이전 값이 없거나 0 이거나 변화가 ±5% 이하면 중립(색 없음).
 */
export function deltaTone(cur: number, prev: number | null | undefined, goodWhenUp: boolean): 'good' | 'bad' | 'neutral' {
  if (prev == null || prev === 0) return 'neutral'
  const r = (cur - prev) / prev
  if (Math.abs(r) <= 0.05) return 'neutral'
  return (r > 0) === goodWhenUp ? 'good' : 'bad'
}

/** 7일 넘게 보유하면 "오래 머문 일" */
export const AGED_HOURS = 7 * 24
/** 7일 넘게 보유 중인 일 수 — 화면("내 손에 있는 일")과 메일이 같은 함수로 센다 */
export const agedCount = (issues: { ageHours: number }[]) => issues.filter(i => i.ageHours >= AGED_HOURS).length

/** 작업 결과 평가 — 이 건수가 모여야 비율을 보여준다 */
export const MIN_SAMPLE = 20

// ─── 프로젝트 주제색 ───

/** 주제색이 없는 옛 프로젝트 — 프로젝트 카드와 같은 기본색 */
export const DEFAULT_PROJECT_COLOR = '#4ade80'
/** 주제색 중 "흰색" — 밝은 배경(라이트 테마·메일)에서 보이지 않아 중립색으로 바꿔 칠한다 */
export const WHITE_PROJECT_COLOR = '#e0e0e0'
/** 「누가 검증·확인했나」 사람 조각 색 — 프로젝트 색 목록에서 단계색(검증 보라·확인 분홍)과 겹치지 않는 것만, 많이 한 순서로. 화면·메일 공용 */
export const PERSON_COLORS = ['#22d3ee', '#60a5fa', '#fbbf24', '#a3e635', '#fb923c']
/** 비중 막대의 「기타」 조각 id */
export const OTHERS_ID = '__others'

/**
 * 프로젝트별 비중 막대 조각의 색 — 화면과 메일이 같은 규칙으로 칠한다.
 * 프로젝트는 주제색, 「기타」는 중립(color: null). 같은 주제색이 다시 나오면 농도를 낮춰 구분한다.
 */
export function projectSwatches(parts: { id: string; color?: string | null }[]): { color: string | null; alpha: number }[] {
  const seen = new Map<string, number>()
  return parts.map(p => {
    if (p.id === OTHERS_ID) return { color: null, alpha: 1 }
    const color = (p.color || DEFAULT_PROJECT_COLOR).toLowerCase()
    const n = seen.get(color) ?? 0
    seen.set(color, n + 1)
    return { color, alpha: [1, 0.55, 0.3][Math.min(n, 2)] }
  })
}
