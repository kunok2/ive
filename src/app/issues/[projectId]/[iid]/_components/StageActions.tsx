'use client'

import { useTranslations } from 'next-intl'
import { ISSUE_STAGE_STYLE } from '@/lib/active-work'

export type StageDirection = 'forward' | 'backward' | 'stay'

export interface StageAction {
  action: string
  label: string
  icon: string
  direction: StageDirection
  /** 시각적 위험 강조 (반려/취소 등). backward 와 직교 */
  danger?: boolean
}

/** 검증·확인 도중에 닫힌 작업 — 단계 라벨은 그대로인데 이슈만 닫혔다(MR 머지의 닫기 키워드로 Git 이 닫음 등). 다음 단계로 이어 가면 서버가 다시 연다 */
const MIDWAY_STAGES = new Set(['verify_waiting', 'verifying', 'confirm_waiting', 'confirming'])
export function isClosedMidway(issue: { state?: string; stage?: string }): boolean {
  return issue.state === 'closed' && !!issue.stage && MIDWAY_STAGES.has(issue.stage)
}

/** 뒤로 가는 버튼(「이전 단계로」·「재처리」)이 보내는 단계 액션 — 버튼에 적는 도착 단계와 실제 전이가 같은 값을 쓴다 */
export function retryActionOf(stage: string | null | undefined): string {
  return stage === 'done' ? 'reopen'
    : stage === 'verifying' ? 'reject'
    : stage === 'confirming' ? 'return_to_dev'
    : stage === 'none' ? 'schedule'
    : 'retry'
}

export function useStageConfig() {
  const tStage = useTranslations('stage')
  const tIssue = useTranslations('issue')

  // 색 = 앱 전체 단계 색(진행 = 단계색, 그 단계 대기 = 회색빛) — lib/active-work ISSUE_STAGE_STYLE
  const STAGE_INFO: Record<string, { label: string; color: string; icon: string; bg: string }> = {
    none:            { label: tStage('none'),            color: ISSUE_STAGE_STYLE.none.text, icon: 'fa-inbox',              bg: ISSUE_STAGE_STYLE.none.bg },
    waiting:         { label: tStage('waiting'),         color: ISSUE_STAGE_STYLE.waiting.text, icon: 'fa-clock',              bg: ISSUE_STAGE_STYLE.waiting.bg },
    verify_waiting:  { label: tStage('verify_waiting'),  color: ISSUE_STAGE_STYLE.verify_waiting.text, icon: 'fa-hourglass-half',  bg: ISSUE_STAGE_STYLE.verify_waiting.bg },
    dev:             { label: tStage('dev'),             color: ISSUE_STAGE_STYLE.dev.text, icon: 'fa-code',           bg: ISSUE_STAGE_STYLE.dev.bg },
    dev_fail:        { label: tStage('dev_fail'),        color: ISSUE_STAGE_STYLE.dev_fail.text, icon: 'fa-circle-xmark',       bg: ISSUE_STAGE_STYLE.dev_fail.bg },
    verifying:       { label: tStage('verifying'),       color: ISSUE_STAGE_STYLE.verifying.text, icon: 'fa-magnifying-glass', bg: ISSUE_STAGE_STYLE.verifying.bg },
    confirm_waiting: { label: tStage('confirm_waiting'), color: ISSUE_STAGE_STYLE.confirm_waiting.text, icon: 'fa-hourglass-half',  bg: ISSUE_STAGE_STYLE.confirm_waiting.bg },
    confirming:      { label: tStage('confirming'),      color: ISSUE_STAGE_STYLE.confirming.text, icon: 'fa-clipboard-check', bg: ISSUE_STAGE_STYLE.confirming.bg },
    done:            { label: tStage('done'),            color: ISSUE_STAGE_STYLE.done.text, icon: 'fa-circle-check',       bg: ISSUE_STAGE_STYLE.done.bg },
    closed:          { label: tStage('closed'),          color: ISSUE_STAGE_STYLE.closed.text, icon: 'fa-lock',               bg: ISSUE_STAGE_STYLE.closed.bg },
    rejected:        { label: tStage('rejected'),        color: ISSUE_STAGE_STYLE.rejected.text, icon: 'fa-rotate-left',        bg: ISSUE_STAGE_STYLE.rejected.bg },
    unknown:         { label: tStage('unknown'),         color: ISSUE_STAGE_STYLE.none.text, icon: 'fa-question',           bg: ISSUE_STAGE_STYLE.none.bg },
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
