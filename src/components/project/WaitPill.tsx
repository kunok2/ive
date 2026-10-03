'use client'

import { useTranslations } from 'next-intl'

/**
 * 그 단계에서 아직 아무도 잡지 않은 건수 — 진행 숫자 옆의 흐린 글씨 「대기 n」.
 * 진행 중 숫자보다 눈에 덜 띄게 둔다(테두리·아이콘 없음). 0이면 그리지 않는다.
 */
export default function WaitPill({ n, title }: { n: number; title: string }) {
  const tp = useTranslations('project')
  if (n <= 0) return null
  return (
    <span title={title} className="text-[11px] font-bold leading-none text-ive-text-dim tabular-nums whitespace-nowrap">
      {tp('waitShort', { n })}
    </span>
  )
}
