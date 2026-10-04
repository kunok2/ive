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
 * 작업 배지 — 마감일(D-N·D+N·일찍/늦게) + 회차(처리 N회 · 되돌림 N회, 아이콘만으로는 둘이 헷갈려 글자로 적는다).
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
          {t('badgeProcess', { count: ic.processCount })}
        </span>
      )}
      {showRetry(issue) && ic && (
        <span
          className="inline-flex items-center gap-0.5 px-1.5 py-0.5 rounded border bg-ive-amber/10 text-ive-amber border-ive-amber/20 text-[10px] font-bold"
          title={t('retryCount', { count: ic.retryTotal })}
        >
          <i className="fa-solid fa-rotate-left" />
          {t('badgeRetry', { count: ic.retryTotal })}
        </span>
      )}
    </>
  )
}

/**
 * 카드용 마감일 뱃지.
 *   - 진행중 + 마감 전: "D-N"·오늘이면 "D-Day" (KST 달력 날짜 차이, 1일 이내 amber · 그 외 cyan)
 *   - 진행중 + 마감 지남: "D+N" (KST 달력 날짜 차이, red)
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

  // 진행중 — 남은 날은 KST 달력 날짜 차이(내일 마감 = D-1, 오늘 = D-Day). 남은 시간을 올림하면 하루가 밀렸다(내일 마감이 D-2)
  const todayKst = new Date(Date.now() + 9 * 3_600_000).toISOString().slice(0, 10)
  const diff = Math.round((Date.parse(`${issue.dueDate}T00:00:00Z`) - Date.parse(`${todayKst}T00:00:00Z`)) / 86_400_000)
  if (diff < 0) {
    const days = -diff
    return (
      <span className="inline-flex items-center gap-0.5 px-1.5 py-0.5 rounded border bg-ive-red/10 text-ive-red border-ive-red/20 text-[10px] font-bold" title={t('overdueBy', { remain: t('daysRemain', { days }) })}>
        <i className="fa-solid fa-triangle-exclamation" />
        {`D+${days}`}
      </span>
    )
  }
  const days = diff
  // 색상: 1일 이내 amber, 그 외 cyan
  const cls = days <= 1
    ? 'bg-ive-amber/10 text-ive-amber border-ive-amber/20'
    : 'bg-ive-cyan/10 text-ive-cyan border-ive-cyan/20'
  return (
    <span className={`inline-flex items-center gap-0.5 px-1.5 py-0.5 rounded border ${cls} text-[10px] font-bold`} title={`${issue.dueDate} (${t('daysRemain', { days })} ${t('left')})`}>
      <i className="fa-solid fa-calendar-day" />
      {days === 0 ? 'D-Day' : `D-${days}`}
    </span>
  )
}
