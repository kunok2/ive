'use client'

import { useTranslations } from 'next-intl'

interface StageAction {
  action: string
  label: string
  icon: string
  danger?: boolean
}

export function useStageConfig() {
  const tStage = useTranslations('stage')
  const tIssue = useTranslations('issue')

  const STAGE_INFO: Record<string, { label: string; color: string; icon: string; bg: string }> = {
    waiting:        { label: tStage('waiting'),        color: 'text-ive-cyan',      icon: 'fa-clock',              bg: 'bg-ive-cyan/10' },
    verify_waiting: { label: tStage('verify_waiting'), color: 'text-ive-amber',     icon: 'fa-hourglass-half',     bg: 'bg-ive-amber/10' },
    dev:            { label: tStage('dev'),            color: 'text-ive-amber',     icon: 'fa-code',               bg: 'bg-ive-amber/10' },
    dev_fail:       { label: tStage('dev_fail'),       color: 'text-ive-red',       icon: 'fa-circle-xmark',       bg: 'bg-ive-red/10' },
    verifying:      { label: tStage('verifying'),      color: 'text-ive-amber',     icon: 'fa-magnifying-glass',   bg: 'bg-ive-amber/10' },
    done:           { label: tStage('done'),           color: 'text-ive-green',     icon: 'fa-circle-check',       bg: 'bg-ive-green/10' },
    closed:         { label: tStage('closed'),         color: 'text-ive-text-muted',icon: 'fa-lock',               bg: 'bg-white/5' },
    rejected:       { label: tStage('rejected'),       color: 'text-ive-red',       icon: 'fa-rotate-left',        bg: 'bg-ive-red/10' },
    unknown:        { label: tStage('unknown'),        color: 'text-ive-text-dim',  icon: 'fa-question',           bg: 'bg-white/5' },
  }

  const STAGE_ACTIONS: Record<string, StageAction[]> = {
    waiting: [],
    verify_waiting: [
      { action: 'start_verification', label: tIssue('startVerification'), icon: 'fa-play' },
      { action: 'cancel', label: tIssue('cancelToWaiting'), icon: 'fa-rotate-left', danger: true },
    ],
    dev: [
      { action: 'cancel', label: tIssue('cancelToDev'), icon: 'fa-rotate-left', danger: true },
    ],
    dev_fail: [
      { action: 'retry', label: tIssue('retryToWaiting'), icon: 'fa-rotate' },
    ],
    verifying: [
      { action: 'approve', label: tIssue('approveVerify'), icon: 'fa-circle-check' },
      { action: 'reject', label: tIssue('rejectVerify'), icon: 'fa-rotate-left', danger: true },
    ],
    done: [
      { action: 'reopen', label: tIssue('reopenToWaiting'), icon: 'fa-rotate' },
      { action: 'retry', label: tIssue('retryToWaiting'), icon: 'fa-rotate' },
    ],
    rejected: [
      { action: 'retry', label: tIssue('retryToWaiting'), icon: 'fa-rotate' },
    ],
  }

  return { STAGE_INFO, STAGE_ACTIONS }
}

interface StageActionButtonsProps {
  actions: StageAction[]
  stageChanging: boolean
  onAction: (action: string) => void
}

export default function StageActionButtons({ actions, stageChanging, onAction }: StageActionButtonsProps) {
  return (
    <>
      {actions.map(act => (
        <button
          key={act.action}
          onClick={() => onAction(act.action)}
          disabled={stageChanging}
          className={`h-7 px-2 rounded-lg text-xs font-bold border transition-all active:scale-95 disabled:opacity-40 ${
            act.danger
              ? 'text-ive-red/80 border-ive-red/30 bg-ive-bg-card hover:bg-ive-red/10'
              : 'text-ive-green border-ive-green/30 bg-ive-bg-card hover:bg-ive-green/10'
          }`}
        >
          {stageChanging ? <i className="fa-solid fa-circle-notch fa-spin" /> : <><i className={`fa-solid ${act.icon} mr-0.5`} />{act.label}</>}
        </button>
      ))}
    </>
  )
}
