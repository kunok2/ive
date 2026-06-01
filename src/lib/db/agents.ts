import { Agent, isAgentAvailableNow } from '@/types'
import { getDb } from './connection'
import { clearPreferredAgentRefs } from './issues'

function mapAgent(r: any): Agent {
  return {
    id: r.id, userId: r.user_id, name: r.name,
    avatar: r.avatar || 'av-01',
    cliName: r.cli_name as Agent['cliName'], cliPath: r.cli_path,
    cliVersion: r.cli_version, modelName: r.model || '',
    maxTurns: r.max_turns ?? 200,
    status: r.status as Agent['status'],
    snapshotInterval: r.snapshot_interval ?? 1,
    sparklinePoints: r.sparkline_points ?? 60,
    statsRetention: r.stats_retention ?? 7,
    enabled: r.enabled === undefined || r.enabled === null ? true : r.enabled !== 0,
    pausedUntil: r.paused_until ?? null,
    createdAt: r.created_at,
  }
}

export function getAgentsByUser(userId: string): Agent[] {
  const rows = getDb().prepare('SELECT * FROM agents WHERE user_id = ? ORDER BY created_at DESC').all(userId) as any[]
  return rows.map(mapAgent)
}

/**
 * 사용자의 에이전트 중 "지금 사용 가능한" 것만 (사용중지/예약중지 제외).
 * 에이전트 선택 시 사용중지를 빠뜨리지 않도록 모든 선택 지점이 이 함수를 쓴다.
 * (선택 정책 — 라운드로빈/CLI우선/first-free — 은 호출부가 이 결과 위에 얹는다.)
 */
export function getAvailableAgentsByUser(userId: string, now: number = Date.now()): Agent[] {
  return getAgentsByUser(userId).filter(a => isAgentAvailableNow(a, now))
}

export function getAgent(id: string): Agent | null {
  const r = getDb().prepare('SELECT * FROM agents WHERE id = ?').get(id) as any
  if (!r) return null
  return mapAgent(r)
}

/** 전체 에이전트 (관리자 선택용) */
export function getAllAgents(): Agent[] {
  const rows = getDb().prepare('SELECT * FROM agents ORDER BY created_at ASC').all() as any[]
  return rows.map(mapAgent)
}

export function createAgent(a: Agent) {
  getDb().prepare(
    'INSERT INTO agents (id, user_id, name, avatar, cli_name, cli_path, cli_version, model, max_turns, status, snapshot_interval, sparkline_points, stats_retention, enabled, paused_until, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)'
  ).run(a.id, a.userId, a.name, a.avatar || 'av-01', a.cliName, a.cliPath, a.cliVersion, a.modelName || '', a.maxTurns, a.status, a.snapshotInterval ?? 1, a.sparklinePoints ?? 60, a.statsRetention ?? 7, a.enabled === false ? 0 : 1, a.pausedUntil ?? null, a.createdAt)
}

export function updateAgent(a: Agent) {
  getDb().prepare(
    'UPDATE agents SET name = ?, avatar = ?, cli_name = ?, cli_path = ?, cli_version = ?, model = ?, max_turns = ?, status = ?, snapshot_interval = ?, sparkline_points = ?, stats_retention = ?, enabled = ?, paused_until = ? WHERE id = ? AND user_id = ?'
  ).run(a.name, a.avatar || 'av-01', a.cliName, a.cliPath, a.cliVersion, a.modelName || '', a.maxTurns, a.status, a.snapshotInterval ?? 1, a.sparklinePoints ?? 60, a.statsRetention ?? 7, a.enabled === false ? 0 : 1, a.pausedUntil ?? null, a.id, a.userId)
}

export function deleteAgent(id: string, userId: string) {
  clearPreferredAgentRefs(id)
  getDb().prepare('DELETE FROM agents WHERE id = ? AND user_id = ?').run(id, userId)
}

export function updateAgentStatus(id: string, status: Agent['status']) {
  getDb().prepare('UPDATE agents SET status = ? WHERE id = ?').run(status, id)
}
