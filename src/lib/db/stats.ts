import { StatSnapshot } from '@/types'
import { getDb } from './connection'

export function createSnapshot(s: StatSnapshot) {
  getDb().prepare(
    'INSERT INTO stat_snapshots (id, entity_type, entity_id, timestamp, running, waiting, verify_waiting, completed, failed, total_tokens, cost_usd) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)'
  ).run(s.id, s.entityType, s.entityId, s.timestamp, s.running, s.waiting, s.verifyWaiting, s.completed, s.failed, s.totalTokens, s.costUsd)
}

export function getSnapshots(entityType: 'project' | 'agent' | 'verifier', entityId: string, limit: number = 60): StatSnapshot[] {
  const rows = getDb().prepare(`
    SELECT * FROM stat_snapshots
    WHERE entity_type = ? AND entity_id = ?
    ORDER BY timestamp DESC
    LIMIT ?
  `).all(entityType, entityId, limit) as any[]
  return rows.map(r => ({
    id: r.id, entityType: r.entity_type, entityId: r.entity_id,
    timestamp: r.timestamp, running: r.running, waiting: r.waiting,
    verifyWaiting: r.verify_waiting ?? 0,
    completed: r.completed, failed: r.failed,
    totalTokens: r.total_tokens, costUsd: r.cost_usd,
  })).reverse()
}

export function getDailyAvgSnapshots(entityType: 'project' | 'agent' | 'verifier', entityId: string, limit: number = 60): StatSnapshot[] {
  const rows = getDb().prepare(`
    SELECT
      DATE(timestamp) as day,
      ROUND(AVG(running), 2) as running,
      ROUND(AVG(waiting), 2) as waiting,
      ROUND(AVG(verify_waiting), 2) as verify_waiting,
      ROUND(AVG(completed), 2) as completed,
      ROUND(AVG(failed), 2) as failed,
      ROUND(AVG(total_tokens), 2) as total_tokens,
      ROUND(AVG(cost_usd), 6) as cost_usd
    FROM stat_snapshots
    WHERE entity_type = ? AND entity_id = ?
    GROUP BY DATE(timestamp)
    ORDER BY day DESC
    LIMIT ?
  `).all(entityType, entityId, limit) as any[]
  return rows.map(r => ({
    id: `avg-${r.day}`, entityType, entityId,
    timestamp: r.day, running: r.running, waiting: r.waiting,
    verifyWaiting: r.verify_waiting ?? 0,
    completed: r.completed, failed: r.failed,
    totalTokens: r.total_tokens, costUsd: r.cost_usd,
  })).reverse()
}

export function getHourlyAvgSnapshots(entityType: 'project' | 'agent' | 'verifier', entityId: string, limit: number = 60): StatSnapshot[] {
  const rows = getDb().prepare(`
    SELECT
      STRFTIME('%Y-%m-%d %H:00', timestamp) as hour,
      ROUND(AVG(running), 2) as running,
      ROUND(AVG(waiting), 2) as waiting,
      ROUND(AVG(verify_waiting), 2) as verify_waiting,
      ROUND(AVG(completed), 2) as completed,
      ROUND(AVG(failed), 2) as failed,
      ROUND(AVG(total_tokens), 2) as total_tokens,
      ROUND(AVG(cost_usd), 6) as cost_usd
    FROM stat_snapshots
    WHERE entity_type = ? AND entity_id = ?
    GROUP BY STRFTIME('%Y-%m-%d %H', timestamp)
    ORDER BY hour DESC
    LIMIT ?
  `).all(entityType, entityId, limit) as any[]
  return rows.map(r => ({
    id: `havg-${r.hour}`, entityType, entityId,
    timestamp: r.hour, running: r.running, waiting: r.waiting,
    verifyWaiting: r.verify_waiting ?? 0,
    completed: r.completed, failed: r.failed,
    totalTokens: r.total_tokens, costUsd: r.cost_usd,
  })).reverse()
}

export function aggregateSnapshotsToDailySummaries() {
  const db = getDb()
  const rows = db.prepare(`
    SELECT
      entity_type, entity_id,
      DATE(timestamp, '+9 hours') as kst_date,
      ROUND(AVG(running), 2) as avg_running,
      ROUND(AVG(waiting), 2) as avg_waiting,
      ROUND(AVG(verify_waiting), 2) as avg_verify_waiting,
      ROUND(AVG(completed), 2) as avg_completed,
      ROUND(AVG(failed), 2) as avg_failed,
      ROUND(AVG(total_tokens), 2) as avg_total_tokens,
      ROUND(AVG(cost_usd), 6) as avg_cost_usd,
      COUNT(*) as sample_count
    FROM stat_snapshots
    GROUP BY entity_type, entity_id, DATE(timestamp, '+9 hours')
  `).all() as any[]

  const upsert = db.prepare(`
    INSERT INTO stat_daily_summaries (id, entity_type, entity_id, date, avg_running, avg_waiting, avg_verify_waiting, avg_completed, avg_failed, avg_total_tokens, avg_cost_usd, sample_count)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(entity_type, entity_id, date) DO UPDATE SET
      avg_running = excluded.avg_running, avg_waiting = excluded.avg_waiting,
      avg_verify_waiting = excluded.avg_verify_waiting,
      avg_completed = excluded.avg_completed, avg_failed = excluded.avg_failed,
      avg_total_tokens = excluded.avg_total_tokens, avg_cost_usd = excluded.avg_cost_usd,
      sample_count = excluded.sample_count
  `)

  const tx = db.transaction(() => {
    for (const r of rows) {
      upsert.run(
        `ds-${r.entity_type}-${r.entity_id}-${r.kst_date}`,
        r.entity_type, r.entity_id, r.kst_date,
        r.avg_running, r.avg_waiting, r.avg_verify_waiting,
        r.avg_completed, r.avg_failed,
        r.avg_total_tokens, r.avg_cost_usd, r.sample_count
      )
    }
  })
  tx()

  if (rows.length > 0) {
    console.log(`[Cleanup] Aggregated ${rows.length} snapshot groups into daily summaries`)
  }
}

// userId: null이면 전체(메일 보고서 등 글로벌 집계용), string이면 해당 사용자가 소유/공유받은 프로젝트만 집계
export function getDailyWaitingTrend(userId: string | null, startDate: string, endDate: string): {
  daily: { date: string; total: number; totalWaiting: number; totalVerifyWaiting: number; byProject: { projectId: string; projectName: string; projectColor: string; waiting: number; verifyWaiting: number }[] }[]
} {
  const db = getDb()
  const userScope = userId
    ? `(p.user_id = ? OR EXISTS (SELECT 1 FROM project_shares ps WHERE ps.project_id = p.id AND ps.user_id = ?))`
    : '1=1'
  const userArgs: string[] = userId ? [userId, userId] : []

  const projects = db.prepare(
    `SELECT p.id, p.name, p.color FROM projects p WHERE ${userScope}`
  ).all(...userArgs) as { id: string; name: string; color: string }[]
  const projectMap = new Map(projects.map(p => [p.id, { name: p.name, color: p.color }]))

  const summaryRows = db.prepare(`
    SELECT s.date as day, s.entity_id as project_id, s.avg_waiting, s.avg_verify_waiting
    FROM stat_daily_summaries s JOIN projects p ON p.id = s.entity_id
    WHERE s.entity_type = 'project' AND s.date >= ? AND s.date < ? AND ${userScope}
    ORDER BY day ASC
  `).all(startDate, endDate, ...userArgs) as { day: string; project_id: string; avg_waiting: number; avg_verify_waiting: number }[]

  const kstToday = new Date(Date.now() + 9 * 60 * 60 * 1000).toISOString().slice(0, 10)
  const snapshotRows = db.prepare(`
    SELECT DATE(s.timestamp, '+9 hours') as day, s.entity_id as project_id,
      ROUND(AVG(s.waiting)) as avg_waiting, ROUND(AVG(s.verify_waiting)) as avg_verify_waiting
    FROM stat_snapshots s JOIN projects p ON p.id = s.entity_id
    WHERE s.entity_type = 'project'
      AND DATE(s.timestamp, '+9 hours') >= ? AND DATE(s.timestamp, '+9 hours') < ? AND DATE(s.timestamp, '+9 hours') < ?
      AND ${userScope}
    GROUP BY DATE(s.timestamp, '+9 hours'), s.entity_id
    ORDER BY day ASC
  `).all(startDate, endDate, kstToday, ...userArgs) as { day: string; project_id: string; avg_waiting: number; avg_verify_waiting: number }[]

  const latestTodayRows = db.prepare(`
    SELECT s.entity_id as project_id, s.waiting, s.verify_waiting
    FROM stat_snapshots s
    INNER JOIN (
      SELECT entity_id, MAX(timestamp) as max_ts FROM stat_snapshots
      WHERE entity_type = 'project' AND DATE(timestamp, '+9 hours') = ? GROUP BY entity_id
    ) latest ON s.entity_id = latest.entity_id AND s.timestamp = latest.max_ts
    JOIN projects p ON p.id = s.entity_id
    WHERE s.entity_type = 'project' AND ${userScope}
  `).all(kstToday, ...userArgs) as { project_id: string; waiting: number; verify_waiting: number }[]

  const dayMap = new Map<string, Map<string, { waiting: number; verifyWaiting: number }>>()
  for (const r of summaryRows) {
    if (!dayMap.has(r.day)) dayMap.set(r.day, new Map())
    dayMap.get(r.day)!.set(r.project_id, { waiting: r.avg_waiting, verifyWaiting: r.avg_verify_waiting ?? 0 })
  }
  for (const r of snapshotRows) {
    if (!dayMap.has(r.day)) dayMap.set(r.day, new Map())
    dayMap.get(r.day)!.set(r.project_id, { waiting: r.avg_waiting, verifyWaiting: r.avg_verify_waiting ?? 0 })
  }
  if (latestTodayRows.length > 0 && kstToday >= startDate && kstToday < endDate) {
    if (!dayMap.has(kstToday)) dayMap.set(kstToday, new Map())
    for (const r of latestTodayRows) {
      dayMap.get(kstToday)!.set(r.project_id, { waiting: r.waiting, verifyWaiting: r.verify_waiting ?? 0 })
    }
  }

  const daily: { date: string; total: number; totalWaiting: number; totalVerifyWaiting: number; byProject: { projectId: string; projectName: string; projectColor: string; waiting: number; verifyWaiting: number }[] }[] = []
  const cur = new Date(startDate)
  const end = new Date(endDate)
  while (cur < end) {
    const dateStr = cur.toISOString().slice(0, 10)
    const projData = dayMap.get(dateStr)
    const byProject: { projectId: string; projectName: string; projectColor: string; waiting: number; verifyWaiting: number }[] = []
    let totalWaiting = 0, totalVerifyWaiting = 0
    for (const [pid, info] of projectMap) {
      const d = projData?.get(pid) ?? { waiting: 0, verifyWaiting: 0 }
      byProject.push({ projectId: pid, projectName: info.name, projectColor: info.color, waiting: d.waiting, verifyWaiting: d.verifyWaiting })
      totalWaiting += d.waiting; totalVerifyWaiting += d.verifyWaiting
    }
    byProject.sort((a, b) => a.projectName.localeCompare(b.projectName))
    daily.push({ date: dateStr, total: totalWaiting + totalVerifyWaiting, totalWaiting, totalVerifyWaiting, byProject })
    cur.setDate(cur.getDate() + 1)
  }
  return { daily }
}

// userId: null이면 전체, string이면 해당 사용자 소유 에이전트만 집계
export function getDailyWaitingTrendByAgent(userId: string | null, startDate: string, endDate: string): {
  daily: { date: string; total: number; byAgent: { agentId: string; agentName: string; agentAvatar: string; waiting: number }[] }[]
} {
  const db = getDb()
  const ownerScope = userId ? 'a.user_id = ?' : '1=1'
  const ownerArgs: string[] = userId ? [userId] : []

  const agents = db.prepare(
    `SELECT a.id, a.name, a.avatar FROM agents a WHERE ${ownerScope}`
  ).all(...ownerArgs) as { id: string; name: string; avatar: string }[]
  const agentMap = new Map(agents.map(a => [a.id, { name: a.name, avatar: a.avatar }]))

  const summaryRows = db.prepare(`
    SELECT s.date as day, s.entity_id as agent_id, s.avg_waiting
    FROM stat_daily_summaries s JOIN agents a ON a.id = s.entity_id
    WHERE s.entity_type = 'agent' AND s.date >= ? AND s.date < ? AND ${ownerScope}
    ORDER BY day ASC
  `).all(startDate, endDate, ...ownerArgs) as { day: string; agent_id: string; avg_waiting: number }[]

  const kstToday = new Date(Date.now() + 9 * 60 * 60 * 1000).toISOString().slice(0, 10)
  const snapshotRows = db.prepare(`
    SELECT DATE(s.timestamp, '+9 hours') as day, s.entity_id as agent_id, ROUND(AVG(s.waiting)) as avg_waiting
    FROM stat_snapshots s JOIN agents a ON a.id = s.entity_id
    WHERE s.entity_type = 'agent'
      AND DATE(s.timestamp, '+9 hours') >= ? AND DATE(s.timestamp, '+9 hours') < ? AND DATE(s.timestamp, '+9 hours') < ?
      AND ${ownerScope}
    GROUP BY DATE(s.timestamp, '+9 hours'), s.entity_id ORDER BY day ASC
  `).all(startDate, endDate, kstToday, ...ownerArgs) as { day: string; agent_id: string; avg_waiting: number }[]

  const latestTodayRows = db.prepare(`
    SELECT s.entity_id as agent_id, s.waiting
    FROM stat_snapshots s
    INNER JOIN (
      SELECT entity_id, MAX(timestamp) as max_ts FROM stat_snapshots
      WHERE entity_type = 'agent' AND DATE(timestamp, '+9 hours') = ? GROUP BY entity_id
    ) latest ON s.entity_id = latest.entity_id AND s.timestamp = latest.max_ts
    JOIN agents a ON a.id = s.entity_id
    WHERE s.entity_type = 'agent' AND ${ownerScope}
  `).all(kstToday, ...ownerArgs) as { agent_id: string; waiting: number }[]

  const dayMap = new Map<string, Map<string, number>>()
  for (const r of summaryRows) {
    if (!dayMap.has(r.day)) dayMap.set(r.day, new Map())
    dayMap.get(r.day)!.set(r.agent_id, r.avg_waiting)
  }
  for (const r of snapshotRows) {
    if (!dayMap.has(r.day)) dayMap.set(r.day, new Map())
    dayMap.get(r.day)!.set(r.agent_id, r.avg_waiting)
  }
  if (latestTodayRows.length > 0 && kstToday >= startDate && kstToday < endDate) {
    if (!dayMap.has(kstToday)) dayMap.set(kstToday, new Map())
    for (const r of latestTodayRows) { dayMap.get(kstToday)!.set(r.agent_id, r.waiting) }
  }

  const daily: { date: string; total: number; byAgent: { agentId: string; agentName: string; agentAvatar: string; waiting: number }[] }[] = []
  const cur = new Date(startDate)
  const end = new Date(endDate)
  while (cur < end) {
    const dateStr = cur.toISOString().slice(0, 10)
    const agentData = dayMap.get(dateStr)
    const byAgent: { agentId: string; agentName: string; agentAvatar: string; waiting: number }[] = []
    let total = 0
    for (const [aid, info] of agentMap) {
      const waiting = agentData?.get(aid) ?? 0
      byAgent.push({ agentId: aid, agentName: info.name, agentAvatar: info.avatar, waiting })
      total += waiting
    }
    byAgent.sort((a, b) => b.waiting - a.waiting)
    daily.push({ date: dateStr, total, byAgent })
    cur.setDate(cur.getDate() + 1)
  }
  return { daily }
}

export function cleanOldSnapshots(retentionDays: number = 7) {
  aggregateSnapshotsToDailySummaries()
  const cutoff = new Date(Date.now() - retentionDays * 86400000).toISOString()
  getDb().prepare('DELETE FROM stat_snapshots WHERE timestamp < ?').run(cutoff)
}

export function cleanOldExecutions(retentionDays: number = 30) {
  const fs = require('fs')
  const cutoff = new Date(Date.now() - retentionDays * 86400000).toISOString()
  const rows = getDb().prepare(
    "SELECT id, log_path FROM task_executions WHERE status != 'running' AND ended_at IS NOT NULL AND ended_at < ?"
  ).all(cutoff) as { id: string; log_path: string }[]

  let deletedLogs = 0
  for (const row of rows) {
    if (row.log_path) {
      try { fs.unlinkSync(row.log_path); deletedLogs++ } catch { /* already gone */ }
    }
  }

  const result = getDb().prepare(
    "DELETE FROM task_executions WHERE status != 'running' AND ended_at IS NOT NULL AND ended_at < ?"
  ).run(cutoff)

  if (rows.length > 0) {
    console.log(`[Cleanup] Purged ${result.changes} executions, ${deletedLogs} log files (retention: ${retentionDays}d)`)
  }
}
