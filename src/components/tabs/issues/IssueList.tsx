'use client'

import type { ReactNode } from 'react'
import { useTranslations } from 'next-intl'
import IssueCard from './IssueCard'
import type { IveIssue, ProjectAgent, StageInfo } from './types'

interface GitMember {
  id: number
  username: string
  name: string
  avatarUrl: string
}

interface IssueListProps {
  filtered: IveIssue[]
  issues: IveIssue[]
  isHistoryTab: boolean
  loading: boolean
  closedLoading: boolean
  closedIssues: IveIssue[]
  stageInfo: Record<string, StageInfo>
  selected: Set<number>
  bulkMode: boolean
  navigatingIid: number | null
  canEdit: boolean
  /** 현재 사용자가 관리자인지 */
  isAdmin: boolean
  /** 현재 사용자 IVE id */
  currentUserId: string | null
  /** 현재 사용자 Git OAuth id (string) */
  currentUserGitId: string | null
  closing: number | null
  projectAgents: ProjectAgent[]
  gitMembers: GitMember[]
  locale?: string
  timezone?: string
  /** 스크롤 영역 맨 위에 함께 렌더할 노드(예: IssueAddForm). 폼이 커져도 본문 스크롤로 모두 접근 가능하게 한다. */
  headerSlot?: ReactNode
  onToggleSelect: (iid: number) => void
  onNavigate: (issue: IveIssue) => void
  onOpenAgentPicker: (iid: number) => void
  onOpenAssigneeModal: (iids: number[]) => void
  onCloseIssue: (e: React.MouseEvent, iid: number) => void
  onPresetVerifierChange?: (iid: number, preset: { mode: 'creator' | 'auto' | 'specific'; userId: string | null; username: string | null }) => Promise<void> | void
  onPresetConfirmerChange?: (iid: number, preset: { mode: 'creator' | 'auto' | 'specific'; userId: string | null; username: string | null }) => Promise<void> | void
}

export default function IssueList({
  filtered,
  issues,
  isHistoryTab,
  loading,
  closedLoading,
  closedIssues,
  stageInfo,
  selected,
  bulkMode,
  navigatingIid,
  canEdit,
  isAdmin,
  currentUserId,
  currentUserGitId,
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
  headerSlot,
}: IssueListProps) {
  const tIssue = useTranslations('issue')

  return (
    <div className="flex-1 min-h-0 overflow-y-auto custom-scrollbar" data-scroll-container="issues-list">
      <div className="pb-20">
        {headerSlot}
        {(isHistoryTab ? closedLoading : loading) && (isHistoryTab ? closedIssues : issues).length === 0 ? (
          <div className="text-center py-20 text-ive-text-muted">{tIssue('loadingIssues')}</div>
        ) : filtered.length === 0 ? (
          <div className="text-center py-20 bg-ive-bg/50 rounded-2xl border border-dashed border-ive-border-subtle">
            <i className="fa-solid fa-inbox text-4xl text-ive-text-dim mb-4 block" />
            <p className="text-base text-ive-text-muted">
              {isHistoryTab ? tIssue('noFilterMatch') : issues.length === 0 ? tIssue('noIveIssues') : tIssue('noFilterMatch')}
            </p>
          </div>
        ) : (
          <div className="flex flex-col gap-3">
            {filtered.map(issue => {
              const isCreator = !!(
                (currentUserId && issue.iveAuthorId && issue.iveAuthorId === currentUserId)
                || (currentUserGitId && issue.authorId != null && String(issue.authorId) === currentUserGitId)
              )
              const canEditAssignees = isAdmin || isCreator
              return (
              <IssueCard
                key={issue.iid}
                issue={issue}
                stageInfo={stageInfo}
                isSelected={selected.has(issue.iid)}
                bulkMode={bulkMode}
                navigatingIid={navigatingIid}
                canEdit={canEdit}
                canEditAssignees={canEditAssignees}
                isHistoryTab={isHistoryTab}
                closing={closing}
                gitMembers={gitMembers}
                locale={locale}
                timezone={timezone}
                onToggleSelect={onToggleSelect}
                onNavigate={onNavigate}
                onOpenAssigneeModal={onOpenAssigneeModal}
                onOpenAgentPicker={onOpenAgentPicker}
                onCloseIssue={onCloseIssue}
                onPresetVerifierChange={onPresetVerifierChange}
                onPresetConfirmerChange={onPresetConfirmerChange}
              />
              )
            })}
          </div>
        )}
      </div>
    </div>
  )
}
