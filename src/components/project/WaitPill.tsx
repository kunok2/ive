'use client'

import { useTranslations } from 'next-intl'
import CountBump from '@/components/ui/CountBump'
import { STAGE_TONE } from '@/lib/active-work'

/** 대기·실패 표시의 공통 꼴 — 바탕 없는 아이콘 + 작은 굵은 숫자(배지로 만들지 않는다 — 큰 숫자 옆에서 덩어리가 커진다). 나란히 놓이므로 꼴이 같아야 한다 */
const PILL = 'text-xs font-bold tabular-nums whitespace-nowrap'

/**
 * 그 단계에서 아직 아무도 잡지 않은 건수 — 시계 + n(기다리는 n건).
 * 화살표(「←n」)는 방향으로 읽혀 대기라는 뜻이 전해지지 않았다 — 「대기」 단계 배지와 같은 시계 아이콘으로(모래시계는 작은 크기에서 가늘고 조잡했다),
 * 실패 표시(경고 아이콘 + n)와 같은 꼴. 색은 그 단계 색을 조금 옅게 — 큰 숫자(진행 중)와 같은 단계의 것임이 색으로 이어진다.
 * 뜻은 title(「대기 n건」)로도. 0이면 그리지 않는다.
 */
export default function WaitPill({ n, title, kind }: { n: number; title: string; kind: 'process' | 'verify' | 'confirm' }) {
  if (n <= 0) return null
  return (
    <span title={title} aria-label={title} className={`${PILL} ${STAGE_TONE[kind].text} opacity-80`}>
      <i className="fa-regular fa-clock mr-0.5" /><CountBump value={n} />
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
    <span title={title} aria-label={title} className={`${PILL} text-ive-red`}>
      <i className="fa-solid fa-triangle-exclamation mr-0.5" /><CountBump value={n} />
    </span>
  )
}

/**
 * 머지 대상 브랜치에서 돌고 있거나 대기 중인 CI(파이프라인) 건수 — 작업취합 패널 상세와 같은 값. 0이면 그리지 않는다.
 */
export function CiPill({ running, waiting }: { running: number; waiting: number }) {
  const tp = useTranslations('project')
  const n = running + waiting
  if (n <= 0) return null
  const title = tp('mergeCiHint', { running, waiting })
  return (
    <span title={title} aria-label={title} className={`${PILL} ${running > 0 ? 'text-ive-cyan' : 'text-ive-amber'}`}>
      <i className="fa-solid fa-gears mr-0.5" /><CountBump value={n} />
    </span>
  )
}

/**
 * 작업취합에서 충돌이 난 MR 건수 — 머지를 기다리는 MR 숫자에 묻히지 않게 따로 붙인다(사람이 풀어야 넘어간다). 0이면 그리지 않는다.
 */
export function ConflictPill({ n }: { n: number }) {
  const tp = useTranslations('project')
  if (n <= 0) return null
  const title = tp('mergeConflictHint', { n })
  return (
    <span title={title} aria-label={title} className={`${PILL} text-ive-red`}>
      <i className="fa-solid fa-triangle-exclamation mr-0.5" /><CountBump value={n} />
    </span>
  )
}
