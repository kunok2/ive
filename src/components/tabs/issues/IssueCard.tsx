'use client'

import type { PresetRole, RoleAgentCandidate } from '@/components/issue/RoleAvatarBar'
import { useTranslations } from 'next-intl'
import RoleAvatarBar from '@/components/issue/RoleAvatarBar'
import { macroIndexFromStage } from '@/app/issues/[projectId]/[iid]/_components/StageProgress'
import { formatDateMedium } from '@/lib/format-date'
import type { IveIssue, StageInfo } from './types'

interface GitMember {
  id: number
  username: string
  name: string
  avatarUrl: string
}

type RolePresetPayload = PresetRole

interface IssueCardProps {
  issue: IveIssue
  stageInfo: Record<string, StageInfo>
  isSelected: boolean
  /** PC 폭에서 오른쪽 칸에 열려 있음 */
  isOpen?: boolean
  bulkMode: boolean
  navigatingIid: number | null
  canEdit: boolean
  /** 담당자/검증자/확인자 변경 권한 — 관리자 또는 이슈 생성자만 */
  canEditAssignees: boolean
  isHistoryTab: boolean
  closing: number | null
  gitMembers: GitMember[]
  /** 확인자 후보 — IVE 사용자(미지정 시 gitMembers fallback). */
  confirmerMembers?: GitMember[]
  roleAgents?: { verify: RoleAgentCandidate[]; confirm: RoleAgentCandidate[]; process: RoleAgentCandidate[] }
  locale?: string
  timezone?: string
  onToggleSelect: (iid: number) => void
  onNavigate: (issue: IveIssue) => void
  onOpenAssigneeModal: (iids: number[]) => void
  /** 처리자(에이전트) picker — 처리자 아바타 클릭 시 호출. AI 에이전트/자동/담당자 모드 중 선택. */
  onOpenAgentPicker: (iid: number) => void
  onCloseIssue: (e: React.MouseEvent, iid: number) => void
  onPresetVerifierChange?: (iid: number, preset: RolePresetPayload) => Promise<void> | void
  onPresetConfirmerChange?: (iid: number, preset: RolePresetPayload) => Promise<void> | void
}

export default function IssueCard({
  issue,
  stageInfo,
  isSelected,
  isOpen = false,
  bulkMode,
  navigatingIid,
  canEdit,
  canEditAssignees,
  isHistoryTab,
  closing,
  gitMembers,
  confirmerMembers,
  roleAgents,
  locale,
  timezone,
  onToggleSelect,
  onNavigate,
  onOpenAgentPicker,
  onCloseIssue,
  onPresetVerifierChange,
  onPresetConfirmerChange,
}: IssueCardProps) {
  const tIssue = useTranslations('issue')
  const tCommon = useTranslations('common')

  const displayStage = issue.state === 'closed' && (!issue.stage || issue.stage === 'none') ? 'closed' : issue.stage
  const info = stageInfo[displayStage] || stageInfo.unknown

  return (
    <div
      onClick={() => {
        if (bulkMode) { onToggleSelect(issue.iid); return }
        onNavigate(issue)
      }}
      className={`bg-ive-bg-card border rounded-lg p-4 transition-all cursor-pointer active:scale-[0.98] ${
        isSelected
          ? 'border-ive-green/50 bg-ive-green/5'
          : isOpen ? 'border-ive-cyan/60'
          : 'border-ive-border-subtle hover:border-ive-green/40'
      }`}
    >
      <div className="flex items-start justify-between gap-2 mb-2">
        <div className="flex items-start gap-2 min-w-0 flex-1">
          {bulkMode && (
            <div className="mt-0.5 shrink-0">
              {isSelected
                ? <i className="fa-solid fa-square-check text-ive-green text-lg" />
                : <i className="fa-regular fa-square text-ive-text-dim text-lg" />
              }
            </div>
          )}
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-2">
              <span className="text-sm font-bold text-ive-green">#{issue.iid}</span>
              <span className="text-xs text-ive-text-dim">
                <i className="fa-solid fa-calendar-day mr-1" />
                {formatDateMedium(issue.updatedAt, locale, timezone)}
              </span>
              {issue.chatActive && (
                <span className={`inline-flex items-center gap-1 text-xs font-bold px-1.5 py-0.5 rounded-lg bg-ive-cyan/15 text-ive-cyan ${issue.chatProcessing ? 'animate-pulse' : ''}`}>
                  {issue.chatProcessing
                    ? <><i className="fa-solid fa-circle-notch fa-spin" />{tIssue('chatBadgeThinking')}</>
                    : <><i className="fa-solid fa-comments" />{tIssue('chatBadgeActive')}</>}
                </span>
              )}
            </div>
            <h3 className="text-base font-bold text-ive-text leading-snug mt-0.5 line-clamp-2">{issue.title}</h3>
          </div>
        </div>
        {navigatingIid === issue.iid ? (
          <i className="fa-solid fa-circle-notch fa-spin text-ive-green shrink-0" />
        ) : canEditAssignees && !bulkMode && !isHistoryTab && (
          <button
            onClick={(e) => onCloseIssue(e, issue.iid)}
            disabled={closing === issue.iid}
            className="shrink-0 w-6 h-6 rounded-lg flex items-center justify-center text-ive-text-dim border border-ive-border hover:text-ive-red hover:border-ive-red/40 transition-all active:scale-95 disabled:opacity-40"
            title={tIssue('closeIssue')}
            aria-label={tCommon('close')}
          >
            {closing === issue.iid
              ? <i className="fa-solid fa-circle-notch fa-spin text-[10px]" />
              : <i className="fa-solid fa-xmark text-xs" />}
          </button>
        )}
      </div>
      {issue.stageWorkerNote && (
        <div className="mb-1.5 px-2 py-1 rounded-lg bg-ive-amber/10 border border-ive-amber/20 text-xs text-ive-amber truncate" title={issue.stageWorkerNote}>
          <i className="fa-solid fa-robot mr-1" />
          {issue.stageWorkerNote}
        </div>
      )}
      {issue.stage === 'dev_fail' && issue.failReason && (
        <div className="mb-1.5 px-2 py-1 rounded-lg bg-ive-red/10 border border-ive-red/20 text-xs text-ive-red">
          <i className="fa-solid fa-triangle-exclamation mr-1" />
          {issue.failReason}
        </div>
      )}
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-ive-text-dim">
        {/* 4 역할 아바타 — 작성자 › 처리자 › 검증자 › 확인자 (작업 #271) */}
        <span onClick={e => { if (canEdit && !bulkMode) e.stopPropagation() }}>
          <RoleAvatarBar
            size="sm"
            canEdit={canEditAssignees && !bulkMode && gitMembers.length > 0}
            currentMacro={macroIndexFromStage(issue.stage)}
            gitMembers={gitMembers}
            confirmerMembers={confirmerMembers}
            verifierAgents={roleAgents?.verify}
            confirmerAgents={roleAgents?.confirm}
            creator={{
              name: issue.author?.name ?? null,
              avatar: issue.author?.avatar ?? null,
              avatarUrl: issue.author?.avatarUrl ?? null,
            }}
            processor={{
              assignMode: (issue.assignMode as 'agent' | 'auto' | 'assignee' | 'none' | undefined) ?? 'auto',
              agentName: issue.preferredAgentName ?? null,
              agentAvatar: issue.preferredAgentAvatar ?? null,
              username: issue.assignees?.[0]?.username ?? null,
              name: issue.assignees?.[0]?.name ?? null,
              avatarUrl: issue.assignees?.[0]?.avatarUrl ?? null,
              pendingAuto: !!issue.assigneeAuto,
            }}
            verifier={issue.presetVerifier ?? { mode: 'creator', userId: null, username: null }}
            confirmer={issue.presetConfirmer ?? { mode: 'creator', userId: null, username: null }}
            actualProcessor={issue.actualProcessor ?? null}
            actualVerifier={issue.actualVerifier ?? null}
            actualConfirmer={issue.actualConfirmer ?? null}
            onProcessorClick={() => onOpenAgentPicker(issue.iid)}
            onVerifierChange={onPresetVerifierChange ? (preset) => onPresetVerifierChange(issue.iid, preset) : undefined}
            onConfirmerChange={onPresetConfirmerChange ? (preset) => onPresetConfirmerChange(issue.iid, preset) : undefined}
          />
        </span>
        {/* 마감일 + 회차 뱃지 + 상태 배지 — 우측 정렬 그룹.
            마감일: D-N(남음) / D+N(지남) / 완료 시 일찍/늦게.
            회차 뱃지: 처리 N회 / 되돌리기 N회. 1회는 평범하니 ≥2회만 노출. */}
        {(() => {
          const ic = issue.iterationCounts
          const showProcess = !!ic && ic.processCount >= 2
          const showRetry = !!ic && ic.retryTotal >= 1
          const showState = issue.stage !== 'none'
          const due = renderDueBadge(issue, tIssue)
          if (!showProcess && !showRetry && !showState && !due) return null
          return (
            <span className="ml-auto shrink-0 inline-flex items-center gap-1">
              {due}
              {showProcess && ic && (
                <span
                  className="inline-flex items-center gap-0.5 px-1.5 py-0.5 rounded border bg-ive-cyan/10 text-ive-cyan border-ive-cyan/20 text-[10px] font-bold"
                  title={tIssue('iterationCount', { count: ic.processCount })}
                >
                  <i className="fa-solid fa-repeat" />
                  {ic.processCount}
                </span>
              )}
              {showRetry && ic && (
                <span
                  className="inline-flex items-center gap-0.5 px-1.5 py-0.5 rounded border bg-ive-amber/10 text-ive-amber border-ive-amber/20 text-[10px] font-bold"
                  title={tIssue('retryCount', { count: ic.retryTotal })}
                >
                  <i className="fa-solid fa-rotate-left" />
                  {ic.retryTotal}
                </span>
              )}
              {showState && (
                <span className={`inline-flex items-center gap-1 text-[10px] font-bold px-1.5 py-0.5 rounded border ${info.color}`}>
                  <i className={`fa-solid ${info.icon}`} />
                  {info.label}
                </span>
              )}
            </span>
          )
        })()}
      </div>
    </div>
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
function renderDueBadge(issue: IveIssue, t: ReturnType<typeof useTranslations<'issue'>>) {
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
