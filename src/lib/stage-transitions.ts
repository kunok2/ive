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
      addLabels: p => [p.labelSchedule || 'IVE-S'],
    },
  ],
  waiting: [
    {
      action: 'start_dev',
      description: '개발 시작 → 개발 중',
      removeLabels: p => [p.labelSchedule || 'IVE-S'],
      addLabels: p => [p.labelDev || 'IVE-D'],
    },
  ],
  dev: [
    {
      action: 'cancel',
      description: '작업 취소 → 스케줄',
      removeLabels: p => [p.labelDev || 'IVE-D'],
      addLabels: p => [p.labelSchedule || 'IVE-S'],
    },
    {
      action: 'complete',
      description: '머지 완료 → 검증대기',
      removeLabels: p => [p.labelDev || 'IVE-D'],
      addLabels: p => [p.labelVerifyWait || 'IVE-W'],
    },
    {
      action: 'retry',
      description: '재시도 → 스케줄',
      removeLabels: p => [p.labelDev || 'IVE-D'],
      addLabels: p => [p.labelSchedule || 'IVE-S'],
    },
  ],
  dev_fail: [
    {
      action: 'retry',
      description: '재시도 → 스케줄',
      removeLabels: p => [p.labelDev || 'IVE-D'],
      addLabels: p => [p.labelSchedule || 'IVE-S'],
    },
  ],
  verify_waiting: [
    {
      action: 'start_verification',
      description: '검증시작 → 검증 중',
      removeLabels: p => [p.labelVerifyWait || 'IVE-W'],
      addLabels: p => [p.labelVerify || 'IVE-V'],
    },
    {
      action: 'cancel',
      description: '검증대기 취소 → 스케줄',
      removeLabels: p => [p.labelVerifyWait || 'IVE-W'],
      addLabels: p => [p.labelSchedule || 'IVE-S'],
    },
    {
      action: 'retry',
      description: '재시도 → 스케줄',
      removeLabels: p => [p.labelVerifyWait || 'IVE-W'],
      addLabels: p => [p.labelSchedule || 'IVE-S'],
    },
    {
      action: 'to_inflow',
      description: '유입 상태로 초기화',
      removeLabels: p => [p.labelVerifyWait || 'IVE-W'],
      addLabels: () => [],
    },
  ],
  verifying: [
    {
      action: 'approve',
      description: '검증 승인 → 확인대기',
      removeLabels: p => [p.labelVerify || 'IVE-V'],
      addLabels: p => [p.labelConfirmWait || 'IVE-P'],
    },
    {
      action: 'complete',
      description: '머지 완료 → 확인대기',
      removeLabels: p => [p.labelVerify || 'IVE-V', p.labelDev || 'IVE-D'],
      addLabels: p => [p.labelConfirmWait || 'IVE-P'],
    },
    {
      action: 'reject',
      description: '검증 반려 → 스케줄 (처리 재요청)',
      removeLabels: p => [p.labelVerify || 'IVE-V'],
      addLabels: p => [p.labelSchedule || 'IVE-S'],
    },
    {
      action: 'retry',
      description: '재시도 → 스케줄',
      removeLabels: p => [p.labelVerify || 'IVE-V'],
      addLabels: p => [p.labelSchedule || 'IVE-S'],
    },
    {
      action: 'to_inflow',
      description: '유입 상태로 초기화',
      removeLabels: p => [p.labelVerify || 'IVE-V'],
      addLabels: () => [],
    },
  ],
  confirm_waiting: [
    {
      action: 'start_confirmation',
      description: '확인 시작 → 확인 중',
      removeLabels: p => [p.labelConfirmWait || 'IVE-P'],
      addLabels: p => [p.labelConfirm || 'IVE-C'],
    },
    {
      action: 'cancel',
      description: '확인대기 취소 → 스케줄',
      removeLabels: p => [p.labelConfirmWait || 'IVE-P'],
      addLabels: p => [p.labelSchedule || 'IVE-S'],
    },
    {
      action: 'return_to_dev',
      description: '재작업 요청 → 스케줄',
      removeLabels: p => [p.labelConfirmWait || 'IVE-P'],
      addLabels: p => [p.labelSchedule || 'IVE-S'],
    },
    {
      action: 'retry',
      description: '재시도 → 스케줄',
      removeLabels: p => [p.labelConfirmWait || 'IVE-P'],
      addLabels: p => [p.labelSchedule || 'IVE-S'],
    },
  ],
  confirming: [
    {
      action: 'accept',
      description: '확인 완료 → 완료',
      removeLabels: p => [p.labelConfirm || 'IVE-C'],
      addLabels: p => [p.labelEnd || 'IVE-E'],
    },
    {
      action: 'return_to_dev',
      description: '재검증 요청 → 검증대기',
      removeLabels: p => [p.labelConfirm || 'IVE-C'],
      addLabels: p => [p.labelVerifyWait || 'IVE-W'],
    },
    {
      action: 'retry',
      description: '재시도 → 스케줄',
      removeLabels: p => [p.labelConfirm || 'IVE-C'],
      addLabels: p => [p.labelSchedule || 'IVE-S'],
    },
  ],
  done: [
    {
      action: 'reopen',
      description: '재확인 요청 → 확인대기',
      removeLabels: p => [p.labelEnd || 'IVE-E'],
      addLabels: p => [p.labelConfirmWait || 'IVE-P'],
    },
    {
      action: 'retry',
      description: '재시도 → 스케줄',
      removeLabels: p => [p.labelEnd || 'IVE-E'],
      addLabels: p => [p.labelSchedule || 'IVE-S'],
    },
  ],
  rejected: [
    {
      action: 'retry',
      description: '재시도 → 스케줄',
      removeLabels: () => [],
      addLabels: p => [p.labelSchedule || 'IVE-S'],
    },
  ],
}

/** 모든 단계 라벨 목록 */
export function allStageLabels(p: Project): string[] {
  return [
    p.labelSchedule || 'IVE-S',
    p.labelDev || 'IVE-D',
    p.labelVerifyWait || 'IVE-W',
    p.labelVerify || 'IVE-V',
    p.labelConfirmWait || 'IVE-P',
    p.labelConfirm || 'IVE-C',
    p.labelEnd || 'IVE-E',
  ]
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
