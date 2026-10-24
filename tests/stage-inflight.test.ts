import { describe, it, expect } from 'vitest'
import { beginStageChange, endStageChange, stageChangedSince, stageChangeKey } from '../src/lib/stage-inflight'

describe('stage-inflight — 단계 변경 중인 작업을 스캐너가 알아본다', () => {
  it('진행 중이면 언제 시작한 스캔이든 변경 중으로 본다', () => {
    const k = stageChangeKey('p1', 1)
    expect(beginStageChange(k)).toBe(true)
    expect(beginStageChange(k)).toBe(false) // 동시 요청은 막는다
    expect(stageChangedSince(k, Date.now())).toBe(true)
    endStageChange(k)
  })

  it('스캔이 이슈를 읽은 뒤에 끝난 변경은 변경으로 보고, 그 전에 끝난 변경은 아니다', () => {
    const k = stageChangeKey('p1', 2)
    beginStageChange(k)
    endStageChange(k, 1000)
    expect(stageChangedSince(k, 999)).toBe(true)   // 스캔 시작(999) 뒤에 끝남 → 읽은 레이블이 옛 것일 수 있다
    expect(stageChangedSince(k, 1001)).toBe(false) // 스캔 시작 전에 끝남 → 읽은 레이블에 반영됨
  })

  it('다른 작업·기록 없는 작업은 영향이 없다', () => {
    expect(stageChangedSince(stageChangeKey('p1', 999), 0)).toBe(false)
  })
})
