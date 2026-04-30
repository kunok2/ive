/**
 * 보고서 집계 불변식 골든 테스트
 *
 * 모든 유입 경로에서 보고서 숫자가 앞뒤가 맞는지 검증:
 * 1. 에이전트(AI)가 정상 처리한 케이스
 * 2. 사람이 직접 작업한 케이스
 * 3. 외부 도구(Claude Code 등)에서 후 정산 유입된 케이스
 * 4. 검증(verify) 워크플로를 거친 케이스
 * 5. 실패(failed) 후 재시도 케이스
 * 6. endedAt이 NULL인 비정상 데이터 방어
 * 7. 사람+에이전트 혼합 프로젝트
 *
 * 불변식:
 * - INV-1: 유입(uniqueInflow) >= 처리(verifiedCount)
 * - INV-2: success/failed status인 execution의 처리 카운팅 보장
 * - INV-3: 일별 트렌드 유입 합산 = 전체 유입
 * - INV-4: 일별 트렌드 처리(verified) 합산 = 전체 처리
 * - INV-5: 프로젝트별 합산 = 전체 합산
 * - INV-6: endedAt NULL이어도 success/failed는 처리로 집계
 * - INV-7: 재시도(같은 이슈 여러 execution)는 유입 1건으로 집계
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import Database from 'better-sqlite3'
import {
  setupTestDb, teardownTestDb,
  seedUser, seedProject, seedAgent, seedExecution,
} from './helpers/test-db'
import type { ReportExecution } from '@/lib/db/reports'

// ── 테스트용 집계 함수 (route.ts 로직 그대로) ──
// route.ts에서 추출한 핵심 집계 로직을 순수 함수로 재현

function durationMin(startedAt: string, endedAt: string | null): number {
  if (!endedAt) return 0
  return Math.max(0, (new Date(endedAt).getTime() - new Date(startedAt).getTime()) / 60000)
}

interface AggregationResult {
  totalTasks: number
  uniqueInflow: number
  verifiedCount: number
  successCount: number
  failedCount: number
  runningCount: number
  dailyTrend: { date: string; inflow: number; verified: number; tasks: number }[]
  byProject: { projectId: string; tasks: number; uniqueIssues: number; verified: number }[]
  lifecycle: { procCount: number; waitCount: number }
}

/** UTC ISO 날짜 → KST 기준 버킷 키 (YYYY-MM-DD) */
function toBucketKey(dateStr: string): string {
  const KST_OFFSET_MS = 9 * 60 * 60 * 1000
  return new Date(new Date(dateStr).getTime() + KST_OFFSET_MS).toISOString().slice(0, 10)
}

/**
 * route.ts GET 핸들러의 집계 로직을 순수 함수로 재현.
 * 여기서 검증하는 것은 "규칙"이지 route.ts 코드가 아님.
 * route.ts가 이 규칙을 위반하면 테스트를 추가하여 강제.
 */
function aggregateReport(execs: ReportExecution[]): AggregationResult {
  const totalTasks = execs.length
  const uniqueIssueKeys = new Set(execs.map(e => `${e.projectId}:${e.issueIid}`))
  const uniqueInflow = uniqueIssueKeys.size

  // 처리 카운트: success/failed이면 무조건 처리 (endedAt 여부 무관)
  const verifiedIssueKeys = new Set(
    execs.filter(e => e.verifiedAt || e.rejectedAt || e.status === 'success' || e.status === 'failed')
      .map(e => `${e.projectId}:${e.issueIid}`)
  )
  const verifiedCount = verifiedIssueKeys.size
  const successCount = execs.filter(e => e.status === 'success').length
  const failedCount = execs.filter(e => e.status === 'failed').length
  const runningCount = execs.filter(e => e.status === 'running' || e.status === 'assigned').length

  // 일별 트렌드
  const firstStartByIssue = new Map<string, string>()
  for (const e of execs) {
    const k = `${e.projectId}:${e.issueIid}`
    const prev = firstStartByIssue.get(k)
    if (!prev || e.startedAt < prev) firstStartByIssue.set(k, e.startedAt)
  }
  const verifyDateByIssue = new Map<string, string>()
  for (const e of execs) {
    const verifyEnd = e.verifiedAt || e.rejectedAt || ((e.status === 'success' || e.status === 'failed') ? (e.endedAt || e.startedAt) : null)
    if (!verifyEnd) continue
    const k = `${e.projectId}:${e.issueIid}`
    const prev = verifyDateByIssue.get(k)
    if (!prev || verifyEnd < prev) verifyDateByIssue.set(k, verifyEnd)
  }

  const dayMap = new Map<string, { tasks: number; inflowIssues: Set<string>; verifiedIssues: Set<string> }>()
  const mkBucket = () => ({ tasks: 0, inflowIssues: new Set<string>(), verifiedIssues: new Set<string>() })

  for (const e of execs) {
    const key = toBucketKey(e.startedAt)
    if (!dayMap.has(key)) dayMap.set(key, mkBucket())
    const d = dayMap.get(key)!
    d.tasks++
    const ik = `${e.projectId}:${e.issueIid}`
    if (firstStartByIssue.get(ik) === e.startedAt) d.inflowIssues.add(ik)
  }
  for (const [ik, verifyEnd] of verifyDateByIssue) {
    const key = toBucketKey(verifyEnd)
    if (!dayMap.has(key)) dayMap.set(key, mkBucket())
    dayMap.get(key)!.verifiedIssues.add(ik)
  }

  const dailyTrend = Array.from(dayMap.entries())
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([date, d]) => ({
      date,
      inflow: d.inflowIssues.size,
      verified: d.verifiedIssues.size,
      tasks: d.tasks,
    }))

  // 프로젝트별
  const projectMap = new Map<string, typeof execs>()
  for (const e of execs) {
    if (!projectMap.has(e.projectId)) projectMap.set(e.projectId, [])
    projectMap.get(e.projectId)!.push(e)
  }
  const byProject = Array.from(projectMap.entries()).map(([pid, pExecs]) => ({
    projectId: pid,
    tasks: pExecs.length,
    uniqueIssues: new Set(pExecs.map(e => `${e.projectId}:${e.issueIid}`)).size,
    verified: new Set(
      pExecs.filter(e => e.verifiedAt || e.rejectedAt || e.status === 'success' || e.status === 'failed')
        .map(e => `${e.projectId}:${e.issueIid}`)
    ).size,
  }))

  // 생애주기
  const finishedExecs = execs.filter(e => e.status === 'success' || e.status === 'failed')
  const procTimes = finishedExecs.filter(e => e.endedAt).map(e => durationMin(e.startedAt, e.endedAt!)).filter(v => v > 0)
  const waitTimes = finishedExecs.filter(e => e.issueCreatedAt).map(e => {
    let wait = durationMin(e.issueCreatedAt!, e.startedAt)
    const effEnd = e.endedAt || e.startedAt
    if (effEnd && e.verifyStartedAt) {
      const vw = durationMin(effEnd, e.verifyStartedAt)
      if (vw >= 0) wait += vw
    }
    return wait
  }).filter(v => v >= 0)

  return {
    totalTasks, uniqueInflow, verifiedCount, successCount, failedCount, runningCount,
    dailyTrend, byProject,
    lifecycle: { procCount: procTimes.length, waitCount: waitTimes.length },
  }
}

// ── DB에서 ReportExecution 조회 (route.ts의 getExecutionsInRange 간소화) ──
function getTestExecutions(db: Database.Database, userId: string, startISO: string, endISO: string): ReportExecution[] {
  const rows = db.prepare(`
    SELECT te.id, te.project_id, p.name as project_name, p.color as project_color,
           p.avatar_url as project_avatar_url, p.provider as project_provider,
           te.agent_id, a.name as agent_name, a.avatar as agent_avatar, a.cli_name,
           u.name as developer_name, a.user_id as developer_user_id,
           te.issue_iid, te.issue_title, te.status,
           te.started_at, te.ended_at, te.input_tokens, te.output_tokens, te.cost_usd, te.turns,
           te.issue_created_at, te.model_name, te.verified_at, te.verify_started_at, te.rejected_at,
           te.assignee_type, te.user_id as te_user_id, te.user_name as te_user_name, te.user_avatar as te_user_avatar,
           te.verifier_name, te.verifier_avatar, te.verifier_username,
           te.verifier_user_id as verifier_user_id_resolved
    FROM task_executions te
    JOIN projects p ON p.id = te.project_id
    LEFT JOIN agents a ON a.id = te.agent_id
    LEFT JOIN users u ON u.id = a.user_id
    WHERE (p.user_id = ? OR EXISTS (SELECT 1 FROM project_shares ps WHERE ps.project_id = p.id AND ps.user_id = ?))
      AND te.started_at >= ? AND te.started_at < ?
    ORDER BY te.started_at ASC
  `).all(userId, userId, startISO, endISO) as any[]

  return rows.map((r: any): ReportExecution => ({
    id: r.id, projectId: r.project_id, projectName: r.project_name,
    projectColor: r.project_color, projectAvatarUrl: r.project_avatar_url || '', projectProvider: r.project_provider || 'gitlab',
    agentId: r.agent_id ?? '', agentName: r.agent_name ?? r.te_user_name ?? '', agentAvatar: r.agent_avatar || r.te_user_avatar || 'av-01',
    agentDeleted: !!r.agent_id && r.agent_name == null && r.te_user_name == null,
    cliName: r.cli_name ?? '', developerName: r.developer_name || r.agent_name || r.te_user_name || '',
    developerUserId: r.developer_user_id ?? null,
    userId: r.te_user_id ?? null, userName: r.te_user_name ?? null, userAvatar: r.te_user_avatar ?? null,
    issueIid: r.issue_iid, issueTitle: r.issue_title,
    status: r.status, startedAt: r.started_at, endedAt: r.ended_at,
    inputTokens: r.input_tokens ?? 0, outputTokens: r.output_tokens ?? 0,
    costUsd: r.cost_usd ?? 0, turns: r.turns ?? 0,
    issueCreatedAt: r.issue_created_at ?? null, modelName: r.model_name ?? null,
    verifiedAt: r.verified_at ?? null, verifyStartedAt: r.verify_started_at ?? null,
    rejectedAt: r.rejected_at ?? null, verifierName: r.verifier_name ?? null,
    verifierAvatar: r.verifier_avatar ?? null, verifierUsername: r.verifier_username ?? null,
    verifierUserId: r.verifier_user_id_resolved ?? null, assigneeType: r.assignee_type ?? 'agent',
  }))
}

// ─────────────────────────────────────────────
// 테스트
// ─────────────────────────────────────────────

let db: Database.Database

beforeEach(() => {
  db = setupTestDb()
  seedUser(db, 'user-1', '관리자', { isAdmin: true })
  seedProject(db, 'proj-1', 'user-1', 'IVE 프로젝트')
  seedProject(db, 'proj-2', 'user-1', '스파이더 APM')
  seedAgent(db, 'agent-1', 'user-1', 'Claude Agent')
})

afterEach(() => {
  teardownTestDb()
})

// 조회 범위: 2026-04-07 ~ 2026-04-14 (UTC 기준)
const RANGE_START = '2026-04-06T15:00:00.000Z' // KST 2026-04-07 00:00
const RANGE_END = '2026-04-13T15:00:00.000Z'   // KST 2026-04-14 00:00

describe('보고서 집계 불변식', () => {

  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  // 케이스 1: 에이전트(AI)가 정상 처리
  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  describe('케이스 1: 에이전트 정상 처리', () => {
    beforeEach(() => {
      // 이슈 #1: 에이전트가 성공적으로 처리
      seedExecution(db, {
        id: 'ex-1', projectId: 'proj-1', agentId: 'agent-1', issueIid: 1,
        issueTitle: '에이전트 작업', status: 'success',
        startedAt: '2026-04-08T02:00:00.000Z', endedAt: '2026-04-08T02:30:00.000Z',
        issueCreatedAt: '2026-04-08T01:50:00.000Z',
        inputTokens: 1000, outputTokens: 500, costUsd: 0.05, turns: 3,
      })
      // 이슈 #2: 에이전트가 실패
      seedExecution(db, {
        id: 'ex-2', projectId: 'proj-1', agentId: 'agent-1', issueIid: 2,
        issueTitle: '실패 작업', status: 'failed',
        startedAt: '2026-04-09T03:00:00.000Z', endedAt: '2026-04-09T03:15:00.000Z',
        issueCreatedAt: '2026-04-09T02:50:00.000Z',
      })
      // 이슈 #3: 에이전트 작업중 (running)
      seedExecution(db, {
        id: 'ex-3', projectId: 'proj-1', agentId: 'agent-1', issueIid: 3,
        issueTitle: '진행중 작업', status: 'running',
        startedAt: '2026-04-10T04:00:00.000Z',
        issueCreatedAt: '2026-04-10T03:50:00.000Z',
      })
    })

    it('INV-1: 유입 >= 처리', () => {
      const execs = getTestExecutions(db, 'user-1', RANGE_START, RANGE_END)
      const r = aggregateReport(execs)
      expect(r.uniqueInflow).toBeGreaterThanOrEqual(r.verifiedCount)
    })

    it('INV-2: success+failed 이슈는 모두 처리로 집계', () => {
      const execs = getTestExecutions(db, 'user-1', RANGE_START, RANGE_END)
      const r = aggregateReport(execs)
      expect(r.uniqueInflow).toBe(3) // 이슈 3개
      expect(r.verifiedCount).toBe(2) // #1 success + #2 failed
      expect(r.runningCount).toBe(1)  // #3 running
    })

    it('INV-5: 프로젝트별 합산 = 전체 합산', () => {
      const execs = getTestExecutions(db, 'user-1', RANGE_START, RANGE_END)
      const r = aggregateReport(execs)
      const projTaskSum = r.byProject.reduce((s, p) => s + p.tasks, 0)
      expect(projTaskSum).toBe(r.totalTasks)
    })
  })

  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  // 케이스 2: 사람이 직접 작업
  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  describe('케이스 2: 사람 직접 작업', () => {
    beforeEach(() => {
      seedExecution(db, {
        id: 'ex-human-1', projectId: 'proj-1', agentId: null, issueIid: 10,
        issueTitle: '사람 작업', status: 'success',
        startedAt: '2026-04-08T05:00:00.000Z', endedAt: '2026-04-08T07:00:00.000Z',
        issueCreatedAt: '2026-04-08T04:00:00.000Z',
        assigneeType: 'user', userId: 'user-1', userName: '관리자',
      })
      seedExecution(db, {
        id: 'ex-human-2', projectId: 'proj-1', agentId: null, issueIid: 11,
        issueTitle: '사람 작업중', status: 'assigned',
        startedAt: '2026-04-09T06:00:00.000Z',
        issueCreatedAt: '2026-04-09T05:30:00.000Z',
        assigneeType: 'user', userId: 'user-1', userName: '관리자',
      })
    })

    it('INV-1: 사람 작업도 유입 >= 처리', () => {
      const execs = getTestExecutions(db, 'user-1', RANGE_START, RANGE_END)
      const r = aggregateReport(execs)
      expect(r.uniqueInflow).toBe(2)
      expect(r.verifiedCount).toBe(1) // success만
      expect(r.runningCount).toBe(1)  // assigned도 진행중
    })

    it('INV-2: 사람 success도 처리로 집계', () => {
      const execs = getTestExecutions(db, 'user-1', RANGE_START, RANGE_END)
      const r = aggregateReport(execs)
      expect(r.successCount).toBe(1)
    })
  })

  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  // 케이스 3: 외부 도구 후 정산 유입
  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  describe('케이스 3: 외부 도구 후 정산', () => {
    beforeEach(() => {
      // 후 정산: endedAt이 정상적으로 있는 경우
      seedExecution(db, {
        id: 'ex-ext-1', projectId: 'proj-2', agentId: null, issueIid: 20,
        issueTitle: 'Claude Code 작업', status: 'success',
        startedAt: '2026-04-10T06:27:02.000Z', endedAt: '2026-04-10T06:27:02.000Z',
        issueCreatedAt: '2026-04-10T05:00:00.000Z',
        assigneeType: 'user', userName: 'koj',
        inputTokens: 5000, outputTokens: 2000, costUsd: 0.15, modelName: 'claude-opus-4-6',
      })
      seedExecution(db, {
        id: 'ex-ext-2', projectId: 'proj-2', agentId: null, issueIid: 21,
        issueTitle: 'Gemini 작업', status: 'success',
        startedAt: '2026-04-10T06:27:03.000Z', endedAt: '2026-04-10T06:27:03.000Z',
        issueCreatedAt: '2026-04-10T05:10:00.000Z',
        assigneeType: 'user', userName: 'koj',
      })
      seedExecution(db, {
        id: 'ex-ext-3', projectId: 'proj-2', agentId: null, issueIid: 22,
        issueTitle: 'Codex 작업', status: 'success',
        startedAt: '2026-04-10T06:27:04.000Z', endedAt: '2026-04-10T06:27:04.000Z',
        issueCreatedAt: '2026-04-10T05:20:00.000Z',
        assigneeType: 'user', userName: 'koj',
      })
    })

    it('INV-1,2: 후 정산 3건 모두 유입=처리', () => {
      const execs = getTestExecutions(db, 'user-1', RANGE_START, RANGE_END)
      const r = aggregateReport(execs)
      expect(r.uniqueInflow).toBe(3)
      expect(r.verifiedCount).toBe(3)
      expect(r.successCount).toBe(3)
    })

    it('INV-3: 일별 트렌드 유입 합산 = 전체 유입', () => {
      const execs = getTestExecutions(db, 'user-1', RANGE_START, RANGE_END)
      const r = aggregateReport(execs)
      const trendInflowSum = r.dailyTrend.reduce((s, d) => s + d.inflow, 0)
      expect(trendInflowSum).toBe(r.uniqueInflow)
    })

    it('INV-4: 일별 트렌드 처리 합산 = 전체 처리', () => {
      const execs = getTestExecutions(db, 'user-1', RANGE_START, RANGE_END)
      const r = aggregateReport(execs)
      const trendVerifiedSum = r.dailyTrend.reduce((s, d) => s + d.verified, 0)
      expect(trendVerifiedSum).toBe(r.verifiedCount)
    })
  })

  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  // 케이스 4: 검증 워크플로
  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  describe('케이스 4: 검증 워크플로', () => {
    beforeEach(() => {
      // 에이전트 작업 → 검증 승인
      seedExecution(db, {
        id: 'ex-verify-1', projectId: 'proj-1', agentId: 'agent-1', issueIid: 30,
        issueTitle: '검증 완료 작업', status: 'success',
        startedAt: '2026-04-08T10:00:00.000Z', endedAt: '2026-04-08T10:30:00.000Z',
        issueCreatedAt: '2026-04-08T09:50:00.000Z',
        verifyStartedAt: '2026-04-08T11:00:00.000Z',
        verifiedAt: '2026-04-08T11:30:00.000Z',
        verifierName: '검증자A', verifierUsername: 'verifier-a',
      })
      // 에이전트 작업 → 검증 반려
      seedExecution(db, {
        id: 'ex-verify-2', projectId: 'proj-1', agentId: 'agent-1', issueIid: 31,
        issueTitle: '검증 반려 작업', status: 'success',
        startedAt: '2026-04-09T10:00:00.000Z', endedAt: '2026-04-09T10:20:00.000Z',
        issueCreatedAt: '2026-04-09T09:50:00.000Z',
        verifyStartedAt: '2026-04-09T11:00:00.000Z',
        rejectedAt: '2026-04-09T11:10:00.000Z',
        verifierName: '검증자A', verifierUsername: 'verifier-a',
      })
    })

    it('INV-1,2: 검증된 건도 유입=처리', () => {
      const execs = getTestExecutions(db, 'user-1', RANGE_START, RANGE_END)
      const r = aggregateReport(execs)
      expect(r.uniqueInflow).toBe(2)
      expect(r.verifiedCount).toBe(2)
    })

    it('검증 시간이 생애주기에 반영', () => {
      const execs = getTestExecutions(db, 'user-1', RANGE_START, RANGE_END)
      const r = aggregateReport(execs)
      // 두 건 모두 endedAt이 있으므로 procCount = 2
      expect(r.lifecycle.procCount).toBe(2)
    })
  })

  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  // 케이스 5: 실패 후 재시도
  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  describe('케이스 5: 재시도 (같은 이슈 여러 execution)', () => {
    beforeEach(() => {
      // 이슈 #40: 1차 시도 실패
      seedExecution(db, {
        id: 'ex-retry-1', projectId: 'proj-1', agentId: 'agent-1', issueIid: 40,
        issueTitle: '재시도 작업', status: 'failed',
        startedAt: '2026-04-08T08:00:00.000Z', endedAt: '2026-04-08T08:10:00.000Z',
        issueCreatedAt: '2026-04-08T07:50:00.000Z',
      })
      // 이슈 #40: 2차 시도 성공
      seedExecution(db, {
        id: 'ex-retry-2', projectId: 'proj-1', agentId: 'agent-1', issueIid: 40,
        issueTitle: '재시도 작업', status: 'success',
        startedAt: '2026-04-08T09:00:00.000Z', endedAt: '2026-04-08T09:20:00.000Z',
        issueCreatedAt: '2026-04-08T07:50:00.000Z',
      })
    })

    it('INV-7: 재시도 시 유입은 1건, execution은 2건', () => {
      const execs = getTestExecutions(db, 'user-1', RANGE_START, RANGE_END)
      const r = aggregateReport(execs)
      expect(r.totalTasks).toBe(2)     // execution 2건
      expect(r.uniqueInflow).toBe(1)   // 이슈 1건
      expect(r.verifiedCount).toBe(1)  // 같은 이슈이므로 처리도 1건
    })

    it('INV-3: 재시도 건의 유입은 첫 시작일에만 카운트', () => {
      const execs = getTestExecutions(db, 'user-1', RANGE_START, RANGE_END)
      const r = aggregateReport(execs)
      const trendInflowSum = r.dailyTrend.reduce((s, d) => s + d.inflow, 0)
      expect(trendInflowSum).toBe(1) // 1일에 1건만
    })
  })

  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  // 케이스 6: endedAt NULL 방어 (비정상 데이터)
  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  describe('케이스 6: endedAt NULL인 success/failed (방어)', () => {
    beforeEach(() => {
      // endedAt이 NULL인 success (과거 버그로 발생 가능)
      seedExecution(db, {
        id: 'ex-null-1', projectId: 'proj-1', agentId: 'agent-1', issueIid: 50,
        issueTitle: 'endedAt 누락', status: 'success',
        startedAt: '2026-04-08T12:00:00.000Z', endedAt: null,
        issueCreatedAt: '2026-04-08T11:50:00.000Z',
      })
      // endedAt이 NULL인 failed
      seedExecution(db, {
        id: 'ex-null-2', projectId: 'proj-1', agentId: 'agent-1', issueIid: 51,
        issueTitle: 'endedAt 누락 실패', status: 'failed',
        startedAt: '2026-04-09T12:00:00.000Z', endedAt: null,
        issueCreatedAt: '2026-04-09T11:50:00.000Z',
      })
      // 정상 케이스 (비교용)
      seedExecution(db, {
        id: 'ex-normal', projectId: 'proj-1', agentId: 'agent-1', issueIid: 52,
        issueTitle: '정상 케이스', status: 'success',
        startedAt: '2026-04-10T12:00:00.000Z', endedAt: '2026-04-10T12:30:00.000Z',
        issueCreatedAt: '2026-04-10T11:50:00.000Z',
      })
    })

    it('INV-6: endedAt NULL이어도 success/failed는 처리로 집계', () => {
      const execs = getTestExecutions(db, 'user-1', RANGE_START, RANGE_END)
      const r = aggregateReport(execs)
      expect(r.uniqueInflow).toBe(3)
      expect(r.verifiedCount).toBe(3) // 3개 모두 처리로 잡혀야 함!
    })

    it('INV-3: endedAt NULL이어도 일별 유입 합산 정확', () => {
      const execs = getTestExecutions(db, 'user-1', RANGE_START, RANGE_END)
      const r = aggregateReport(execs)
      const trendInflowSum = r.dailyTrend.reduce((s, d) => s + d.inflow, 0)
      expect(trendInflowSum).toBe(r.uniqueInflow)
    })

    it('INV-4: endedAt NULL이어도 일별 처리 합산 정확', () => {
      const execs = getTestExecutions(db, 'user-1', RANGE_START, RANGE_END)
      const r = aggregateReport(execs)
      const trendVerifiedSum = r.dailyTrend.reduce((s, d) => s + d.verified, 0)
      expect(trendVerifiedSum).toBe(r.verifiedCount)
    })
  })

  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  // 케이스 7: 혼합 시나리오 (에이전트 + 사람 + 후정산 + 검증)
  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  describe('케이스 7: 전체 혼합 시나리오', () => {
    beforeEach(() => {
      // 프로젝트1: 에이전트 성공
      seedExecution(db, {
        id: 'ex-mix-1', projectId: 'proj-1', agentId: 'agent-1', issueIid: 60,
        issueTitle: '에이전트 성공', status: 'success',
        startedAt: '2026-04-08T01:00:00.000Z', endedAt: '2026-04-08T01:30:00.000Z',
        issueCreatedAt: '2026-04-08T00:50:00.000Z',
        verifyStartedAt: '2026-04-08T02:00:00.000Z', verifiedAt: '2026-04-08T02:15:00.000Z',
        verifierName: '검증자',
      })
      // 프로젝트1: 사람 작업 진행중
      seedExecution(db, {
        id: 'ex-mix-2', projectId: 'proj-1', agentId: null, issueIid: 61,
        issueTitle: '사람 진행중', status: 'assigned',
        startedAt: '2026-04-09T02:00:00.000Z',
        issueCreatedAt: '2026-04-09T01:30:00.000Z',
        assigneeType: 'user', userName: '관리자',
      })
      // 프로젝트2: 후정산 완료 3건
      seedExecution(db, {
        id: 'ex-mix-3', projectId: 'proj-2', agentId: null, issueIid: 70,
        issueTitle: '후정산 1', status: 'success',
        startedAt: '2026-04-10T06:00:00.000Z', endedAt: '2026-04-10T06:00:00.000Z',
        assigneeType: 'user', userName: 'koj',
      })
      seedExecution(db, {
        id: 'ex-mix-4', projectId: 'proj-2', agentId: null, issueIid: 71,
        issueTitle: '후정산 2', status: 'success',
        startedAt: '2026-04-10T06:00:01.000Z', endedAt: '2026-04-10T06:00:01.000Z',
        assigneeType: 'user', userName: 'koj',
      })
      seedExecution(db, {
        id: 'ex-mix-5', projectId: 'proj-2', agentId: null, issueIid: 72,
        issueTitle: '후정산 3', status: 'success',
        startedAt: '2026-04-10T06:00:02.000Z', endedAt: '2026-04-10T06:00:02.000Z',
        assigneeType: 'user', userName: 'koj',
      })
      // 프로젝트1: 에이전트 실패 후 재시도 성공
      seedExecution(db, {
        id: 'ex-mix-6a', projectId: 'proj-1', agentId: 'agent-1', issueIid: 62,
        issueTitle: '재시도 대상', status: 'failed',
        startedAt: '2026-04-11T03:00:00.000Z', endedAt: '2026-04-11T03:10:00.000Z',
        issueCreatedAt: '2026-04-11T02:50:00.000Z',
      })
      seedExecution(db, {
        id: 'ex-mix-6b', projectId: 'proj-1', agentId: 'agent-1', issueIid: 62,
        issueTitle: '재시도 대상', status: 'success',
        startedAt: '2026-04-11T04:00:00.000Z', endedAt: '2026-04-11T04:20:00.000Z',
        issueCreatedAt: '2026-04-11T02:50:00.000Z',
      })
    })

    it('INV-1: 전체 유입 >= 전체 처리', () => {
      const execs = getTestExecutions(db, 'user-1', RANGE_START, RANGE_END)
      const r = aggregateReport(execs)
      expect(r.uniqueInflow).toBeGreaterThanOrEqual(r.verifiedCount)
    })

    it('유입/처리 정확한 숫자', () => {
      const execs = getTestExecutions(db, 'user-1', RANGE_START, RANGE_END)
      const r = aggregateReport(execs)
      // 고유 이슈: #60, #61, #70, #71, #72, #62 = 6개
      expect(r.uniqueInflow).toBe(6)
      // 처리: #60(success+verified), #70,#71,#72(success), #62(success) = 5개
      // #61은 assigned → 미처리
      expect(r.verifiedCount).toBe(5)
      expect(r.runningCount).toBe(1) // #61 assigned
    })

    it('INV-3: 일별 유입 합산 = 전체 유입', () => {
      const execs = getTestExecutions(db, 'user-1', RANGE_START, RANGE_END)
      const r = aggregateReport(execs)
      const trendInflowSum = r.dailyTrend.reduce((s, d) => s + d.inflow, 0)
      expect(trendInflowSum).toBe(r.uniqueInflow)
    })

    it('INV-4: 일별 처리 합산 = 전체 처리', () => {
      const execs = getTestExecutions(db, 'user-1', RANGE_START, RANGE_END)
      const r = aggregateReport(execs)
      const trendVerifiedSum = r.dailyTrend.reduce((s, d) => s + d.verified, 0)
      expect(trendVerifiedSum).toBe(r.verifiedCount)
    })

    it('INV-5: 프로젝트별 tasks 합산 = 전체 tasks', () => {
      const execs = getTestExecutions(db, 'user-1', RANGE_START, RANGE_END)
      const r = aggregateReport(execs)
      const projTaskSum = r.byProject.reduce((s, p) => s + p.tasks, 0)
      expect(projTaskSum).toBe(r.totalTasks)
    })

    it('INV-5: 프로젝트별 고유이슈 합산 = 전체 유입', () => {
      const execs = getTestExecutions(db, 'user-1', RANGE_START, RANGE_END)
      const r = aggregateReport(execs)
      const projIssueSum = r.byProject.reduce((s, p) => s + p.uniqueIssues, 0)
      expect(projIssueSum).toBe(r.uniqueInflow)
    })

    it('INV-5: 프로젝트별 처리 합산 = 전체 처리', () => {
      const execs = getTestExecutions(db, 'user-1', RANGE_START, RANGE_END)
      const r = aggregateReport(execs)
      const projVerifiedSum = r.byProject.reduce((s, p) => s + p.verified, 0)
      expect(projVerifiedSum).toBe(r.verifiedCount)
    })

    it('totalTasks = successCount + failedCount + runningCount', () => {
      const execs = getTestExecutions(db, 'user-1', RANGE_START, RANGE_END)
      const r = aggregateReport(execs)
      expect(r.successCount + r.failedCount + r.runningCount).toBe(r.totalTasks)
    })
  })

  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  // 케이스 8: 빈 데이터
  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  describe('케이스 8: 빈 데이터', () => {
    it('데이터 없을 때 모든 값이 0', () => {
      const execs = getTestExecutions(db, 'user-1', RANGE_START, RANGE_END)
      const r = aggregateReport(execs)
      expect(r.totalTasks).toBe(0)
      expect(r.uniqueInflow).toBe(0)
      expect(r.verifiedCount).toBe(0)
      expect(r.dailyTrend).toHaveLength(0)
    })
  })

  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  // 케이스 9: updateExecutionStatus 방어
  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  describe('케이스 9: updateExecutionStatus ended_at 자동 채움', () => {
    it('success로 변경 시 endedAt 없으면 자동 생성', async () => {
      seedExecution(db, {
        id: 'ex-update-1', projectId: 'proj-1', agentId: 'agent-1', issueIid: 80,
        status: 'running', startedAt: '2026-04-08T01:00:00.000Z',
      })

      const { updateExecutionStatus } = await import('@/lib/db/executions')
      updateExecutionStatus('ex-update-1', 'success')

      const row = db.prepare('SELECT ended_at FROM task_executions WHERE id = ?').get('ex-update-1') as any
      expect(row.ended_at).not.toBeNull()
    })

    it('failed로 변경 시 endedAt 없으면 자동 생성', async () => {
      seedExecution(db, {
        id: 'ex-update-2', projectId: 'proj-1', agentId: 'agent-1', issueIid: 81,
        status: 'running', startedAt: '2026-04-08T01:00:00.000Z',
      })

      const { updateExecutionStatus } = await import('@/lib/db/executions')
      updateExecutionStatus('ex-update-2', 'failed')

      const row = db.prepare('SELECT ended_at FROM task_executions WHERE id = ?').get('ex-update-2') as any
      expect(row.ended_at).not.toBeNull()
    })
  })

  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  // 케이스 10: createExecution ended_at 저장 검증
  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  describe('케이스 10: createExecution ended_at 저장', () => {
    it('endedAt이 있는 execution 생성 시 DB에 반영', async () => {
      const { createExecution } = await import('@/lib/db/executions')
      createExecution({
        id: 'ex-create-1', projectId: 'proj-1', agentId: 'agent-1', issueIid: 90,
        issueTitle: '후정산 테스트', status: 'success',
        startedAt: '2026-04-08T01:00:00.000Z',
        endedAt: '2026-04-08T01:30:00.000Z',
        logPath: '', inputTokens: 0, outputTokens: 0, costUsd: 0, turns: 0,
      })

      const row = db.prepare('SELECT ended_at FROM task_executions WHERE id = ?').get('ex-create-1') as any
      expect(row.ended_at).toBe('2026-04-08T01:30:00.000Z')
    })

    it('endedAt이 없는 execution 생성 시 NULL', async () => {
      const { createExecution } = await import('@/lib/db/executions')
      createExecution({
        id: 'ex-create-2', projectId: 'proj-1', agentId: 'agent-1', issueIid: 91,
        status: 'running',
        startedAt: '2026-04-08T01:00:00.000Z',
        logPath: '', inputTokens: 0, outputTokens: 0, costUsd: 0, turns: 0,
      })

      const row = db.prepare('SELECT ended_at FROM task_executions WHERE id = ?').get('ex-create-2') as any
      expect(row.ended_at).toBeNull()
    })
  })
})
