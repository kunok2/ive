import { ReportSchedule, ReportSendLog } from '@/types'
import { getDb } from './connection'
import { kstDateToUTCISO } from '../date-utils'

// ── Report Executions ──

export interface ReportExecution {
  id: string
  projectId: string
  projectName: string
  projectColor: string
  projectAvatarUrl: string
  projectProvider: string
  agentId: string
  agentName: string
  agentAvatar: string
  agentDeleted: boolean
  cliName: string
  developerName: string
  developerUserId: string | null
  userId: string | null
  userName: string | null
  userAvatar: string | null
  issueIid: number
  issueTitle: string | null
  status: string
  startedAt: string
  endedAt: string | null
  inputTokens: number
  outputTokens: number
  cacheReadInputTokens?: number
  cacheCreationInputTokens?: number
  costUsd: number
  turns: number
  issueCreatedAt: string | null
  verifiedAt: string | null
  verifyStartedAt: string | null
  rejectedAt: string | null
  confirmedAt: string | null
  confirmerName: string | null
  confirmerAvatar: string | null
  confirmerUserId: string | null
  modelName: string | null
  verifierName: string | null
  verifierAvatar: string | null
  verifierUsername: string | null
  verifierUserId: string | null
  assigneeType: string
}

function mapReportExecution(r: any): ReportExecution {
  return {
    id: r.id, projectId: r.project_id, projectName: r.project_name,
    projectColor: r.project_color, projectAvatarUrl: r.project_avatar_url || '', projectProvider: r.project_provider || 'gitlab',
    agentId: r.agent_id ?? '', agentName: r.agent_name ?? r.te_user_name ?? '', agentAvatar: r.agent_avatar || r.te_user_avatar || 'av-01',
    agentDeleted: !!r.agent_id && r.agent_name == null && r.te_user_name == null,
    cliName: r.cli_name ?? '', developerName: r.developer_name || r.agent_name || r.te_user_name || '',
    developerUserId: r.developer_user_id ?? null,
    userId: r.te_user_id ?? null,
    userName: r.te_user_name ?? null,
    userAvatar: r.te_user_avatar ?? null,
    issueIid: r.issue_iid, issueTitle: r.issue_title,
    status: r.status, startedAt: r.started_at, endedAt: r.ended_at,
    inputTokens: r.input_tokens ?? 0, outputTokens: r.output_tokens ?? 0,
    cacheReadInputTokens: r.cache_read_input_tokens ?? 0,
    cacheCreationInputTokens: r.cache_creation_input_tokens ?? 0,
    costUsd: r.cost_usd ?? 0, turns: r.turns ?? 0,
    issueCreatedAt: r.issue_created_at ?? null,
    modelName: r.model_name ?? null,
    verifiedAt: r.verified_at ?? null,
    verifyStartedAt: r.verify_started_at ?? null,
    rejectedAt: r.rejected_at ?? null,
    confirmedAt: r.confirmed_at ?? null,
    confirmerName: r.confirmer_name ?? null,
    confirmerAvatar: r.confirmer_avatar ?? null,
    confirmerUserId: r.confirmer_user_id ?? null,
    verifierName: r.verifier_name ?? null,
    verifierAvatar: r.verifier_user_avatar ?? r.verifier_avatar ?? null,
    verifierUsername: r.verifier_username ?? null,
    verifierUserId: r.verifier_user_id_resolved ?? null,
    assigneeType: r.assignee_type ?? 'agent',
  }
}

const REPORT_EXEC_QUERY = `
  SELECT te.id, te.project_id, p.name as project_name, p.color as project_color, p.avatar_url as project_avatar_url, p.provider as project_provider,
         te.agent_id, a.name as agent_name, a.avatar as agent_avatar, a.cli_name,
         u.name as developer_name, a.user_id as developer_user_id,
         te.issue_iid, te.issue_title, te.status,
         te.started_at, te.ended_at, te.input_tokens, te.output_tokens, te.cache_read_input_tokens, te.cache_creation_input_tokens, te.cost_usd, te.turns,
         te.issue_created_at, te.model_name, te.verified_at, te.verify_started_at, te.rejected_at,
         ist.confirmed_at, ist.confirmer_name, ist.confirmer_avatar, ist.confirmer_user_id,
         te.assignee_type, te.user_id as te_user_id, te.user_name as te_user_name, te.user_avatar as te_user_avatar,
         te.verifier_name, te.verifier_avatar, te.verifier_username,
         COALESCE(te.verifier_user_id, vu.id) as verifier_user_id_resolved,
         vu.avatar as verifier_user_avatar
  FROM task_executions te
  JOIN projects p ON p.id = te.project_id
  LEFT JOIN agents a ON a.id = te.agent_id
  LEFT JOIN users u ON u.id = a.user_id
  LEFT JOIN issue_stages ist ON ist.project_id = te.project_id AND ist.issue_iid = te.issue_iid
  LEFT JOIN users vu ON vu.id = te.verifier_user_id OR (te.verifier_user_id IS NULL AND vu.name = te.verifier_name)
`

export function getExecutionsInRange(userId: string, start: string, end: string): ReportExecution[] {
  const startISO = kstDateToUTCISO(start)
  const endISO = kstDateToUTCISO(end)
  const rows = getDb().prepare(`
    ${REPORT_EXEC_QUERY}
    WHERE (p.user_id = ? OR EXISTS (SELECT 1 FROM project_shares ps WHERE ps.project_id = p.id AND ps.user_id = ?))
      AND te.started_at >= ? AND te.started_at < ?
    ORDER BY te.started_at ASC
  `).all(userId, userId, startISO, endISO) as any[]
  return rows.map(mapReportExecution)
}

/**
 * 보고 기간 내 execution이 있는 이슈들의 전체 기간 최초 started_at 을 조회.
 * 보고서 '유입' 카운팅에서 기간 내 첫 exec 을 유입일로 잘못 보는 버그를 막기 위함 —
 * 지난주에 시작된 이슈가 이번주에 retry된 경우 이번주 유입으로 둔갑하지 않도록.
 */
export function getGlobalFirstStartedAt(
  userId: string,
  issueKeys: { projectId: string; issueIid: number }[]
): Map<string, string> {
  const map = new Map<string, string>()
  if (issueKeys.length === 0) return map
  // 권한 검증을 위해 projectId 별로 조회
  const projectIds = Array.from(new Set(issueKeys.map(k => k.projectId)))
  for (const projectId of projectIds) {
    const iids = issueKeys.filter(k => k.projectId === projectId).map(k => k.issueIid)
    if (iids.length === 0) continue
    const placeholders = iids.map(() => '?').join(',')
    const rows = getDb().prepare(`
      SELECT te.issue_iid, MIN(te.started_at) as first_start
      FROM task_executions te
      JOIN projects p ON p.id = te.project_id
      WHERE te.project_id = ?
        AND te.issue_iid IN (${placeholders})
        AND (p.user_id = ? OR EXISTS (SELECT 1 FROM project_shares ps WHERE ps.project_id = p.id AND ps.user_id = ?))
      GROUP BY te.issue_iid
    `).all(projectId, ...iids, userId, userId) as any[]
    for (const r of rows) {
      map.set(`${projectId}:${r.issue_iid}`, r.first_start as string)
    }
  }
  return map
}

export function getGlobalExecutionsInRange(start: string, end: string): ReportExecution[] {
  const startISO = kstDateToUTCISO(start)
  const endISO = kstDateToUTCISO(end)
  const rows = getDb().prepare(`
    ${REPORT_EXEC_QUERY}
    WHERE te.started_at >= ? AND te.started_at < ?
    ORDER BY te.started_at ASC
  `).all(startISO, endISO) as any[]
  return rows.map(mapReportExecution)
}

// ── Report Schedules ──

function mapReportSchedule(r: any): ReportSchedule {
  return {
    id: r.id, reportType: r.report_type, enabled: !!r.enabled,
    recipients: JSON.parse(r.recipients || '[]'),
    sendHour: r.send_hour ?? 9,
    createdAt: r.created_at, updatedAt: r.updated_at,
  }
}

export function getAllReportSchedules(): ReportSchedule[] {
  return (getDb().prepare('SELECT * FROM report_schedules ORDER BY report_type ASC').all() as any[]).map(mapReportSchedule)
}

export function getReportSchedule(id: string): ReportSchedule | null {
  const r = getDb().prepare('SELECT * FROM report_schedules WHERE id = ?').get(id) as any
  return r ? mapReportSchedule(r) : null
}

export function getReportScheduleByType(reportType: string): ReportSchedule | null {
  const r = getDb().prepare('SELECT * FROM report_schedules WHERE report_type = ?').get(reportType) as any
  return r ? mapReportSchedule(r) : null
}

export function upsertReportSchedule(s: ReportSchedule) {
  const sendHour = s.sendHour ?? 9
  getDb().prepare(`
    INSERT INTO report_schedules (id, report_type, enabled, recipients, send_day, send_hour, created_at, updated_at)
    VALUES (?, ?, ?, ?, 1, ?, ?, datetime('now'))
    ON CONFLICT(id) DO UPDATE SET
      enabled = excluded.enabled, recipients = excluded.recipients,
      send_hour = excluded.send_hour, updated_at = datetime('now')
  `).run(s.id, s.reportType, s.enabled ? 1 : 0, JSON.stringify(s.recipients), sendHour, s.createdAt || new Date().toISOString())
}

export function deleteReportSchedule(id: string) {
  getDb().prepare('DELETE FROM report_schedules WHERE id = ?').run(id)
}

// ── Report Send Logs ──

function mapReportSendLog(r: any): ReportSendLog {
  return {
    id: r.id, scheduleId: r.schedule_id, reportType: r.report_type,
    periodStart: r.period_start, periodEnd: r.period_end,
    recipientEmail: r.recipient_email, status: r.status,
    errorMessage: r.error_message, sentAt: r.sent_at,
  }
}

export function createReportSendLog(log: ReportSendLog) {
  getDb().prepare(
    'INSERT INTO report_send_logs (id, schedule_id, report_type, period_start, period_end, recipient_email, status, error_message, sent_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)'
  ).run(log.id, log.scheduleId, log.reportType, log.periodStart, log.periodEnd, log.recipientEmail, log.status, log.errorMessage || null, log.sentAt)
}

export function getReportSendLogs(limit: number = 50, offset: number = 0): ReportSendLog[] {
  return (getDb().prepare('SELECT * FROM report_send_logs ORDER BY sent_at DESC LIMIT ? OFFSET ?').all(limit, offset) as any[]).map(mapReportSendLog)
}

export function getReportSendLogCount(): number {
  return (getDb().prepare('SELECT COUNT(*) as cnt FROM report_send_logs').get() as { cnt: number }).cnt
}

export function hasAlreadySent(scheduleId: string, periodStart: string, periodEnd: string, recipientEmail: string): boolean {
  const r = getDb().prepare(
    "SELECT id FROM report_send_logs WHERE schedule_id = ? AND period_start = ? AND period_end = ? AND recipient_email = ? AND status = 'success' LIMIT 1"
  ).get(scheduleId, periodStart, periodEnd, recipientEmail)
  return !!r
}
