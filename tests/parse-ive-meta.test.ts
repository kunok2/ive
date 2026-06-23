/**
 * parseIveMeta 골든 테스트.
 *
 * 회귀 방지 사고: 운영 (2026-05-07)
 *   ive-meta 본문에 `ended_at: REPLACE_END` placeholder 가 그대로 들어와
 *   DB 의 task_executions.ended_at 에 'REPLACE_END' 리터럴 저장.
 *   보고서 쿼리 MAX(ended_at) 으로 흘러가 toISOString() 에서 RangeError → 사이트 다운.
 */
import { describe, it, expect } from 'vitest'
import { parseIveMeta, parseIveMetaSessions } from '@/lib/scanner/formatters'

describe('parseIveMeta', () => {
  it('정상 ISO 시각 파싱', () => {
    const body = `description here
<!-- ive-meta
model: claude-opus-4-7
input_tokens: 100
output_tokens: 200
cost_usd: 1.5
turns: 3
started_at: 2026-05-07T10:00:00+09:00
ended_at: 2026-05-07T11:00:00+09:00
-->`
    const m = parseIveMeta(body)
    expect(m.startedAt).toBe('2026-05-07T01:00:00.000Z')
    expect(m.endedAt).toBe('2026-05-07T02:00:00.000Z')
    expect(m.model).toBe('claude-opus-4-7')
    expect(m.inputTokens).toBe(100)
  })

  it('invalid timestamp(placeholder) 는 raw 문자열이 아니라 null 로 처리', () => {
    // 회귀 방지: 'REPLACE_END' 같은 raw 가 DB 에 저장되면 보고서 쿼리에서 RangeError.
    const body = `<!-- ive-meta
model: x
input_tokens: 0
output_tokens: 0
cost_usd: 0
turns: 0
started_at: REPLACE_START
ended_at: REPLACE_END
-->`
    const m = parseIveMeta(body)
    expect(m.startedAt).toBeNull()
    expect(m.endedAt).toBeNull()
  })

  it('아예 잘못된 형식도 null', () => {
    const body = `<!-- ive-meta
started_at: not-a-date
ended_at: 어제 오후 3시
-->`
    const m = parseIveMeta(body)
    expect(m.startedAt).toBeNull()
    expect(m.endedAt).toBeNull()
  })

  it('ive-meta 블록 없으면 모두 기본값', () => {
    const m = parseIveMeta('plain body without meta')
    expect(m.model).toBeNull()
    expect(m.inputTokens).toBe(0)
    expect(m.startedAt).toBeNull()
    expect(m.endedAt).toBeNull()
  })
})

describe('parseIveMetaSessions (다세션 — 다일 작업)', () => {
  it('블록 1개면 길이 1 (하위호환)', () => {
    const body = `<!-- ive-meta
model: claude-opus-4-8
input_tokens: 100
started_at: 2026-06-17T09:00:00+09:00
ended_at: 2026-06-17T11:00:00+09:00
-->`
    const ss = parseIveMetaSessions(body)
    expect(ss).toHaveLength(1)
    expect(ss[0].inputTokens).toBe(100)
    expect(ss[0].startedAt).toBe('2026-06-17T00:00:00.000Z')
  })

  it('주 경계를 넘는 작업: 블록 여러 개를 각각의 세션으로 파싱', () => {
    const body = `## 작업
<!-- ive-meta
model: claude-opus-4-8
input_tokens: 8000000
output_tokens: 200000
cost_usd: 48
turns: 120
started_at: 2026-06-17T09:17:00+09:00
ended_at: 2026-06-18T03:11:00+09:00
-->
## 추가 작업 (다음 주)
<!-- ive-meta
model: claude-opus-4-8
input_tokens: 2000000
output_tokens: 50000
cost_usd: 12
turns: 40
started_at: 2026-06-22T11:00:00+09:00
ended_at: 2026-06-22T16:41:00+09:00
-->`
    const ss = parseIveMetaSessions(body)
    expect(ss).toHaveLength(2)
    expect(ss[0].inputTokens).toBe(8000000)
    expect(ss[0].startedAt).toBe('2026-06-17T00:17:00.000Z')
    expect(ss[1].inputTokens).toBe(2000000)
    expect(ss[1].startedAt).toBe('2026-06-22T02:00:00.000Z')
    // 두 세션의 started_at 이 서로 다른 주(週) → 보고서가 각 주에 분배
    expect(ss[0].startedAt!.slice(0, 10)).not.toBe(ss[1].startedAt!.slice(0, 10))
  })

  it('블록 없으면 빈 배열', () => {
    expect(parseIveMetaSessions('plain body')).toEqual([])
  })
})
