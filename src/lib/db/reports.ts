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
  confirmStartedAt: string | null
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
  workSec: number         // 툴 직접개발 확정 작업시간(초): ive-meta>/spend>0
  rateMultiplier: number  // 이 exec의 사람 비용에 적용할 단가 배수 — 그 프로젝트에서 그 역할을 한 사람의 배수 (기본 1)
}

/**
 * exec 1건의 사람 비용에 적용할 단가 배수.
 * 단가 배수는 「프로젝트 × 사람 × 역할」 값이다(프로젝트 화면 → 역할·단계 자동화 → 역할 탭에서 역할과 함께 정한다).
 * 역할은 실행 종류로 정한다: ex-verify = 검증, ex-confirm = 확인, 그 밖의 사람 실행(담당자 처리·툴 직접개발) = 처리.
 * 그 프로젝트 역할 명부에서 이 실행의 사람 줄을 찾지 못하면 종전 사람별 배수(users.rate_multiplier — 화면에서는 더 이상 바꾸지 않는다,
 * 이전 보고서 숫자를 지키기 위한 읽기 전용 값), 그것도 없으면 1.
 * 에이전트 exec 은 사람 비용이 0 이라 무의미하다.
 */
function resolveRowRateMultiplier(r: any): number {
  return r.role_multiplier ?? r.human_multiplier ?? 1
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
    confirmStartedAt: r.confirm_started_at ?? null,
    confirmedAt: r.confirmed_at ?? null,
    confirmerName: r.confirmer_name ?? null,
    confirmerAvatar: r.confirmer_avatar ?? null,
    confirmerUserId: r.confirmer_user_id ?? null,
    verifierName: r.verifier_name ?? null,
    verifierAvatar: r.verifier_user_avatar ?? r.verifier_avatar ?? null,
    verifierUsername: r.verifier_username ?? null,
    verifierUserId: r.verifier_user_id_resolved ?? null,
    assigneeType: r.assignee_type ?? 'agent',
    workSec: r.work_sec ?? 0,
    rateMultiplier: resolveRowRateMultiplier(r),
  }
}

const REPORT_EXEC_QUERY = `
  SELECT te.id, te.project_id, p.name as project_name, p.color as project_color, p.avatar_url as project_avatar_url, p.provider as project_provider,
         te.agent_id, a.name as agent_name, a.avatar as agent_avatar, a.cli_name,
         u.name as developer_name, a.user_id as developer_user_id,
         te.issue_iid, te.issue_title, te.status,
         te.started_at, te.ended_at, te.input_tokens, te.output_tokens, te.cache_read_input_tokens, te.cache_creation_input_tokens, te.cost_usd, te.turns,
         te.issue_created_at, te.model_name, te.verified_at, te.verify_started_at, te.rejected_at, te.work_sec,
         ist.confirm_started_at, ist.confirmed_at, ist.confirmer_name, ist.confirmer_avatar, ist.confirmer_user_id,
         te.assignee_type, te.user_id as te_user_id, te.user_name as te_user_name, te.user_avatar as te_user_avatar,
         te.verifier_name, te.verifier_avatar, te.verifier_username,
         COALESCE(te.verifier_user_id, vu.id) as verifier_user_id_resolved,
         vu.avatar as verifier_user_avatar,
         hu.rate_multiplier as human_multiplier,
         -- 그 프로젝트에서 그 역할을 한 사람의 단가 배수 (역할 명부의 사람 줄)
         --   사람 찾기: IVE 사용자의 Git(OAuth) id·Git username · 실행 행의 Git 사용자 id(담당자 처리) · 검증자 Git username · 툴 직접개발 작성자 이름
         CASE WHEN te.assignee_type = 'user' THEN (
           SELECT CASE WHEN te.id LIKE 'ex-verify-%' THEN m.rate_verify WHEN te.id LIKE 'ex-confirm-%' THEN m.rate_confirm ELSE m.rate_process END
           FROM project_role_members m
           WHERE m.project_id = te.project_id AND m.subject_type = 'user' AND (
                 (m.git_user_id IS NOT NULL AND (m.git_user_id = hu.oauth_user_id OR m.git_user_id = te.user_id))
              OR (p.provider = 'gitlab' AND hu.gitlab_username IS NOT NULL AND m.subject_id = hu.gitlab_username)
              OR (p.provider = 'github' AND hu.github_username IS NOT NULL AND m.subject_id = hu.github_username)
              OR (te.id LIKE 'ex-verify-%' AND te.verifier_username IS NOT NULL AND m.subject_id = te.verifier_username)
              OR (te.user_id IS NULL AND te.user_name IS NOT NULL AND (m.name = te.user_name OR m.subject_id = te.user_name)))
           LIMIT 1
         ) END as role_multiplier
  FROM task_executions te
  JOIN projects p ON p.id = te.project_id
  LEFT JOIN agents a ON a.id = te.agent_id
  LEFT JOIN users u ON u.id = a.user_id
  LEFT JOIN issue_stages ist ON ist.project_id = te.project_id AND ist.issue_iid = te.issue_iid
  LEFT JOIN users vu ON vu.id = COALESCE(te.verifier_user_id, (SELECT u2.id FROM users u2 WHERE u2.name = te.verifier_name LIMIT 1))
  LEFT JOIN users hu ON hu.id = te.user_id
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
