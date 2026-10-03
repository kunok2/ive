'use client'

import { useTranslations } from 'next-intl'

/**
 * 그 단계에서 아직 아무도 잡지 않은 건수 — 진행 숫자 옆 보조 글씨 「대기 n」.
 * 진행 중 숫자보다 작게 두되(테두리·아이콘 없음) 읽을 수 있는 보조색으로 — dim(#52525b)은 다크 카드에서 2.4:1 이라 안 읽혔다. 0이면 그리지 않는다.
 */
export default function WaitPill({ n, title }: { n: number; title: string }) {
  const tp = useTranslations('project')
  if (n <= 0) return null
  return (
    <span title={title} className="text-xs font-bold leading-none text-ive-text-secondary tabular-nums whitespace-nowrap">
      {tp('waitShort', { n })}
    </span>
  )
}
