import { getDb } from './connection'

export interface ChatSession {
  id: string
  projectId: string
  issueIid: number
  agentId: string | null
  executionId: string | null
  cliSessionId: string | null
  workspacePath: string | null
  status: 'active' | 'ended'
  createdAt: string
  lastActiveAt: string
}

export interface ChatMessage {
  id: string
  sessionId: string
  role: 'user' | 'assistant'
  content: string
  createdAt: string
}

function mapChatSession(r: any): ChatSession {
  return {
    id: r.id, projectId: r.project_id, issueIid: r.issue_iid,
    agentId: r.agent_id, executionId: r.execution_id ?? null,
    cliSessionId: r.cli_session_id ?? null, workspacePath: r.workspace_path,
    status: r.status, createdAt: r.created_at, lastActiveAt: r.last_active_at,
  }
}

function mapChatMessage(r: any): ChatMessage {
  return { id: r.id, sessionId: r.session_id, role: r.role, content: r.content, createdAt: r.created_at }
}

export function createChatSession(s: { id: string; projectId: string; issueIid: number; agentId?: string; executionId?: string; workspacePath?: string }) {
  const now = new Date().toISOString()
  getDb().prepare(`
    INSERT INTO chat_sessions (id, project_id, issue_iid, agent_id, execution_id, workspace_path, status, created_at, last_active_at)
    VALUES (?, ?, ?, ?, ?, ?, 'active', ?, ?)
  `).run(s.id, s.projectId, s.issueIid, s.agentId || null, s.executionId || null, s.workspacePath || null, now, now)
}

export function getAnyActiveChatSession(projectId: string): ChatSession | null {
  const r = getDb().prepare(
    "SELECT * FROM chat_sessions WHERE project_id = ? AND status = 'active' ORDER BY created_at DESC LIMIT 1"
  ).get(projectId) as any
  return r ? mapChatSession(r) : null
}

export function getActiveChatSession(projectId: string, issueIid: number): ChatSession | null {
  const r = getDb().prepare(
    "SELECT * FROM chat_sessions WHERE project_id = ? AND issue_iid = ? AND status = 'active' ORDER BY created_at DESC LIMIT 1"
  ).get(projectId, issueIid) as any
  return r ? mapChatSession(r) : null
}

export function getChatSession(id: string): ChatSession | null {
  const r = getDb().prepare('SELECT * FROM chat_sessions WHERE id = ?').get(id) as any
  return r ? mapChatSession(r) : null
}

export function updateChatSessionActivity(id: string) {
  getDb().prepare("UPDATE chat_sessions SET last_active_at = datetime('now') WHERE id = ?").run(id)
}

export function updateChatSessionAgent(id: string, agentId: string) {
  getDb().prepare("UPDATE chat_sessions SET agent_id = ? WHERE id = ?").run(agentId, id)
}

export function updateChatSessionWorkspace(id: string, workspacePath: string) {
  getDb().prepare("UPDATE chat_sessions SET workspace_path = ? WHERE id = ?").run(workspacePath, id)
}

export function updateChatSessionCliId(id: string, cliSessionId: string) {
  getDb().prepare("UPDATE chat_sessions SET cli_session_id = ? WHERE id = ?").run(cliSessionId, id)
}

export function endChatSession(id: string) {
  getDb().prepare("UPDATE chat_sessions SET status = 'ended', last_active_at = datetime('now') WHERE id = ?").run(id)
}

export function saveChatMessage(m: { id: string; sessionId: string; role: 'user' | 'assistant'; content: string }) {
  getDb().prepare(`
    INSERT INTO chat_messages (id, session_id, role, content, created_at)
    VALUES (?, ?, ?, ?, datetime('now'))
  `).run(m.id, m.sessionId, m.role, m.content)
  updateChatSessionActivity(m.sessionId)
}

export function getChatMessages(sessionId: string): ChatMessage[] {
  const rows = getDb().prepare('SELECT * FROM chat_messages WHERE session_id = ? ORDER BY created_at ASC').all(sessionId) as any[]
  return rows.map(mapChatMessage)
}

export function getLastEndedChatSession(projectId: string, issueIid: number): ChatSession | null {
  const r = getDb().prepare(
    "SELECT * FROM chat_sessions WHERE project_id = ? AND issue_iid = ? AND status = 'ended' ORDER BY last_active_at DESC LIMIT 1"
  ).get(projectId, issueIid) as any
  return r ? mapChatSession(r) : null
}

export function getChatHistoryForPrompt(sessionId: string): string {
  const msgs = getChatMessages(sessionId)
  if (msgs.length === 0) return ''
  return msgs.map(m => `**${m.role === 'user' ? '👤 User' : '🤖 AI'}**: ${m.content}`).join('\n\n')
}
