import { SlackWorkspace, SlackChannelConfig, SlackThreadSession, SlackUserMap } from '@/types'
import { getDb } from './connection'

// ── Workspaces ──

function mapWorkspace(r: any): SlackWorkspace {
  return {
    id: r.id,
    teamId: r.team_id,
    teamName: r.team_name || '',
    name: r.name || '',
    botUserId: r.bot_user_id || '',
    defaultUserId: r.default_user_id ?? null,
    enabled: r.enabled === 1,
    createdAt: r.created_at,
  }
}

/** 워크스페이스 목록 (토큰 제외, UI/관리용) */
export function getAllSlackWorkspaces(): SlackWorkspace[] {
  const rows = getDb().prepare('SELECT * FROM slack_workspaces ORDER BY created_at ASC').all() as any[]
  return rows.map(mapWorkspace)
}

export function getSlackWorkspace(id: string): SlackWorkspace | null {
  const r = getDb().prepare('SELECT * FROM slack_workspaces WHERE id = ?').get(id) as any
  return r ? mapWorkspace(r) : null
}

/** team_id(Slack 워크스페이스 ID)로 조회 — 이벤트 라우팅용 */
export function getSlackWorkspaceByTeamId(teamId: string): SlackWorkspace | null {
  const r = getDb().prepare('SELECT * FROM slack_workspaces WHERE team_id = ?').get(teamId) as any
  return r ? mapWorkspace(r) : null
}

/** 암호화된 원본 토큰까지 포함한 행 (서명검증·API 호출용). decrypt는 호출 측 책임. */
export function getSlackWorkspaceRaw(teamId: string): { id: string; team_id: string; bot_token: string; signing_secret: string; bot_user_id: string; default_user_id: string | null; enabled: number } | null {
  return getDb().prepare('SELECT * FROM slack_workspaces WHERE team_id = ?').get(teamId) as any ?? null
}

export function getSlackWorkspaceRawById(id: string): { id: string; team_id: string; bot_token: string; signing_secret: string; bot_user_id: string; default_user_id: string | null; enabled: number } | null {
  return getDb().prepare('SELECT * FROM slack_workspaces WHERE id = ?').get(id) as any ?? null
}

export function createSlackWorkspace(w: {
  id: string; teamId: string; teamName: string; name: string;
  botTokenEncrypted: string; signingSecretEncrypted: string; botUserId: string;
  defaultUserId?: string | null; enabled?: boolean
}) {
  getDb().prepare(`
    INSERT INTO slack_workspaces (id, team_id, team_name, name, bot_token, signing_secret, bot_user_id, default_user_id, enabled)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    w.id, w.teamId, w.teamName, w.name, w.botTokenEncrypted, w.signingSecretEncrypted,
    w.botUserId, w.defaultUserId ?? null, w.enabled === false ? 0 : 1
  )
}

export function updateSlackWorkspace(id: string, patch: {
  teamId?: string; teamName?: string; name?: string;
  botTokenEncrypted?: string; signingSecretEncrypted?: string; botUserId?: string;
  defaultUserId?: string | null; enabled?: boolean
}) {
  const fields: string[] = []
  const values: any[] = []
  if (patch.teamId !== undefined) { fields.push('team_id = ?'); values.push(patch.teamId) }
  if (patch.teamName !== undefined) { fields.push('team_name = ?'); values.push(patch.teamName) }
  if (patch.name !== undefined) { fields.push('name = ?'); values.push(patch.name) }
  if (patch.botTokenEncrypted !== undefined) { fields.push('bot_token = ?'); values.push(patch.botTokenEncrypted) }
  if (patch.signingSecretEncrypted !== undefined) { fields.push('signing_secret = ?'); values.push(patch.signingSecretEncrypted) }
  if (patch.botUserId !== undefined) { fields.push('bot_user_id = ?'); values.push(patch.botUserId) }
  if (patch.defaultUserId !== undefined) { fields.push('default_user_id = ?'); values.push(patch.defaultUserId) }
  if (patch.enabled !== undefined) { fields.push('enabled = ?'); values.push(patch.enabled ? 1 : 0) }
  if (fields.length === 0) return
  values.push(id)
  getDb().prepare(`UPDATE slack_workspaces SET ${fields.join(', ')} WHERE id = ?`).run(...values)
}

export function deleteSlackWorkspace(id: string) {
  const ws = getSlackWorkspace(id)
  getDb().prepare('DELETE FROM slack_workspaces WHERE id = ?').run(id)
  if (ws) {
    getDb().prepare('DELETE FROM slack_channel_config WHERE workspace_id = ?').run(id)
    getDb().prepare('DELETE FROM slack_thread_session WHERE workspace_id = ?').run(id)
    getDb().prepare('DELETE FROM slack_user_map WHERE workspace_id = ?').run(id)
  }
}

// ── Channel config (채널 ↔ 프로젝트) ──

function mapChannelConfig(r: any): SlackChannelConfig {
  return {
    workspaceId: r.workspace_id,
    channelId: r.channel_id,
    channelName: r.channel_name ?? null,
    projectId: r.project_id ?? null,
    iveUserId: r.ive_user_id ?? null,
    updatedAt: r.updated_at,
  }
}

export function getSlackChannelConfig(workspaceId: string, channelId: string): SlackChannelConfig | null {
  const r = getDb().prepare('SELECT * FROM slack_channel_config WHERE workspace_id = ? AND channel_id = ?').get(workspaceId, channelId) as any
  return r ? mapChannelConfig(r) : null
}

export function getSlackChannelConfigsByWorkspace(workspaceId: string): SlackChannelConfig[] {
  const rows = getDb().prepare('SELECT * FROM slack_channel_config WHERE workspace_id = ? ORDER BY updated_at DESC').all(workspaceId) as any[]
  return rows.map(mapChannelConfig)
}

export function upsertSlackChannelConfig(c: { workspaceId: string; channelId: string; channelName?: string | null; projectId?: string | null; iveUserId?: string | null }) {
  getDb().prepare(`
    INSERT INTO slack_channel_config (workspace_id, channel_id, channel_name, project_id, ive_user_id, updated_at)
    VALUES (?, ?, ?, ?, ?, datetime('now'))
    ON CONFLICT(workspace_id, channel_id) DO UPDATE SET
      channel_name = excluded.channel_name,
      project_id = excluded.project_id,
      ive_user_id = excluded.ive_user_id,
      updated_at = excluded.updated_at
  `).run(c.workspaceId, c.channelId, c.channelName ?? null, c.projectId ?? null, c.iveUserId ?? null)
}

// ── Thread session (스레드 ↔ 이슈) ──

function mapThreadSession(r: any): SlackThreadSession {
  return {
    workspaceId: r.workspace_id,
    channelId: r.channel_id,
    threadTs: r.thread_ts,
    issueIid: r.issue_iid ?? null,
    cliSessionId: r.cli_session_id ?? null,
    updatedAt: r.updated_at,
  }
}

export function getSlackThreadSession(workspaceId: string, channelId: string, threadTs: string): SlackThreadSession | null {
  const r = getDb().prepare('SELECT * FROM slack_thread_session WHERE workspace_id = ? AND channel_id = ? AND thread_ts = ?').get(workspaceId, channelId, threadTs) as any
  return r ? mapThreadSession(r) : null
}

export function createSlackThreadSession(s: { workspaceId: string; channelId: string; threadTs: string; issueIid?: number | null }) {
  getDb().prepare(`
    INSERT INTO slack_thread_session (workspace_id, channel_id, thread_ts, issue_iid, updated_at)
    VALUES (?, ?, ?, ?, datetime('now'))
    ON CONFLICT(workspace_id, channel_id, thread_ts) DO UPDATE SET
      issue_iid = excluded.issue_iid, updated_at = excluded.updated_at
  `).run(s.workspaceId, s.channelId, s.threadTs, s.issueIid ?? null)
}

export function updateSlackThreadCliSession(workspaceId: string, channelId: string, threadTs: string, cliSessionId: string) {
  getDb().prepare(`
    UPDATE slack_thread_session SET cli_session_id = ?, updated_at = datetime('now')
    WHERE workspace_id = ? AND channel_id = ? AND thread_ts = ?
  `).run(cliSessionId, workspaceId, channelId, threadTs)
}

// ── User mapping (Slack 유저 ↔ IVE 유저) ──

function mapUserMap(r: any): SlackUserMap {
  return { workspaceId: r.workspace_id, slackUserId: r.slack_user_id, iveUserId: r.ive_user_id }
}

export function getSlackUserMap(workspaceId: string, slackUserId: string): SlackUserMap | null {
  const r = getDb().prepare('SELECT * FROM slack_user_map WHERE workspace_id = ? AND slack_user_id = ?').get(workspaceId, slackUserId) as any
  return r ? mapUserMap(r) : null
}

export function getSlackUserMapsByWorkspace(workspaceId: string): SlackUserMap[] {
  const rows = getDb().prepare('SELECT * FROM slack_user_map WHERE workspace_id = ?').all(workspaceId) as any[]
  return rows.map(mapUserMap)
}

export function upsertSlackUserMap(m: { workspaceId: string; slackUserId: string; iveUserId: string }) {
  getDb().prepare(`
    INSERT INTO slack_user_map (workspace_id, slack_user_id, ive_user_id)
    VALUES (?, ?, ?)
    ON CONFLICT(workspace_id, slack_user_id) DO UPDATE SET ive_user_id = excluded.ive_user_id
  `).run(m.workspaceId, m.slackUserId, m.iveUserId)
}

export function deleteSlackUserMap(workspaceId: string, slackUserId: string) {
  getDb().prepare('DELETE FROM slack_user_map WHERE workspace_id = ? AND slack_user_id = ?').run(workspaceId, slackUserId)
}
