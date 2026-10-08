/**
 * 단계 전이 표 — 각 stage 에서 허용되는 action 과 전이 시 적용할 라벨 변경.
 *
 * 모든 stage 의 모든 action 은 단계 라벨(S/D/W/V/P/C/E) 사이의 일관성을 보장해야 한다.
 *   - 전이 후 라벨 집합에는 단계 라벨이 정확히 하나만 남아야 한다.
 *   - removeLabels 는 "전이 시점에 분명히 제거할 라벨" 만 명시.
 *   - addLabels 는 "전이 후 추가할 라벨" 만 명시.
 *   - 라벨 잔재 정리는 호출 측에서 sanitizeStageLabels 로 보강한다.
 */

import type { Project } from '@/types'
import { DEFAULT_LABELS } from '@/lib/labels'

export interface StageTransition {
  action: string
  description: string
  removeLabels: (p: Project) => string[]
  addLabels: (p: Project) => string[]
}

export const TRANSITIONS: Record<string, StageTransition[]> = {
  none: [
    {
      action: 'schedule',
      description: '스케줄 등록',
      removeLabels: () => [],
      addLabels: p => [p.labelSchedule || DEFAULT_LABELS.schedule],
    },
  ],
  waiting: [
    {
      action: 'start_dev',
      description: '개발 시작 → 개발 중',
      removeLabels: p => [p.labelSchedule || DEFAULT_LABELS.schedule],
      addLabels: p => [p.labelDev || DEFAULT_LABELS.dev],
    },
  ],
  dev: [
    {
      action: 'cancel',
      description: '작업 취소 → 스케줄',
      removeLabels: p => [p.labelDev || DEFAULT_LABELS.dev],
      addLabels: p => [p.labelSchedule || DEFAULT_LABELS.schedule],
    },
    {
      action: 'complete',
      description: '머지 완료 → 검증대기',
      removeLabels: p => [p.labelDev || DEFAULT_LABELS.dev],
      addLabels: p => [p.labelVerifyWait || DEFAULT_LABELS.verifyWait],
    },
    {
      action: 'retry',
      description: '재시도 → 스케줄',
      removeLabels: p => [p.labelDev || DEFAULT_LABELS.dev],
      addLabels: p => [p.labelSchedule || DEFAULT_LABELS.schedule],
    },
  ],
  dev_fail: [
    {
      action: 'retry',
      description: '재시도 → 스케줄',
      removeLabels: p => [p.labelDev || DEFAULT_LABELS.dev],
      addLabels: p => [p.labelSchedule || DEFAULT_LABELS.schedule],
    },
  ],
  verify_waiting: [
    {
      action: 'start_verification',
      description: '검증시작 → 검증 중',
      removeLabels: p => [p.labelVerifyWait || DEFAULT_LABELS.verifyWait],
      addLabels: p => [p.labelVerify || DEFAULT_LABELS.verify],
    },
    {
      action: 'cancel',
      description: '검증대기 취소 → 스케줄',
      removeLabels: p => [p.labelVerifyWait || DEFAULT_LABELS.verifyWait],
      addLabels: p => [p.labelSchedule || DEFAULT_LABELS.schedule],
    },
    {
      action: 'retry',
      description: '재시도 → 스케줄',
      removeLabels: p => [p.labelVerifyWait || DEFAULT_LABELS.verifyWait],
      addLabels: p => [p.labelSchedule || DEFAULT_LABELS.schedule],
    },
    {
      action: 'to_inflow',
      description: '유입 상태로 초기화',
      removeLabels: p => [p.labelVerifyWait || DEFAULT_LABELS.verifyWait],
      addLabels: () => [],
    },
  ],
  verifying: [
    {
      action: 'approve',
      description: '검증 승인 → 확인대기',
      removeLabels: p => [p.labelVerify || DEFAULT_LABELS.verify],
      addLabels: p => [p.labelConfirmWait || DEFAULT_LABELS.confirmWait],
    },
    {
      action: 'complete',
      description: '머지 완료 → 확인대기',
      removeLabels: p => [p.labelVerify || DEFAULT_LABELS.verify, p.labelDev || DEFAULT_LABELS.dev],
      addLabels: p => [p.labelConfirmWait || DEFAULT_LABELS.confirmWait],
    },
    {
      action: 'reject',
      description: '검증 반려 → 스케줄 (처리 재요청)',
      removeLabels: p => [p.labelVerify || DEFAULT_LABELS.verify],
      addLabels: p => [p.labelSchedule || DEFAULT_LABELS.schedule],
    },
    {
      action: 'retry',
      description: '재시도 → 스케줄',
      removeLabels: p => [p.labelVerify || DEFAULT_LABELS.verify],
      addLabels: p => [p.labelSchedule || DEFAULT_LABELS.schedule],
    },
    {
      action: 'to_inflow',
      description: '유입 상태로 초기화',
      removeLabels: p => [p.labelVerify || DEFAULT_LABELS.verify],
      addLabels: () => [],
    },
  ],
  confirm_waiting: [
    {
      action: 'start_confirmation',
      description: '확인 시작 → 확인 중',
      removeLabels: p => [p.labelConfirmWait || DEFAULT_LABELS.confirmWait],
      addLabels: p => [p.labelConfirm || DEFAULT_LABELS.confirm],
    },
    {
      action: 'cancel',
      description: '확인대기 취소 → 스케줄',
      removeLabels: p => [p.labelConfirmWait || DEFAULT_LABELS.confirmWait],
      addLabels: p => [p.labelSchedule || DEFAULT_LABELS.schedule],
    },
    {
      // 확인 쪽 반려는 검증대기로 돌아간다(처리대기 아님 — 사용자 확정 2026-10-07). 화면 버튼 이름도 「검증대기로」다.
      action: 'return_to_dev',
      description: '재검증 요청 → 검증대기',
      removeLabels: p => [p.labelConfirmWait || DEFAULT_LABELS.confirmWait],
      addLabels: p => [p.labelVerifyWait || DEFAULT_LABELS.verifyWait],
    },
    {
      action: 'retry',
      description: '재시도 → 스케줄',
      removeLabels: p => [p.labelConfirmWait || DEFAULT_LABELS.confirmWait],
      addLabels: p => [p.labelSchedule || DEFAULT_LABELS.schedule],
    },
  ],
  confirming: [
    {
      action: 'accept',
      description: '확인 완료 → 완료',
      removeLabels: p => [p.labelConfirm || DEFAULT_LABELS.confirm],
      addLabels: p => [p.labelEnd || DEFAULT_LABELS.end],
    },
    {
      action: 'return_to_dev',
      description: '재검증 요청 → 검증대기',
      removeLabels: p => [p.labelConfirm || DEFAULT_LABELS.confirm],
      addLabels: p => [p.labelVerifyWait || DEFAULT_LABELS.verifyWait],
    },
    // ⛔ 확인 중 → 스케줄(retry) 길을 두지 않는다 — 확인 반려는 검증대기로만 간다(사용자 확정 2026-10-07).
    //    처리대기로 바로 보내면 확인자의 화면 단서가 코드 지시로 바뀌지 않은 채 처리자에게 간다.
  ],
  done: [
    {
      action: 'reopen',
      description: '재확인 요청 → 확인대기',
      removeLabels: p => [p.labelEnd || DEFAULT_LABELS.end],
      addLabels: p => [p.labelConfirmWait || DEFAULT_LABELS.confirmWait],
    },
    {
      action: 'retry',
      description: '재시도 → 스케줄',
      removeLabels: p => [p.labelEnd || DEFAULT_LABELS.end],
      addLabels: p => [p.labelSchedule || DEFAULT_LABELS.schedule],
    },
  ],
  rejected: [
    {
      action: 'retry',
      description: '재시도 → 스케줄',
      removeLabels: () => [],
      addLabels: p => [p.labelSchedule || DEFAULT_LABELS.schedule],
    },
  ],
}

/** 모든 단계 라벨 목록 */
export function allStageLabels(p: Project): string[] {
  return [
    p.labelSchedule || DEFAULT_LABELS.schedule,
    p.labelDev || DEFAULT_LABELS.dev,
    p.labelVerifyWait || DEFAULT_LABELS.verifyWait,
    p.labelVerify || DEFAULT_LABELS.verify,
    p.labelConfirmWait || DEFAULT_LABELS.confirmWait,
    p.labelConfirm || DEFAULT_LABELS.confirm,
    p.labelEnd || DEFAULT_LABELS.end,
  ]
}

/** 대상 라벨(ive) — 단계 라벨 없이 등록만 된 이슈 표시 */
export function targetLabelOf(p: Project): string {
  return p.labelTarget || DEFAULT_LABELS.target
}

/**
 * IVE 가 관리하는 이슈인가 — 대상 라벨(ive) 또는 단계 라벨 중 하나라도 있으면.
 * 단계 라벨이 붙으면 대상 라벨은 뗀다(중복 표시). 예전 이슈는 둘 다 붙어 있을 수 있다.
 */
export function isIveManaged(labels: string[], p: Project): boolean {
  return labels.includes(targetLabelOf(p)) || allStageLabels(p).some(l => labels.includes(l))
}

/**
 * 단계 라벨을 바꿀 때 대상 라벨(ive) 정리 — 단계 라벨이 곧 IVE 관리 표시라 둘을 함께 달지 않는다.
 *  - 단계 라벨을 붙이면 대상 라벨을 뗀다
 *  - 단계 라벨을 떼기만 하면(유입으로 되돌림) 대상 라벨을 붙인다 — 라벨이 다 빠져 IVE 가 이슈를 놓치지 않게
 */
export function withTargetLabelSwap(p: Project, add: string[], remove: string[]): { add: string[]; remove: string[] } {
  const target = targetLabelOf(p)
  const stages = allStageLabels(p)
  if (add.some(l => stages.includes(l))) {
    return { add: add.filter(l => l !== target), remove: remove.includes(target) ? remove : [...remove, target] }
  }
  if (remove.some(l => stages.includes(l)) && !add.includes(target)) {
    return { add: [...add, target], remove: remove.filter(l => l !== target) }
  }
  return { add, remove }
}

/**
 * 전이 시 라벨 잔재 안전 정리.
 * 단계 라벨 중 "유지할 단일 라벨" 외의 모든 라벨을 제거 대상에 포함.
 *
 * @param p              프로젝트
 * @param keepLabel      전이 후 유지할 단계 라벨 (addLabels 결과 중 하나)
 * @returns              제거해야 할 단계 라벨 목록 (현재 라벨 집합과 무관하게 안전망)
 */
export function staleStageLabelsToRemove(p: Project, keepLabel: string): string[] {
  return allStageLabels(p).filter(l => l !== keepLabel)
}

/**
 * Git UI/CLI 에서 라벨을 직접 옮겼을 때, 그 전이로부터 기록해야 할 검증/확인 마커를 판정한다.
 *
 * 에이전트가 검증·확인을 맡으면 IVE 화면 버튼이 아니라 `glab`/`gh` 로 라벨을 옮긴다.
 * 그래서 이 판정이 곧 보고서의 검증/확인 통계가 된다.
 *
 * ⛔ 종전 스캐너는 "verifying → done" 만 승인으로 봤다. 정상 흐름인 **verifying → 확인대기(P)**
 * 는 승인 조건에 걸리지 않고 "verifying 에서 벗어남" 조건에 걸려 **반려로 기록**됐다.
 * (화면 버튼으로 승인하면 verified_at 이 먼저 박혀 무해했으나, CLI 로 라벨만 옮기면 오염된다.)
 * 또 확인 단계(P→C→E)는 라벨로 옮겨도 confirm_started_at/confirmed_at 이 전혀 남지 않았다.
 */
export type StageChangeMarkers = {
  verifyStarted: boolean
  verified: boolean
  rejected: boolean
  confirmStarted: boolean
  confirmed: boolean
}

/** 검증 통과로 볼 수 있는 후속 단계 — 확인대기/확인중/완료. */
const VERIFY_PASSED_STAGES = new Set(['confirm_waiting', 'confirming', 'done'])

export function markersForStageChange(
  prevStage: string | null | undefined,
  stage: string | null | undefined,
): StageChangeMarkers {
  const prev = prevStage ?? null
  const next = stage ?? null
  return {
    // 검증 시작: 임의 단계 → 검증 중
    verifyStarted: next === 'verifying' && prev !== 'verifying',
    // 검증 승인: 검증 중 → 확인대기/확인중/완료
    verified: prev === 'verifying' && next !== null && VERIFY_PASSED_STAGES.has(next),
    // 검증 반려: 검증 중 → 그 외(스케줄 복귀, 라벨 제거 등). 승인 경로는 위에서 걸러진다.
    rejected: prev === 'verifying' && next !== 'verifying' && !(next !== null && VERIFY_PASSED_STAGES.has(next)),
    // 확인 시작: 임의 단계 → 확인 중
    confirmStarted: next === 'confirming' && prev !== 'confirming',
    // 확인 완료: 확인대기/확인중 → 완료 (검증에서 곧장 완료로 건너뛴 경우는 확인으로 치지 않는다)
    confirmed: next === 'done' && (prev === 'confirming' || prev === 'confirm_waiting'),
  }
}

/** 단계(stage) → 그 단계를 나타내는 라벨. 라벨 이벤트에서 "누가 이 단계로 옮겼는가"를 찾을 때 쓴다. */
export function stageLabelFor(p: Project, stage: string | null | undefined): string | null {
  switch (stage) {
    case 'waiting': return p.labelSchedule || DEFAULT_LABELS.schedule
    case 'dev':
    case 'dev_fail': return p.labelDev || DEFAULT_LABELS.dev
    case 'verify_waiting': return p.labelVerifyWait || DEFAULT_LABELS.verifyWait
    case 'verifying': return p.labelVerify || DEFAULT_LABELS.verify
    case 'confirm_waiting': return p.labelConfirmWait || DEFAULT_LABELS.confirmWait
    case 'confirming': return p.labelConfirm || DEFAULT_LABELS.confirm
    case 'done': return p.labelEnd || DEFAULT_LABELS.end
    default: return null
  }
}

/**
 * 전이 후 단계 — 화면의 코멘트 말머리(「검증 중 → 확인대기」)가 실제 전이와 어긋나지 않게 이 표에서 계산한다.
 * 기본 라벨 이름으로 addLabels 를 풀어 단계로 되돌린다. 단계 라벨을 붙이지 않는 전이(to_inflow)는 'none'.
 */
export function transitionTarget(stage: string | null | undefined, action: string): string | null {
  const t = (TRANSITIONS[stage || ''] || []).find(x => x.action === action)
  if (!t) return null
  const added = t.addLabels({} as Project)[0]
  if (!added) return 'none'
  const byLabel: Record<string, string> = {
    [DEFAULT_LABELS.schedule]: 'waiting', [DEFAULT_LABELS.dev]: 'dev',
    [DEFAULT_LABELS.verifyWait]: 'verify_waiting', [DEFAULT_LABELS.verify]: 'verifying',
    [DEFAULT_LABELS.confirmWait]: 'confirm_waiting', [DEFAULT_LABELS.confirm]: 'confirming',
    [DEFAULT_LABELS.end]: 'done',
  }
  return byLabel[added] ?? null
}
