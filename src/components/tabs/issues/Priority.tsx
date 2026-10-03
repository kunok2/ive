'use client'

/**
 * 작업 우선순위 — 0 보통 · 1 높음 · 2 긴급. 에이전트가 대기 작업을 높은 것부터 집는다(IVE DB 에만 저장).
 * 보통은 표시하지 않는다(기본값). 색은 상태 의미색: 긴급=빨강, 높음=주황.
 */
import { useTranslations } from 'next-intl'

export type Priority = 0 | 1 | 2

const BADGE: Record<1 | 2, string> = {
  2: 'bg-ive-red/15 text-ive-red border-ive-red/30',
  1: 'bg-ive-amber/15 text-ive-amber border-ive-amber/30',
}
const ICON: Record<1 | 2, string> = { 2: 'fa-angles-up', 1: 'fa-angle-up' }

/** 카드·머리줄의 작은 배지 — 보통이면 그리지 않는다 */
export function PriorityBadge({ priority }: { priority?: number | null }) {
  const t = useTranslations('issue')
  if (priority !== 1 && priority !== 2) return null
  return (
    <span className={`inline-flex items-center gap-0.5 px-1.5 py-0.5 rounded-lg border text-xs font-bold shrink-0 ${BADGE[priority]}`} title={t('priorityHint')}>
      <i className={`fa-solid ${ICON[priority]}`} />{t(`priority${priority}`)}
    </span>
  )
}

/** 보통·높음·긴급 고르기 — 작업 추가 폼과 상세의 마감일 빠른 버튼과 같은 모양 */
export function PriorityPicker({ value, onChange, disabled }: { value: Priority; onChange: (p: Priority) => void; disabled?: boolean }) {
  const t = useTranslations('issue')
  const on = (p: Priority) => p === 2 ? 'bg-ive-red/15 text-ive-red border-ive-red/40'
    : p === 1 ? 'bg-ive-amber/15 text-ive-amber border-ive-amber/40'
    : 'bg-ive-green/10 text-ive-green border-ive-green/40'
  return (
    <div className="flex flex-wrap items-center gap-1.5">
      <label className="text-xs font-bold text-ive-text-dim shrink-0" title={t('priorityHint')}>
        <i className="fa-solid fa-arrow-up-wide-short mr-1" />{t('priority')}
      </label>
      {([0, 1, 2] as Priority[]).map(p => (
        <button
          key={p}
          type="button"
          disabled={disabled}
          aria-pressed={value === p}
          onClick={() => value !== p && onChange(p)}
          className={`shrink-0 text-xs font-bold px-2 py-1.5 rounded-lg border transition-all disabled:opacity-40 ${value === p ? on(p) : 'bg-ive-bg-deep text-ive-text-dim border-ive-border-dark hover:border-ive-green/50'}`}
        >
          {p > 0 && <i className={`fa-solid ${ICON[p as 1 | 2]} mr-1`} />}{t(`priority${p}`)}
        </button>
      ))}
    </div>
  )
}
