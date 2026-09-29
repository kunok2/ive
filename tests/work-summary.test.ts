/**
 * buildWorkSummary — 개발 완료 노트의 「수행 작업」에서 도구 호출 줄을 걷어낸다.
 * 운영 노트가 359줄 중 165줄이 🔧 줄이라 무엇을 고쳤는지가 묻히던 문제의 회귀 방지.
 */
import { describe, it, expect } from 'vitest'
import { buildWorkSummary } from '@/lib/scanner/mr-creator'

describe('buildWorkSummary', () => {
  it('한 줄 도구 호출과 빈 인용줄을 버리고 문장만 남긴다', () => {
    const out = buildWorkSummary([
      'I will investigate.',
      '> **🔧 Bash** `$ ls src`',
      '>',
      '원인은 번역 키 누락이었다.',
    ])
    expect(out).toBe('\n\n### 📝 수행 작업\nI will investigate.\n원인은 번역 키 누락이었다.')
  })

  it('여러 줄 명령은 닫는 백틱까지 통째로 버린다', () => {
    const out = buildWorkSummary([
      '> **🔧 Bash** `$ python3 - <<\'PY\'\nimport json\nprint(1)`\n수정 완료.',
    ])
    expect(out).toBe('\n\n### 📝 수행 작업\n수정 완료.')
  })

  it('남는 문장이 없으면 절을 만들지 않는다', () => {
    expect(buildWorkSummary(['> **🔧 Bash** `$ ls`'])).toBe('')
    expect(buildWorkSummary([])).toBe('')
  })
})
