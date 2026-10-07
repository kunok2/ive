/**
 * 확인 반려는 검증대기로 돌아간다 (처리대기가 아니다) — 사용자 확정 2026-10-07.
 *
 * K-1: 확인 판정 fail → return_to_dev, 그 전이는 확인 중(C) → 검증대기(W)다.
 * K-2: 확인 작업자의 반려 노트 제목을 검증 작업자가 알아본다(새 제목·옛 제목).
 * K-3: 확인 반려가 있으면 검증 프롬프트에 「확인 반려」 절이 실린다 — 확인자 노트는 에이전트 표시가 있어 사람 코멘트에서 빠지므로.
 */
import { describe, it, expect } from 'vitest'
import { confirmStageAction, CONFIRM_VERDICT_TITLE } from '@/lib/scanner/confirm-worker'
import { isConfirmRejectionNote } from '@/lib/scanner/verify-worker'
import { TRANSITIONS } from '@/lib/stage-transitions'
import { buildVerifyPrompt, VERIFY_EDITABLE_DEFAULT } from '@/lib/role-prompts'

const project = { labelSchedule: 'IVE-S', labelVerifyWait: 'IVE-W', labelConfirm: 'IVE-C' } as any

describe('확인 반려 → 검증대기', () => {
  it('K-1: fail → return_to_dev = C → W', () => {
    expect(confirmStageAction('pass')).toBe('accept')
    expect(confirmStageAction('blocked')).toBeNull()
    const action = confirmStageAction('fail')
    const t = TRANSITIONS.confirming.find(x => x.action === action)!
    expect(t.removeLabels(project)).toEqual(['IVE-C'])
    expect(t.addLabels(project)).toEqual(['IVE-W'])
  })

  it('K-2: 반려 노트 제목을 알아본다', () => {
    expect(isConfirmRejectionNote(`## ${CONFIRM_VERDICT_TITLE.fail.ko}\n\n본문`)).toBe(true)
    expect(isConfirmRejectionNote(`## ${CONFIRM_VERDICT_TITLE.fail.en}\n`)).toBe(true)
    expect(isConfirmRejectionNote('## ❌ 확인 실패 — 재작업 필요\n')).toBe(true)
    expect(isConfirmRejectionNote(`## ${CONFIRM_VERDICT_TITLE.pass.ko}\n`)).toBe(false)
  })

  it('K-3: 확인 반려 절이 검증 프롬프트에 실린다', () => {
    const base = {
      iid: 1, title: 't', body: 'b', isKo: true, mrUrl: null, targetBranch: 'staging', sourceSha: 'abc', behindTarget: false,
      conflictFiles: [], changedFiles: [], diffPath: '.ive-out/mr.diff', checksSection: '', e2eScript: null, outDir: '.ive-out', maxRunMinutes: 30,
    }
    expect(buildVerifyPrompt(base, VERIFY_EDITABLE_DEFAULT)).not.toContain('확인 반려로 돌아온 건 — 이것부터 본다')
    const p = buildVerifyPrompt({ ...base, confirmRejection: '.lvs { width:100% } 가 1424 에서 멈춤' }, VERIFY_EDITABLE_DEFAULT)
    expect(p).toContain('확인 반려로 돌아온 건 — 이것부터 본다')
    expect(p).toContain('.lvs { width:100% } 가 1424 에서 멈춤')
  })
})
