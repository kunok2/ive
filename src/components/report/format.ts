/**
 * 보고서 화면 표기 — 메일과 같은 표기 함수(lib/report-model/format)를 쓰고, 화면용 색 클래스만 더한다.
 */
import type { CSSProperties } from 'react'
import { projectSwatches, WHITE_PROJECT_COLOR } from '@/lib/report-model/format'

export { fmtHours, pct, deltaTone, agedCount, AGED_HOURS, MIN_SAMPLE, OTHERS_ID, type Tr } from '@/lib/report-model/format'

export const toneClass = { good: 'text-ive-cyan', bad: 'text-ive-red', neutral: 'text-ive-text-secondary' } as const

/**
 * 프로젝트별 비중 막대·범례 점의 화면 스타일 — 프로젝트 주제색(메일과 같은 규칙, projectSwatches).
 * 흰색 주제색은 라이트 테마에서 사라지므로 테마 보조 글자색으로, 「기타」는 중립색으로 칠한다.
 */
export function projectSwatchStyles(parts: { id: string; color?: string | null }[]): CSSProperties[] {
  return projectSwatches(parts).map(s => s.color == null
    ? { background: 'var(--color-ive-text-muted)', opacity: 0.35 }
    : { background: s.color === WHITE_PROJECT_COLOR ? 'var(--color-ive-text-secondary)' : s.color, opacity: s.alpha })
}
