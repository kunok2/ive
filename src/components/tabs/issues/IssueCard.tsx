'use client'

import { useTranslations } from 'next-intl'
import AgentAvatar from '@/components/agent/AgentAvatar'
import RoleAvatarBar from '@/components/issue/RoleAvatarBar'
import { macroIndexFromStage } from '@/app/issues/[projectId]/[iid]/_components/StageProgress'
import { formatDateMedium } from '@/lib/format-date'
import type { CliName } from '@/types'
import type { IveIssue, ProjectAgent, StageInfo } from './types'
import { CLI_CONFIG } from './types'

interface GitMember {
  id: number
  username: string
  name: string
  avatarUrl: string
}

type RolePresetPayload = { mode: 'creator' | 'auto' | 'specific'; userId: string | null; username: string | null }

interface IssueCardProps {
  issue: IveIssue
  stageInfo: Record<string, StageInfo>
  cliConfig: typeof CLI_CONFIG
  isSelected: boolean
  bulkMode: boolean
  navigatingIid: number | null
  canEdit: boolean
  /** 담당자/검증자/확인자 변경 권한 — 관리자 또는 이슈 생성자만 */
  canEditAssignees: boolean
  isHistoryTab: boolean
  closing: number | null
  projectAgents: ProjectAgent[]
  gitMembers: GitMember[]
  locale?: string
  timezone?: string
  onToggleSelect: (iid: number) => void
  onNavigate: (issue: IveIssue) => void
  onOpenAgentPicker: (iid: number) => void
  onOpenAssigneeModal: (iids: number[]) => void
  onCloseIssue: (e: React.MouseEvent, iid: number) => void
  onPresetVerifierChange?: (iid: number, preset: RolePresetPayload) => Promise<void> | void
  onPresetConfirmerChange?: (iid: number, preset: RolePresetPayload) => Promise<void> | void
}

export default function IssueCard({
  issue,
  stageInfo,
  cliConfig,
  isSelected,
  bulkMode,
  navigatingIid,
  canEdit,
  canEditAssignees,
  isHistoryTab,
  closing,
  projectAgents,
  gitMembers,
  locale,
  timezone,
  onToggleSelect,
  onNavigate,
  onOpenAgentPicker,
  onOpenAssigneeModal,
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
            className="shrink-0 w-6 h-6 rounded-full flex items-center justify-center text-ive-text-dim border border-ive-border hover:text-ive-red hover:border-ive-red/40 transition-all active:scale-95 disabled:opacity-40"
            title={tIssue('closeIssue')}
            aria-label={tCommon('close')}
          >
            {closing === issue.iid
              ? <i className="fa-solid fa-circle-notch fa-spin text-[10px]" />
              : <i className="fa-solid fa-xmark text-xs" />}
          </button>
        )}
      </div>
      {issue.stage === 'dev_fail' && issue.failReason && (
        <div className="mb-1.5 px-2 py-1 rounded-lg bg-ive-red/10 border border-ive-red/20 text-xs text-ive-red">
          <i className="fa-solid fa-triangle-exclamation mr-1" />
          {issue.failReason}
        </div>
      )}
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-ive-text-dim">
        <AgentBadge
          issue={issue}
          canEdit={canEdit}
          bulkMode={bulkMode}
          projectAgents={projectAgents}
          cliConfig={cliConfig}
          onOpenAgentPicker={onOpenAgentPicker}
        />
        {/* 4 역할 아바타 — 작성자 › 처리자 › 검증자 › 확인자 (작업 #271) */}
        <span onClick={e => { if (canEdit && !bulkMode) e.stopPropagation() }}>
          <RoleAvatarBar
            size="sm"
            canEdit={canEditAssignees && !bulkMode && gitMembers.length > 0}
            currentMacro={macroIndexFromStage(issue.stage)}
            gitMembers={gitMembers}
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
            onProcessorClick={() => onOpenAssigneeModal([issue.iid])}
            onVerifierChange={onPresetVerifierChange ? (preset) => onPresetVerifierChange(issue.iid, preset) : undefined}
            onConfirmerChange={onPresetConfirmerChange ? (preset) => onPresetConfirmerChange(issue.iid, preset) : undefined}
          />
        </span>
        {issue.stage !== 'none' && (
          <span className={`ml-auto shrink-0 inline-flex items-center gap-1 text-[10px] font-bold px-1.5 py-0.5 rounded border ${info.color}`}>
            <i className={`fa-solid ${info.icon}`} />
            {info.label}
          </span>
        )}
      </div>
    </div>
  )
}

/** Inline sub-component for agent/assignee badge in the issue footer */
function AgentBadge({
  issue,
  canEdit,
  bulkMode,
  projectAgents,
  cliConfig,
  onOpenAgentPicker,
}: {
  issue: IveIssue
  canEdit: boolean
  bulkMode: boolean
  projectAgents: ProjectAgent[]
  cliConfig: typeof CLI_CONFIG
  onOpenAgentPicker: (iid: number) => void
}) {
  const tIssue = useTranslations('issue')

  const agentEditable = canEdit && !bulkMode && issue.stage === 'waiting' && projectAgents.length > 0
  const onClickEdit = agentEditable ? (e: React.MouseEvent) => { e.stopPropagation(); onOpenAgentPicker(issue.iid) } : undefined

  if (issue.assignMode === 'assignee') {
    const assignee = issue.assignees?.[0]
    return (
      <span
        className={`inline-flex items-center gap-1 text-ive-cyan ${agentEditable ? 'cursor-pointer hover:text-ive-cyan/80' : ''}`}
        onClick={onClickEdit}
      >
        {assignee?.avatarUrl ? (
          <img src={assignee.avatarUrl} className="w-4 h-4 rounded-full object-cover bg-ive-bg-deep" alt="" />
        ) : (
          <span className="w-4 h-4 rounded-full bg-ive-cyan/20 flex items-center justify-center">
            <i className="fa-solid fa-user text-[10px] text-ive-cyan" />
          </span>
        )}
        <span className="font-bold truncate max-w-[80px]">{assignee?.name || assignee?.username || tIssue('assigneeHandles')}</span>
        {agentEditable && <i className="fa-solid fa-pen-to-square text-[9px] opacity-60" />}
      </span>
    )
  }

  if (issue.preferredAgentId) {
    const avatar = issue.preferredAgentAvatar || 'av-01'
    return (
      <span
        className={`inline-flex items-center gap-1 ${agentEditable ? 'cursor-pointer hover:text-ive-text' : ''}`}
        onClick={onClickEdit}
      >
        <AgentAvatar avatar={avatar} size="xs" />
        <span className="font-bold text-ive-text-muted truncate max-w-[80px]">{issue.preferredAgentName}</span>
        {issue.preferredAgentCliName && (() => {
          const cli = cliConfig[issue.preferredAgentCliName as CliName]
          return cli ? <i className={`${cli.icon} ${cli.color} text-[10px]`} /> : null
        })()}
        {agentEditable && <i className="fa-solid fa-pen-to-square text-[9px] opacity-60" />}
      </span>
    )
  }

  if (agentEditable) {
    return (
      <span
        className="inline-flex items-center gap-1 cursor-pointer text-ive-text-dim hover:text-ive-green"
        onClick={onClickEdit}
      >
        <i className="fa-solid fa-user-gear text-[10px]" />
        <span className="font-bold truncate max-w-[80px]">{tIssue('noPreference')}</span>
        <i className="fa-solid fa-pen-to-square text-[9px] opacity-60" />
      </span>
    )
  }

  return null
}
