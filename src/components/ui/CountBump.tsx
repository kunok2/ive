'use client'

import { useEffect, useRef, useState, type ReactNode } from 'react'

/**
 * 숫자가 바뀌는 순간 한 번 살짝 커졌다 돌아온다 — 숫자가 바뀌었다는 것을 눈으로 알게.
 * 처음 그릴 때(데이터를 받아 오는 첫 1.5초)는 튀지 않는다. 움직임 줄이기 설정이면 움직이지 않는다(globals.css).
 * 진행 중 깜빡임(animate-pulse)은 바깥 span 에 두고 이 부품은 안쪽에 둔다 — 둘이 겹쳐도 서로 지우지 않는다.
 */
export default function CountBump({ value, children, className = '' }: { value: unknown; children?: ReactNode; className?: string }) {
  const prev = useRef(value)
  const mountedAt = useRef(Date.now())
  const [bump, setBump] = useState(0)
  useEffect(() => {
    if (Object.is(prev.current, value)) return
    prev.current = value
    if (Date.now() - mountedAt.current < 1500) return
    setBump(n => n + 1)
  }, [value])
  // key 를 바꿔 같은 애니메이션을 다시 시작한다
  return <span key={bump} className={`inline-block ${bump ? 'animate-count-bump' : ''} ${className}`}>{children ?? String(value ?? '')}</span>
}
