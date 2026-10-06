'use client'

import { useEffect, useRef, useState } from 'react'

// 흐르는 속도(px/초)를 글 길이와 상관없이 일정하게 — 고정 주기면 긴 글일수록 빨라져 읽을 수 없었다(IVE #542).
const SCROLL_SPEED = 30
// keyframes(globals.css `marquee`)에서 실제로 움직이는 구간(12% → 88%)의 비율
const MOVE_RATIO = 0.76
// 짧은 글은 종전 주기(12초)보다 빨라지지 않게
const MIN_DURATION = 12

export default function MarqueeText({ children, className }: { children: React.ReactNode; className?: string }) {
  const containerRef = useRef<HTMLDivElement>(null)
  const contentRef = useRef<HTMLSpanElement>(null)
  const [scrolling, setScrolling] = useState(false)

  useEffect(() => {
    const container = containerRef.current
    const content = contentRef.current
    if (!container || !content) return
    const check = () => {
      // measure only the first copy (original text)
      const firstChild = content.children[0] as HTMLElement | undefined
      if (!firstChild) return
      const textWidth = firstChild.scrollWidth
      const viewWidth = container.clientWidth
      if (textWidth > viewWidth) {
        // scroll distance = text width + gap so the second copy lands exactly at the start
        const gap = 80
        const scrollDist = textWidth + gap
        content.style.setProperty('--marquee-scroll', `-${scrollDist}px`)
        const duration = Math.max(MIN_DURATION, scrollDist / SCROLL_SPEED / MOVE_RATIO)
        content.style.setProperty('--marquee-duration', `${duration.toFixed(1)}s`)
        setScrolling(true)
      } else {
        setScrolling(false)
      }
    }
    check()
    const ro = new ResizeObserver(check)
    ro.observe(container)
    return () => ro.disconnect()
  }, [children])

  return (
    <div ref={containerRef} className="marquee-container min-w-0">
      <span ref={contentRef} className={`marquee-content ${scrolling ? 'scrolling' : ''} ${className ?? ''}`}>
        <span className="marquee-segment">{children}</span>
        {scrolling && <span className="marquee-segment marquee-gap">{children}</span>}
      </span>
    </div>
  )
}
