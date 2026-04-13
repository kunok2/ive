'use client'

import { useEffect, useState } from 'react'
import { useTranslations } from 'next-intl'

export default function ElapsedTimer({ startTime }: { startTime: number | null }) {
  const [seconds, setSeconds] = useState(0)
  const tIssue = useTranslations('issue')
  useEffect(() => {
    if (!startTime) return
    const tick = () => setSeconds(Math.floor((Date.now() - startTime) / 1000))
    tick()
    const interval = setInterval(tick, 1000)
    return () => clearInterval(interval)
  }, [startTime])
  return (
    <span className="text-ive-cyan text-sm">
      {tIssue('chatThinking', { seconds })}
    </span>
  )
}
