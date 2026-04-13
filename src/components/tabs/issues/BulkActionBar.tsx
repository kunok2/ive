'use client'

import { useTranslations } from 'next-intl'

interface StageInfo {
  label: string
  color: string
  icon: string
}

interface BulkAction {
  action: string
  label: string
  icon: string
  danger?: boolean
}

interface BulkActionBarProps {
  selected: Set<number>
  filteredCount: number
  stages: Set<string>
  stageInfo: Record<string, StageInfo>
  bulkActions: BulkAction[]
  bulkProgress: { total: number; done: number; failed: number } | null
  cancelRef: React.RefObject<boolean>
  gitMembersCount: number
  onToggleSelectAll: () => void
  onExitBulkMode: () => void
  onBulkAction: (action: string) => void
  onCancel: () => void
  onOpenAssigneeModal: (iids: number[]) => void
}

export default function BulkActionBar({
  selected,
  filteredCount,
  stages,
  stageInfo,
  bulkActions,
  bulkProgress,
  cancelRef,
  gitMembersCount,
  onToggleSelectAll,
  onExitBulkMode,
  onBulkAction,
  onCancel,
  onOpenAssigneeModal,
}: BulkActionBarProps) {
  const tIssue = useTranslations('issue')
  const tCommon = useTranslations('common')
  const STAGE_INFO_UNKNOWN = stageInfo.unknown

  return (
    <div className="mb-3 bg-ive-bg-card border border-ive-amber/30 rounded-lg p-3">
      <div className="flex items-center justify-between mb-2">
        <div className="flex items-center gap-2">
          <button
            onClick={onToggleSelectAll}
            className="w-7 h-7 rounded-lg border flex items-center justify-center transition-all bg-ive-bg-deep border-ive-border-dark text-ive-text-dim hover:border-ive-green/50"
          >
            {selected.size === filteredCount && filteredCount > 0
              ? <i className="fa-solid fa-square-check text-ive-green text-sm" />
              : selected.size > 0
                ? <i className="fa-solid fa-square-minus text-ive-amber text-sm" />
                : <i className="fa-regular fa-square text-sm" />
            }
          </button>
          <span className="text-sm font-bold text-ive-text">
            {selected.size > 0 ? tIssue('selected', { count: selected.size }) : tIssue('selectIssues')}
          </span>
          {selected.size > 0 && stages.size === 1 && (
            <span className={`text-xs font-bold px-1.5 py-0.5 rounded border ${(stageInfo[[...stages][0]] || STAGE_INFO_UNKNOWN).color}`}>
              {(stageInfo[[...stages][0]] || STAGE_INFO_UNKNOWN).label}
            </span>
          )}
          {selected.size > 0 && stages.size > 1 && (
            <span className="text-xs text-ive-amber font-bold">{tIssue('mixedStages')}</span>
          )}
        </div>
        <button onClick={onExitBulkMode} className="text-sm text-ive-red font-bold px-3 py-1.5 rounded-lg border border-ive-red/30 bg-ive-bg-deep hover:bg-ive-red/10 transition-all active:scale-95">
          <i className="fa-solid fa-xmark mr-1" />{tCommon('cancel')}
        </button>
      </div>

      {/* 프로그레스 바 */}
      {bulkProgress && (
        <div className="mb-2">
          <div className="flex items-center justify-between text-xs mb-1">
            <span className="text-ive-text-muted font-bold">
              {cancelRef.current ? tIssue('cancelled') : bulkProgress.done === bulkProgress.total ? tIssue('completed') : tCommon('processing')}
              {' '}{bulkProgress.done}/{bulkProgress.total}
              {bulkProgress.failed > 0 && <span className="text-ive-red ml-1">({tIssue('failed')} {bulkProgress.failed})</span>}
            </span>
            {bulkProgress.done < bulkProgress.total && !cancelRef.current && (
              <button onClick={onCancel} className="text-ive-red font-bold hover:underline">
                {tIssue('stop')}
              </button>
            )}
          </div>
          <div className="w-full h-1.5 bg-ive-bg-deep rounded-full overflow-hidden">
            <div
              className={`h-full rounded-full transition-all duration-300 ${cancelRef.current ? 'bg-ive-amber' : bulkProgress.failed > 0 ? 'bg-ive-red' : 'bg-ive-green'}`}
              style={{ width: `${(bulkProgress.done / bulkProgress.total) * 100}%` }}
            />
          </div>
        </div>
      )}

      {/* 벌크 액션 버튼들 */}
      {!bulkProgress && selected.size > 0 && (
        <div className="flex gap-2 flex-wrap">
          {gitMembersCount > 0 && (
            <button
              onClick={() => onOpenAssigneeModal([...selected])}
              className="text-xs font-bold px-3 py-1.5 rounded-lg border text-ive-cyan border-ive-cyan/30 bg-ive-bg-deep hover:bg-ive-cyan/10 transition-all active:scale-95"
            >
              <i className="fa-solid fa-user-tag mr-1" />{tIssue('assignee')} ({selected.size})
            </button>
          )}
          {stages.size > 1 ? (
            <>
              <span className="text-xs text-ive-amber py-1">{tIssue('sameStageHint')}</span>
              <button
                onClick={() => onBulkAction('close')}
                className="text-xs font-bold px-3 py-1.5 rounded-lg border text-ive-red/80 border-ive-red/30 bg-ive-bg-deep hover:bg-ive-red/10 transition-all active:scale-95"
              >
                <i className="fa-solid fa-xmark mr-1" />{tCommon('close')} ({selected.size})
              </button>
            </>
          ) : (
            <>
              {bulkActions.map(act => (
                <button
                  key={act.action}
                  onClick={() => onBulkAction(act.action)}
                  className={`text-xs font-bold px-3 py-1.5 rounded-lg border transition-all active:scale-95 ${
                    act.danger
                      ? 'text-ive-red/80 border-ive-red/30 bg-ive-bg-deep hover:bg-ive-red/10'
                      : 'text-ive-green border-ive-green/30 bg-ive-bg-deep hover:bg-ive-green/10'
                  }`}
                >
                  <i className={`fa-solid ${act.icon} mr-1`} />{act.label} ({selected.size})
                </button>
              ))}
              <button
                onClick={() => onBulkAction('close')}
                className="text-xs font-bold px-3 py-1.5 rounded-lg border text-ive-red/80 border-ive-red/30 bg-ive-bg-deep hover:bg-ive-red/10 transition-all active:scale-95"
              >
                <i className="fa-solid fa-xmark mr-1" />{tCommon('close')} ({selected.size})
              </button>
            </>
          )}
        </div>
      )}
    </div>
  )
}
