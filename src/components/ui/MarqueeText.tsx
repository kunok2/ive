'use client'

import { useEffect, useRef, useState } from 'react'

export default function MarqueeText({ children, className }: { children: React.ReactNode; className?: string }) {
  const containerRef = useRef<HTMLDivElement>(null)
  const contentRef = useRef<HTMLSpanElement>(null)
  const [scrolling, setScrolling] = useState(false)

  useEffect(() => {
    const container = containerRef.current
    const content = contentRef.current
    if (!container || !content) return
    const check = () => {
      const overflow = content.scrollWidth - container.clientWidth
      if (overflow > 0) {
        content.style.setProperty('--marquee-distance', `-${overflow}px`)
        content.style.setProperty('--marquee-reset', `${container.clientWidth}px`)
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
        {children}
      </span>
    </div>
  )
}
