'use client'

import { useRef, useState, useCallback, type ReactNode, type RefObject } from 'react'
import { useTranslations } from 'next-intl'

interface Props {
  onRefresh: () => Promise<void>
  children: ReactNode
  className?: string
  scrollContainerRef?: RefObject<HTMLElement | null>
}

export default function PullToRefresh({ onRefresh, children, className, scrollContainerRef }: Props) {
  const [pullY, setPullY] = useState(0)
  const [refreshing, setRefreshing] = useState(false)
  const touchStartY = useRef(0)
  const pulling = useRef(false)
  const t = useTranslations('pull')

  const isAtTop = useCallback(() => {
    if (scrollContainerRef?.current) {
      return scrollContainerRef.current.scrollTop <= 0
    }
    return window.scrollY <= 0
  }, [scrollContainerRef])

  const onTouchStart = useCallback((e: React.TouchEvent) => {
    if (isAtTop() && !refreshing) {
      touchStartY.current = e.touches[0].clientY
      pulling.current = true
    }
  }, [refreshing, isAtTop])

  const onTouchMove = useCallback((e: React.TouchEvent) => {
    if (!pulling.current) return
    const dy = Math.max(0, (e.touches[0].clientY - touchStartY.current) * 0.4)
    setPullY(Math.min(dy, 80))
  }, [])

  const onTouchEnd = useCallback(async () => {
    if (!pulling.current) return
    pulling.current = false
    if (pullY >= 50) {
      setRefreshing(true)
      setPullY(40)
      try { await onRefresh() } finally { setRefreshing(false) }
    }
    setPullY(0)
  }, [pullY, onRefresh])

  return (
    <div
      className={className}
      onTouchStart={onTouchStart}
      onTouchMove={onTouchMove}
      onTouchEnd={onTouchEnd}
    >
      <div
        className="flex items-center justify-center overflow-hidden transition-all duration-200"
        style={{ height: pullY > 0 ? pullY : 0, opacity: pullY > 10 ? 1 : 0 }}
      >
        <i className={`fa-solid fa-arrows-rotate text-ive-green ${refreshing ? 'fa-spin' : ''}`} style={{ transform: `rotate(${pullY * 4}deg)` }} />
        <span className="ml-2 text-xs text-ive-text-dim font-bold">
          {refreshing ? t('loading') : pullY >= 50 ? t('releaseToRefresh') : t('pullToRefresh')}
        </span>
      </div>
      {children}
    </div>
  )
}
