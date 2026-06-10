'use client'

import { useTranslations } from 'next-intl'

interface ProjectHeaderProps {
  project: { name: string; color?: string; provider: string; repoUrl: string }
  issueCount: number
  canEdit: boolean
  bulkMode: boolean
  isHistoryTab: boolean
  loading: boolean
  closedLoading: boolean
  showAddForm: boolean
  onToggleAddForm: () => void
  onEnterBulkMode: () => void
  onRefresh: () => void
}

export default function ProjectHeader({
  project,
  issueCount,
  canEdit,
  bulkMode,
  isHistoryTab,
  loading,
  closedLoading,
  onToggleAddForm,
  onEnterBulkMode,
  onRefresh,
}: ProjectHeaderProps) {
  const tIssue = useTranslations('issue')
  const tCommon = useTranslations('common')

  return (
    <div className="flex items-center gap-3 mb-3 bg-ive-bg-card border border-ive-border-subtle rounded-lg px-4 py-3">
      <div className="w-9 h-9 rounded-lg flex items-center justify-center shrink-0" style={{ backgroundColor: `${project.color || '#22d3ee'}15` }}>
        <i className={`fa-brands ${project.provider === 'github' ? 'fa-github' : 'fa-gitlab'} text-xl`}
           style={{ color: project.color || '#22d3ee' }} />
      </div>
      <div className="min-w-0 flex-1">
        <div className="text-base font-bold text-ive-text truncate">{project.name}</div>
        <div className="text-xs text-ive-text-dim truncate">{project.repoUrl}</div>
      </div>
      <div className="flex items-center gap-2 shrink-0">
        <div className="text-center">
          <div className="text-lg font-bold text-ive-green-light">{issueCount}</div>
          <div className="text-xs text-ive-text-dim">{tIssue('issues')}</div>
        </div>
        {canEdit && !bulkMode && (
          <button
            onClick={onToggleAddForm}
            className="w-9 h-9 rounded-lg bg-ive-green/20 border border-ive-green/30 flex items-center justify-center text-ive-green hover:bg-ive-green/30 hover:scale-105 transition-all"
            title={tIssue('addNewIssue')}
          >
            <i className="fa-solid fa-plus text-sm" />
          </button>
        )}
        {canEdit && issueCount > 0 && !bulkMode && !isHistoryTab && (
          <button
            onClick={onEnterBulkMode}
            className="w-9 h-9 rounded-lg bg-ive-bg-deep border border-ive-border-subtle flex items-center justify-center text-ive-text-dim hover:text-ive-text hover:border-ive-green/30 transition-all"
            title={tIssue('bulkEdit')}
          >
            <i className="fa-solid fa-list-check text-sm" />
          </button>
        )}
        {!bulkMode && (
          <button
            onClick={onRefresh}
            disabled={loading || closedLoading}
            className="w-9 h-9 rounded-lg bg-ive-bg-deep border border-ive-border-subtle flex items-center justify-center text-ive-text-dim hover:text-ive-green hover:border-ive-green/30 transition-all disabled:opacity-40"
            title={tCommon('refresh')}
          >
            <i className={`fa-solid fa-arrows-rotate text-sm ${(loading || closedLoading) ? 'fa-spin' : ''}`} />
          </button>
        )}
      </div>
    </div>
  )
}
