import { describe, it, expect } from 'vitest'
import { parseIssueProgress, computeProgress, toggleCheckboxInBody, appendChecklist } from '@/lib/stage-progress'

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
  it('진척은 본문 체크박스 전체 대비 — 단계 제목과 무관', () => {
    // 배경 1(완료) + 처리 2(완료) + 검증 3(1완료) + 확인 1 = 7개 중 4개
    expect(parseIssueProgress(BODY).total).toEqual({ done: 4, total: 7, percent: 57 })
  })
  it('단계 제목 아래는 그 단계의 개수만 참고값으로 따로 낸다', () => {
    const p = parseIssueProgress(BODY)
    expect(p.byStage.process).toEqual({ done: 2, total: 2, percent: 100 })
    expect(p.byStage.verify).toEqual({ done: 1, total: 3, percent: 33 })
    expect(p.byStage.confirm).toEqual({ done: 0, total: 1, percent: 0 })
  })
  it('단계 제목 없는 목록도 그대로 전체 진척', () => {
    const p = parseIssueProgress('- [x] a\n- [x] b\n- [x] c\n- [ ] d\n- [ ] e\n- [ ] f\n- [ ] g')
    expect(p.total).toEqual({ done: 3, total: 7, percent: 43 })
    expect(p.byStage).toEqual({})
  })
  it('코드 블록 안 예시는 세지 않는다', () => {
    expect(parseIssueProgress('```\n- [ ] x\n```\n- [x] y').total).toEqual({ done: 1, total: 1, percent: 100 })
  })
  it('체크박스가 없으면 null', () => {
    expect(parseIssueProgress('그냥 글').total).toBeNull()
    expect(parseIssueProgress(null).total).toBeNull()
  })
  it('상태와 무관 — computeProgress 는 본문만 본다', () => {
    expect(computeProgress(BODY)).toEqual(parseIssueProgress(BODY))
  })
})

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
    expect(parseIssueProgress(out).byStage.verify).toEqual({ done: 0, total: 1, percent: 0 })
  })
})
