/**
 * 보고서 화면 표기 — 메일과 같은 표기 함수(lib/report-model/format)를 쓰고, 화면용 색 클래스만 더한다.
 */
export { fmtHours, pct, deltaTone, agedCount, AGED_HOURS, MIN_SAMPLE, type Tr } from '@/lib/report-model/format'

export const toneClass = { good: 'text-ive-cyan', bad: 'text-ive-red', neutral: 'text-ive-text-secondary' } as const
