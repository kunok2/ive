/**
 * 처리 미완 관문 (#1972·#1975, 2026-10-04)
 *   처리자가 요건이 남은 채 끝내도 IVE 가 「✅ 개발 완료」를 달고 검증대기(IVE-W)로 넘겼다.
 *   이제 최종 보고 마지막 줄 IVE-RESULT 로 가른다 — 이 시험은 그 판정 재료(노트 분류·연속 미완 수)를 붙잡는다.
 *   M-1: 처리자 결과 노트만 경계(반려·확인·배정 노트는 아님)
 *   M-2: 봇 표시가 있는 검증 반려 노트도 결과 노트가 아니다(피드백으로 넘어가야 한다)
 *   M-3: 연속 미완 수는 맨 뒤부터 센다
 */
import { describe, it, expect } from 'vitest'
import { isProcessorResultNote, isBookkeepingNote, trailingIncompleteStreak } from '@/lib/scanner/mr-creator'

const done = '<!-- ive-bot -->\n<!-- ive-agent:a -->\n## ✅ 개발 완료 — Claude1\n…'
const incomplete = '<!-- ive-bot -->\n<!-- ive-agent:a -->\n## ⚠️ 처리 미완 — 이어서 처리 — Claude1\n…'
const error = '<!-- ive-bot -->\n<!-- ive-agent:a -->\n## ❌ 실행 오류 — Claude2\n…'
const reject = '<!-- ive-bot -->\n## ↩️ 검증 반려 (IVE-S) — 재작업 지시\n…'
const assign = '<!-- ive-bot -->\n## 🎯 검증자 배정\n…'
const confirm = '## 확인 결과 — 재작업 필요 (IVE-C → IVE-S)\n…'

describe('처리 미완 관문', () => {
  it('M-1·M-2: 결과 노트 분류', () => {
    expect([done, incomplete, error].every(isProcessorResultNote)).toBe(true)
    expect([reject, assign, confirm].some(isProcessorResultNote)).toBe(false)
    expect(isBookkeepingNote(assign)).toBe(true)
    expect(isBookkeepingNote(reject)).toBe(false)
  })
  it('M-3: 연속 미완 수', () => {
    expect(trailingIncompleteStreak([done, incomplete, incomplete])).toBe(2)
    expect(trailingIncompleteStreak([incomplete, done])).toBe(0)
    expect(trailingIncompleteStreak([])).toBe(0)
  })
})
