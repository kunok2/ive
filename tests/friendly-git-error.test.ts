/**
 * friendlyGitError 골든 테스트
 *
 * 중요한 로직:
 *   GitLab/GitHub API 에서 던지는 raw 에러(예: "401 Unauthorized") 를
 *   사용자에게 보여줄 한국어 친절 메시지로 변환.
 *   깨지면 사용자에게 "401" 같은 불친절한 코드만 노출되어 원인 파악 어려워짐.
 *
 * 불변식:
 *   E-1: 각 HTTP 상태에 맞는 한국어 안내 포함
 *   E-2: 이미 한국어 메시지인 경우 그대로 전달 (이중 래핑 방지)
 *   E-3: 매치 안 되는 에러도 최소한 원본은 보존
 *   E-4: 액션 이름이 메시지에 반영됨 (예: "머지 실패" vs "MR 조회 실패")
 */
import { describe, it, expect } from 'vitest'
import { friendlyGitError } from '@/lib/git-token'

describe('friendlyGitError', () => {
  describe('E-1: HTTP 상태 매핑', () => {
    it('401 Unauthorized → 인증 실패 안내', () => {
      const msg = friendlyGitError(new Error('401 Unauthorized'), '머지')
      expect(msg).toContain('인증 실패')
      expect(msg).toContain('401')
      expect(msg).toContain('머지')
    })

    it('403 Forbidden → 권한 부족 안내', () => {
      const msg = friendlyGitError(new Error('403 Forbidden'), 'MR 조회')
      expect(msg).toContain('권한 부족')
      expect(msg).toContain('403')
      expect(msg).toContain('MR 조회')
    })

    it('405 Method Not Allowed → 보호된 브랜치 안내', () => {
      const msg = friendlyGitError(new Error('405 Method Not Allowed: not allowed to merge'), '머지')
      expect(msg).toContain('보호된 브랜치')
    })

    it('404 Not Found → 리소스 없음 안내', () => {
      const msg = friendlyGitError(new Error('404 Not Found'), '조회')
      expect(msg).toContain('찾을 수 없')
    })

    it('409 Conflict → 충돌 안내', () => {
      const msg = friendlyGitError(new Error('409 conflict'), '머지')
      expect(msg).toContain('충돌')
    })

    it('422 cannot be merged → 불가 상태 안내', () => {
      const msg = friendlyGitError(new Error('422 cannot be merged'), '머지')
      expect(msg).toContain('불가능한 상태')
    })
  })

  describe('E-2: 한국어 원본 보존', () => {
    it('이미 한국어 메시지면 그대로 전달 (이중 래핑 금지)', () => {
      const msg = friendlyGitError(new Error('이슈 수정 실패: 네트워크 오류'), '수정')
      expect(msg).toBe('이슈 수정 실패: 네트워크 오류')
    })
  })

  describe('E-3: 미매치 에러 fallback', () => {
    it('알려지지 않은 영문 에러는 action prefix 로 래핑', () => {
      const msg = friendlyGitError(new Error('ENOTFOUND gitlab.com'), '연결')
      expect(msg).toContain('연결 실패')
      expect(msg).toContain('ENOTFOUND')
    })

    it('Error 객체 아닌 값도 문자열로 변환', () => {
      const msg = friendlyGitError('some string error', '작업')
      expect(typeof msg).toBe('string')
      expect(msg).toContain('some string error')
    })

    it('undefined 도 크래시 없음', () => {
      expect(() => friendlyGitError(undefined, '작업')).not.toThrow()
    })
  })

  describe('E-4: action 이름 반영', () => {
    it('action 이 메시지에 포함되어 문맥 명확', () => {
      const a = friendlyGitError(new Error('401'), '머지')
      const b = friendlyGitError(new Error('401'), 'MR 조회')
      expect(a).toContain('머지')
      expect(b).toContain('MR 조회')
      expect(a).not.toBe(b)
    })
  })
})
