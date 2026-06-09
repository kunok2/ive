import {
  getDb, getAllProjects, getAgentsByUser,
  createSnapshot, cleanOldSnapshots, cleanOldExecutions, cleanOldActivityLogs,
  getSystemSetting, countPreferredIssuesByAgent
} from './db'
import { getKSTTodayStartISO } from './date-utils'

interface VerifierAggRow {
  username: string
  verifying: number
  verify_waiting: number
}

let collectorStarted = false

export function startStatsCollector() {
  if (collectorStarted) return
  collectorStarted = true

  // 1분마다 수집
  setInterval(() => {
    try {
      collectSnapshots()
    } catch (e) {
      console.warn('[StatsCollector] Error:', (e as Error).message)
    }
  }, 60 * 1000)

  // 1시간마다 오래된 데이터 정리
  setInterval(() => {
    try {
      const snapshotDays = Number(getSystemSetting('retention.snapshots_days')) || 7
      const execDays = Number(getSystemSetting('retention.executions_days')) || 365
      cleanOldSnapshots(snapshotDays)
      // stat_daily_summaries는 영구 보관 (적재량 적음, 연도별 히스토리 조회용)
      cleanOldExecutions(execDays)
      cleanOldActivityLogs(90)
    } catch (e) {
      console.warn('[StatsCollector] Cleanup error:', (e as Error).message)
    }
  }, 60 * 60 * 1000)

  console.log('[StatsCollector] Started')
}

function collectSnapshots() {
  const db = getDb()
  const now = new Date().toISOString()
  const todayStartISO = getKSTTodayStartISO()

  const projects = getAllProjects()

  for (const project of projects) {
    // 프로젝트별 running 수 (assigned 포함)
    const running = (db.prepare(
      "SELECT COUNT(*) as cnt FROM task_executions WHERE project_id = ? AND status IN ('running', 'assigned')"
    ).get(project.id) as { cnt: number }).cnt

    // 처리대기 / 검증대기 / 확인대기 — 모두 issue_stages 권위 소스에서 직접 집계.
    // projects 캐시 컬럼(lastScannedIssueCount/lastVerifyWaitingCount)은 스캔 주기에만
    // 갱신되어 GitLab에서 수동으로 라벨/단계를 바꾼 경우(task_execution 없는 전환)를
    // 즉시 반영하지 못한다. 프로젝트 카드(/api/projects/[id]/stats)와 동일하게
    // cached_stage 기준으로 세어 보고서와 카드의 대기 집계를 일치시킨다.
    const waitingRow = db.prepare(
      `SELECT
        SUM(CASE WHEN cached_stage = 'waiting' THEN 1 ELSE 0 END) as waiting,
        SUM(CASE WHEN cached_stage = 'verify_waiting' THEN 1 ELSE 0 END) as verify_waiting,
        SUM(CASE WHEN cached_stage = 'confirm_waiting' THEN 1 ELSE 0 END) as confirm_waiting
      FROM issue_stages WHERE project_id = ?`
    ).get(project.id) as { waiting: number | null; verify_waiting: number | null; confirm_waiting: number | null }
    const waiting = waitingRow.waiting ?? 0
    const verifyWaiting = waitingRow.verify_waiting ?? 0
    const confirmWaiting = waitingRow.confirm_waiting ?? 0

    // 금일 완료/실패 수, 토큰, 비용
    const todayStats = db.prepare(`
      SELECT
        COUNT(CASE WHEN status = 'success' THEN 1 END) as completed,
        COUNT(CASE WHEN status = 'failed' THEN 1 END) as failed,
        COALESCE(SUM(input_tokens + output_tokens), 0) as total_tokens,
        COALESCE(SUM(cost_usd), 0) as cost_usd
      FROM task_executions
      WHERE project_id = ? AND started_at >= ? AND status != 'running'
    `).get(project.id, todayStartISO) as { completed: number; failed: number; total_tokens: number; cost_usd: number }

    createSnapshot({
      id: `snap-p-${project.id}-${Date.now()}`,
      entityType: 'project',
      entityId: project.id,
      timestamp: now,
      running,
      waiting,
      verifyWaiting,
      confirmWaiting,
      completed: todayStats.completed,
      failed: todayStats.failed,
      totalTokens: todayStats.total_tokens,
      costUsd: todayStats.cost_usd,
    })
  }

  // 에이전트별 스냅샷 - 모든 사용자의 에이전트 조회
  const users = db.prepare('SELECT id FROM users').all() as { id: string }[]
  const seenAgents = new Set<string>()

  for (const user of users) {
    const agents = getAgentsByUser(user.id)
    for (const agent of agents) {
      if (seenAgents.has(agent.id)) continue
      seenAgents.add(agent.id)

      const running = (db.prepare(
        "SELECT COUNT(*) as cnt FROM task_executions WHERE agent_id = ? AND status = 'running'"
      ).get(agent.id) as { cnt: number }).cnt

      const todayStats = db.prepare(`
        SELECT
          COUNT(CASE WHEN status = 'success' THEN 1 END) as completed,
          COUNT(CASE WHEN status = 'failed' THEN 1 END) as failed,
          COALESCE(SUM(input_tokens + output_tokens), 0) as total_tokens,
          COALESCE(SUM(cost_usd), 0) as cost_usd
        FROM task_executions
        WHERE agent_id = ? AND started_at >= ? AND status != 'running'
      `).get(agent.id, todayStartISO) as { completed: number; failed: number; total_tokens: number; cost_usd: number }

      // 에이전트에 지정된 대기(preferred) 이슈 수
      const waiting = countPreferredIssuesByAgent(agent.id)

      createSnapshot({
        id: `snap-a-${agent.id}-${Date.now()}`,
        entityType: 'agent',
        entityId: agent.id,
        timestamp: now,
        running,
        waiting,
        verifyWaiting: 0, // 에이전트 단위에서는 검증대기 의미 없음
        confirmWaiting: 0, // 에이전트 단위에서는 확인대기 의미 없음
        completed: todayStats.completed,
        failed: todayStats.failed,
        totalTokens: todayStats.total_tokens,
        costUsd: todayStats.cost_usd,
      })
    }
  }

  // ── 검증자별 스냅샷 (Git assignee 기반) ──
  // issue_stages의 assignee_username 기준으로 현재 검증중/대기 집계 + 오늘 승인/반려
  try {
    const verifierRows = db.prepare(`
      SELECT
        assignee_username as username,
        SUM(CASE WHEN cached_stage = 'verifying' THEN 1 ELSE 0 END) as verifying,
        SUM(CASE WHEN cached_stage = 'verify_waiting' THEN 1 ELSE 0 END) as verify_waiting
      FROM issue_stages
      WHERE assignee_username IS NOT NULL AND cached_stage IN ('verifying', 'verify_waiting')
      GROUP BY assignee_username
    `).all() as VerifierAggRow[]

    // 최근 승인/반려 이력이 있는 검증자도 스냅샷에 포함 (대기가 0이더라도 추이 보존)
    const recentVerifiers = db.prepare(`
      SELECT DISTINCT verifier_username as username
      FROM task_executions
      WHERE verifier_username IS NOT NULL
        AND (verified_at >= ? OR rejected_at >= ?)
    `).all(todayStartISO, todayStartISO) as { username: string }[]

    const seenVerifiers = new Set<string>()
    for (const v of verifierRows) seenVerifiers.add(v.username)
    for (const v of recentVerifiers) seenVerifiers.add(v.username)

    for (const username of seenVerifiers) {
      const agg = verifierRows.find(r => r.username === username)
      const todayAgg = db.prepare(`
        SELECT
          COUNT(CASE WHEN verified_at IS NOT NULL AND verified_at >= ? THEN 1 END) as completed,
          COUNT(CASE WHEN rejected_at IS NOT NULL AND rejected_at >= ? THEN 1 END) as failed
        FROM task_executions
        WHERE verifier_username = ?
      `).get(todayStartISO, todayStartISO, username) as { completed: number; failed: number }

      createSnapshot({
        id: `snap-v-${username}-${Date.now()}`,
        entityType: 'verifier',
        entityId: username,
        timestamp: now,
        running: Number(agg?.verifying || 0),       // running → 검증중
        waiting: Number(agg?.verify_waiting || 0),  // waiting → 검증대기
        verifyWaiting: 0,
        confirmWaiting: 0,
        completed: todayAgg.completed,              // 오늘 승인
        failed: todayAgg.failed,                    // 오늘 반려
        totalTokens: 0,
        costUsd: 0,
      })
    }
  } catch (e) {
    console.warn('[StatsCollector] verifier snapshot error:', (e as Error).message)
  }
}
