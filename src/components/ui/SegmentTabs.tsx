'use client'

/**
 * 화면 위쪽 「종류」 고르기 버튼 줄 — 보고서(주간·월간·연간)와 개발자(전체·처리·검증·확인)가 같이 쓴다.
 * 두 화면의 위쪽은 같은 순서·같은 모양: 프로젝트 필터 → 이 버튼 줄 → (보고서만) 기간 이동.
 * count 는 이름 옆 숫자, badge 는 그 옆 청록 칩(쌓인 일 등). 아이콘은 폭이 좁은 폰에서는 숨긴다.
 */
export interface SegmentItem<K extends string> {
  key: K
  label: string
  icon?: string
  count?: number
  badge?: number
}

export default function SegmentTabs<K extends string>({ items, value, onChange, dataTour }: {
  items: SegmentItem<K>[]
  value: K
  onChange: (key: K) => void
  dataTour?: string
}) {
  return (
    <div data-tour={dataTour} className="flex gap-1 mb-2 desk:flex-1 desk:min-w-0" role="tablist">
      {items.map(it => {
        const on = it.key === value
        return (
          <button
            key={it.key}
            type="button"
            role="tab"
            aria-selected={on}
            onClick={() => onChange(it.key)}
            className={`flex-1 min-w-0 min-h-11 px-1 inline-flex items-center justify-center gap-1 text-sm font-bold rounded-lg transition-all ${on ? 'bg-ive-green text-ive-bg-deep' : 'bg-ive-bg-card text-ive-text-secondary'}`}
          >
            {/* 아이콘 글꼴의 display 가 hidden 을 이기므로 감싼 요소에서 숨긴다 */}
            {it.icon && <span className="hidden pad:inline" aria-hidden="true"><i className={`fa-solid ${it.icon}`} /></span>}
            <span className="truncate">{it.label}{it.count != null && ` ${it.count}`}</span>
            {!!it.badge && (
              <span className={`inline-flex px-1.5 rounded-lg text-xs font-bold shrink-0 ${on ? 'bg-ive-bg-deep/30 text-ive-bg-deep' : 'bg-ive-cyan/20 text-ive-cyan'}`}>{it.badge}</span>
            )}
          </button>
        )
      })}
    </div>
  )
}
