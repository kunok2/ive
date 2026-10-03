'use client'

import { useEffect, useState } from 'react'

/** globals.css 의 --breakpoint-desk(75rem = 1200px)와 같은 기준 */
export const DESK_QUERY = '(min-width: 75rem)'

/**
 * 미디어 쿼리 일치 여부. 서버 렌더와 첫 렌더는 false(폰 배치)로 시작해 마운트 후 맞춘다.
 * CSS(`desk:`)로 되는 배치는 CSS로 하고, 동작이 갈리는 곳(옆 칸에 열기 등)만 이 훅을 쓴다.
 */
export function useMediaQuery(query: string): boolean {
  const [matches, setMatches] = useState(false)
  useEffect(() => {
    const mq = window.matchMedia(query)
    const update = () => setMatches(mq.matches)
    update()
    mq.addEventListener('change', update)
    return () => mq.removeEventListener('change', update)
  }, [query])
  return matches
}

/** PC 폭(1200px 이상)인가 */
export const useIsDesk = () => useMediaQuery(DESK_QUERY)
