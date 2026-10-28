/**
 * 외부 도구가 끝낸 이슈를 IVE 가 닫은 뒤, stale 정리가 버려진 것으로 세던 문제 (운영 spider-framework 1697).
 *
 * reconcileExternalIssue 는 외부 도구가 끝낸 verify_waiting 이슈를 완료로 보고 닫는다. 닫힌 이슈는 다음 스캔에서
 * 목록에서 사라져 stale 정리로 가는데, 정리 쪽이 같은 판정을 모르면 'closed/abandoned' 로 마감해 완료로 세지지 않는다.
 *
 * 검증 불변식:
 *   E-1: verify_waiting + 외부 기록만 → 외부 도구가 끝낸 건 (정리 쪽이 완료로 마감해야 함).
 *   E-2: 외부 기록이 없으면 아니다.
 *   E-3: IVE 가 직접 돌린 실행이 있으면 아니다 (재태깅된 진짜 검증대기).
 *   E-4: verify_waiting 이 아닌 단계는 아니다.
 *   E-5: 닫는 쪽(reconcileExternalIssue)이 닫는 경우와 정리 쪽 판정이 항상 일치한다.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import Database from 'better-sqlite3'
import { setupTestDb, teardownTestDb, seedUser, seedProject, seedExecution } from './helpers/test-db'
import { isExternalToolFinished, reconcileExternalIssue } from '@/lib/scanner'
import type { Project } from '@/types'

let db: Database.Database
const project = { id: 'p1', userId: 'u1', name: 'T', provider: 'github' } as unknown as Project

beforeEach(() => {
  db = setupTestDb()
  seedUser(db, 'u1', 'Owner')
  seedProject(db, 'p1', 'u1', 'T')
})
afterEach(() => teardownTestDb())

const external = (id: string, iid: number) => seedExecution(db, {
  id, projectId: 'p1', agentId: null, issueIid: iid, status: 'success',
  startedAt: '2026-05-01T00:00:00.000Z', assigneeType: 'user', userId: null,
})
const iveRun = (id: string, iid: number) => seedExecution(db, {
  id, projectId: 'p1', agentId: 'a1', issueIid: iid, status: 'success',
  startedAt: '2026-05-01T01:00:00.000Z', assigneeType: 'agent',
})

describe('isExternalToolFinished', () => {
  it('E-1: verify_waiting + 외부 기록만 → true', () => {
    external('e1', 1)
    expect(isExternalToolFinished(project, 1, 'verify_waiting')).toBe(true)
  })
  it('E-2: 외부 기록이 없으면 false', () => {
    expect(isExternalToolFinished(project, 2, 'verify_waiting')).toBe(false)
  })
  it('E-3: IVE 가 직접 돌린 실행이 있으면 false', () => {
    external('e3', 3); iveRun('i3', 3)
    expect(isExternalToolFinished(project, 3, 'verify_waiting')).toBe(false)
  })
  it('E-4: verify_waiting 이 아니면 false', () => {
    external('e4', 4)
    for (const s of ['dev', 'dev_fail', 'verifying', 'confirm_waiting', null]) {
      expect(isExternalToolFinished(project, 4, s)).toBe(false)
    }
  })
  it('E-5: 닫는 쪽이 닫는 경우와 정리 쪽 판정이 일치한다', async () => {
    external('e5a', 5)
    external('e5b', 6); iveRun('i5b', 6)
    for (const iid of [5, 6, 7]) {
      const close = vi.fn().mockResolvedValue(undefined)
      await reconcileExternalIssue(project, { iid, title: 'X', description: '' }, 'verify_waiting', close)
      expect(close.mock.calls.length > 0).toBe(isExternalToolFinished(project, iid, 'verify_waiting'))
    }
  })
})
