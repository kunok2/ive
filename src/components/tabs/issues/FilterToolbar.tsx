'use client'

import { useTranslations } from 'next-intl'
import type { IveIssue } from './types'

interface FilterTab {
  key: string
  label: string
}

interface FilterToolbarProps {
  filterTabs: FilterTab[]
  filter: string
  onFilterChange: (filter: string) => void
  onFetchClosedIssues: () => void
  issues: IveIssue[]
  closedIssues: IveIssue[]
  /** 이력 전체 건수 (서버가 모르면 null → 받은 건수로 표시) */
  closedTotal?: number | null
  onClearSelected: () => void
  issueSearchQuery: string
  onSearchQueryChange: (query: string) => void
  canFilterMine: boolean
  onlyMine: boolean
  onToggleOnlyMine: () => void
  isMine: (issue: IveIssue) => boolean
  sortOrder: 'newest' | 'oldest'
  onSortChange: (sort: 'newest' | 'oldest') => void
}

export default function FilterToolbar({
  filterTabs,
  filter,
  onFilterChange,
  onFetchClosedIssues,
  issues,
  closedIssues,
  closedTotal = null,
  onClearSelected,
  issueSearchQuery,
  onSearchQueryChange,
  canFilterMine,
  onlyMine,
  onToggleOnlyMine,
  isMine,
  sortOrder,
  onSortChange,
}: FilterToolbarProps) {
  const tIssue = useTranslations('issue')
  const tSort = useTranslations('sort')

  return (
    <>
      <div data-tour="issues-filter" className="flex gap-1 mb-2 bg-ive-bg-card rounded-lg p-1 border border-ive-border-subtle">
        {filterTabs.map(tab => (
          <button
            key={tab.key}
            onClick={() => {
              onFilterChange(tab.key)
              onClearSelected()
              if (tab.key === 'history') onFetchClosedIssues()
            }}
            className={`flex-1 py-2 text-sm font-bold rounded-lg transition-all ${
              filter === tab.key
                ? tab.key === 'history' ? 'bg-ive-text-dim/20 text-ive-text-muted' : 'bg-ive-green/20 text-ive-green'
                : 'text-ive-text-dim hover:text-ive-text-muted'
            }`}
          >
            {tab.label}
            {(() => {
              const mineFilter = (i: IveIssue) => !onlyMine || !canFilterMine || isMine(i)
              const count = tab.key === 'all' ? issues.filter(mineFilter).length
                : tab.key === 'waiting' ? issues.filter(i => i.stage === 'waiting' && mineFilter(i)).length
                : tab.key === 'active' ? issues.filter(i => (i.stage === 'dev' || i.stage === 'verify_waiting' || i.stage === 'verifying' || i.stage === 'confirm_waiting' || i.stage === 'confirming') && mineFilter(i)).length
                : tab.key === 'failed' ? issues.filter(i => (i.stage === 'dev_fail' || i.stage === 'rejected') && mineFilter(i)).length
                : tab.key === 'done' ? issues.filter(i => i.stage === 'done' && mineFilter(i)).length
                // 이력은 한 페이지씩 받으므로 전체 건수는 서버(Git)가 알려 준 값. "내 것만"은 받은 범위 안에서 센다.
                : tab.key === 'history' ? ((onlyMine && canFilterMine) || closedTotal == null ? closedIssues.filter(mineFilter).length : closedTotal)
                : 0
              return count > 0 ? <span className="ml-1 text-xs opacity-60">{count}</span> : null
            })()}
          </button>
        ))}
      </div>

      {/* search + "assigned to me" + sort */}
      <div className="flex items-center gap-2 mb-3">
        <div className="flex-1 relative">
          <i className="fa-solid fa-magnifying-glass absolute left-2.5 top-1/2 -translate-y-1/2 text-[10px] text-ive-text-dim" />
          <input
            type="text"
            value={issueSearchQuery}
            onChange={e => onSearchQueryChange(e.target.value)}
            placeholder={tIssue('searchPlaceholder')}
            className="w-full bg-ive-bg-card border border-ive-border-subtle rounded-lg pl-7 pr-7 py-1.5 text-sm text-ive-text placeholder-ive-text-dim focus:outline-none focus:border-ive-green/50 transition-colors"
          />
          {issueSearchQuery && (
            <button onClick={() => onSearchQueryChange('')} className="absolute right-2 top-1/2 -translate-y-1/2 text-ive-text-dim hover:text-ive-text">
              <i className="fa-solid fa-xmark text-[10px]" />
            </button>
          )}
        </div>
        {canFilterMine && (
          <button
            onClick={onToggleOnlyMine}
            className={`text-sm font-bold flex items-center gap-1 px-3 py-1.5 rounded-lg border transition-all shrink-0 ${
              onlyMine
                ? 'bg-ive-green/20 text-ive-green border-ive-green/40'
                : 'bg-ive-bg-card text-ive-text-dim border-ive-border-subtle hover:text-ive-text hover:border-ive-green/30'
            }`}
            title={tIssue('assignedToMeTooltip')}
          >
            <i className={`fa-solid ${onlyMine ? 'fa-user-check' : 'fa-user'}`} />
            {tIssue('assignedToMe')}
          </button>
        )}
        <button
          onClick={() => onSortChange(sortOrder === 'newest' ? 'oldest' : 'newest')}
          className="text-sm font-bold text-ive-text-dim hover:text-ive-text flex items-center gap-1 px-3 py-1.5 rounded-lg bg-ive-bg-card border border-ive-border-subtle hover:border-ive-green/30 transition-all shrink-0"
        >
          <i className={`fa-solid ${sortOrder === 'newest' ? 'fa-arrow-down-wide-short' : 'fa-arrow-up-wide-short'}`} />
          {sortOrder === 'newest' ? tSort('newest') : tSort('oldest')}
        </button>
      </div>
    </>
  )
}
