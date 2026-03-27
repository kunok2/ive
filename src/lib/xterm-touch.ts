import type { Terminal } from '@xterm/xterm'

/**
 * xterm.js 모바일 터치 스크롤 (관성/모멘텀 포함)
 * iOS Safari에서 네이티브처럼 부드러운 스크롤 제공
 */
export function setupXtermTouchScroll(el: HTMLElement, term: Terminal): () => void {
  let touchY = 0
  let velocity = 0
  let lastTime = 0
  let animFrame = 0
  let accumulated = 0

  const FRICTION = 0.92
  const MIN_VELOCITY = 0.5
  const PX_PER_LINE = 14

  const onTouchStart = (e: TouchEvent) => {
    // 진행 중인 관성 스크롤 중단
    if (animFrame) {
      cancelAnimationFrame(animFrame)
      animFrame = 0
    }
    touchY = e.touches[0].clientY
    lastTime = e.timeStamp
    velocity = 0
    accumulated = 0
  }

  const onTouchMove = (e: TouchEvent) => {
    e.preventDefault()
    const now = e.timeStamp
    const currentY = e.touches[0].clientY
    const dy = touchY - currentY
    const dt = Math.max(now - lastTime, 1)

    // 속도 계산 (px/ms) — 이전 속도와 블렌딩
    velocity = 0.7 * (dy / dt) + 0.3 * velocity

    touchY = currentY
    lastTime = now

    // 즉시 스크롤
    accumulated += dy
    const lines = Math.trunc(accumulated / PX_PER_LINE)
    if (lines !== 0) {
      term.scrollLines(lines)
      accumulated -= lines * PX_PER_LINE
    }
  }

  const onTouchEnd = () => {
    // 관성 스크롤 시작 (속도를 px/frame으로 변환, ~16ms/frame)
    let v = velocity * 16
    accumulated = 0

    const animate = () => {
      v *= FRICTION
      if (Math.abs(v) < MIN_VELOCITY) return

      accumulated += v
      const lines = Math.trunc(accumulated / PX_PER_LINE)
      if (lines !== 0) {
        term.scrollLines(lines)
        accumulated -= lines * PX_PER_LINE
      }

      animFrame = requestAnimationFrame(animate)
    }

    if (Math.abs(v) > MIN_VELOCITY) {
      animFrame = requestAnimationFrame(animate)
    }
  }

  el.addEventListener('touchstart', onTouchStart, { passive: true })
  el.addEventListener('touchmove', onTouchMove, { passive: false })
  el.addEventListener('touchend', onTouchEnd, { passive: true })

  return () => {
    if (animFrame) cancelAnimationFrame(animFrame)
    el.removeEventListener('touchstart', onTouchStart)
    el.removeEventListener('touchmove', onTouchMove)
    el.removeEventListener('touchend', onTouchEnd)
  }
}
