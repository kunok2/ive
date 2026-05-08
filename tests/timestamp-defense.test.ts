/**
 * Timestamp 다층 방어 골든 테스트.
 *
 * 회귀 방지 사고 (운영 2026-05-07~05-08):
 *   외부 도구 ive-meta 의 'REPLACE_END' placeholder 가 task_executions.ended_at 에
 *   raw 문자열로 저장. resolvedAt 으로 흘러 클라이언트의 utcISOToKSTDateTime 에서 throw.
 *   한 row 의 dirty data 가 보고서 페이지 전체를 다운시킴.
 *
 * 방어 3 단계:
 *   (1) DB INSERT 단계: createExecution / updateExecutionStatus 에서 garbage 는 NULL 화
 *   (2) 응답 직렬화 단계: 보고서 API 가 클라이언트로 보낼 때 safeISO 로 정제
 *   (3) 클라이언트 렌더 단계: utcISOToKSTDate/DateTime/Month 가 invalid 입력에 throw 안 함
 *
 * 본 테스트는 (1) 과 (3) 을 단위 검증.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import Database from 'better-sqlite3'
import { setupTestDb, teardownTestDb, seedUser, seedProject, seedAgent } from './helpers/test-db'
import { createExecution, updateExecutionStatus, getExecution } from '@/lib/db/executions'
import { utcISOToKSTDate, utcISOToKSTDateTime, utcISOToKSTMonth } from '@/lib/date-utils'

describe('Layer 1 (DB INSERT) — sanitizeTimestamp', () => {
  let db: Database.Database
  beforeEach(() => {
    db = setupTestDb()
    seedUser(db, 'u1', '정균옥')
    seedProject(db, 'p1', 'u1', 'IVE')
    seedAgent(db, 'a1', 'u1', 'C')
  })
  afterEach(() => teardownTestDb())

  it('garbage ended_at 은 NULL 로 저장 (REPLACE_END placeholder 회귀)', () => {
    createExecution({
      id: 'ex1', projectId: 'p1', agentId: 'a1', issueIid: 1,
      status: 'success' as any,
      startedAt: '2026-05-07T10:00:00.000Z',
      endedAt: 'REPLACE_END' as any,
      logPath: '',
      inputTokens: 0, outputTokens: 0, costUsd: 0, turns: 0,
    } as any)
    const got = getExecution('ex1')
    expect(got!.endedAt).toBeNull()
    expect(got!.startedAt).toBe('2026-05-07T10:00:00.000Z')
  })

  it('빈 문자열도 NULL 로', () => {
    createExecution({
      id: 'ex2', projectId: 'p1', agentId: 'a1', issueIid: 2,
      status: 'success' as any,
      startedAt: '2026-05-07T10:00:00.000Z',
      endedAt: '   ' as any,
      logPath: '',
      inputTokens: 0, outputTokens: 0, costUsd: 0, turns: 0,
    } as any)
    const got = getExecution('ex2')
    expect(got!.endedAt).toBeNull()
  })

  it('updateExecutionStatus 도 garbage 차단', () => {
    createExecution({
      id: 'ex3', projectId: 'p1', agentId: 'a1', issueIid: 3,
      status: 'running' as any,
      startedAt: '2026-05-07T10:00:00.000Z',
      logPath: '',
      inputTokens: 0, outputTokens: 0, costUsd: 0, turns: 0,
    } as any)
    updateExecutionStatus('ex3', 'success' as any, 'BAD_VALUE')
    const got = getExecution('ex3')
    // garbage 는 거부되었지만 success 로 끝났으니 자동 채움된 ISO 시각이 있어야 함
    expect(got!.status).toBe('success')
    expect(got!.endedAt).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/)
  })

  it('정상 ISO 는 그대로 (정규화는 ISO 로 통일)', () => {
    createExecution({
      id: 'ex4', projectId: 'p1', agentId: 'a1', issueIid: 4,
      status: 'success' as any,
      startedAt: '2026-05-07T10:00:00.000Z',
      endedAt: '2026-05-07T10:30:00.000Z',
      logPath: '',
      inputTokens: 0, outputTokens: 0, costUsd: 0, turns: 0,
    } as any)
    const got = getExecution('ex4')
    expect(got!.endedAt).toBe('2026-05-07T10:30:00.000Z')
  })
})

describe('Layer 3 (date-utils) — invalid 입력에 throw 안 함', () => {
  it('utcISOToKSTDate: garbage 입력 시 throw 없이 입력 그대로 반환', () => {
    expect(() => utcISOToKSTDate('REPLACE_END')).not.toThrow()
    expect(utcISOToKSTDate('REPLACE_END')).toBe('REPLACE_END')
    expect(utcISOToKSTDate('not a date')).toBe('not a date')
  })

  it('utcISOToKSTDateTime: garbage 입력 시 throw 없이 입력 그대로 반환', () => {
    expect(() => utcISOToKSTDateTime('REPLACE_END')).not.toThrow()
    expect(utcISOToKSTDateTime('REPLACE_END')).toBe('REPLACE_END')
  })

  it('utcISOToKSTMonth: garbage 입력 시 throw 없이 입력 그대로 반환', () => {
    expect(() => utcISOToKSTMonth('REPLACE_END')).not.toThrow()
    expect(utcISOToKSTMonth('REPLACE_END')).toBe('REPLACE_END')
  })

  it('정상 입력은 변환됨', () => {
    // 2026-05-07T10:00:00.000Z UTC = 2026-05-07T19:00:00 KST
    expect(utcISOToKSTDate('2026-05-07T10:00:00.000Z')).toBe('2026-05-07')
    expect(utcISOToKSTDateTime('2026-05-07T10:00:00.000Z')).toBe('2026-05-07 19:00')
    expect(utcISOToKSTMonth('2026-05-07T10:00:00.000Z')).toBe('2026-05')
  })
})
