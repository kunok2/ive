'use client'

import { useTranslations } from 'next-intl'

/**
 * 그 단계에서 아직 아무도 잡지 않은 건수 — 진행 숫자 옆 「←n」(들어와 기다리는 n건).
 * 완료 칸의 증분 「+n/-n」과 같은 모양(작은 굵은 글씨, 숫자와 기준선 맞춤). 뜻은 title(「대기 n건」)로.
 * 색은 읽히는 보조색 — dim(#52525b)은 다크 카드에서 2.2:1 이라 안 읽혔다. 0이면 그리지 않는다.
 */
export default function WaitPill({ n, title }: { n: number; title: string }) {
  const tp = useTranslations('project')
  if (n <= 0) return null
  return (
    <span title={title} aria-label={title} className="text-xs font-bold text-ive-text-secondary tabular-nums whitespace-nowrap">
      {tp('waitShort', { n })}
    </span>
  )
}
