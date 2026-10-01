'use client'

import type { PresetRole, RoleAgentCandidate } from '@/components/issue/RoleAvatarBar'
import { useEffect, useRef, type ReactNode } from 'react'
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
  /** 이력: 다음 페이지가 있는지 / 받는 중인지 / 이어 받기 */
  closedHasMore?: boolean
  closedLoadingMore?: boolean
  onLoadMoreClosed?: () => void
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
  /** 확인자 후보 — IVE 사용자(미지정 시 gitMembers fallback). */
  confirmerMembers?: GitMember[]
  roleAgents?: { verify: RoleAgentCandidate[]; confirm: RoleAgentCandidate[]; process: RoleAgentCandidate[] }
  locale?: string
  timezone?: string
  /** 스크롤 영역 맨 위에 함께 렌더할 노드(예: IssueAddForm). 폼이 커져도 본문 스크롤로 모두 접근 가능하게 한다. */
  headerSlot?: ReactNode
  onToggleSelect: (iid: number) => void
  onNavigate: (issue: IveIssue) => void
  onOpenAgentPicker: (iid: number) => void
  onOpenAssigneeModal: (iids: number[]) => void
  onCloseIssue: (e: React.MouseEvent, iid: number) => void
  onPresetVerifierChange?: (iid: number, preset: PresetRole) => Promise<void> | void
  onPresetConfirmerChange?: (iid: number, preset: PresetRole) => Promise<void> | void
}

export default function IssueList({
  filtered,
  issues,
  isHistoryTab,
  loading,
  closedLoading,
  closedIssues,
  closedHasMore = false,
  closedLoadingMore = false,
  onLoadMoreClosed,
  stageInfo,
  selected,
  bulkMode,
  navigatingIid,
  canEdit,
  isAdmin,
  currentUserId,
  currentUserGitId,
  closing,
  gitMembers,
  confirmerMembers,
  roleAgents,
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

  // 이력: 목록 끝(센티널)이 보이면 다음 페이지를 이어 받는다. 버튼은 관찰이 안 되는 환경용 대체 수단.
  const sentinelRef = useRef<HTMLDivElement | null>(null)
  const showLoadMore = isHistoryTab && closedHasMore && !!onLoadMoreClosed
  useEffect(() => {
    const el = sentinelRef.current
    if (!showLoadMore || !el || typeof IntersectionObserver === 'undefined') return
    const io = new IntersectionObserver(entries => {
      if (entries.some(e => e.isIntersecting)) onLoadMoreClosed?.()
    }, { rootMargin: '400px 0px' })
    io.observe(el)
    return () => io.disconnect()
  }, [showLoadMore, onLoadMoreClosed])

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
                confirmerMembers={confirmerMembers}
                roleAgents={roleAgents}
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
            {showLoadMore && (
              <div ref={sentinelRef} className="flex justify-center py-3">
                <button
                  type="button"
                  onClick={() => onLoadMoreClosed?.()}
                  disabled={closedLoadingMore}
                  className="text-sm font-bold text-ive-text-dim hover:text-ive-text px-4 py-2 rounded-lg bg-ive-bg-card border border-ive-border-subtle hover:border-ive-green/30 transition-all disabled:opacity-60"
                >
                  {closedLoadingMore
                    ? <><i className="fa-solid fa-spinner fa-spin mr-1" />{tIssue('loadingIssues')}</>
                    : <><i className="fa-solid fa-chevron-down mr-1" />{tIssue('loadMore')}</>}
                </button>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  )
}
