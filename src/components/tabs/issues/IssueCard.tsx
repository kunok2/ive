'use client'

import { PriorityBadge } from './Priority'
import IssueBadges, { hasIssueBadges } from './IssueBadges'
import { roleBarPropsOf } from './role-bar-props'
import type { PresetRole, RoleAgentCandidate } from '@/components/issue/RoleAvatarBar'
import { useTranslations } from 'next-intl'
import RoleAvatarBar from '@/components/issue/RoleAvatarBar'
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
  const showState = issue.stage !== 'none'
  const meta = <IssueBadges issue={issue} />

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
              {showState && (
                <span className={`inline-flex items-center gap-1 text-xs font-bold px-1.5 py-0.5 rounded-lg border ${info.color}`}>
                  <i className={`fa-solid ${info.icon}`} />
                  {info.label}
                </span>
              )}
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
          <i className="fa-solid fa-bolt mr-1" />
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
            {...roleBarPropsOf(issue)}
            gitMembers={gitMembers}
            confirmerMembers={confirmerMembers}
            verifierAgents={roleAgents?.verify}
            confirmerAgents={roleAgents?.confirm}
            onProcessorClick={() => onOpenAgentPicker(issue.iid)}
            onVerifierChange={onPresetVerifierChange ? (preset) => onPresetVerifierChange(issue.iid, preset) : undefined}
            onConfirmerChange={onPresetConfirmerChange ? (preset) => onPresetConfirmerChange(issue.iid, preset) : undefined}
          />
        </span>
        {/* 담당자와 현재 단계가 먼저 보이도록, 날짜·우선순위·회차는 보조 정보로 아래에 둔다. */}
        {(hasIssueBadges(issue) || issue.priority === 1 || issue.priority === 2 || issue.updatedAt) && (
          <span className="ml-auto shrink-0 inline-flex flex-wrap items-center justify-end gap-1">
            <PriorityBadge priority={issue.priority} />
            {meta}
            {issue.updatedAt && (
              <span className="text-xs text-ive-text-dim">
                <i className={`fa-solid ${isHistoryTab && issue.closedAt ? 'fa-lock' : 'fa-calendar-day'} mr-1`} />
                {formatDateMedium(isHistoryTab && issue.closedAt ? issue.closedAt : issue.updatedAt, locale, timezone)}
              </span>
            )}
          </span>
        )}
      </div>
    </div>
  )
}
