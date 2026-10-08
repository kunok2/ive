/**
 * stageFromLabels 우선순위 골든 테스트
 *
 * 중요한 로직:
 *   Git 이슈의 레이블 집합 → IssueStage 단일 판정.
 *   확인 단계(IVE-P / IVE-C) 도입 후 우선순위:
 *     E > C > P > V > W > D > S
 *
 * 불변식:
 *   P-0: IVE·단계 라벨이 하나도 없으면 null. 단계 라벨만 있어도 판정한다(단계 라벨을 붙일 때 IVE 는 뗀다)
 *   P-1: 단일 레이블이 단독으로 있을 때 해당 stage 를 반환
 *   P-2: 여러 레이블이 동시에 있을 때 우선순위 상위 stage 를 반환
 *   P-3: dev 단계는 hasActiveExec === false 이면 'dev_fail'
 *   P-4: 신규 IVE-P / IVE-C 는 verify(IVE-V) 보다 상위 (확인이 검증보다 뒤 단계)
 *   P-5: IVE-E 는 모든 단계 레이블보다 상위 (완료가 최종)
 */
import { describe, it, expect } from 'vitest'
import { stageFromLabels } from '@/lib/db/issues'
import type { Project } from '@/types'

const project: Project = {
  id: 'p1', userId: 'u', name: 'T', provider: 'gitlab',
  repoUrl: '', authType: 'token', gitUsername: '', accessToken: '',
  color: '#4ade80',
  labelTarget: 'IVE',
  labelSchedule: 'IVE-S', labelDev: 'IVE-D',
  labelVerifyWait: 'IVE-W', labelVerify: 'IVE-V',
  labelConfirmWait: 'IVE-P', labelConfirm: 'IVE-C',
  labelEnd: 'IVE-E', labelNotify: 'IVE-N',
  baseBranch: '', confirmBaseBranch: '', testSiteUrl: '',
  showToolUsage: false, checkInterval: 1, lastCheckedAt: null,
  lastScannedIssueCount: null, lastVerifyWaitingCount: null,
  scannerActive: false, usesOAuthToken: false,
  lastError: null, lastErrorAt: null,
  sortOrder: 0, avatarUrl: '',
  snapshotInterval: 1, sparklinePoints: 60, statsRetention: 7,
  conflictCount: 0, lastActivityAt: null,
  reportSecret: null, slackNotifyChannel: '', slackWorkspaceId: '',
  createdAt: '2026-01-01T00:00:00Z',
}

describe('stageFromLabels — P-0: labelTarget 미부착', () => {
  it('IVE 없이 단계 라벨만 있어도 판정한다', () => {
    expect(stageFromLabels(['IVE-S'], project)).toBe('waiting')
    expect(stageFromLabels(['IVE-D', 'IVE-W'], project)).toBe('verify_waiting')
    expect(stageFromLabels(['IVE-E'], project)).toBe('done')
  })
  it('IVE·단계 라벨이 하나도 없으면 null', () => {
    expect(stageFromLabels([], project)).toBeNull()
    expect(stageFromLabels(['bug', 'IVE-N'], project)).toBeNull()
  })
})

describe('stageFromLabels — P-1: 단일 stage 레이블', () => {
  it('IVE + IVE-S → waiting', () => {
    expect(stageFromLabels(['IVE', 'IVE-S'], project)).toBe('waiting')
  })
  it('IVE + IVE-D → dev (active exec 가정)', () => {
    expect(stageFromLabels(['IVE', 'IVE-D'], project, { hasActiveExec: true })).toBe('dev')
  })
  it('IVE + IVE-W → verify_waiting', () => {
    expect(stageFromLabels(['IVE', 'IVE-W'], project)).toBe('verify_waiting')
  })
  it('IVE + IVE-V → verifying', () => {
    expect(stageFromLabels(['IVE', 'IVE-V'], project)).toBe('verifying')
  })
  it('IVE + IVE-P → confirm_waiting', () => {
    expect(stageFromLabels(['IVE', 'IVE-P'], project)).toBe('confirm_waiting')
  })
  it('IVE + IVE-C → confirming', () => {
    expect(stageFromLabels(['IVE', 'IVE-C'], project)).toBe('confirming')
  })
  it('IVE + IVE-E → done', () => {
    expect(stageFromLabels(['IVE', 'IVE-E'], project)).toBe('done')
  })
  it('IVE 만 있고 stage 레이블 없으면 null', () => {
    expect(stageFromLabels(['IVE'], project)).toBeNull()
  })
})

describe('stageFromLabels — P-2: 우선순위 (E > C > P > V > W > D > S)', () => {
  it('E 가 있으면 다른 모든 단계 무시 → done', () => {
    expect(stageFromLabels(['IVE', 'IVE-S', 'IVE-D', 'IVE-W', 'IVE-V', 'IVE-P', 'IVE-C', 'IVE-E'], project)).toBe('done')
  })
  it('C > P', () => {
    expect(stageFromLabels(['IVE', 'IVE-P', 'IVE-C'], project)).toBe('confirming')
  })
  it('P > V (확인이 검증보다 뒤 단계)', () => {
    expect(stageFromLabels(['IVE', 'IVE-V', 'IVE-P'], project)).toBe('confirm_waiting')
  })
  it('C > V', () => {
    expect(stageFromLabels(['IVE', 'IVE-V', 'IVE-C'], project)).toBe('confirming')
  })
  it('V > W', () => {
    expect(stageFromLabels(['IVE', 'IVE-W', 'IVE-V'], project)).toBe('verifying')
  })
  it('W > D', () => {
    expect(stageFromLabels(['IVE', 'IVE-D', 'IVE-W'], project, { hasActiveExec: true })).toBe('verify_waiting')
  })
  it('D > S', () => {
    expect(stageFromLabels(['IVE', 'IVE-S', 'IVE-D'], project, { hasActiveExec: true })).toBe('dev')
  })
})

describe('stageFromLabels — P-3: dev_fail 분기', () => {
  it('IVE-D + hasActiveExec=false → dev_fail', () => {
    expect(stageFromLabels(['IVE', 'IVE-D'], project, { hasActiveExec: false })).toBe('dev_fail')
  })
  it('IVE-D + hasActiveExec=true → dev', () => {
    expect(stageFromLabels(['IVE', 'IVE-D'], project, { hasActiveExec: true })).toBe('dev')
  })
  it('IVE-D + hasActiveExec 미지정 → dev (기본값)', () => {
    expect(stageFromLabels(['IVE', 'IVE-D'], project)).toBe('dev')
  })
})

describe('stageFromLabels — P-4: 신규 IVE-P / IVE-C 가 검증 단계보다 상위', () => {
  it('머지 직후 시나리오: V 제거 + P 부착 (실제 전이) → confirm_waiting', () => {
    expect(stageFromLabels(['IVE', 'IVE-P'], project)).toBe('confirm_waiting')
  })
  it('전이 중 일시적 동시 부착: V + P → P 우선 (확인이 더 진척된 상태)', () => {
    expect(stageFromLabels(['IVE', 'IVE-V', 'IVE-P'], project)).toBe('confirm_waiting')
  })
  it('확인 시작 시: P → C 전이 직전 동시 부착 → C 우선', () => {
    expect(stageFromLabels(['IVE', 'IVE-P', 'IVE-C'], project)).toBe('confirming')
  })
})

describe('stageFromLabels — P-5: 완료(IVE-E)는 모든 단계 상위', () => {
  it('done + verifying 동시 → done', () => {
    expect(stageFromLabels(['IVE', 'IVE-V', 'IVE-E'], project)).toBe('done')
  })
  it('done + confirming 동시 → done', () => {
    expect(stageFromLabels(['IVE', 'IVE-C', 'IVE-E'], project)).toBe('done')
  })
})

describe('stageFromLabels — 커스텀 레이블 사용', () => {
  it('프로젝트가 다른 레이블을 쓰면 그 값으로 판정', () => {
    const custom: Project = { ...project, labelConfirmWait: 'CONFIRM-WAIT', labelConfirm: 'CONFIRM' }
    expect(stageFromLabels(['IVE', 'CONFIRM-WAIT'], custom)).toBe('confirm_waiting')
    expect(stageFromLabels(['IVE', 'CONFIRM'], custom)).toBe('confirming')
    expect(stageFromLabels(['IVE', 'IVE-P'], custom)).toBeNull() // 기본값 IVE-P 는 인식 안 함
  })
})
