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
  /** 처리 담당(에이전트·자동·사람) — 프로젝트 에이전트나 Git 멤버가 있을 때 */
  canPickAgent: boolean
  onOpenAgentPicker: () => void
  onBulkPriority: (priority: 0 | 1 | 2) => void
  onOpenRolePicker: (role: 'verifier' | 'confirmer') => void
  /** 모든 단계 자동배정 — 에이전트가 있을 때 */
  canAutoAll: boolean
  onOpenDueDate: () => void
}

const PRIORITY_TONE: Record<0 | 1 | 2, string> = {
  0: 'text-ive-text-secondary border-ive-border-subtle hover:bg-white/[0.04]',
  1: 'text-ive-amber border-ive-amber/30 hover:bg-ive-amber/10',
  2: 'text-ive-red border-ive-red/30 hover:bg-ive-red/10',
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
  canPickAgent,
  onOpenAgentPicker,
  onBulkPriority,
  onOpenRolePicker,
  canAutoAll,
  onOpenDueDate,
}: BulkActionBarProps) {
  const tIssue = useTranslations('issue')
  const tCommon = useTranslations('common')
  const tAuto = useTranslations('automation')
  const STAGE_INFO_UNKNOWN = stageInfo.unknown

  return (
    // 줄 사이 간격은 gap 으로 — 줄마다 mb 를 두면 아무것도 고르지 않았을 때(첫 줄만) 아래 여백만 커져 위로 쏠렸다
    <div className="mb-3 flex flex-col gap-2 bg-ive-bg-card border border-ive-amber/30 rounded-lg p-3">
      <div className="flex items-center justify-between">
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
        <div>
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
          {/* 다음 단계로 — 단계가 섞여도 작업마다 자기 다음 단계로(작업 상세의 다음 단계 버튼과 같은 동작). 에이전트가 시작할 일은 건너뛴다 */}
          <button
            onClick={() => onBulkAction('next')}
            className="text-xs font-bold px-3 py-1.5 rounded-lg border text-ive-green border-ive-green/30 bg-ive-bg-deep hover:bg-ive-green/10 transition-all active:scale-95"
          >
            <i className="fa-solid fa-forward mr-1" />{tIssue('bulkNextStage')} ({selected.size})
          </button>
          {/* 모든 단계 자동배정 — 작업 상세의 같은 버튼(처리·검증·확인을 명부의 에이전트로) */}
          {canAutoAll && (
            <button
              onClick={() => onBulkAction('auto_all')}
              className="text-xs font-bold px-3 py-1.5 rounded-lg border text-ive-cyan border-ive-cyan/30 bg-ive-bg-deep hover:bg-ive-cyan/10 transition-all active:scale-95"
            >
              <i className="fa-solid fa-wand-magic-sparkles mr-1" />{tAuto('autoAllAgents')} ({selected.size})
            </button>
          )}
          {gitMembersCount > 0 && (
            <button
              onClick={() => onOpenAssigneeModal([...selected])}
              className="text-xs font-bold px-3 py-1.5 rounded-lg border text-ive-cyan border-ive-cyan/30 bg-ive-bg-deep hover:bg-ive-cyan/10 transition-all active:scale-95"
            >
              <i className="fa-solid fa-user-tag mr-1" />{tIssue('assignee')} ({selected.size})
            </button>
          )}
          {canPickAgent && (
            <button
              onClick={onOpenAgentPicker}
              className="text-xs font-bold px-3 py-1.5 rounded-lg border text-ive-cyan border-ive-cyan/30 bg-ive-bg-deep hover:bg-ive-cyan/10 transition-all active:scale-95"
            >
              <i className="fa-solid fa-robot mr-1" />{tIssue('preferredAgent')} ({selected.size})
            </button>
          )}
          {/* 검증자·확인자 — 카드의 역할 아바타를 눌러 고르는 것과 같은 창 */}
          {(['verifier', 'confirmer'] as const).map(role => (
            <button
              key={role}
              onClick={() => onOpenRolePicker(role)}
              className="text-xs font-bold px-3 py-1.5 rounded-lg border text-ive-cyan border-ive-cyan/30 bg-ive-bg-deep hover:bg-ive-cyan/10 transition-all active:scale-95"
            >
              <i className={`fa-solid ${role === 'verifier' ? 'fa-magnifying-glass' : 'fa-clipboard-check'} mr-1`} />{tIssue(role)} ({selected.size})
            </button>
          ))}
          <button
            onClick={onOpenDueDate}
            className="text-xs font-bold px-3 py-1.5 rounded-lg border text-ive-cyan border-ive-cyan/30 bg-ive-bg-deep hover:bg-ive-cyan/10 transition-all active:scale-95"
          >
            <i className="fa-solid fa-calendar-days mr-1" />{tIssue('dueDate')} ({selected.size})
          </button>
          {/* 우선순위 — 보통·높음·긴급, 작업 상세의 우선순위와 같은 값 */}
          {([0, 1, 2] as const).map(p => (
            <button
              key={p}
              onClick={() => onBulkPriority(p)}
              title={tIssue('priority')}
              className={`text-xs font-bold px-3 py-1.5 rounded-lg border bg-ive-bg-deep transition-all active:scale-95 ${PRIORITY_TONE[p]}`}
            >
              <i className="fa-solid fa-flag mr-1" />{tIssue(`priority${p}`)}
            </button>
          ))}
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
