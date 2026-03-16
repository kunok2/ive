import Database from 'better-sqlite3'
import path from 'path'
import bcrypt from 'bcryptjs'
import { User, Project, Agent, ProjectAssignment, TaskExecution, TaskStatus, StatSnapshot } from '@/types'
import { startScanner } from './scanner'

declare global {
  var db: Database.Database | undefined;
}

export function getDb() {
  if (!global.db) {
    const dbPath = path.join(process.cwd(), 'data', 'spring-ive.db')
    const db = new Database(dbPath)
    db.pragma('foreign_keys = ON')
    initSchema(db)
    global.db = db

    if (process.env.NODE_ENV !== 'test') {
      startScanner();
    }
  }
  return global.db
}

function initSchema(db: Database.Database) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS users (
      id TEXT PRIMARY KEY,
      email TEXT UNIQUE NOT NULL,
      password TEXT NOT NULL,
      name TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS projects (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL,
      name TEXT NOT NULL,
      provider TEXT NOT NULL CHECK(provider IN ('github', 'gitlab')),
      repo_url TEXT NOT NULL,
      access_token TEXT NOT NULL,
      color TEXT NOT NULL DEFAULT '#4ade80',
      label_target TEXT NOT NULL DEFAULT 'IVE',
      label_in_progress TEXT NOT NULL DEFAULT 'IVE(D)',
      label_fail_dev TEXT NOT NULL DEFAULT 'IVE(DF)',
      label_validation TEXT NOT NULL DEFAULT 'IVE(V)',
      label_fail_val TEXT NOT NULL DEFAULT 'IVE(VF)',
      label_done TEXT NOT NULL DEFAULT 'IVE(E)',
      check_interval INTEGER NOT NULL DEFAULT 10,
      last_checked_at TEXT,
      last_scanned_issue_count INTEGER,
      scanner_active INTEGER NOT NULL DEFAULT 1,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS agents (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL,
      name TEXT NOT NULL,
      cli_name TEXT NOT NULL CHECK(cli_name IN ('claude', 'gemini', 'codex')),
      cli_path TEXT NOT NULL,
      cli_version TEXT NOT NULL DEFAULT '',
      max_turns INTEGER NOT NULL DEFAULT 200,
      status TEXT NOT NULL DEFAULT 'available' CHECK(status IN ('available', 'busy', 'offline')),
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS project_assignments (
      id TEXT PRIMARY KEY,
      project_id TEXT NOT NULL,
      agent_id TEXT NOT NULL,
      assigned_at TEXT NOT NULL DEFAULT (datetime('now')),
      FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE,
      FOREIGN KEY (agent_id) REFERENCES agents(id) ON DELETE CASCADE,
      UNIQUE(project_id, agent_id)
    );

    CREATE TABLE IF NOT EXISTS task_executions (
      id TEXT PRIMARY KEY,
      project_id TEXT NOT NULL,
      agent_id TEXT NOT NULL,
      issue_iid INTEGER NOT NULL,
      status TEXT NOT NULL CHECK(status IN ('running', 'success', 'failed')),
      started_at TEXT NOT NULL DEFAULT (datetime('now')),
      ended_at TEXT,
      log_path TEXT NOT NULL,
      FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE,
      FOREIGN KEY (agent_id) REFERENCES agents(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS stat_snapshots (
      id TEXT PRIMARY KEY,
      entity_type TEXT NOT NULL CHECK(entity_type IN ('project', 'agent')),
      entity_id TEXT NOT NULL,
      timestamp TEXT NOT NULL,
      running INTEGER NOT NULL DEFAULT 0,
      waiting INTEGER NOT NULL DEFAULT 0,
      completed INTEGER NOT NULL DEFAULT 0,
      failed INTEGER NOT NULL DEFAULT 0,
      total_tokens INTEGER NOT NULL DEFAULT 0,
      cost_usd REAL NOT NULL DEFAULT 0
    );
    CREATE INDEX IF NOT EXISTS idx_stat_snapshots_entity ON stat_snapshots(entity_type, entity_id, timestamp);

    -- 레거시 테이블 유지 (데이터 보존, 참조하지 않음)
    CREATE TABLE IF NOT EXISTS roles (
      id TEXT PRIMARY KEY,
      project_id TEXT NOT NULL,
      name TEXT NOT NULL,
      category TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'idle',
      access_token TEXT,
      max_agents INTEGER NOT NULL DEFAULT 1,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE TABLE IF NOT EXISTS role_assignments (
      id TEXT PRIMARY KEY,
      role_id TEXT NOT NULL,
      agent_id TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'active',
      assigned_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
  `)

  // Migrations
  try {
    const tableInfo = db.prepare("PRAGMA table_info(projects)").all() as any[]
    if (!tableInfo.some((col: any) => col.name === 'access_token')) {
      db.exec("ALTER TABLE projects ADD COLUMN access_token TEXT NOT NULL DEFAULT ''")
    }
    if (!tableInfo.some((col: any) => col.name === 'label_target')) {
      db.exec("ALTER TABLE projects ADD COLUMN label_target TEXT NOT NULL DEFAULT 'IVE'")
      db.exec("ALTER TABLE projects ADD COLUMN label_in_progress TEXT NOT NULL DEFAULT 'IVE(D)'")
      db.exec("ALTER TABLE projects ADD COLUMN label_fail_dev TEXT NOT NULL DEFAULT 'IVE(DF)'")
      db.exec("ALTER TABLE projects ADD COLUMN label_validation TEXT NOT NULL DEFAULT 'IVE(V)'")
      db.exec("ALTER TABLE projects ADD COLUMN label_fail_val TEXT NOT NULL DEFAULT 'IVE(VF)'")
      db.exec("ALTER TABLE projects ADD COLUMN label_done TEXT NOT NULL DEFAULT 'IVE(E)'")
    } else if (!tableInfo.some((col: any) => col.name === 'label_fail_dev')) {
      db.exec("ALTER TABLE projects ADD COLUMN label_fail_dev TEXT NOT NULL DEFAULT 'IVE(DF)'")
      db.exec("ALTER TABLE projects ADD COLUMN label_fail_val TEXT NOT NULL DEFAULT 'IVE(VF)'")
    }
    if (!tableInfo.some((col: any) => col.name === 'color')) {
      db.exec("ALTER TABLE projects ADD COLUMN color TEXT NOT NULL DEFAULT '#4ade80'")
    }
    if (!tableInfo.some((col: any) => col.name === 'check_interval')) {
      db.exec("ALTER TABLE projects ADD COLUMN check_interval INTEGER NOT NULL DEFAULT 10")
    }
    if (!tableInfo.some((col: any) => col.name === 'last_checked_at')) {
      db.exec("ALTER TABLE projects ADD COLUMN last_checked_at TEXT")
    }
    if (!tableInfo.some((col: any) => col.name === 'last_scanned_issue_count')) {
      db.exec("ALTER TABLE projects ADD COLUMN last_scanned_issue_count INTEGER")
    }
    if (!tableInfo.some((col: any) => col.name === 'scanner_active')) {
      db.exec("ALTER TABLE projects ADD COLUMN scanner_active INTEGER NOT NULL DEFAULT 1")
    }
    if (!tableInfo.some((col: any) => col.name === 'last_error')) {
      db.exec("ALTER TABLE projects ADD COLUMN last_error TEXT")
      db.exec("ALTER TABLE projects ADD COLUMN last_error_at TEXT")
    }
    if (!tableInfo.some((col: any) => col.name === 'sort_order')) {
      db.exec("ALTER TABLE projects ADD COLUMN sort_order INTEGER NOT NULL DEFAULT 0")
      // 기존 프로젝트에 순서 부여
      const rows = db.prepare("SELECT id FROM projects ORDER BY created_at ASC").all() as { id: string }[]
      rows.forEach((r, i) => db.prepare("UPDATE projects SET sort_order = ? WHERE id = ?").run(i, r.id))
    }
  } catch (e) { console.error("Migration failed for projects:", e) }

  try {
    const tableInfo = db.prepare("PRAGMA table_info(agents)").all() as any[]
    if (!tableInfo.some((col: any) => col.name === 'max_turns')) {
      db.exec("ALTER TABLE agents ADD COLUMN max_turns INTEGER NOT NULL DEFAULT 200")
    }
  } catch (e) { console.error("Migration failed for agents:", e) }

  try {
    const tableInfo = db.prepare("PRAGMA table_info(users)").all() as any[]
    if (tableInfo.some((col: any) => col.name === 'password_hash') && !tableInfo.some((col: any) => col.name === 'password')) {
      db.exec("ALTER TABLE users RENAME COLUMN password_hash TO password")
    }
  } catch (e) { console.error("Migration failed for users:", e) }

  try {
    const tableInfo = db.prepare("PRAGMA table_info(task_executions)").all() as any[]
    if (!tableInfo.some((col: any) => col.name === 'pid')) {
      db.exec("ALTER TABLE task_executions ADD COLUMN pid INTEGER")
    }
    if (!tableInfo.some((col: any) => col.name === 'input_tokens')) {
      db.exec("ALTER TABLE task_executions ADD COLUMN input_tokens INTEGER NOT NULL DEFAULT 0")
      db.exec("ALTER TABLE task_executions ADD COLUMN output_tokens INTEGER NOT NULL DEFAULT 0")
      db.exec("ALTER TABLE task_executions ADD COLUMN cost_usd REAL NOT NULL DEFAULT 0")
    }
    if (!tableInfo.some((col: any) => col.name === 'issue_title')) {
      db.exec("ALTER TABLE task_executions ADD COLUMN issue_title TEXT")
    }
    if (!tableInfo.some((col: any) => col.name === 'turns')) {
      db.exec("ALTER TABLE task_executions ADD COLUMN turns INTEGER NOT NULL DEFAULT 0")
    }
  } catch (e) { console.error("Migration failed for task_executions:", e) }

  // 프로젝트 모니터링 설정
  try {
    const tableInfo = db.prepare("PRAGMA table_info(projects)").all() as any[]
    if (!tableInfo.some((col: any) => col.name === 'snapshot_interval')) {
      db.exec("ALTER TABLE projects ADD COLUMN snapshot_interval INTEGER NOT NULL DEFAULT 1")
      db.exec("ALTER TABLE projects ADD COLUMN sparkline_points INTEGER NOT NULL DEFAULT 60")
      db.exec("ALTER TABLE projects ADD COLUMN stats_retention INTEGER NOT NULL DEFAULT 7")
    }
  } catch (e) { console.error("Migration failed for projects monitoring:", e) }

  // 에이전트 모니터링 설정
  try {
    const tableInfo = db.prepare("PRAGMA table_info(agents)").all() as any[]
    if (!tableInfo.some((col: any) => col.name === 'snapshot_interval')) {
      db.exec("ALTER TABLE agents ADD COLUMN snapshot_interval INTEGER NOT NULL DEFAULT 1")
      db.exec("ALTER TABLE agents ADD COLUMN sparkline_points INTEGER NOT NULL DEFAULT 60")
      db.exec("ALTER TABLE agents ADD COLUMN stats_retention INTEGER NOT NULL DEFAULT 7")
    }
  } catch (e) { console.error("Migration failed for agents monitoring:", e) }

  seedAdmin(db)
}

function seedAdmin(db: Database.Database) {
  const exists = db.prepare('SELECT id FROM users WHERE email = ?').get('admin@ive.local')
  if (!exists) {
    db.prepare('INSERT INTO users (id, email, password, name) VALUES (?, ?, ?, ?)').run(
      'user-admin',
      'admin@ive.local',
      bcrypt.hashSync('admin', 10),
      '관리자'
    )
  }
}

// ── Users ──

export function getUserByEmail(email: string): any {
  return getDb().prepare('SELECT * FROM users WHERE email = ?').get(email)
}

export function getUserById(id: string): User | null {
  return getDb().prepare('SELECT * FROM users WHERE id = ?').get(id) as User | null
}

export function createUser(u: any) {
  getDb().prepare('INSERT INTO users (id, email, password, name) VALUES (?, ?, ?, ?)').run(u.id, u.email, u.password, u.name)
}

// ── Projects ──

type ProjectRow = {
  id: string; user_id: string; name: string; provider: string;
  repo_url: string; access_token: string; color: string; created_at: string;
  label_target: string; label_in_progress: string; label_fail_dev: string;
  label_done: string;
  check_interval: number; last_checked_at: string | null;
  last_scanned_issue_count: number | null; scanner_active: number;
  last_error: string | null; last_error_at: string | null;
  sort_order: number;
  snapshot_interval: number; sparkline_points: number; stats_retention: number;
}

function mapProject(r: ProjectRow): Project {
  return {
    id: r.id, userId: r.user_id, name: r.name, provider: r.provider as Project['provider'],
    repoUrl: r.repo_url, accessToken: r.access_token, color: (r.color || '#4ade80') as Project['color'],
    createdAt: r.created_at,
    labelTarget: r.label_target, labelInProgress: r.label_in_progress,
    labelFailDev: r.label_fail_dev,
    labelDone: r.label_done,
    checkInterval: r.check_interval,
    lastCheckedAt: r.last_checked_at,
    lastScannedIssueCount: r.last_scanned_issue_count,
    scannerActive: r.scanner_active === 1,
    lastError: r.last_error ?? null,
    lastErrorAt: r.last_error_at ?? null,
    sortOrder: r.sort_order ?? 0,
    snapshotInterval: r.snapshot_interval ?? 1,
    sparklinePoints: r.sparkline_points ?? 60,
    statsRetention: r.stats_retention ?? 7,
  }
}

export function getAllProjects(): Project[] {
  return (getDb().prepare('SELECT * FROM projects').all() as ProjectRow[]).map(mapProject)
}

export function getProjectsByUser(userId: string): Project[] {
  return (getDb().prepare('SELECT * FROM projects WHERE user_id = ? ORDER BY sort_order ASC, created_at ASC').all(userId) as ProjectRow[]).map(mapProject)
}

export function getProject(id: string): Project | null {
  const r = getDb().prepare('SELECT * FROM projects WHERE id = ?').get(id) as ProjectRow | undefined
  return r ? mapProject(r) : null
}

export function createProject(p: Project) {
  // 새 프로젝트는 맨 마지막 순서로
  const maxOrder = getDb().prepare("SELECT COALESCE(MAX(sort_order), -1) as m FROM projects WHERE user_id = ?").get(p.userId) as { m: number }
  const sortOrder = p.sortOrder ?? (maxOrder.m + 1)

  getDb().prepare(
    `INSERT INTO projects (
      id, user_id, name, provider, repo_url, access_token, color,
      label_target, label_in_progress, label_fail_dev, label_done,
      check_interval, last_checked_at, last_scanned_issue_count, scanner_active, sort_order,
      snapshot_interval, sparkline_points, stats_retention, created_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(
    p.id, p.userId, p.name, p.provider, p.repoUrl, p.accessToken, p.color || '#4ade80',
    p.labelTarget, p.labelInProgress, p.labelFailDev, p.labelDone,
    p.checkInterval, p.lastCheckedAt, p.lastScannedIssueCount, p.scannerActive ? 1 : 0, sortOrder,
    p.snapshotInterval ?? 1, p.sparklinePoints ?? 60, p.statsRetention ?? 7, p.createdAt
  )
}

export function updateProject(p: Project) {
  getDb().prepare(
    `UPDATE projects SET
      name = ?, repo_url = ?, access_token = ?, color = ?,
      label_target = ?, label_in_progress = ?, label_fail_dev = ?,
      label_done = ?,
      check_interval = ?, last_checked_at = ?, last_scanned_issue_count = ?,
      scanner_active = ?, sort_order = ?,
      snapshot_interval = ?, sparkline_points = ?, stats_retention = ?
      WHERE id = ? AND user_id = ?`
  ).run(
    p.name, p.repoUrl, p.accessToken, p.color || '#4ade80',
    p.labelTarget, p.labelInProgress, p.labelFailDev,
    p.labelDone,
    p.checkInterval, p.lastCheckedAt, p.lastScannedIssueCount,
    p.scannerActive ? 1 : 0, p.sortOrder ?? 0,
    p.snapshotInterval ?? 1, p.sparklinePoints ?? 60, p.statsRetention ?? 7,
    p.id, p.userId
  )
}

export function updateProjectSortOrders(userId: string, orders: { id: string; sortOrder: number }[]) {
  const stmt = getDb().prepare('UPDATE projects SET sort_order = ? WHERE id = ? AND user_id = ?')
  const tx = getDb().transaction(() => {
    for (const o of orders) {
      stmt.run(o.sortOrder, o.id, userId)
    }
  })
  tx()
}

export function updateProjectLastChecked(id: string, timestamp: string, issueCount: number) {
  getDb().prepare('UPDATE projects SET last_checked_at = ?, last_scanned_issue_count = ?, last_error = NULL, last_error_at = NULL WHERE id = ?').run(timestamp, issueCount, id)
}

export function updateProjectError(id: string, error: string) {
  getDb().prepare('UPDATE projects SET last_error = ?, last_error_at = ? WHERE id = ?').run(error, new Date().toISOString(), id)
}

export function clearProjectError(id: string) {
  getDb().prepare('UPDATE projects SET last_error = NULL, last_error_at = NULL WHERE id = ?').run(id)
}

export function deleteProject(id: string, userId: string) {
  getDb().prepare('DELETE FROM projects WHERE id = ? AND user_id = ?').run(id, userId)
}

// ── Agents ──

function mapAgent(r: any): Agent {
  return {
    id: r.id, userId: r.user_id, name: r.name,
    cliName: r.cli_name as Agent['cliName'], cliPath: r.cli_path,
    cliVersion: r.cli_version, maxTurns: r.max_turns ?? 200,
    status: r.status as Agent['status'],
    snapshotInterval: r.snapshot_interval ?? 1,
    sparklinePoints: r.sparkline_points ?? 60,
    statsRetention: r.stats_retention ?? 7,
    createdAt: r.created_at,
  }
}

export function getAgentsByUser(userId: string): Agent[] {
  const rows = getDb().prepare('SELECT * FROM agents WHERE user_id = ? ORDER BY created_at DESC').all(userId) as any[]
  return rows.map(mapAgent)
}

export function getAgent(id: string): Agent | null {
  const r = getDb().prepare('SELECT * FROM agents WHERE id = ?').get(id) as any
  if (!r) return null
  return mapAgent(r)
}

export function createAgent(a: Agent) {
  getDb().prepare(
    'INSERT INTO agents (id, user_id, name, cli_name, cli_path, cli_version, max_turns, status, snapshot_interval, sparkline_points, stats_retention, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)'
  ).run(a.id, a.userId, a.name, a.cliName, a.cliPath, a.cliVersion, a.maxTurns, a.status, a.snapshotInterval ?? 1, a.sparklinePoints ?? 60, a.statsRetention ?? 7, a.createdAt)
}

export function updateAgent(a: Agent) {
  getDb().prepare(
    'UPDATE agents SET name = ?, cli_name = ?, cli_path = ?, cli_version = ?, max_turns = ?, status = ?, snapshot_interval = ?, sparkline_points = ?, stats_retention = ? WHERE id = ? AND user_id = ?'
  ).run(a.name, a.cliName, a.cliPath, a.cliVersion, a.maxTurns, a.status, a.snapshotInterval ?? 1, a.sparklinePoints ?? 60, a.statsRetention ?? 7, a.id, a.userId)
}

export function deleteAgent(id: string, userId: string) {
  getDb().prepare('DELETE FROM agents WHERE id = ? AND user_id = ?').run(id, userId)
}

export function updateAgentStatus(id: string, status: Agent['status']) {
  getDb().prepare('UPDATE agents SET status = ? WHERE id = ?').run(status, id)
}

// ── Project Assignments (프로젝트-에이전트 배정) ──

export function getProjectAssignments(projectId: string): (ProjectAssignment & { agent: Agent })[] {
  const rows = getDb().prepare(`
    SELECT pa.*, a.name as agent_name, a.cli_name, a.cli_path, a.cli_version, a.max_turns,
           a.status as agent_status, a.user_id, a.created_at as agent_created_at,
           a.snapshot_interval as a_snapshot_interval, a.sparkline_points as a_sparkline_points, a.stats_retention as a_stats_retention
    FROM project_assignments pa
    JOIN agents a ON pa.agent_id = a.id
    WHERE pa.project_id = ?
    ORDER BY pa.assigned_at ASC
  `).all(projectId) as any[]
  return rows.map(r => ({
    id: r.id, projectId: r.project_id, agentId: r.agent_id, assignedAt: r.assigned_at,
    agent: {
      id: r.agent_id, userId: r.user_id, name: r.agent_name,
      cliName: r.cli_name as Agent['cliName'], cliPath: r.cli_path,
      cliVersion: r.cli_version, maxTurns: r.max_turns ?? 200,
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

export function assignAgentToProject(pa: ProjectAssignment) {
  getDb().prepare(
    'INSERT INTO project_assignments (id, project_id, agent_id, assigned_at) VALUES (?, ?, ?, ?)'
  ).run(pa.id, pa.projectId, pa.agentId, pa.assignedAt)
}

export function unassignAgentFromProject(projectId: string, agentId: string) {
  getDb().prepare('DELETE FROM project_assignments WHERE project_id = ? AND agent_id = ?').run(projectId, agentId)
}

export function countActiveExecutionsByAgent(agentId: string): number {
  const r = getDb().prepare(
    "SELECT COUNT(*) as cnt FROM task_executions WHERE agent_id = ? AND status = 'running'"
  ).get(agentId) as { cnt: number }
  return r.cnt
}

// ── Task Executions ──

function mapExecution(r: any): TaskExecution {
  return {
    id: r.id, projectId: r.project_id, agentId: r.agent_id,
    issueIid: r.issue_iid, issueTitle: r.issue_title ?? undefined,
    status: r.status, startedAt: r.started_at, endedAt: r.ended_at,
    logPath: r.log_path, pid: r.pid ?? undefined,
    agentName: r.agent_name ?? undefined,
    inputTokens: r.input_tokens ?? 0, outputTokens: r.output_tokens ?? 0,
    costUsd: r.cost_usd ?? 0, turns: r.turns ?? 0,
  }
}

export function createExecution(ex: TaskExecution) {
  getDb().prepare(
    'INSERT INTO task_executions (id, project_id, agent_id, issue_iid, issue_title, status, started_at, log_path) VALUES (?, ?, ?, ?, ?, ?, ?, ?)'
  ).run(ex.id, ex.projectId, ex.agentId, ex.issueIid, ex.issueTitle ?? null, ex.status, ex.startedAt, ex.logPath)
}

export function updateExecutionStatus(id: string, status: TaskStatus, endedAt?: string) {
  if (endedAt) {
    getDb().prepare('UPDATE task_executions SET status = ?, ended_at = ? WHERE id = ?').run(status, endedAt, id)
  } else {
    getDb().prepare('UPDATE task_executions SET status = ? WHERE id = ?').run(status, id)
  }
}

export function updateExecutionTokens(id: string, inputTokens: number, outputTokens: number, costUsd: number, turns: number = 0) {
  getDb().prepare('UPDATE task_executions SET input_tokens = ?, output_tokens = ?, cost_usd = ?, turns = ? WHERE id = ?')
    .run(inputTokens, outputTokens, costUsd, turns, id)
}

export function getExecution(id: string): TaskExecution | null {
  const r = getDb().prepare('SELECT * FROM task_executions WHERE id = ?').get(id) as any
  if (!r) return null
  return mapExecution(r)
}

export function updateExecutionPid(id: string, pid: number) {
  getDb().prepare('UPDATE task_executions SET pid = ? WHERE id = ?').run(pid, id)
}

export function killExecution(id: string): boolean {
  const r = getDb().prepare('SELECT * FROM task_executions WHERE id = ?').get(id) as any
  if (!r) return false
  if (r.pid) {
    try {
      process.kill(-r.pid, 'SIGKILL')
      console.log(`[DB] Killed process group -${r.pid} for execution ${id}`)
    } catch (e: any) {
      if (e.code !== 'ESRCH') console.warn(`[DB] Kill failed for pid ${r.pid}:`, e.message)
    }
  }
  getDb().prepare("UPDATE task_executions SET status = 'failed', ended_at = ? WHERE id = ?").run(new Date().toISOString(), id)
  return true
}

export function resetStuckExecutions() {
  const stuckRows = getDb().prepare("SELECT * FROM task_executions WHERE status = 'running'").all() as any[]
  for (const r of stuckRows) {
    if (r.pid) {
      try { process.kill(-r.pid, 'SIGKILL') } catch (e: any) {
        if (e.code !== 'ESRCH') console.warn(`[DB] Kill failed for pid ${r.pid}:`, e.message)
      }
    }
    getDb().prepare("UPDATE task_executions SET status = 'failed', ended_at = ? WHERE id = ?").run(new Date().toISOString(), r.id)
    console.log(`[DB] Reset stuck execution ${r.id}`)
  }
  if (stuckRows.length > 0) console.log(`[DB] Reset ${stuckRows.length} stuck execution(s).`)
}

export function hasActiveExecution(projectId: string, issueIid: number): boolean {
  const r = getDb().prepare(
    "SELECT id FROM task_executions WHERE project_id = ? AND issue_iid = ? AND status = 'running' LIMIT 1"
  ).get(projectId, issueIid)
  return !!r
}

export function getLatestExecutionsByProject(projectId: string, limit: number = 20): TaskExecution[] {
  const rows = getDb().prepare(`
    SELECT te.*, a.name AS agent_name
    FROM task_executions te
    LEFT JOIN agents a ON a.id = te.agent_id
    WHERE te.project_id = ?
    ORDER BY te.started_at DESC
    LIMIT ?
  `).all(projectId, limit) as any[]
  return rows.map(mapExecution)
}

export function getLatestExecutionsByAgent(agentId: string, limit: number = 20): TaskExecution[] {
  const rows = getDb().prepare(`
    SELECT te.*, a.name AS agent_name
    FROM task_executions te
    LEFT JOIN agents a ON a.id = te.agent_id
    WHERE te.agent_id = ?
    ORDER BY te.started_at DESC
    LIMIT ?
  `).all(agentId, limit) as any[]
  return rows.map(mapExecution)
}

export function getTodayExecutionsByProject(projectId: string): TaskExecution[] {
  const today = new Date().toISOString().slice(0, 10)
  const rows = getDb().prepare(`
    SELECT te.*, a.name AS agent_name
    FROM task_executions te
    LEFT JOIN agents a ON a.id = te.agent_id
    WHERE te.project_id = ? AND te.started_at >= ?
    ORDER BY te.started_at DESC
  `).all(projectId, today) as any[]
  return rows.map(mapExecution)
}

export function getTodayExecutionsByAgent(agentId: string): TaskExecution[] {
  const today = new Date().toISOString().slice(0, 10)
  const rows = getDb().prepare(`
    SELECT te.*, a.name AS agent_name
    FROM task_executions te
    LEFT JOIN agents a ON a.id = te.agent_id
    WHERE te.agent_id = ? AND te.started_at >= ?
    ORDER BY te.started_at DESC
  `).all(agentId, today) as any[]
  return rows.map(mapExecution)
}

export function getYesterdayCompletedCount(entityType: 'project' | 'agent', entityId: string): number {
  const yesterday = new Date(Date.now() - 86400000).toISOString().slice(0, 10)
  const today = new Date().toISOString().slice(0, 10)
  const now = new Date()
  const yesterdaySameTime = new Date(now.getTime() - 86400000).toISOString()
  const col = entityType === 'project' ? 'project_id' : 'agent_id'
  const r = getDb().prepare(`
    SELECT COUNT(*) as cnt FROM task_executions
    WHERE ${col} = ? AND status IN ('success', 'failed')
    AND started_at >= ? AND started_at < ?
  `).get(entityId, yesterday, yesterdaySameTime) as { cnt: number }
  return r.cnt
}

// ── Stat Snapshots ──

export function createSnapshot(s: StatSnapshot) {
  getDb().prepare(
    'INSERT INTO stat_snapshots (id, entity_type, entity_id, timestamp, running, waiting, completed, failed, total_tokens, cost_usd) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)'
  ).run(s.id, s.entityType, s.entityId, s.timestamp, s.running, s.waiting, s.completed, s.failed, s.totalTokens, s.costUsd)
}

export function getSnapshots(entityType: string, entityId: string, limit: number = 60): StatSnapshot[] {
  const rows = getDb().prepare(`
    SELECT * FROM stat_snapshots
    WHERE entity_type = ? AND entity_id = ?
    ORDER BY timestamp DESC
    LIMIT ?
  `).all(entityType, entityId, limit) as any[]
  return rows.map(r => ({
    id: r.id, entityType: r.entity_type, entityId: r.entity_id,
    timestamp: r.timestamp, running: r.running, waiting: r.waiting,
    completed: r.completed, failed: r.failed,
    totalTokens: r.total_tokens, costUsd: r.cost_usd,
  })).reverse()
}

export function cleanOldSnapshots(retentionDays: number = 7) {
  const cutoff = new Date(Date.now() - retentionDays * 86400000).toISOString()
  getDb().prepare('DELETE FROM stat_snapshots WHERE timestamp < ?').run(cutoff)
}
