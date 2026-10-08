'use client'

/**
 * 보고서 가로 누적 막대 — 조각마다 호버·포커스 툴팁(값 굵게 + 이름), 호버한 조각만 또렷하게.
 *
 * 막대는 10~12px 로 얇아 칠한 부분만 호버 대상으로 두면 맞히기 어렵다 — 조각마다 위아래로 투명한 호버 칸을 둔다.
 * 아래 범례 줄과 같은 hovered 를 쓰면 줄 ↔ 조각이 함께 강조된다(sections 의 WhereSection 등).
 * 툴팁은 꾸밈일 뿐 값은 범례 줄·표에도 있다(툴팁이 정보를 가두지 않는다).
 */
import { useState, type CSSProperties, type PointerEvent } from 'react'

/**
 * 호버 강조 핸들러 — 마우스·펜만. 터치는 스크롤하려고 손가락을 대기만 해도 pointerenter→(스크롤 시작)pointerleave 가
 * 연달아 와서 툴팁·강조가 번쩍 나왔다 사라진다(잔상). 터치에서는 탭(포커스)으로만 툴팁을 띄운다.
 */
export function hoverHandlers(key: string, set: (key: string | null) => void) {
  return {
    onPointerEnter: (e: PointerEvent) => { if (e.pointerType !== 'touch') set(key) },
    onPointerLeave: (e: PointerEvent) => { if (e.pointerType !== 'touch') set(null) },
  }
}

export interface HBarSegment {
  key: string
  /** 조각 크기(비율·건수 아무거나 — flexGrow) */
  value: number
  /** 툴팁 이름 */
  label: string
  /** 툴팁 값(굵게) */
  valueText: string
  className?: string
  style?: CSSProperties
  /** 묶음 — 같은 묶음끼리 이어 붙이고, 묶음마다 둥글게 시작해 둥글게 끝난다(예: 처리대기+처리). 없으면 막대 전체가 한 묶음 */
  group?: string
}

export function StackedHBar({
  segments, heightClass = 'h-2.5', gapClass = 'gap-0.5', hovered: hoveredProp, onHover, showTip = true,
}: {
  segments: HBarSegment[]
  heightClass?: string
  gapClass?: string
  /** 바깥(범례 줄)과 강조를 나눌 때 — 주지 않으면 막대 혼자 관리 */
  hovered?: string | null
  onHover?: (key: string | null) => void
  /** 툴팁 — 여러 막대가 강조를 나눌 때(같은 단계를 모든 달에서 강조) 호버한 막대에만 띄운다 */
  showTip?: boolean
}) {
  const [own, setOwn] = useState<string | null>(null)
  const hovered = hoveredProp !== undefined ? hoveredProp : own
  const setHovered = (k: string | null) => { if (onHover) onHover(k); else setOwn(k) }
  const shown = segments.filter(s => s.value > 0)
  // 묶음이 있으면 묶음 안은 완전히 붙이고(대기+진행 한 덩어리) 묶음 사이만 띄운다
  const grouped = shown.some(s => s.group != null)
  const total = shown.reduce((sum, s) => sum + s.value, 0)
  if (total <= 0) return null

  // 툴팁 위치 — 호버한 조각의 가운데. 양끝 근처면 막대 밖으로 넘치지 않게 한쪽으로 붙인다
  let acc = 0
  const centers = new Map<string, number>()
  for (const s of shown) { centers.set(s.key, (acc + s.value / 2) / total); acc += s.value }
  const tip = hovered && showTip ? shown.find(s => s.key === hovered) : undefined
  const c = tip ? centers.get(tip.key)! : 0
  const shift = c < 0.15 ? '0%' : c > 0.85 ? '-100%' : '-50%'

  return (
    <div className="relative" onPointerLeave={e => { if (e.pointerType !== 'touch') setHovered(null) }}>
      {/* 바탕 줄 — 조각 사이 틈으로 보인다 */}
      <div className={`absolute inset-x-0 top-1/2 -translate-y-1/2 rounded-full bg-ive-bg ${heightClass}`} aria-hidden="true" />
      <div className={`relative flex ${grouped ? '' : gapClass} -my-2`}>
        {shown.map((s, i) => {
          const dim = hovered != null && hovered !== s.key
          const groupStart = i === 0 || shown[i - 1].group !== s.group
          const groupEnd = i === shown.length - 1 || shown[i + 1].group !== s.group
          return (
            <div
              key={s.key}
              role="img"
              tabIndex={0}
              aria-label={`${s.label} ${s.valueText}`}
              className={`py-2 outline-none cursor-default group transition-opacity duration-150 ${dim ? 'opacity-35' : ''}`}
              style={{ flexGrow: s.value, flexBasis: 0, minWidth: 4, marginLeft: groupStart && i > 0 && s.group != null ? 4 : undefined, WebkitTapHighlightColor: 'transparent' }}
              onPointerEnter={e => { if (e.pointerType !== 'touch') setHovered(s.key) }}
              onFocus={() => setHovered(s.key)}
              onBlur={() => setHovered(null)}
            >
              <div
                className={`${heightClass} transition-[filter] duration-150 ${groupStart ? 'rounded-l-full' : ''} ${groupEnd ? 'rounded-r-full' : ''} ${hovered === s.key ? 'brightness-125' : ''} group-focus-visible:ring-2 group-focus-visible:ring-ive-text/60 ${s.className ?? ''}`}
                style={s.style}
              />
            </div>
          )
        })}
      </div>
      {tip && (
        <div
          className="pointer-events-none absolute bottom-full mb-1 z-10 whitespace-nowrap rounded-lg border border-ive-border bg-ive-bg-solid px-2 py-1 text-xs font-bold flex items-center gap-1.5"
          style={{ left: `${c * 100}%`, transform: `translateX(${shift})` }}
          role="tooltip"
        >
          <span className={`inline-block w-2.5 h-0.5 rounded-full ${tip.className ?? ''}`} style={tip.style} aria-hidden="true" />
          <span className="text-ive-text tabular-nums">{tip.valueText}</span>
          <span className="text-ive-text-secondary">{tip.label}</span>
        </div>
      )}
    </div>
  )
}
