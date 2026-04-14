'use client'

import { useTranslations } from 'next-intl'
import AgentAvatar from '@/components/agent/AgentAvatar'
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

interface IssueCardProps {
  issue: IveIssue
  stageInfo: Record<string, StageInfo>
  cliConfig: typeof CLI_CONFIG
  isSelected: boolean
  bulkMode: boolean
  navigatingIid: number | null
  canEdit: boolean
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
}

export default function IssueCard({
  issue,
  stageInfo,
  cliConfig,
  isSelected,
  bulkMode,
  navigatingIid,
  canEdit,
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
      <div className="flex items-start justify-between gap-3 mb-2">
        <div className="flex items-start gap-2.5 min-w-0 flex-1">
          {bulkMode && (
            <div className="mt-0.5 shrink-0">
              {isSelected
                ? <i className="fa-solid fa-square-check text-ive-green text-lg" />
                : <i className="fa-regular fa-square text-ive-text-dim text-lg" />
              }
            </div>
          )}
          <div className="min-w-0 flex-1">
            <span className="text-sm font-bold text-ive-green">#{issue.iid}</span>
            <h3 className="text-base font-bold text-ive-text leading-snug mt-0.5 line-clamp-2">{issue.title}</h3>
          </div>
        </div>
        {navigatingIid === issue.iid ? (
          <i className="fa-solid fa-circle-notch fa-spin text-ive-green shrink-0" />
        ) : issue.stage !== 'none' && (
          <span className={`shrink-0 text-xs font-bold px-2 py-1 rounded-lg border ${info.color}`}>
            <i className={`fa-solid ${info.icon} mr-1`} />
            {info.label}
          </span>
        )}
      </div>
      {issue.stage === 'dev_fail' && issue.failReason && (
        <div className="mb-1.5 px-2 py-1 rounded-lg bg-ive-red/10 border border-ive-red/20 text-xs text-ive-red">
          <i className="fa-solid fa-triangle-exclamation mr-1" />
          {issue.failReason}
        </div>
      )}
      <div className="flex items-center gap-3 text-xs text-ive-text-dim">
        <AgentBadge
          issue={issue}
          canEdit={canEdit}
          bulkMode={bulkMode}
          projectAgents={projectAgents}
          cliConfig={cliConfig}
          onOpenAgentPicker={onOpenAgentPicker}
        />
        <span>
          <i className="fa-solid fa-user mr-1" />
          {issue.author}
        </span>
        {/* assignee avatars + edit */}
        {((issue.assignees && issue.assignees.length > 0) || (canEdit && !bulkMode && gitMembers.length > 0)) && (
          <span className="flex items-center gap-1"
            onClick={(e) => {
              if (canEdit && !bulkMode && gitMembers.length > 0) {
                e.stopPropagation()
                onOpenAssigneeModal([issue.iid])
              }
            }}
          >
            {(issue.assignees || []).map(a => (
              <span key={a.id} className="flex items-center gap-0.5">
                {a.avatarUrl ? <img src={a.avatarUrl} className="w-4 h-4 rounded-full" alt="" /> : <i className="fa-solid fa-user text-[10px]" />}
                <span className="text-xs font-bold text-ive-text-muted">{a.name || a.username}</span>
              </span>
            ))}
            {canEdit && !bulkMode && gitMembers.length > 0 && !(issue.assignees && issue.assignees.length > 0) && (
              <i className="fa-solid fa-user-pen text-[10px] text-ive-text-dim hover:text-ive-green cursor-pointer transition-all" />
            )}
          </span>
        )}
        <span>
          <i className="fa-solid fa-calendar-day mr-1" />
          {formatDateMedium(issue.updatedAt, locale, timezone)}
        </span>
        {canEdit && !bulkMode && !isHistoryTab && (
          <button
            onClick={(e) => onCloseIssue(e, issue.iid)}
            disabled={closing === issue.iid}
            className="ml-auto text-xs font-bold text-ive-text-dim hover:text-ive-red border border-ive-border-subtle hover:border-ive-red/30 px-2 py-0.5 rounded-lg transition-all active:scale-95 disabled:opacity-40"
            title={tIssue('closeIssue')}
          >
            {closing === issue.iid ? <i className="fa-solid fa-circle-notch fa-spin" /> : <><i className="fa-solid fa-xmark mr-0.5" />{tCommon('close')}</>}
          </button>
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
    return (
      <span
        className={`flex items-center gap-1 text-ive-cyan ${agentEditable ? 'cursor-pointer hover:text-ive-cyan/80' : ''}`}
        onClick={onClickEdit}
      >
        {issue.assignees?.[0]?.avatarUrl ? (
          <img src={issue.assignees[0].avatarUrl} className="w-4 h-4 rounded-full" alt="" />
        ) : (
          <i className="fa-solid fa-user text-[10px]" />
        )}
        <span className="font-bold">{issue.assignees?.[0]?.name || issue.assignees?.[0]?.username || tIssue('assigneeHandles')}</span>
        {agentEditable && <i className="fa-solid fa-pen-to-square text-[9px] opacity-60" />}
      </span>
    )
  }

  if (issue.preferredAgentId && issue.preferredAgentAvatar) {
    return (
      <span
        className={`flex items-center gap-1 ${agentEditable ? 'cursor-pointer hover:text-ive-text' : ''}`}
        onClick={onClickEdit}
      >
        <AgentAvatar avatar={issue.preferredAgentAvatar} size="xs" />
        <span className="font-bold text-ive-text-muted">{issue.preferredAgentName}</span>
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
        className="flex items-center gap-1 cursor-pointer text-ive-text-dim hover:text-ive-green"
        onClick={onClickEdit}
      >
        <i className="fa-solid fa-user-gear text-[10px]" />
        <span className="font-bold">{tIssue('noPreference')}</span>
        <i className="fa-solid fa-pen-to-square text-[9px] opacity-60" />
      </span>
    )
  }

  return null
}
