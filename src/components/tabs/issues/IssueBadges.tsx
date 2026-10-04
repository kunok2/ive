'use client'

import { useTranslations } from 'next-intl'

/** 배지가 읽는 작업 필드 — 작업 목록(IveIssue)·넓은 화면 보드가 같은 /api/projects/[id]/issues 응답을 쓴다 */
export interface BadgeIssue {
  state?: string
  stage?: string
  updatedAt: string
  dueDate?: string | null
  iterationCounts?: { processCount: number; retryTotal: number }
}

/** 처리 N회는 1회가 평범하니 2회부터, 되돌리기는 1회부터 */
const showProcess = (i: BadgeIssue) => (i.iterationCounts?.processCount ?? 0) >= 2
const showRetry = (i: BadgeIssue) => (i.iterationCounts?.retryTotal ?? 0) >= 1

export function hasIssueBadges(i: BadgeIssue): boolean {
  return !!i.dueDate || showProcess(i) || showRetry(i)
}

/**
 * 작업 배지 — 마감일(D-N·D+N·일찍/늦게) + 회차(처리 N회 · 되돌리기 N회).
 * 작업 목록 카드와 넓은 화면 프로젝트 보드가 같이 쓴다(한쪽만 바뀌지 않게).
 */
export default function IssueBadges({ issue }: { issue: BadgeIssue }) {
  const t = useTranslations('issue')
  const ic = issue.iterationCounts
  return (
    <>
      {renderDueBadge(issue, t)}
      {showProcess(issue) && ic && (
        <span
          className="inline-flex items-center gap-0.5 px-1.5 py-0.5 rounded border bg-ive-cyan/10 text-ive-cyan border-ive-cyan/20 text-[10px] font-bold"
          title={t('iterationCount', { count: ic.processCount })}
        >
          <i className="fa-solid fa-repeat" />
          {ic.processCount}
        </span>
      )}
      {showRetry(issue) && ic && (
        <span
          className="inline-flex items-center gap-0.5 px-1.5 py-0.5 rounded border bg-ive-amber/10 text-ive-amber border-ive-amber/20 text-[10px] font-bold"
          title={t('retryCount', { count: ic.retryTotal })}
        >
          <i className="fa-solid fa-rotate-left" />
          {ic.retryTotal}
        </span>
      )}
    </>
  )
}

/**
 * 카드용 마감일 뱃지.
 *   - 진행중 + 마감 전: "D-N" (cyan / 90%↑ amber / 1일 이내 amber-strong)
 *   - 진행중 + 마감 지남: "D+N" (red)
 *   - 완료(닫힘 또는 done) + 마감 비교: "-N일"(일찍, green) / "+N일"(늦게, red) / "정시"(green)
 *   - 마감일 없음: null
 *
 * "완료" 판정: state === 'closed' 또는 stage === 'done'.
 * 완료 시각은 issue.updatedAt 을 근사치로 사용 (목록 응답엔 closedAt/confirmedAt 미포함).
 */
function renderDueBadge(issue: BadgeIssue, t: ReturnType<typeof useTranslations<'issue'>>) {
  if (!issue.dueDate) return null
  const end = new Date(`${issue.dueDate}T23:59:59+09:00`).getTime()
  const isCompleted = issue.state === 'closed' || issue.stage === 'done'

  if (isCompleted) {
    // updatedAt 을 완료 근사 시각으로 사용. closed 시점/done 라벨링 시점에 가까움.
    const completedTs = new Date(issue.updatedAt).getTime()
    const diffMs = end - completedTs
    const days = Math.round(diffMs / 86400000)
    if (Math.abs(diffMs) < 60_000) {
      return (
        <span className="inline-flex items-center gap-0.5 px-1.5 py-0.5 rounded border bg-ive-green/10 text-ive-green border-ive-green/20 text-[10px] font-bold" title={t('completedOnTime')}>
          <i className="fa-solid fa-calendar-check" />
          {t('completedOnTime')}
        </span>
      )
    }
    if (diffMs >= 0) {
      const text = `-${Math.max(days, 1)}d`
      return (
        <span className="inline-flex items-center gap-0.5 px-1.5 py-0.5 rounded border bg-ive-green/10 text-ive-green border-ive-green/20 text-[10px] font-bold" title={t('completedEarly', { remain: t('daysRemain', { days: Math.max(days, 1) }) })}>
          <i className="fa-solid fa-calendar-check" />
          {text}
        </span>
      )
    }
    const text = `+${Math.max(Math.abs(days), 1)}d`
    return (
      <span className="inline-flex items-center gap-0.5 px-1.5 py-0.5 rounded border bg-ive-red/10 text-ive-red border-ive-red/20 text-[10px] font-bold" title={t('completedLate', { remain: t('daysRemain', { days: Math.max(Math.abs(days), 1) }) })}>
        <i className="fa-solid fa-calendar-xmark" />
        {text}
      </span>
    )
  }

  // 진행중
  const now = Date.now()
  const remainMs = end - now
  const overdue = remainMs < 0
  if (overdue) {
    const days = Math.max(Math.ceil(Math.abs(remainMs) / 86400000), 1)
    return (
      <span className="inline-flex items-center gap-0.5 px-1.5 py-0.5 rounded border bg-ive-red/10 text-ive-red border-ive-red/20 text-[10px] font-bold" title={t('overdueBy', { remain: t('daysRemain', { days }) })}>
        <i className="fa-solid fa-triangle-exclamation" />
        {`D+${days}`}
      </span>
    )
  }
  const days = Math.max(Math.ceil(remainMs / 86400000), 0)
  // 색상: 1일 이내 amber, 그 외 cyan
  const cls = days <= 1
    ? 'bg-ive-amber/10 text-ive-amber border-ive-amber/20'
    : 'bg-ive-cyan/10 text-ive-cyan border-ive-cyan/20'
  return (
    <span className={`inline-flex items-center gap-0.5 px-1.5 py-0.5 rounded border ${cls} text-[10px] font-bold`} title={`${issue.dueDate} (${t('daysRemain', { days })} ${t('left')})`}>
      <i className="fa-solid fa-calendar-day" />
      {`D-${days}`}
    </span>
  )
}
