import { describe, it, expect } from 'vitest'
import { parseIssueProgress, overallPercent, computeProgress, progressStageOf } from '@/lib/stage-progress'

const BODY = `## 배경
설명

- [x] 배경 목록은 단계 아님

## 처리
- [x] A
- [x] B

## 검증
- [x] 화면 확인
  - [ ] 모바일
- [ ] 로그 확인

## 확인
- [ ] 운영 반영
`

describe('parseIssueProgress', () => {
  it('지금 단계 제목 아래 체크박스만 센다', () => {
    const p = parseIssueProgress(BODY, 'verify')
    expect(p.stage).toEqual({ done: 1, total: 3, percent: 33 })
    expect(p.byStage.process).toEqual({ done: 2, total: 2, percent: 100 })
    expect(p.byStage.confirm?.total).toBe(1)
  })
  it('단계 제목이 없으면 전체 체크박스를 지금 단계로 본다', () => {
    const p = parseIssueProgress('- [x] a\n- [ ] b\n* [X] c\n1. [ ] d', 'process')
    expect(p.stage).toEqual({ done: 2, total: 4, percent: 50 })
  })
  it('코드 블록 안 예시는 세지 않는다', () => {
    const p = parseIssueProgress('```\n- [ ] 예시\n```\n- [x] 실제', 'process')
    expect(p.stage).toEqual({ done: 1, total: 1, percent: 100 })
  })
  it('체크박스가 없으면 null', () => {
    expect(parseIssueProgress('그냥 글', 'verify').stage).toBeNull()
    expect(parseIssueProgress(null, null).stage).toBeNull()
  })
  it('현재 단계 제목이 없으면 제목 없는 목록으로 대신한다', () => {
    const p = parseIssueProgress('- [x] a\n\n## 처리\n- [x] b', 'verify')
    expect(p.stage).toEqual({ done: 1, total: 1, percent: 100 })
  })
})

describe('overallPercent', () => {
  it('끝난 단계 + 현재 단계 진행률', () => {
    expect(overallPercent('verify', 0.5)).toBe(50)
    expect(overallPercent('process', 0)).toBe(0)
    expect(overallPercent('confirm', 1)).toBe(100)
    expect(overallPercent('done', null)).toBe(100)
  })
})

describe('computeProgress', () => {
  it('IVE 단계 → 진행률 단계 매핑', () => {
    expect(progressStageOf('verifying')).toBe('verify')
    expect(progressStageOf('confirm_waiting')).toBe('confirm')
    expect(progressStageOf('none')).toBeNull()
  })
  it('본문과 단계에서 한 번에 구한다', () => {
    const r = computeProgress(BODY, 'verifying')
    expect(r.stage?.percent).toBe(33)
    expect(r.overall).toBe(Math.round(((1 + 1 / 3) / 3) * 100))
  })
})

describe('전체 진행률은 모든 단계의 체크박스를 반영한다', () => {
  const all = '## 처리\n- [x] a\n## 검증\n- [x] b\n## 확인\n- [x] c'
  it('다 체크하면 단계가 안 넘어가도 100', () => {
    expect(computeProgress(all, 'verifying').overall).toBe(100)
  })
  it('뒤 단계 체크박스가 비었으면 그만큼 덜 찬다', () => {
    expect(computeProgress(all.replace('[x] c', '[ ] c'), 'verifying').overall).toBe(67)
  })
})

import { toggleCheckboxInBody, appendChecklist } from '@/lib/stage-progress'

describe('toggleCheckboxInBody', () => {
  const body = '## 처리\n- [ ] a\n```\n- [ ] 예시\n```\n  - [x] b\n- [ ] c'
  it('코드 블록을 건너뛰고 N번째를 바꾼다', () => {
    expect(toggleCheckboxInBody(body, 1, false)).toBe(body.replace('- [x] b', '- [ ] b'))
    expect(toggleCheckboxInBody(body, 2, true)).toBe(body.replace('- [ ] c', '- [x] c'))
  })
  it('이미 그 상태이거나 없는 번호면 null', () => {
    expect(toggleCheckboxInBody(body, 0, false)).toBeNull()
    expect(toggleCheckboxInBody(body, 9, true)).toBeNull()
  })
})

describe('appendChecklist', () => {
  const L = { process: '처리', verify: '검증', confirm: '확인' }
  it('본문 뒤에 붙이고, 만든 뼈대는 단계별 0건으로 읽힌다', () => {
    const out = appendChecklist('설명', L)
    expect(out.startsWith('설명\n\n## 처리\n- [ ] ')).toBe(true)
    expect(parseIssueProgress(out, 'process').byStage.verify).toEqual({ done: 0, total: 1, percent: 0 })
  })
})
