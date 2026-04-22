/**
 * ive-author / ive-agent 마커 골든 테스트
 *
 * 중요한 로직:
 *   - 이슈/코멘트 본문에 HTML 주석 마커를 삽입/제거/파싱하는 유틸.
 *   - 마커가 깨지면: 로컬 계정 사용자가 자기 이슈의 "생성자"로 인식되지 않아 검증 팝업이
 *     안 뜨고, 에이전트가 쓴 코멘트가 프로젝트 소유자 이름으로 나오고,
 *     본문에 HTML 주석이 그대로 노출되는 등 UX가 깨진다.
 *
 * 불변식:
 *   M-1: prepend 한 마커는 extract 로 동일 id 를 돌려받아야 한다.
 *   M-2: strip 후에는 본문에서 해당 마커가 사라지고 나머지 텍스트는 보존된다.
 *   M-3: ive-author 와 ive-agent 마커는 독립적으로 파싱된다.
 *   M-4: stripAllIveMarkers 는 둘 다 동시에 제거한다.
 *   M-5: null/undefined/비문자열 입력에 크래시하지 않는다.
 */
import { describe, it, expect } from 'vitest'
import {
  IVE_AUTHOR_MARKER_RE,
  IVE_AGENT_MARKER_RE,
  prependIveAuthorMarker,
  stripIveAuthorMarker,
  extractIveAuthorId,
  prependIveAgentMarker,
  stripIveAgentMarker,
  extractIveAgentId,
  stripAllIveMarkers,
} from '@/lib/ive-author'

describe('ive-author / ive-agent 마커', () => {
  describe('M-1: prepend → extract 왕복', () => {
    it('author 마커: userId 가 정확히 복원된다', () => {
      const body = prependIveAuthorMarker('user-abc123', '본문 내용')
      expect(extractIveAuthorId(body)).toBe('user-abc123')
    })

    it('agent 마커: agentId 가 정확히 복원된다', () => {
      const body = prependIveAgentMarker('agent-001', '에이전트 코멘트')
      expect(extractIveAgentId(body)).toBe('agent-001')
    })

    it('빈 본문에도 마커가 정상 주입된다', () => {
      const body = prependIveAuthorMarker('user-1', '')
      expect(extractIveAuthorId(body)).toBe('user-1')
    })
  })

  describe('M-2: strip 동작', () => {
    it('stripIveAuthorMarker 는 마커만 제거하고 본문은 보존한다', () => {
      const body = `<!-- ive-author:user-1 -->\n실제 본문`
      expect(stripIveAuthorMarker(body)).toBe('실제 본문')
    })

    it('stripIveAgentMarker 는 agent 마커만 제거한다', () => {
      const body = `<!-- ive-agent:agent-1 -->\n에이전트 코멘트`
      expect(stripIveAgentMarker(body)).toBe('에이전트 코멘트')
    })

    it('마커가 없으면 원본 그대로', () => {
      expect(stripIveAuthorMarker('그냥 본문')).toBe('그냥 본문')
      expect(stripIveAgentMarker('그냥 본문')).toBe('그냥 본문')
    })
  })

  describe('M-3: author 와 agent 마커 독립성', () => {
    it('author 마커만 있으면 extractAgent 는 null', () => {
      const body = `<!-- ive-author:user-1 -->\n본문`
      expect(extractIveAuthorId(body)).toBe('user-1')
      expect(extractIveAgentId(body)).toBeNull()
    })

    it('agent 마커만 있으면 extractAuthor 는 null', () => {
      const body = `<!-- ive-agent:agent-1 -->\n본문`
      expect(extractIveAgentId(body)).toBe('agent-1')
      expect(extractIveAuthorId(body)).toBeNull()
    })

    it('둘 다 있으면 각자 추출된다', () => {
      const body = `<!-- ive-author:user-1 -->\n<!-- ive-agent:agent-1 -->\n본문`
      expect(extractIveAuthorId(body)).toBe('user-1')
      expect(extractIveAgentId(body)).toBe('agent-1')
    })
  })

  describe('M-4: stripAllIveMarkers 복합 제거', () => {
    it('두 마커를 동시에 제거한다', () => {
      const body = `<!-- ive-author:user-1 -->\n<!-- ive-agent:agent-1 -->\n본문 텍스트`
      expect(stripAllIveMarkers(body)).toBe('본문 텍스트')
    })

    it('마커 뒤 공백/개행을 정리한다 (본문 앞쪽)', () => {
      const body = `<!-- ive-author:u1 -->\n\n\n본문`
      expect(stripAllIveMarkers(body)).toBe('본문')
    })
  })

  describe('M-5: 방어적 입력 처리', () => {
    it('null / undefined 입력에 크래시 없음', () => {
      expect(extractIveAuthorId(null)).toBeNull()
      expect(extractIveAuthorId(undefined)).toBeNull()
      expect(extractIveAgentId(null)).toBeNull()
      expect(extractIveAgentId(undefined)).toBeNull()
    })

    it('빈 문자열 입력', () => {
      expect(extractIveAuthorId('')).toBeNull()
      expect(stripIveAuthorMarker('')).toBe('')
      expect(stripAllIveMarkers('')).toBe('')
    })

    it('마커 id 에 허용되지 않는 문자는 매치 안 됨 (보안)', () => {
      // regex: [a-zA-Z0-9_-]+ 만 허용. 슬래시 ${} 등은 매치 안 됨.
      expect(extractIveAuthorId('<!-- ive-author:${evil} -->')).toBeNull()
      expect(extractIveAuthorId('<!-- ive-author:../etc/passwd -->')).toBeNull()
    })
  })

  describe('정규식 직접 확인 (컴파일 상수)', () => {
    it('IVE_AUTHOR_MARKER_RE 는 공백 허용, id만 캡처', () => {
      const m = '<!--  ive-author:abc-123 -->'.match(IVE_AUTHOR_MARKER_RE)
      expect(m).not.toBeNull()
      expect(m?.[1]).toBe('abc-123')
    })

    it('IVE_AGENT_MARKER_RE 도 같은 포맷', () => {
      const m = '<!-- ive-agent:agent_1 -->'.match(IVE_AGENT_MARKER_RE)
      expect(m).not.toBeNull()
      expect(m?.[1]).toBe('agent_1')
    })
  })
})
