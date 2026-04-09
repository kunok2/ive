import {
  getDb, getAllProjects, getAgentsByUser,
  createSnapshot, cleanOldSnapshots, cleanOldExecutions, cleanOldActivityLogs,
  getSystemSetting, countPreferredIssuesByAgent
} from './db'
import { getKSTTodayStartISO } from './date-utils'

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

    // 대기 이슈 수 (마지막 스캔 결과)
    const waiting = project.lastScannedIssueCount ?? 0

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
        completed: todayStats.completed,
        failed: todayStats.failed,
        totalTokens: todayStats.total_tokens,
        costUsd: todayStats.cost_usd,
      })
    }
  }
}
