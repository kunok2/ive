'use client'

import { useTranslations } from 'next-intl'
import CountBump from '@/components/ui/CountBump'

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
      <CountBump value={n}>{tp('waitShort', { n })}</CountBump>
    </span>
  )
}

/**
 * 처리(AI·사람)가 실패하고 아직 아무도 다시 처리하지 않은 건수(dev_fail) — 진행 숫자에 넣지 않고 따로 붙인다.
 * 방치되기 쉬워 빨강으로 드러낸다. 0이면 그리지 않는다.
 */
export function FailPill({ n }: { n: number }) {
  const tp = useTranslations('project')
  if (n <= 0) return null
  const title = tp('stageFailHint', { n })
  return (
    <span title={title} aria-label={title} className="text-xs font-bold text-ive-red tabular-nums whitespace-nowrap">
      <i className="fa-solid fa-triangle-exclamation mr-0.5" /><CountBump value={n} />
    </span>
  )
}
