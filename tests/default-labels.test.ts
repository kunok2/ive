// 레이블 이름은 프로젝트 설정값 — 새 기본 이름(ive, ive:todo …)과 옛 이름(IVE, IVE-S …)이
// 프로젝트마다 섞여 있어도 각자 저장된 이름으로 단계를 읽고 붙인다.
import { describe, it, expect } from 'vitest'
import { DEFAULT_LABELS, LEGACY_LABELS } from '@/lib/labels'
import { stageFromLabels } from '@/lib/db/issues'
import { stageLabelFor, transitionTarget } from '@/lib/stage-transitions'
import type { Project } from '@/types'

const withLabels = (l: typeof DEFAULT_LABELS | typeof LEGACY_LABELS) => ({
  id: 'p', provider: 'github',
  labelTarget: l.target, labelSchedule: l.schedule, labelDev: l.dev, labelVerifyWait: l.verifyWait,
  labelVerify: l.verify, labelConfirmWait: l.confirmWait, labelConfirm: l.confirm, labelEnd: l.end, labelNotify: l.notify,
}) as unknown as Project

const newProject = withLabels(DEFAULT_LABELS)
const oldProject = withLabels(LEGACY_LABELS)

describe('프로젝트별 레이블 이름', () => {
  it('새 기본 이름 프로젝트: 새 이름으로 단계를 읽는다', () => {
    expect(stageFromLabels(['ive', 'ive:verify-wait'], newProject)).toBe('verify_waiting')
    expect(stageFromLabels(['ive', 'ive:done'], newProject)).toBe('done')
    expect(stageLabelFor(newProject, 'confirm_waiting')).toBe('ive:confirm-wait')
  })
  it('옛 이름 프로젝트: 그대로 옛 이름으로 읽고 붙인다(하위 호환)', () => {
    expect(stageFromLabels(['IVE', 'IVE-W'], oldProject)).toBe('verify_waiting')
    expect(stageLabelFor(oldProject, 'confirm_waiting')).toBe('IVE-P')
  })
  it('다른 프로젝트의 이름 체계는 단계로 읽지 않는다', () => {
    expect(stageFromLabels(['IVE', 'IVE-W'], newProject)).not.toBe('verify_waiting')
    expect(stageFromLabels(['ive', 'ive:verify-wait'], oldProject)).not.toBe('verify_waiting')
  })
  it('전이 목표 계산은 기본 이름 표와 맞물린다', () => {
    expect(transitionTarget('verifying', 'approve')).toBe('confirm_waiting')
    expect(transitionTarget('confirming', 'return_to_dev')).toBe('verify_waiting')
  })
})
