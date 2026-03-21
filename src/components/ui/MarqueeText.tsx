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
