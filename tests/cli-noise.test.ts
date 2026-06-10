/**
 * cli-noise 골든 테스트 — stderr 양성 필터 + 한도(rate limit/quota) 감지
 *
 * 중요한 로직:
 *   - gemini/opencode가 매 실행 stderr로 찍는 무해한 배너를 거른다. 안 거르면
 *     실행 상세보기가 노란 경고로 도배되어 실제 출력이 묻힌다(#463).
 *   - CLI별로 제각각인 "사용량 한도 초과" 문구를 공통 패턴으로 분류해, 실패 시
 *     "왜 실패했는지"를 사용자에게 명시한다.
 *
 * 불변식:
 *   B-1: 알려진 양성 배너는 제거된다
 *   B-2: 진짜 오류(인증 실패 등)는 절대 제거하지 않는다
 *   R-1: 각 CLI의 한도 초과 문구를 감지한다
 *   R-2: 평범한 로그는 한도로 오인하지 않는다
 */
import { describe, it, expect } from 'vitest'
import {
  stripBenignGeminiStderr,
  stripBenignOpencodeStderr,
  detectRateLimit,
} from '@/lib/scanner/cli-noise'

describe('stripBenignGeminiStderr', () => {
  it('B-1: gemini 양성 배너 제거', () => {
    const raw = [
      'Warning: 256-color support not detected. Using a terminal...',
      'YOLO mode is enabled. All tool calls will be automatically approved.',
      'Ripgrep is not available. Falling back to GrepTool.',
    ].join('\n')
    expect(stripBenignGeminiStderr(raw).trim()).toBe('')
  })

  it('B-2: 진짜 오류는 보존', () => {
    const raw = [
      'YOLO mode is enabled. All tool calls will be automatically approved.',
      'Error: Failed to authenticate. Check GEMINI_API_KEY.',
    ].join('\n')
    const out = stripBenignGeminiStderr(raw)
    expect(out).toContain('Failed to authenticate')
    expect(out).not.toContain('YOLO mode')
  })
})

describe('stripBenignOpencodeStderr', () => {
  it('B-1: opencode DB 마이그레이션 배너 제거, 오류 보존', () => {
    const raw = [
      'Performing one time database migration...',
      'database migration complete',
      'Error: model not supported',
    ].join('\n')
    const out = stripBenignOpencodeStderr(raw)
    expect(out).toContain('model not supported')
    expect(out).not.toContain('migration')
  })
})

describe('detectRateLimit', () => {
  it('R-1: gemini 용량 소진', () => {
    expect(detectRateLimit('Attempt 1 failed: You have exhausted your capacity on this model. Your quota will reset after 5s.'))
      .toContain('exhausted your capacity')
  })
  it('R-1: claude usage limit', () => {
    expect(detectRateLimit('Claude AI usage limit reached')).toBeTruthy()
  })
  it('R-1: HTTP 429 / Too Many Requests', () => {
    expect(detectRateLimit('Request failed with status 429 Too Many Requests')).toBeTruthy()
  })
  it('R-1: Anthropic overloaded(529)', () => {
    expect(detectRateLimit('{"type":"overloaded_error","message":"Overloaded"}')).toBeTruthy()
  })
  it('R-1: OpenAI insufficient_quota', () => {
    expect(detectRateLimit('You exceeded your current quota (insufficient_quota)')).toBeTruthy()
  })
  it('R-1: Google RESOURCE_EXHAUSTED', () => {
    expect(detectRateLimit('429 RESOURCE_EXHAUSTED: Resource has been exhausted')).toBeTruthy()
  })
  it('R-2: 평범한 로그는 null', () => {
    expect(detectRateLimit('Reading file src/index.ts and editing it')).toBeNull()
    expect(detectRateLimit('CLI 종료: code=0')).toBeNull()
    expect(detectRateLimit('')).toBeNull()
    expect(detectRateLimit(null)).toBeNull()
  })
  it('R-2: 매칭된 줄만 반환(여러 줄 중)', () => {
    const txt = 'starting work\nreading files\n429 Too Many Requests\ndone'
    expect(detectRateLimit(txt)).toBe('429 Too Many Requests')
  })
})
