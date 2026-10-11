'use client'

import { useTranslations } from 'next-intl'

/** 배지가 읽는 작업 필드 — 작업 목록(IveIssue)·넓은 화면 보드가 같은 /api/projects/[id]/issues 응답을 쓴다 */
export interface BadgeIssue {
  state?: string
  stage?: string
  updatedAt: string
  dueDate?: string | null
  iterationCounts?: { processCount: number; verifyCount?: number; confirmCount?: number; retryTotal: number }
  /** 확인대기·확인 중인 작업의 배포 상태 — 머지된 수정이 확인할 사이트에 올라갔는가 */
  deployState?: 'unmerged' | 'deploying' | 'deployed' | 'failed' | null
}

/**
 * 단계별 횟수 — 역할 아바타(RoleAvatarBar) 옆에 적는다. 작업 목록 카드와 넓은 화면 보드가 같이 쓴다.
 * 예전에는 「처리 N회」 배지 하나였다 — 어느 단계에서 몇 번 돌았는지(검증에서 되돌렸는지, 확인에서 되돌렸는지)가 보이지 않았다.
 * 되돌림 이력 자체는 작업 상세의 진행 막대(되돌림 화살표)에서 본다.
 */
export const stageCountsOf = (i: BadgeIssue) => ({
  process: i.iterationCounts?.processCount ?? 0,
  verify: i.iterationCounts?.verifyCount ?? 0,
  confirm: i.iterationCounts?.confirmCount ?? 0,
})

const showDeploy = (i: BadgeIssue) => !!i.deployState && (i.stage === 'confirm_waiting' || i.stage === 'confirming') && i.state !== 'closed'

export function hasIssueBadges(i: BadgeIssue): boolean {
  return !!i.dueDate || showDeploy(i)
}

const DEPLOY_BADGE: Record<NonNullable<BadgeIssue['deployState']>, { cls: string; icon: string; label: string; hint: string }> = {
  unmerged:  { cls: 'bg-white/5 text-ive-text-secondary border-ive-border-subtle', icon: 'fa-solid fa-code-merge',        label: 'deployUnmerged',  hint: 'deployUnmergedHint' },
  deploying: { cls: 'bg-ive-amber/10 text-ive-amber border-ive-amber/20',          icon: 'fa-solid fa-circle-notch fa-spin', label: 'deployDeploying', hint: 'deployDeployingHint' },
  deployed:  { cls: 'bg-ive-green/10 text-ive-green border-ive-green/20',          icon: 'fa-solid fa-circle-check',      label: 'deployDeployed',  hint: 'deployDeployedHint' },
  failed:    { cls: 'bg-ive-red/10 text-ive-red border-ive-red/20',                icon: 'fa-solid fa-triangle-exclamation', label: 'deployFailed',   hint: 'deployFailedHint' },
}

/**
 * 배포 상태 배지 — 확인대기·확인 중인 작업에만. 머지 뒤 CI·배포(필요하면 재기동)가 끝나야 확인할 수 있으므로,
 * 지금 확인해도 되는지(배포됨)·아직인지(배포 중·머지 전)·배포가 깨졌는지(배포 실패)를 알린다. 값은 스캐너가 구해 둔 것.
 */
export function DeployBadge({ issue }: { issue: BadgeIssue }) {
  const t = useTranslations('issue')
  if (!showDeploy(issue)) return null
  const b = DEPLOY_BADGE[issue.deployState!]
  return (
    <span className={`inline-flex items-center gap-1 px-1.5 py-0.5 rounded border text-[10px] font-bold whitespace-nowrap ${b.cls}`} title={t(b.hint)}>
      <i className={b.icon} />
      {t(b.label)}
    </span>
  )
}

/**
 * 작업 배지 — 배포 상태(확인 단계) + 마감일(D-N·D+N·일찍/늦게). 단계별 횟수는 역할 아바타 옆에 적는다(stageCountsOf).
 * 작업 목록 카드와 넓은 화면 프로젝트 보드가 같이 쓴다(한쪽만 바뀌지 않게).
 */
export default function IssueBadges({ issue }: { issue: BadgeIssue }) {
  const t = useTranslations('issue')
  return (
    <>
      <DeployBadge issue={issue} />
      {renderDueBadge(issue, t)}
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
