/**
 * 진행 중인 일의 종류·경과 표기 — 프로젝트 카드의 진행 중 목록과 PC 단계 보드가 같은 규칙을 쓴다.
 */
import { AGED_HOURS } from '@/lib/report-model/format'

/** 처리(에이전트·담당자) / 검증 / 확인 / AI 채팅 */
export type WorkKind = 'process' | 'verify' | 'confirm' | 'chat'
export const WORK_KINDS: WorkKind[] = ['process', 'verify', 'confirm', 'chat']

/**
 * 단계색 — globals.css 의 --color-ive-stage-*. 처리·검증·확인을 색으로 가른다(채팅은 브랜드색).
 * Tailwind 가 읽을 수 있게 클래스 이름을 문자열 그대로 둔다.
 */
export const STAGE_TONE: Record<WorkKind, { text: string; chip: string; border: string; soft: string }> = {
  process: { text: 'text-ive-stage-process', chip: 'bg-ive-stage-process/15 text-ive-stage-process', border: 'border-ive-stage-process', soft: 'bg-ive-stage-process/5' },
  verify:  { text: 'text-ive-stage-verify',  chip: 'bg-ive-stage-verify/15 text-ive-stage-verify',   border: 'border-ive-stage-verify',  soft: 'bg-ive-stage-verify/5' },
  confirm: { text: 'text-ive-stage-confirm', chip: 'bg-ive-stage-confirm/15 text-ive-stage-confirm', border: 'border-ive-stage-confirm', soft: 'bg-ive-stage-confirm/5' },
  chat:    { text: 'text-ive-cyan',          chip: 'bg-ive-cyan/15 text-ive-cyan',                   border: 'border-ive-cyan',          soft: 'bg-ive-cyan/5' },
}

/**
 * 이슈 단계(라벨) → 색 클래스. 단계 배지·보고서 막대·진행 막대·이슈 목록이 모두 이것만 쓴다(화면마다 따로 정하지 않는다).
 * 진행 단계 = 단계색, 그 단계의 대기 = 같은 계열의 회색빛(강조하지 않음), 실패 = 빨강, 완료 = 브랜드.
 * Tailwind 가 읽을 수 있게 클래스 이름을 문자열 그대로 둔다.
 */
export interface IssueStageStyle { text: string; bg: string; border: string; fill: string; ring: string }
export const ISSUE_STAGE_STYLE: Record<string, IssueStageStyle> = {
  none:            { text: 'text-ive-text-muted',             bg: 'bg-white/5',                      border: 'border-ive-border-subtle',            fill: 'bg-ive-text-muted',             ring: 'ring-ive-border-subtle' },
  waiting:         { text: 'text-ive-stage-process-wait',     bg: 'bg-ive-stage-process-wait/15',    border: 'border-ive-stage-process-wait/30',    fill: 'bg-ive-stage-process-wait',     ring: 'ring-ive-stage-process-wait/30' },
  dev:             { text: 'text-ive-stage-process',          bg: 'bg-ive-stage-process/15',         border: 'border-ive-stage-process/40',         fill: 'bg-ive-stage-process',          ring: 'ring-ive-stage-process/30' },
  dev_fail:        { text: 'text-ive-red',                    bg: 'bg-ive-red/15',                   border: 'border-ive-red/40',                   fill: 'bg-ive-red',                    ring: 'ring-ive-red/30' },
  verify_waiting:  { text: 'text-ive-stage-verify-wait',      bg: 'bg-ive-stage-verify-wait/15',     border: 'border-ive-stage-verify-wait/30',     fill: 'bg-ive-stage-verify-wait',      ring: 'ring-ive-stage-verify-wait/30' },
  verifying:       { text: 'text-ive-stage-verify',           bg: 'bg-ive-stage-verify/15',          border: 'border-ive-stage-verify/40',          fill: 'bg-ive-stage-verify',           ring: 'ring-ive-stage-verify/30' },
  confirm_waiting: { text: 'text-ive-stage-confirm-wait',     bg: 'bg-ive-stage-confirm-wait/15',    border: 'border-ive-stage-confirm-wait/30',    fill: 'bg-ive-stage-confirm-wait',     ring: 'ring-ive-stage-confirm-wait/30' },
  confirming:      { text: 'text-ive-stage-confirm',          bg: 'bg-ive-stage-confirm/15',         border: 'border-ive-stage-confirm/40',         fill: 'bg-ive-stage-confirm',          ring: 'ring-ive-stage-confirm/30' },
  done:            { text: 'text-ive-green',                  bg: 'bg-ive-green/15',                 border: 'border-ive-green/30',                 fill: 'bg-ive-green',                  ring: 'ring-ive-green/30' },
  closed:          { text: 'text-ive-text-muted',             bg: 'bg-white/5',                      border: 'border-ive-border-subtle',            fill: 'bg-ive-text-muted',             ring: 'ring-ive-border-subtle' },
  rejected:        { text: 'text-ive-red',                    bg: 'bg-ive-red/15',                   border: 'border-ive-red/40',                   fill: 'bg-ive-red',                    ring: 'ring-ive-red/30' },
}
export const issueStageStyle = (stage: string | null | undefined): IssueStageStyle => ISSUE_STAGE_STYLE[stage ?? 'none'] ?? ISSUE_STAGE_STYLE.none
/** 단계색 hex — 메일(클래스를 못 쓰는 곳)용. globals.css 토큰과 같은 값 */
export const STAGE_HEX = {
  process: '#f59e0b', verify: '#a78bfa', confirm: '#f472b6',
  processWait: '#c0944f', verifyWait: '#988ac6', confirmWait: '#bf7ea4',
} as const

/** 실행 id 접두어로 종류를 가린다 — 사람이 맡은 실행도 같은 규칙(ex-verify- / ex-confirm- / exec-chat-) */
export function execKind(id: string): WorkKind {
  if (id.startsWith('exec-chat-')) return 'chat'
  if (id.startsWith('ex-verify-')) return 'verify'
  if (id.startsWith('ex-confirm-')) return 'confirm'
  return 'process'
}

/**
 * 진행 중인 실행을 눌렀을 때 갈 곳 — 에이전트가 돌린 실행(처리·검증·확인)은 실시간 실행 화면(트레이스),
 * 사람이 맡은 일과 AI 채팅은 이슈 상세(검증·확인 버튼·대화가 있는 곳). 카드·PC 단계 보드·실행 목록이 같은 규칙을 쓴다.
 */
export function execHref(e: { id: string; assigneeType?: string | null; issueIid: number }, projectId: string): string {
  return e.assigneeType === 'user' || execKind(e.id) === 'chat' ? `/issues/${projectId}/${e.issueIid}` : `/executions/${e.id}`
}

export interface Age { unit: 'now' | 'min' | 'hour' | 'day'; n: number; aged: boolean }

/**
 * 경과를 큰 단위 하나로(18분 · 3시간 · 44일). 초 단위로 흔들리지 않게 한다.
 * 7일(보고서의 「7일 넘은 일」과 같은 기준)을 넘으면 aged.
 */
export function ageOf(startedAt: string, now: number = Date.now()): Age {
  const min = Math.max(0, Math.floor((now - new Date(startedAt).getTime()) / 60_000))
  const aged = min >= AGED_HOURS * 60
  if (min < 1) return { unit: 'now', n: 0, aged }
  if (min < 60) return { unit: 'min', n: min, aged }
  if (min < 24 * 60) return { unit: 'hour', n: Math.floor(min / 60), aged }
  return { unit: 'day', n: Math.floor(min / (24 * 60)), aged }
}

/** ageOf 결과를 문구로 — project 메시지의 ageNow/ageMin/ageHour/ageDay */
export function ageText(t: (key: string, values?: Record<string, number>) => string, a: Age): string {
  if (a.unit === 'now') return t('ageNow')
  return t(a.unit === 'min' ? 'ageMin' : a.unit === 'hour' ? 'ageHour' : 'ageDay', { n: a.n })
}
