/**
 * buildWorkSummary — 개발 완료 노트의 「결과」에는 에이전트의 마지막 보고만 싣는다.
 * 운영 노트가 처리 중 말(「~확인 중입니다」「Now read …」)·조사 표·하위 에이전트 출력까지 전부 실려
 * 수백 줄이 되고, 에이전트가 따로 쓴 결과 코멘트와 겹치던 문제의 회귀 방지.
 */
import { describe, it, expect } from 'vitest'
import { buildWorkSummary } from '@/lib/scanner/mr-creator'
import { formatStreamEventMarkdown } from '@/lib/scanner/formatters'

describe('buildWorkSummary', () => {
  it('마지막 도구 호출 뒤의 최종 보고만 싣는다 — 처리 중 말은 버린다', () => {
    const out = buildWorkSummary([
      '작업 범위를 파악하는 중입니다.',
      '> **🔧 Grep** `"getTodos"`',
      'Now read getTodos and createTodo.',
      '> **🔧 Edit** `src/a.ts`',
      '>',
      '**원인**\n- 번역 키 누락',
      '**수정**\n- `src/a.ts` 키 추가',
    ])
    expect(out).toBe('\n\n### 📝 결과\n**원인**\n- 번역 키 누락\n**수정**\n- `src/a.ts` 키 추가')
  })

  it('실행 결과 꼬리줄(토큰·턴)은 싣지 않는다', () => {
    const out = buildWorkSummary([
      '> **🔧 Bash** `$ ls`',
      '수정 완료.',
      '\n---\n**📊 실행 결과** 소요: 164.1s | 토큰: 14,205 | 턴: 23',
    ])
    expect(out).toBe('\n\n### 📝 결과\n수정 완료.')
  })

  it('보고 뒤에 도구를 더 불렀으면 그 앞 마지막 문장 덩어리를 쓴다', () => {
    const out = buildWorkSummary([
      '조사 중입니다.',
      '> **🔧 Read** `a.ts`',
      '**수정**\n- a.ts',
      '> **🔧 Bash** `$ git status`',
    ])
    expect(out).toBe('\n\n### 📝 결과\n**수정**\n- a.ts')
  })

  it('여러 줄 명령은 닫는 백틱까지 통째로 버린다', () => {
    const out = buildWorkSummary([
      '> **🔧 Bash** `$ python3 - <<\'PY\'\nimport json\nprint(1)`\n수정 완료.',
    ])
    expect(out).toBe('\n\n### 📝 결과\n수정 완료.')
  })

  it('남는 문장이 없으면 절을 만들지 않는다', () => {
    expect(buildWorkSummary(['> **🔧 Bash** `$ ls`'])).toBe('')
    expect(buildWorkSummary([])).toBe('')
  })
})

describe('formatStreamEventMarkdown — 하위 에이전트', () => {
  it('하위 에이전트의 말은 버리고 도구 줄만 남긴다(수정 흔적 판정용)', () => {
    const md = formatStreamEventMarkdown({
      type: 'assistant',
      parent_tool_use_id: 'toolu_1',
      message: { content: [
        { type: 'text', text: 'I found 70 places that query todos.' },
        { type: 'tool_use', name: 'Edit', input: { file_path: 'src/a.ts' } },
      ] },
    })
    expect(md).toBe('> **🔧 Edit** `src/a.ts`')
  })

  it('하위 에이전트가 말만 하면 아무것도 남기지 않는다', () => {
    const md = formatStreamEventMarkdown({
      type: 'assistant',
      parent_tool_use_id: 'toolu_1',
      message: { content: [{ type: 'text', text: '| file:line | function |' }] },
    })
    expect(md).toBeNull()
  })
})
