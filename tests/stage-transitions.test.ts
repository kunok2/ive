/**
 * 단계 전이 골든 테스트
 *
 * 검증 불변식:
 *   T-0: TRANSITIONS 의 모든 stage 와 action 은 결정적 라벨 변화를 정의해야 한다.
 *   T-1: 전이 후 결과 라벨 집합에는 단계 라벨이 정확히 1개만 남는다 (stageFromLabels 가 단일 stage 를 결정할 수 있도록).
 *   T-2: 안전망(staleStageLabelsToRemove) 적용 후, "이전 단계 잔재 라벨" 은 모두 제거된다.
 *   T-3: 모든 macro 단계(유입/처리/검증/확인/완료) 사이의 forward / backward 전이가 정의되어 있어야 한다.
 *   T-4: confirming.accept 는 IVE-E 만 추가하고, Git issue close 는 별도 닫기 버튼에서만 수행한다 (자동 close 금지).
 */
import { describe, it, expect } from 'vitest'
import { TRANSITIONS, allStageLabels, staleStageLabelsToRemove } from '@/lib/stage-transitions'
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
  labelEnd: 'IVE-E',
  baseBranch: '', confirmBaseBranch: '', testSiteUrl: '',
  showToolUsage: false, checkInterval: 1, lastCheckedAt: null,
  lastScannedIssueCount: null, lastVerifyWaitingCount: null,
  scannerActive: false, usesOAuthToken: false,
  lastError: null, lastErrorAt: null,
  sortOrder: 0, avatarUrl: '',
  snapshotInterval: 1, sparklinePoints: 60, statsRetention: 7,
  conflictCount: 0, lastActivityAt: null,
  createdAt: '2026-01-01T00:00:00Z',
}

/** 시뮬레이션: 현재 라벨 집합 + 전이 적용 → 다음 라벨 집합 */
function applyTransition(currentLabels: string[], stage: string, action: string): string[] {
  const trans = TRANSITIONS[stage]?.find(t => t.action === action)
  if (!trans) throw new Error(`No transition: ${stage}.${action}`)
  const explicit = trans.removeLabels(project)
  const add = trans.addLabels(project)
  const keep = add[0] || ''
  const sanitized = keep
    ? Array.from(new Set([...explicit, ...staleStageLabelsToRemove(project, keep)]))
    : explicit
  const next = currentLabels.filter(l => !sanitized.includes(l))
  for (const a of add) if (!next.includes(a)) next.push(a)
  return next
}

describe('T-0: 모든 stage.action 정의', () => {
  it('각 stage 의 action 들이 중복 없이 등록되어 있다', () => {
    for (const [stage, transitions] of Object.entries(TRANSITIONS)) {
      const actions = transitions.map(t => t.action)
      expect(new Set(actions).size, `중복 action in stage=${stage}`).toBe(actions.length)
    }
  })

  it('addLabels / removeLabels 는 항상 함수로 호출 가능', () => {
    for (const transitions of Object.values(TRANSITIONS)) {
      for (const t of transitions) {
        expect(() => t.addLabels(project)).not.toThrow()
        expect(() => t.removeLabels(project)).not.toThrow()
      }
    }
  })
})

describe('T-1: 전이 결과 라벨 집합에는 단계 라벨이 정확히 1개', () => {
  const stageLabels = allStageLabels(project)
  const cases: Array<{ stage: string; action: string; from: string[] }> = [
    // 정상 흐름
    { stage: 'none',           action: 'schedule',           from: ['IVE'] },
    { stage: 'waiting',        action: 'start_dev',          from: ['IVE', 'IVE-S'] },
    { stage: 'dev',            action: 'complete',           from: ['IVE', 'IVE-D'] },
    { stage: 'verify_waiting', action: 'start_verification', from: ['IVE', 'IVE-W'] },
    { stage: 'verifying',      action: 'approve',            from: ['IVE', 'IVE-V'] },
    { stage: 'confirm_waiting',action: 'start_confirmation', from: ['IVE', 'IVE-P'] },
    { stage: 'confirming',     action: 'accept',             from: ['IVE', 'IVE-C'] },
    // 후진 흐름
    { stage: 'dev',            action: 'cancel',             from: ['IVE', 'IVE-D'] },
    { stage: 'verifying',      action: 'reject',             from: ['IVE', 'IVE-V'] },
    { stage: 'confirming',     action: 'return_to_dev',      from: ['IVE', 'IVE-C'] },
    { stage: 'done',           action: 'reopen',             from: ['IVE', 'IVE-E'] },
    { stage: 'done',           action: 'retry',              from: ['IVE', 'IVE-E'] },
  ]
  for (const c of cases) {
    it(`${c.stage}.${c.action}: 전이 후 단계 라벨 1개`, () => {
      const next = applyTransition(c.from, c.stage, c.action)
      const stageLabelsInNext = next.filter(l => stageLabels.includes(l))
      expect(stageLabelsInNext.length, `전이 후: ${next.join(', ')}`).toBe(1)
    })
  }
})

describe('T-2: 잔재 라벨 안전망', () => {
  it('done.reopen — 이전 verify 잔재가 있어도 IVE-P 만 남는다', () => {
    // 비정상 상태: 어쩌다 IVE-E 와 IVE-V 가 함께 있음
    const next = applyTransition(['IVE', 'IVE-E', 'IVE-V'], 'done', 'reopen')
    expect(next).toContain('IVE-P')
    expect(next).not.toContain('IVE-E')
    expect(next).not.toContain('IVE-V')
    expect(stageFromLabels(next, project)).toBe('confirm_waiting')
  })
  it('dev.complete — IVE-S/IVE-V 잔재가 있어도 IVE-W 만 남는다', () => {
    const next = applyTransition(['IVE', 'IVE-D', 'IVE-S', 'IVE-V'], 'dev', 'complete')
    expect(next).toContain('IVE-W')
    expect(next).not.toContain('IVE-D')
    expect(next).not.toContain('IVE-S')
    expect(next).not.toContain('IVE-V')
  })
  it('verifying.approve — IVE-D 잔재 정리', () => {
    const next = applyTransition(['IVE', 'IVE-V', 'IVE-D'], 'verifying', 'approve')
    expect(next).toContain('IVE-P')
    expect(next).not.toContain('IVE-V')
    expect(next).not.toContain('IVE-D')
  })
  it('confirming.return_to_dev — IVE-D/IVE-S 잔재 정리', () => {
    const next = applyTransition(['IVE', 'IVE-C', 'IVE-D', 'IVE-S'], 'confirming', 'return_to_dev')
    expect(next).toContain('IVE-W')
    expect(next).not.toContain('IVE-C')
    expect(next).not.toContain('IVE-D')
    expect(next).not.toContain('IVE-S')
    expect(stageFromLabels(next, project)).toBe('verify_waiting')
  })
})

describe('T-3: macro 단계 forward / backward 정의', () => {
  it('정방향: none → waiting → dev → verify_waiting → verifying → confirm_waiting → confirming → done', () => {
    let labels = ['IVE']
    labels = applyTransition(labels, 'none', 'schedule')
    expect(stageFromLabels(labels, project)).toBe('waiting')
    labels = applyTransition(labels, 'waiting', 'start_dev')
    expect(stageFromLabels(labels, project)).toBe('dev')
    labels = applyTransition(labels, 'dev', 'complete')
    expect(stageFromLabels(labels, project)).toBe('verify_waiting')
    labels = applyTransition(labels, 'verify_waiting', 'start_verification')
    expect(stageFromLabels(labels, project)).toBe('verifying')
    labels = applyTransition(labels, 'verifying', 'approve')
    expect(stageFromLabels(labels, project)).toBe('confirm_waiting')
    labels = applyTransition(labels, 'confirm_waiting', 'start_confirmation')
    expect(stageFromLabels(labels, project)).toBe('confirming')
    labels = applyTransition(labels, 'confirming', 'accept')
    expect(stageFromLabels(labels, project)).toBe('done')
  })

  it('역방향: done → reopen → confirm_waiting (이전 macro 의 waiting 으로)', () => {
    const labels = applyTransition(['IVE', 'IVE-E'], 'done', 'reopen')
    expect(stageFromLabels(labels, project)).toBe('confirm_waiting')
  })

  it('verifying → reject → waiting (검증 반려, 처리 재요청)', () => {
    const labels = applyTransition(['IVE', 'IVE-V'], 'verifying', 'reject')
    expect(stageFromLabels(labels, project)).toBe('waiting')
  })

  it('confirming → return_to_dev → verify_waiting (확인 단계에서 검증 재요청)', () => {
    const labels = applyTransition(['IVE', 'IVE-C'], 'confirming', 'return_to_dev')
    expect(stageFromLabels(labels, project)).toBe('verify_waiting')
  })
})

describe('T-4: confirming.accept 는 단계 종결만, Git close 는 별도', () => {
  it('IVE-E 만 추가, 다른 라벨 변경 없음', () => {
    const trans = TRANSITIONS.confirming.find(t => t.action === 'accept')!
    expect(trans.addLabels(project)).toEqual(['IVE-E'])
    expect(trans.removeLabels(project)).toEqual(['IVE-C'])
  })
})
