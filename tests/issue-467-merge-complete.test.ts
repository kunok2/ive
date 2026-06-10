/**
 * #467 — 메인 브랜치 머지로 닫힌 작업을 "완료(success)"로 처리.
 *
 * 검증/확인 단계 작업이 MR 머지로 자동 닫히면(Closes #iid + 브랜치 삭제) 이슈가
 * IVE-E(완료)를 거치지 않고 스캔에서 사라진다. 기존 stale 정리는 잔류 execution 을
 * 'failed' 로 마감해 실제 완료 작업이 "실패"로 집계되던 문제를 바로잡는다.
 *
 * 검증 불변식:
 *   M-1: closed 이슈 + dev-{iid} MR merged → 'merged_complete', 잔류 활성 exec 가 success.
 *   M-2: 검증 진행 중(verify_started_at 있음)이었으면 verified_at = mergedAt 기록.
 *   M-3: 이슈가 여전히 open(라벨만 제거)이면 'abandoned' — exec 손대지 않음.
 *   M-4: closed 이슈 + MR 이 merged 아님(opened/closed) → 'abandoned'.
 *   M-5: fetchIssue 실패 시 보수적으로 'abandoned'.
 *   M-6: 검증 미시작(verify_started_at 없음)이면 verified_at 을 임의 생성하지 않는다.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import Database from 'better-sqlite3'
import { setupTestDb, teardownTestDb, seedUser, seedProject, seedExecution } from './helpers/test-db'
import { reconcileClosedIssue } from '@/lib/scanner'
import { completeMergedIssue } from '@/lib/db'
import type { Project } from '@/types'

let db: Database.Database

const project = { id: 'p1', userId: 'u1', name: 'T', provider: 'gitlab' } as unknown as Project

function getExec(id: string) {
  return db.prepare('SELECT status, ended_at, verified_at FROM task_executions WHERE id = ?').get(id) as {
    status: string; ended_at: string | null; verified_at: string | null
  }
}

beforeEach(() => {
  db = setupTestDb()
  seedUser(db, 'u1', 'Owner')
  seedProject(db, 'p1', 'u1', 'T')
})
afterEach(() => teardownTestDb())

const closedIssue = () => Promise.resolve({ state: 'closed' })
const openIssue = () => Promise.resolve({ state: 'opened' })
const mergedMR = (mergedAt = '2026-06-10T03:00:00.000Z') =>
  Promise.resolve({ state: 'merged', merged_at: mergedAt })
const openedMR = () => Promise.resolve({ state: 'opened', merged_at: null })
const noMR = () => Promise.resolve(null)

describe('reconcileClosedIssue (#467 머지 완료 처리)', () => {
  it('M-1: closed 이슈 + merged MR → merged_complete, 잔류 활성 exec 가 success', async () => {
    // 검증 중인 placeholder execution (assigned)
    seedExecution(db, {
      id: 'ex-verify-1', projectId: 'p1', agentId: null, issueIid: 467, status: 'assigned',
      startedAt: '2026-06-10T02:00:00.000Z', assigneeType: 'user', userId: 'u1',
    })
    const r = await reconcileClosedIssue(project, 467, {
      fetchIssue: closedIssue,
      fetchDevMR: () => mergedMR('2026-06-10T03:00:00.000Z'),
    })
    expect(r.outcome).toBe('merged_complete')
    expect(r.closedExecs).toBe(1)
    const ex = getExec('ex-verify-1')
    expect(ex.status).toBe('success')
    expect(new Date(ex.ended_at).toISOString()).toBe('2026-06-10T03:00:00.000Z')
  })

  it('M-2: 검증 진행 중이었으면 verified_at = mergedAt 기록', async () => {
    // 개발 완료(success) + 검증 시작됨(verify_started_at 있음, 아직 미승인)
    seedExecution(db, {
      id: 'ex-dev', projectId: 'p1', agentId: 'a1', issueIid: 467, status: 'success',
      startedAt: '2026-06-10T01:00:00.000Z', endedAt: '2026-06-10T01:30:00.000Z',
      assigneeType: 'agent', verifyStartedAt: '2026-06-10T02:00:00.000Z',
    })
    await reconcileClosedIssue(project, 467, {
      fetchIssue: closedIssue,
      fetchDevMR: () => mergedMR('2026-06-10T03:00:00.000Z'),
    })
    const ex = getExec('ex-dev')
    expect(ex.verified_at).not.toBeNull()
    expect(new Date(ex.verified_at).toISOString()).toBe('2026-06-10T03:00:00.000Z')
  })

  it('M-3: 이슈가 여전히 열려 있으면 abandoned — exec 손대지 않음', async () => {
    seedExecution(db, {
      id: 'ex-verify-1', projectId: 'p1', agentId: null, issueIid: 467, status: 'assigned',
      startedAt: '2026-06-10T02:00:00.000Z', assigneeType: 'user', userId: 'u1',
    })
    const r = await reconcileClosedIssue(project, 467, {
      fetchIssue: openIssue,
      fetchDevMR: () => mergedMR(),
    })
    expect(r.outcome).toBe('abandoned')
    expect(getExec('ex-verify-1').status).toBe('assigned')
  })

  it('M-4: closed 이슈지만 MR 이 merged 아니면 abandoned', async () => {
    const r1 = await reconcileClosedIssue(project, 467, { fetchIssue: closedIssue, fetchDevMR: openedMR })
    expect(r1.outcome).toBe('abandoned')
    const r2 = await reconcileClosedIssue(project, 467, { fetchIssue: closedIssue, fetchDevMR: noMR })
    expect(r2.outcome).toBe('abandoned')
  })

  it('M-5: fetchIssue 실패 시 보수적으로 abandoned', async () => {
    const r = await reconcileClosedIssue(project, 467, {
      fetchIssue: () => Promise.reject(new Error('network')),
      fetchDevMR: () => mergedMR(),
    })
    expect(r.outcome).toBe('abandoned')
  })

  it('M-6: 검증 미시작이면 verified_at 을 임의 생성하지 않는다', () => {
    // verify_started_at 없음 → completeMergedIssue 가 verified_at 을 만들면 안 됨
    seedExecution(db, {
      id: 'ex-dev', projectId: 'p1', agentId: 'a1', issueIid: 467, status: 'success',
      startedAt: '2026-06-10T01:00:00.000Z', endedAt: '2026-06-10T01:30:00.000Z',
      assigneeType: 'agent',
    })
    completeMergedIssue('p1', 467, '2026-06-10T03:00:00.000Z')
    expect(getExec('ex-dev').verified_at).toBeNull()
  })

  it('M-7: mergedAt 없으면 현재 시각으로 마감 (RangeError 방지)', async () => {
    seedExecution(db, {
      id: 'ex-confirm-1', projectId: 'p1', agentId: null, issueIid: 467, status: 'assigned',
      startedAt: '2026-06-10T02:00:00.000Z', assigneeType: 'user', userId: 'u1',
    })
    const r = await reconcileClosedIssue(project, 467, {
      fetchIssue: closedIssue,
      fetchDevMR: () => Promise.resolve({ state: 'merged', merged_at: null }),
    })
    expect(r.outcome).toBe('merged_complete')
    const ex = getExec('ex-confirm-1')
    expect(ex.status).toBe('success')
    expect(() => new Date(ex.ended_at).toISOString()).not.toThrow()
    expect(ex.ended_at).not.toBeNull()
  })
})
