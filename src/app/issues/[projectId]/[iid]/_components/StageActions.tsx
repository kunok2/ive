'use client'

import { useTranslations } from 'next-intl'

export type StageDirection = 'forward' | 'backward' | 'stay'

export interface StageAction {
  action: string
  label: string
  icon: string
  direction: StageDirection
  /** 시각적 위험 강조 (반려/취소 등). backward 와 직교 */
  danger?: boolean
}

export function useStageConfig() {
  const tStage = useTranslations('stage')
  const tIssue = useTranslations('issue')

  const STAGE_INFO: Record<string, { label: string; color: string; icon: string; bg: string }> = {
    waiting:         { label: tStage('waiting'),         color: 'text-ive-cyan',      icon: 'fa-clock',              bg: 'bg-ive-cyan/10' },
    verify_waiting:  { label: tStage('verify_waiting'),  color: 'text-ive-amber',     icon: 'fa-hourglass-half',     bg: 'bg-ive-amber/10' },
    dev:             { label: tStage('dev'),             color: 'text-ive-cyan',      icon: 'fa-code',               bg: 'bg-ive-cyan/10' },
    dev_fail:        { label: tStage('dev_fail'),        color: 'text-ive-red',       icon: 'fa-circle-xmark',       bg: 'bg-ive-red/10' },
    verifying:       { label: tStage('verifying'),       color: 'text-ive-amber',     icon: 'fa-magnifying-glass',   bg: 'bg-ive-amber/10' },
    confirm_waiting: { label: tStage('confirm_waiting'), color: 'text-ive-amber',     icon: 'fa-hourglass-half',     bg: 'bg-ive-amber/10' },
    confirming:      { label: tStage('confirming'),      color: 'text-ive-amber',     icon: 'fa-clipboard-check',    bg: 'bg-ive-amber/10' },
    done:            { label: tStage('done'),            color: 'text-ive-green',     icon: 'fa-circle-check',       bg: 'bg-ive-green/10' },
    closed:          { label: tStage('closed'),          color: 'text-ive-text-muted',icon: 'fa-lock',               bg: 'bg-white/5' },
    rejected:        { label: tStage('rejected'),        color: 'text-ive-red',       icon: 'fa-rotate-left',        bg: 'bg-ive-red/10' },
    unknown:         { label: tStage('unknown'),         color: 'text-ive-text-dim',  icon: 'fa-question',           bg: 'bg-white/5' },
  }

  const STAGE_ACTIONS: Record<string, StageAction[]> = {
    waiting: [],
    verify_waiting: [
      { action: 'cancel',            direction: 'backward', label: tIssue('cancelToWaiting'),  icon: 'fa-rotate-left', danger: true },
      { action: 'start_verification',direction: 'forward',  label: tIssue('startVerification'), icon: 'fa-play' },
    ],
    dev: [
      { action: 'cancel',            direction: 'backward', label: tIssue('cancelToDev'),       icon: 'fa-rotate-left', danger: true },
    ],
    dev_fail: [
      { action: 'retry',             direction: 'backward', label: tIssue('retryToWaiting'),    icon: 'fa-rotate' },
    ],
    verifying: [
      { action: 'reject',            direction: 'backward', label: tIssue('rejectVerify'),      icon: 'fa-rotate-left', danger: true },
      { action: 'approve',           direction: 'forward',  label: tIssue('approveVerify'),     icon: 'fa-circle-check' },
    ],
    confirm_waiting: [
      { action: 'cancel',            direction: 'backward', label: tIssue('cancelConfirmWait'), icon: 'fa-rotate-left', danger: true },
      { action: 'start_confirmation',direction: 'forward',  label: tIssue('startConfirmation'), icon: 'fa-play' },
    ],
    confirming: [
      { action: 'return_to_dev',     direction: 'backward', label: tIssue('returnToDev'),       icon: 'fa-rotate-left', danger: true },
      { action: 'accept',            direction: 'forward',  label: tIssue('acceptConfirm'),     icon: 'fa-circle-check' },
    ],
    done: [
      { action: 'reopen',            direction: 'backward', label: tIssue('reopenToWaiting'),   icon: 'fa-rotate' },
    ],
    rejected: [
      { action: 'retry',             direction: 'backward', label: tIssue('retryToWaiting'),    icon: 'fa-rotate' },
    ],
  }

  return { STAGE_INFO, STAGE_ACTIONS }
}

interface StageActionButtonsProps {
  actions: StageAction[]
  stageChanging: boolean
  onAction: (action: string) => void
}

/**
 * 액션 버튼을 방향별로 그룹화해 좌(후진) / 우(전진) 로 배치한다.
 * stay 는 가운데(현재 컨텍스트 없음)이지만 stage-only 영역에서는 사용하지 않는다.
 */
export default function StageActionButtons({ actions, stageChanging, onAction }: StageActionButtonsProps) {
  const backward = actions.filter(a => a.direction === 'backward')
  const forward = actions.filter(a => a.direction === 'forward')

  if (actions.length === 0) return null

  return (
    <div className="flex items-center gap-1 flex-wrap justify-end">
      {backward.map(act => (
        <button
          key={act.action}
          onClick={() => onAction(act.action)}
          disabled={stageChanging}
          className={`h-7 px-2 rounded-lg text-xs font-bold border transition-all active:scale-95 disabled:opacity-40 ${
            act.danger
              ? 'text-ive-red/80 border-ive-red/30 bg-ive-bg-card hover:bg-ive-red/10'
              : 'text-ive-amber border-ive-amber/30 bg-ive-bg-card hover:bg-ive-amber/10'
          }`}
          title={act.label}
        >
          {stageChanging
            ? <i className="fa-solid fa-circle-notch fa-spin" />
            : <><i className="fa-solid fa-arrow-left mr-1 text-[10px]" /><i className={`fa-solid ${act.icon} mr-1`} />{act.label}</>
          }
        </button>
      ))}
      {forward.map(act => (
        <button
          key={act.action}
          onClick={() => onAction(act.action)}
          disabled={stageChanging}
          className="h-7 px-2 rounded-lg text-xs font-bold border transition-all active:scale-95 disabled:opacity-40 text-ive-green border-ive-green/40 bg-ive-green/10 hover:bg-ive-green/20"
          title={act.label}
        >
          {stageChanging
            ? <i className="fa-solid fa-circle-notch fa-spin" />
            : <><i className={`fa-solid ${act.icon} mr-1`} />{act.label}<i className="fa-solid fa-arrow-right ml-1 text-[10px]" /></>
          }
        </button>
      ))}
    </div>
  )
}
