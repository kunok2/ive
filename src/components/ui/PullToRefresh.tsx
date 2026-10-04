'use client'

import { useRef, useState, useCallback, type ReactNode, type RefObject } from 'react'
import { useTranslations } from 'next-intl'

interface Props {
  onRefresh: () => Promise<void>
  children: ReactNode
  className?: string
  scrollContainerRef?: RefObject<HTMLElement | null>
}

// 손가락이 이만큼 아래로 움직이기 전에는 당김으로 보지 않는다 — 위로 스크롤하려는 짧은 손짓이 재조회로 번지지 않게
const DEAD_ZONE_PX = 24
// 당김 거리 = (이동 − 데드존) × 감쇠. 50 이상에서 놓으면 새로고침(손가락 약 150px)
const DAMPING = 0.4
const TRIGGER_PX = 50
const MAX_PULL_PX = 80

/** el 이 세로로 스크롤되는 칸인지 — 내용이 넘치고 overflow-y 가 auto/scroll */
function isScrollable(el: HTMLElement): boolean {
  if (el.scrollHeight <= el.clientHeight) return false
  const oy = getComputedStyle(el).overflowY
  return oy === 'auto' || oy === 'scroll'
}

export default function PullToRefresh({ onRefresh, children, className, scrollContainerRef }: Props) {
  const selfRef = useRef<HTMLDivElement>(null)
  const [pullY, setPullY] = useState(0)
  const [refreshing, setRefreshing] = useState(false)
  const touchStartY = useRef(0)
  const touchStartX = useRef(0)
  // 'idle' 터치 없음 · 'armed' 맨 위에서 시작했지만 아직 방향 미정 · 'pulling' 당기는 중
  const phase = useRef<'idle' | 'armed' | 'pulling'>('idle')
  // 이 터치가 시작된 곳을 감싼 스크롤 칸들 — 하나라도 맨 위가 아니면 당김이 아니라 그 칸의 스크롤이다
  const scrollers = useRef<HTMLElement[]>([])
  const t = useTranslations('pull')

  // 종전에는 바깥 칸(overflow-hidden)만 보고 창 스크롤(늘 0)로 판정해, 안쪽 칸을 위로 스크롤하는 손짓이 모두 당김이 됐다.
  // 이제 터치한 요소에서 이 컴포넌트까지 올라가며 실제로 스크롤되는 칸을 모은다.
  const collectScrollers = useCallback((target: EventTarget | null): HTMLElement[] => {
    const out: HTMLElement[] = []
    if (scrollContainerRef?.current) out.push(scrollContainerRef.current)
    let el = target instanceof HTMLElement ? target : null
    while (el && el !== selfRef.current) {
      if (isScrollable(el)) out.push(el)
      el = el.parentElement
    }
    if (selfRef.current && isScrollable(selfRef.current)) out.push(selfRef.current)
    return out
  }, [scrollContainerRef])

  const allAtTop = () => scrollers.current.every(s => s.scrollTop <= 0) && window.scrollY <= 0

  const onTouchStart = useCallback((e: React.TouchEvent) => {
    if (refreshing || e.touches.length !== 1) { phase.current = 'idle'; return }
    scrollers.current = collectScrollers(e.target)
    if (!allAtTop()) { phase.current = 'idle'; return }
    touchStartY.current = e.touches[0].clientY
    touchStartX.current = e.touches[0].clientX
    phase.current = 'armed'
  }, [refreshing, collectScrollers])

  const onTouchMove = useCallback((e: React.TouchEvent) => {
    if (phase.current === 'idle') return
    const dy = e.touches[0].clientY - touchStartY.current
    const dx = e.touches[0].clientX - touchStartX.current
    // 사이에 칸이 스크롤됐다(관성 등) — 그 칸의 스크롤로 넘긴다
    if (!allAtTop()) { phase.current = 'idle'; setPullY(0); return }
    if (phase.current === 'armed') {
      if (dy < 0 || Math.abs(dx) > Math.abs(dy)) {
        // 위로 미는(아래로 스크롤) 손짓이나 가로 손짓 — 이 터치는 당김이 아니다
        if (Math.abs(dy) > 8 || Math.abs(dx) > 8) phase.current = 'idle'
        return
      }
      if (dy < DEAD_ZONE_PX) return
      phase.current = 'pulling'
    }
    setPullY(Math.min(Math.max(0, (dy - DEAD_ZONE_PX) * DAMPING), MAX_PULL_PX))
  }, [])

  const onTouchEnd = useCallback(async () => {
    const wasPulling = phase.current === 'pulling'
    phase.current = 'idle'
    if (!wasPulling) { setPullY(0); return }
    if (pullY >= TRIGGER_PX) {
      setRefreshing(true)
      setPullY(40)
      try { await onRefresh() } finally { setRefreshing(false) }
    }
    setPullY(0)
  }, [pullY, onRefresh])

  return (
    <div
      ref={selfRef}
      className={className}
      onTouchStart={onTouchStart}
      onTouchMove={onTouchMove}
      onTouchEnd={onTouchEnd}
      onTouchCancel={onTouchEnd}
    >
      <div
        className="flex items-center justify-center overflow-hidden transition-all duration-200"
        style={{ height: pullY > 0 ? pullY : 0, opacity: pullY > 10 ? 1 : 0 }}
      >
        <i className={`fa-solid fa-arrows-rotate text-ive-green ${refreshing ? 'fa-spin' : ''}`} style={{ transform: `rotate(${pullY * 4}deg)` }} />
        <span className="ml-2 text-xs text-ive-text-muted font-bold">
          {refreshing ? t('loading') : pullY >= TRIGGER_PX ? t('releaseToRefresh') : t('pullToRefresh')}
        </span>
      </div>
      {children}
    </div>
  )
}
