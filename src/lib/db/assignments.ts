import { Agent, ProjectAssignment } from '@/types'
import { getDb } from './connection'

export function getProjectAssignments(projectId: string): (ProjectAssignment & { agent: Agent })[] {
  const rows = getDb().prepare(`
    SELECT pa.*, a.name as agent_name, a.avatar as agent_avatar, a.cli_name, a.cli_path, a.cli_version, a.model as agent_model, a.max_turns,
           a.status as agent_status, a.user_id, a.created_at as agent_created_at,
           a.snapshot_interval as a_snapshot_interval, a.sparkline_points as a_sparkline_points, a.stats_retention as a_stats_retention
    FROM project_assignments pa
    JOIN agents a ON pa.agent_id = a.id
    WHERE pa.project_id = ?
    ORDER BY pa.assigned_at ASC
  `).all(projectId) as any[]
  return rows.map(r => ({
    id: r.id, projectId: r.project_id, agentId: r.agent_id,
    accessToken: r.access_token || '', assignedAt: r.assigned_at,
    agent: {
      id: r.agent_id, userId: r.user_id, name: r.agent_name,
      avatar: r.agent_avatar || 'av-01',
      cliName: r.cli_name as Agent['cliName'], cliPath: r.cli_path,
      cliVersion: r.cli_version, modelName: r.agent_model || '',
      maxTurns: r.max_turns ?? 200,
      status: r.agent_status as Agent['status'],
      snapshotInterval: r.a_snapshot_interval ?? 1,
      sparklinePoints: r.a_sparkline_points ?? 60,
      statsRetention: r.a_stats_retention ?? 7,
      createdAt: r.agent_created_at,
    },
  }))
}

export function getAgentProjectId(agentId: string): string | null {
  const r = getDb().prepare('SELECT project_id FROM project_assignments WHERE agent_id = ?').get(agentId) as { project_id: string } | undefined
  return r?.project_id ?? null
}

export function getProjectAssignmentCounts(userId: string): Record<string, number> {
  const rows = getDb().prepare(`
    SELECT pa.project_id, COUNT(*) as cnt
    FROM project_assignments pa
    JOIN projects p ON p.id = pa.project_id
    WHERE p.user_id = ? OR EXISTS (SELECT 1 FROM project_shares ps WHERE ps.project_id = p.id AND ps.user_id = ?)
    GROUP BY pa.project_id
  `).all(userId, userId) as { project_id: string; cnt: number }[]
  const map: Record<string, number> = {}
  for (const r of rows) map[r.project_id] = r.cnt
  return map
}

export function getProjectAssignmentAgentIds(userId: string): Record<string, string[]> {
  const rows = getDb().prepare(`
    SELECT pa.project_id, pa.agent_id
    FROM project_assignments pa
    JOIN projects p ON p.id = pa.project_id
    WHERE p.user_id = ? OR EXISTS (SELECT 1 FROM project_shares ps WHERE ps.project_id = p.id AND ps.user_id = ?)
  `).all(userId, userId) as { project_id: string; agent_id: string }[]
  const map: Record<string, string[]> = {}
  for (const r of rows) {
    if (!map[r.project_id]) map[r.project_id] = []
    map[r.project_id].push(r.agent_id)
  }
  return map
}

export function getAgentAssignmentInfo(userId: string): Record<string, { projectId: string; projectName: string; status: string }> {
  const rows = getDb().prepare(`
    SELECT a.id as agent_id, pa.project_id, p.name as project_name, a.status
    FROM agents a
    LEFT JOIN project_assignments pa ON pa.agent_id = a.id
    LEFT JOIN projects p ON p.id = pa.project_id
    WHERE a.user_id = ?
  `).all(userId) as { agent_id: string; project_id: string | null; project_name: string | null; status: string }[]
  const map: Record<string, { projectId: string; projectName: string; status: string }> = {}
  for (const r of rows) {
    map[r.agent_id] = { projectId: r.project_id || '', projectName: r.project_name || '', status: r.status }
  }
  return map
}

export function assignAgentToProject(pa: ProjectAssignment) {
  getDb().prepare(
    'INSERT INTO project_assignments (id, project_id, agent_id, access_token, assigned_at) VALUES (?, ?, ?, ?, ?)'
  ).run(pa.id, pa.projectId, pa.agentId, pa.accessToken || '', pa.assignedAt)
}

export function updateAssignmentToken(projectId: string, agentId: string, accessToken: string) {
  getDb().prepare(
    'UPDATE project_assignments SET access_token = ? WHERE project_id = ? AND agent_id = ?'
  ).run(accessToken, projectId, agentId)
}

export function unassignAgentFromProject(projectId: string, agentId: string) {
  getDb().prepare('DELETE FROM project_assignments WHERE project_id = ? AND agent_id = ?').run(projectId, agentId)
}

export function countActiveExecutionsByProject(projectId: string): number {
  const r = getDb().prepare(
    "SELECT COUNT(*) as cnt FROM task_executions WHERE project_id = ? AND status IN ('running', 'assigned')"
  ).get(projectId) as { cnt: number }
  return r.cnt
}

export function countActiveExecutionsByAgent(agentId: string): number {
  const r = getDb().prepare(
    "SELECT COUNT(*) as cnt FROM task_executions WHERE agent_id = ? AND status = 'running'"
  ).get(agentId) as { cnt: number }
  return r.cnt
}

export function getLastCompletedAt(agentId: string): string | null {
  const r = getDb().prepare(
    "SELECT ended_at FROM task_executions WHERE agent_id = ? AND status IN ('success','failed') ORDER BY ended_at DESC LIMIT 1"
  ).get(agentId) as { ended_at: string } | undefined
  return r?.ended_at ?? null
}
