import Database from 'better-sqlite3'
import path from 'path'
import bcrypt from 'bcryptjs'
import { User, Project, Agent, ProjectAssignment, TaskExecution, TaskStatus, StatSnapshot, TokenPricing, ProjectShare, ShareRole } from '@/types'
import { getKSTTodayStartISO, getKSTYesterdayStartISO, kstDateToUTCISO } from './date-utils'
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
      avatar TEXT NOT NULL DEFAULT 'av-01',
      is_admin INTEGER NOT NULL DEFAULT 0,
      max_agents INTEGER NOT NULL DEFAULT 1,
      max_turns INTEGER NOT NULL DEFAULT 20,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS projects (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL,
      name TEXT NOT NULL,
      provider TEXT NOT NULL CHECK(provider IN ('github', 'gitlab')),
      repo_url TEXT NOT NULL,
      auth_type TEXT NOT NULL DEFAULT 'token',
      git_username TEXT NOT NULL DEFAULT '',
      access_token TEXT NOT NULL,
      color TEXT NOT NULL DEFAULT '#4ade80',
      label_target TEXT NOT NULL DEFAULT 'IVE',
      label_in_progress TEXT NOT NULL DEFAULT 'IVE(D)',
      label_fail_dev TEXT NOT NULL DEFAULT 'IVE(F)',
      label_done TEXT NOT NULL DEFAULT 'IVE(E)',
      show_tool_usage INTEGER NOT NULL DEFAULT 0,
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
      cli_name TEXT NOT NULL CHECK(cli_name IN ('claude', 'gemini', 'codex', 'opencode')),
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
      access_token TEXT NOT NULL DEFAULT '',
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

    CREATE TABLE IF NOT EXISTS token_pricing (
      id TEXT PRIMARY KEY,
      cli_name TEXT NOT NULL UNIQUE,
      model_name TEXT NOT NULL,
      input_price REAL NOT NULL,
      output_price REAL NOT NULL,
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS project_shares (
      id TEXT PRIMARY KEY,
      project_id TEXT NOT NULL,
      user_id TEXT NOT NULL,
      role TEXT NOT NULL DEFAULT 'viewer' CHECK(role IN ('viewer', 'editor')),
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE,
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
      UNIQUE(project_id, user_id)
    );

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
      db.exec("ALTER TABLE projects ADD COLUMN label_fail_dev TEXT NOT NULL DEFAULT 'IVE(F)'")
      db.exec("ALTER TABLE projects ADD COLUMN label_done TEXT NOT NULL DEFAULT 'IVE(E)'")
    } else if (!tableInfo.some((col: any) => col.name === 'label_fail_dev')) {
      db.exec("ALTER TABLE projects ADD COLUMN label_fail_dev TEXT NOT NULL DEFAULT 'IVE(F)'")
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
    if (!tableInfo.some((col: any) => col.name === 'auth_type')) {
      db.exec("ALTER TABLE projects ADD COLUMN auth_type TEXT NOT NULL DEFAULT 'token'")
      db.exec("ALTER TABLE projects ADD COLUMN git_username TEXT NOT NULL DEFAULT ''")
    }
    if (!tableInfo.some((col: any) => col.name === 'show_tool_usage')) {
      db.exec("ALTER TABLE projects ADD COLUMN show_tool_usage INTEGER NOT NULL DEFAULT 0")
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
    if (!tableInfo.some((col: any) => col.name === 'is_admin')) {
      db.exec("ALTER TABLE users ADD COLUMN is_admin INTEGER NOT NULL DEFAULT 0")
    }
    if (!tableInfo.some((col: any) => col.name === 'max_agents')) {
      db.exec("ALTER TABLE users ADD COLUMN max_agents INTEGER NOT NULL DEFAULT 1")
      db.exec("ALTER TABLE users ADD COLUMN max_turns INTEGER NOT NULL DEFAULT 20")
    }
    if (!tableInfo.some((col: any) => col.name === 'avatar')) {
      db.exec("ALTER TABLE users ADD COLUMN avatar TEXT NOT NULL DEFAULT 'av-01'")
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
    if (!tableInfo.some((col: any) => col.name === 'issue_created_at')) {
      db.exec("ALTER TABLE task_executions ADD COLUMN issue_created_at TEXT")
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

  // project_assignments에 access_token 컬럼 추가
  try {
    const tableInfo = db.prepare("PRAGMA table_info(project_assignments)").all() as any[]
    if (!tableInfo.some((col: any) => col.name === 'access_token')) {
      db.exec("ALTER TABLE project_assignments ADD COLUMN access_token TEXT NOT NULL DEFAULT ''")
    }
  } catch (e) { console.error("Migration failed for project_assignments:", e) }

  // agents에 avatar 컬럼 추가
  try {
    const tableInfo = db.prepare("PRAGMA table_info(agents)").all() as any[]
    if (!tableInfo.some((col: any) => col.name === 'avatar')) {
      db.exec("ALTER TABLE agents ADD COLUMN avatar TEXT NOT NULL DEFAULT 'av-01'")
    }
  } catch (e) { console.error("Migration failed for agents avatar:", e) }

  // projects에 avatar_url 컬럼 추가
  try {
    const tableInfo = db.prepare("PRAGMA table_info(projects)").all() as any[]
    if (!tableInfo.some((col: any) => col.name === 'avatar_url')) {
      db.exec("ALTER TABLE projects ADD COLUMN avatar_url TEXT NOT NULL DEFAULT ''")
    }
  } catch (e) { console.error("Migration failed for projects avatar_url:", e) }

  // system_settings 테이블
  db.exec(`
    CREATE TABLE IF NOT EXISTS system_settings (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL DEFAULT '',
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    )
  `)

  // issue_stages 테이블 — 로컬에서 이슈 상태 관리
  db.exec(`
    CREATE TABLE IF NOT EXISTS issue_stages (
      project_id TEXT NOT NULL,
      issue_iid INTEGER NOT NULL,
      stage TEXT NOT NULL DEFAULT 'waiting',
      fail_reason TEXT DEFAULT NULL,
      updated_at TEXT NOT NULL DEFAULT (datetime('now')),
      PRIMARY KEY (project_id, issue_iid),
      FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE
    )
  `)
  // fail_reason 컬럼 마이그레이션
  try {
    db.exec(`ALTER TABLE issue_stages ADD COLUMN fail_reason TEXT DEFAULT NULL`)
  } catch { /* 이미 존재 */ }

  // agents.cli_name CHECK constraint에 opencode 추가 — 테이블 재생성
  try {
    const sql = db.prepare("SELECT sql FROM sqlite_master WHERE type='table' AND name='agents'").get() as any
    if (sql && sql.sql && !sql.sql.includes("'opencode'")) {
      db.exec(`
        PRAGMA foreign_keys = OFF;
        CREATE TABLE agents_new (
          id TEXT PRIMARY KEY,
          user_id TEXT NOT NULL,
          name TEXT NOT NULL,
          cli_name TEXT NOT NULL CHECK(cli_name IN ('claude', 'gemini', 'codex', 'opencode')),
          cli_path TEXT NOT NULL,
          cli_version TEXT NOT NULL DEFAULT '',
          max_turns INTEGER NOT NULL DEFAULT 200,
          status TEXT NOT NULL DEFAULT 'available' CHECK(status IN ('available', 'busy', 'offline')),
          snapshot_interval INTEGER NOT NULL DEFAULT 1,
          sparkline_points INTEGER NOT NULL DEFAULT 60,
          stats_retention INTEGER NOT NULL DEFAULT 7,
          avatar TEXT NOT NULL DEFAULT 'av-01',
          created_at TEXT NOT NULL DEFAULT (datetime('now')),
          FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
        );
        INSERT INTO agents_new SELECT id, user_id, name, cli_name, cli_path, cli_version, max_turns, status, snapshot_interval, sparkline_points, stats_retention, avatar, created_at FROM agents;
        DROP TABLE agents;
        ALTER TABLE agents_new RENAME TO agents;
        PRAGMA foreign_keys = ON;
      `)
    }
  } catch (e) { console.error('[DB] agents migration failed:', e) }

  seedAdmin(db)
  seedTokenPricing(db)
}

function seedTokenPricing(db: Database.Database) {
  const defaults = [
    { id: 'tp-claude', cli: 'claude', model: 'Claude Sonnet 4.6', input: 3.00, output: 15.00 },
    { id: 'tp-gemini', cli: 'gemini', model: 'Gemini 2.5 Pro', input: 1.25, output: 10.00 },
    { id: 'tp-codex', cli: 'codex', model: 'GPT-4.1', input: 2.00, output: 8.00 },
    { id: 'tp-opencode', cli: 'opencode', model: 'Claude Sonnet 4.6', input: 3.00, output: 15.00 },
  ]
  const stmt = db.prepare('INSERT OR IGNORE INTO token_pricing (id, cli_name, model_name, input_price, output_price) VALUES (?, ?, ?, ?, ?)')
  for (const d of defaults) {
    stmt.run(d.id, d.cli, d.model, d.input, d.output)
  }
}

function seedAdmin(db: Database.Database) {
  const exists = db.prepare('SELECT id FROM users WHERE email = ?').get('admin@ive.local')
  if (!exists) {
    db.prepare('INSERT INTO users (id, email, password, name, is_admin, max_agents, max_turns) VALUES (?, ?, ?, ?, 1, 0, 0)').run(
      'user-admin',
      'admin@ive.local',
      bcrypt.hashSync('admin', 10),
      '관리자'
    )
  } else {
    // 기존 admin 계정에 is_admin + 무제한 보장
    db.prepare('UPDATE users SET is_admin = 1, max_agents = 0, max_turns = 0 WHERE email = ?').run('admin@ive.local')
  }
}

// ── Users ──

export function getUserByEmail(email: string): any {
  return getDb().prepare('SELECT * FROM users WHERE email = ?').get(email)
}

export function getUserById(id: string): User | null {
  const row = getDb().prepare('SELECT * FROM users WHERE id = ?').get(id) as any
  if (!row) return null
  return { id: row.id, email: row.email, name: row.name, avatar: row.avatar || 'av-01', isAdmin: !!row.is_admin, maxAgents: row.max_agents ?? 0, maxTurns: row.max_turns ?? 0, createdAt: row.created_at }
}

export function getAllUsers(): User[] {
  const rows = getDb().prepare('SELECT * FROM users ORDER BY created_at ASC').all() as any[]
  return rows.map(r => ({ id: r.id, email: r.email, name: r.name, avatar: r.avatar || 'av-01', isAdmin: !!r.is_admin, maxAgents: r.max_agents ?? 0, maxTurns: r.max_turns ?? 0, createdAt: r.created_at }))
}

export function deleteUser(id: string) {
  getDb().prepare('DELETE FROM users WHERE id = ?').run(id)
}

export function updateUserAvatar(id: string, avatar: string) {
  getDb().prepare('UPDATE users SET avatar = ? WHERE id = ?').run(avatar, id)
}

export function createUser(u: any) {
  getDb().prepare('INSERT INTO users (id, email, password, name) VALUES (?, ?, ?, ?)').run(u.id, u.email, u.password, u.name)
}

// ── Projects ──

type ProjectRow = {
  id: string; user_id: string; name: string; provider: string;
  repo_url: string; auth_type: string; git_username: string;
  access_token: string; color: string; created_at: string;
  label_target: string; label_in_progress: string; label_fail_dev: string;
  label_done: string; show_tool_usage: number;
  check_interval: number; last_checked_at: string | null;
  last_scanned_issue_count: number | null; scanner_active: number;
  last_error: string | null; last_error_at: string | null;
  sort_order: number; avatar_url: string;
  snapshot_interval: number; sparkline_points: number; stats_retention: number;
}

function mapProject(r: ProjectRow): Project {
  return {
    id: r.id, userId: r.user_id, name: r.name, provider: r.provider as Project['provider'],
    repoUrl: r.repo_url, authType: (r.auth_type || 'token') as Project['authType'],
    gitUsername: r.git_username || '', accessToken: r.access_token,
    color: (r.color || '#4ade80') as Project['color'],
    createdAt: r.created_at,
    labelTarget: r.label_target, labelInProgress: r.label_in_progress,
    labelFailDev: r.label_fail_dev,
    labelDone: r.label_done,
    showToolUsage: r.show_tool_usage === 1,
    checkInterval: r.check_interval,
    lastCheckedAt: r.last_checked_at,
    lastScannedIssueCount: r.last_scanned_issue_count,
    scannerActive: r.scanner_active === 1,
    lastError: r.last_error ?? null,
    lastErrorAt: r.last_error_at ?? null,
    sortOrder: r.sort_order ?? 0,
    avatarUrl: r.avatar_url || '',
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
      id, user_id, name, provider, repo_url, auth_type, git_username, access_token, color,
      label_target, label_in_progress, label_fail_dev, label_done, show_tool_usage,
      check_interval, last_checked_at, last_scanned_issue_count, scanner_active, sort_order,
      avatar_url, snapshot_interval, sparkline_points, stats_retention, created_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(
    p.id, p.userId, p.name, p.provider, p.repoUrl, p.authType || 'token', p.gitUsername || '',
    p.accessToken, p.color || '#4ade80',
    p.labelTarget, p.labelInProgress, p.labelFailDev, p.labelDone, p.showToolUsage ? 1 : 0,
    p.checkInterval, p.lastCheckedAt, p.lastScannedIssueCount, p.scannerActive ? 1 : 0, sortOrder,
    p.avatarUrl || '', p.snapshotInterval ?? 1, p.sparklinePoints ?? 60, p.statsRetention ?? 7, p.createdAt
  )
}

export function updateProject(p: Project) {
  getDb().prepare(
    `UPDATE projects SET
      name = ?, repo_url = ?, access_token = ?, color = ?,
      auth_type = ?, git_username = ?,
      label_target = ?, label_in_progress = ?, label_fail_dev = ?,
      label_done = ?, show_tool_usage = ?,
      check_interval = ?, last_checked_at = ?, last_scanned_issue_count = ?,
      scanner_active = ?, sort_order = ?, avatar_url = ?,
      snapshot_interval = ?, sparkline_points = ?, stats_retention = ?
      WHERE id = ? AND user_id = ?`
  ).run(
    p.name, p.repoUrl, p.accessToken, p.color || '#4ade80',
    p.authType || 'token', p.gitUsername || '',
    p.labelTarget, p.labelInProgress, p.labelFailDev,
    p.labelDone, p.showToolUsage ? 1 : 0,
    p.checkInterval, p.lastCheckedAt, p.lastScannedIssueCount,
    p.scannerActive ? 1 : 0, p.sortOrder ?? 0, p.avatarUrl || '',
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
    avatar: r.avatar || 'av-01',
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
    'INSERT INTO agents (id, user_id, name, avatar, cli_name, cli_path, cli_version, max_turns, status, snapshot_interval, sparkline_points, stats_retention, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)'
  ).run(a.id, a.userId, a.name, a.avatar || 'av-01', a.cliName, a.cliPath, a.cliVersion, a.maxTurns, a.status, a.snapshotInterval ?? 1, a.sparklinePoints ?? 60, a.statsRetention ?? 7, a.createdAt)
}

export function updateAgent(a: Agent) {
  getDb().prepare(
    'UPDATE agents SET name = ?, avatar = ?, cli_name = ?, cli_path = ?, cli_version = ?, max_turns = ?, status = ?, snapshot_interval = ?, sparkline_points = ?, stats_retention = ? WHERE id = ? AND user_id = ?'
  ).run(a.name, a.avatar || 'av-01', a.cliName, a.cliPath, a.cliVersion, a.maxTurns, a.status, a.snapshotInterval ?? 1, a.sparklinePoints ?? 60, a.statsRetention ?? 7, a.id, a.userId)
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
    SELECT pa.*, a.name as agent_name, a.avatar as agent_avatar, a.cli_name, a.cli_path, a.cli_version, a.max_turns,
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
    "SELECT COUNT(*) as cnt FROM task_executions WHERE project_id = ? AND status = 'running'"
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
    issueCreatedAt: r.issue_created_at ?? undefined,
  }
}

export function createExecution(ex: TaskExecution) {
  getDb().prepare(
    'INSERT INTO task_executions (id, project_id, agent_id, issue_iid, issue_title, status, started_at, log_path, issue_created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)'
  ).run(ex.id, ex.projectId, ex.agentId, ex.issueIid, ex.issueTitle ?? null, ex.status, ex.startedAt, ex.logPath, ex.issueCreatedAt ?? null)
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
  // 에이전트 상태를 'available'로 복원
  getDb().prepare("UPDATE agents SET status = 'available' WHERE id = ? AND status = 'busy'").run(r.agent_id)
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
    // 고착된 에이전트 상태도 'available'로 복원
    getDb().prepare("UPDATE agents SET status = 'available' WHERE id = ? AND status = 'busy'").run(r.agent_id)
    console.log(`[DB] Reset stuck execution ${r.id}`)
  }
  if (stuckRows.length > 0) console.log(`[DB] Reset ${stuckRows.length} stuck execution(s).`)

  // 서버 재기동 시 '개발중(dev)' 상태로 멈춘 이슈를 '대기(waiting)'로 복원
  const stuckIssues = getDb().prepare("UPDATE issue_stages SET stage = 'waiting', updated_at = datetime('now') WHERE stage = 'dev'").run()
  if (stuckIssues.changes > 0) console.log(`[DB] Reset ${stuckIssues.changes} stuck issue(s) from 'dev' to 'waiting'.`)
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
  const todayStartISO = getKSTTodayStartISO()
  const rows = getDb().prepare(`
    SELECT te.*, a.name AS agent_name
    FROM task_executions te
    LEFT JOIN agents a ON a.id = te.agent_id
    WHERE te.project_id = ? AND te.started_at >= ?
    ORDER BY te.started_at DESC
  `).all(projectId, todayStartISO) as any[]
  return rows.map(mapExecution)
}

export function getTodayExecutionsByAgent(agentId: string): TaskExecution[] {
  const todayStartISO = getKSTTodayStartISO()
  const rows = getDb().prepare(`
    SELECT te.*, a.name AS agent_name
    FROM task_executions te
    LEFT JOIN agents a ON a.id = te.agent_id
    WHERE te.agent_id = ? AND te.started_at >= ?
    ORDER BY te.started_at DESC
  `).all(agentId, todayStartISO) as any[]
  return rows.map(mapExecution)
}

export function getYesterdayCompletedCount(entityType: 'project' | 'agent', entityId: string): number {
  const yesterdayStartISO = getKSTYesterdayStartISO()
  const todayStartISO = getKSTTodayStartISO()
  const col = entityType === 'project' ? 'project_id' : 'agent_id'
  const r = getDb().prepare(`
    SELECT COUNT(*) as cnt FROM task_executions
    WHERE ${col} = ? AND status IN ('success', 'failed')
    AND started_at >= ? AND started_at < ?
  `).get(entityId, yesterdayStartISO, todayStartISO) as { cnt: number }
  return r.cnt
}

// ── Stat Snapshots ──

export function createSnapshot(s: StatSnapshot) {
  getDb().prepare(
    'INSERT INTO stat_snapshots (id, entity_type, entity_id, timestamp, running, waiting, completed, failed, total_tokens, cost_usd) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)'
  ).run(s.id, s.entityType, s.entityId, s.timestamp, s.running, s.waiting, s.completed, s.failed, s.totalTokens, s.costUsd)
}

export function getSnapshots(entityType: 'project' | 'agent', entityId: string, limit: number = 60): StatSnapshot[] {
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

export function getDailyAvgSnapshots(entityType: 'project' | 'agent', entityId: string, limit: number = 60): StatSnapshot[] {
  const rows = getDb().prepare(`
    SELECT
      DATE(timestamp) as day,
      ROUND(AVG(running), 2) as running,
      ROUND(AVG(waiting), 2) as waiting,
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
    id: `avg-${r.day}`,
    entityType,
    entityId,
    timestamp: r.day,
    running: r.running,
    waiting: r.waiting,
    completed: r.completed,
    failed: r.failed,
    totalTokens: r.total_tokens,
    costUsd: r.cost_usd,
  })).reverse()
}

export function getHourlyAvgSnapshots(entityType: 'project' | 'agent', entityId: string, limit: number = 60): StatSnapshot[] {
  const rows = getDb().prepare(`
    SELECT
      STRFTIME('%Y-%m-%d %H:00', timestamp) as hour,
      ROUND(AVG(running), 2) as running,
      ROUND(AVG(waiting), 2) as waiting,
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
    id: `havg-${r.hour}`,
    entityType,
    entityId,
    timestamp: r.hour,
    running: r.running,
    waiting: r.waiting,
    completed: r.completed,
    failed: r.failed,
    totalTokens: r.total_tokens,
    costUsd: r.cost_usd,
  })).reverse()
}

export function cleanOldSnapshots(retentionDays: number = 7) {
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

// ── Token Pricing ──

function mapPricing(r: any): TokenPricing {
  return {
    id: r.id, cliName: r.cli_name, modelName: r.model_name,
    inputPrice: r.input_price, outputPrice: r.output_price,
    updatedAt: r.updated_at,
  }
}

export function getAllTokenPricing(): TokenPricing[] {
  return (getDb().prepare('SELECT * FROM token_pricing ORDER BY cli_name ASC').all() as any[]).map(mapPricing)
}

export function getTokenPricingByCli(cliName: string): TokenPricing | null {
  const r = getDb().prepare('SELECT * FROM token_pricing WHERE cli_name = ?').get(cliName) as any
  return r ? mapPricing(r) : null
}

export function upsertTokenPricing(p: TokenPricing) {
  getDb().prepare(`
    INSERT INTO token_pricing (id, cli_name, model_name, input_price, output_price, updated_at)
    VALUES (?, ?, ?, ?, ?, ?)
    ON CONFLICT(cli_name) DO UPDATE SET
      model_name = excluded.model_name,
      input_price = excluded.input_price,
      output_price = excluded.output_price,
      updated_at = excluded.updated_at
  `).run(p.id, p.cliName, p.modelName, p.inputPrice, p.outputPrice, p.updatedAt)
}

// ── Project Shares (프로젝트 공유) ──

export function getProjectShares(projectId: string): (ProjectShare & { userName: string; userEmail: string })[] {
  const rows = getDb().prepare(`
    SELECT ps.*, u.name as user_name, u.email as user_email
    FROM project_shares ps
    JOIN users u ON ps.user_id = u.id
    WHERE ps.project_id = ?
    ORDER BY ps.created_at ASC
  `).all(projectId) as any[]
  return rows.map(r => ({
    id: r.id, projectId: r.project_id, userId: r.user_id,
    role: r.role as ShareRole, createdAt: r.created_at,
    userName: r.user_name, userEmail: r.user_email,
  }))
}

export function getSharedProjectsForUser(userId: string): (Project & { shareRole: ShareRole })[] {
  const rows = getDb().prepare(`
    SELECT p.*, ps.role as share_role
    FROM project_shares ps
    JOIN projects p ON ps.project_id = p.id
    WHERE ps.user_id = ?
    ORDER BY p.name ASC
  `).all(userId) as any[]
  return rows.map(r => ({ ...mapProject(r as ProjectRow), shareRole: r.share_role as ShareRole }))
}

export function getProjectShareRole(projectId: string, userId: string): ShareRole | null {
  const r = getDb().prepare('SELECT role FROM project_shares WHERE project_id = ? AND user_id = ?').get(projectId, userId) as { role: string } | undefined
  return r ? r.role as ShareRole : null
}

export function createProjectShare(share: ProjectShare) {
  getDb().prepare(
    'INSERT INTO project_shares (id, project_id, user_id, role, created_at) VALUES (?, ?, ?, ?, ?)'
  ).run(share.id, share.projectId, share.userId, share.role, share.createdAt)
}

export function updateProjectShareRole(id: string, role: ShareRole) {
  getDb().prepare('UPDATE project_shares SET role = ? WHERE id = ?').run(role, id)
}

export function deleteProjectShare(id: string) {
  getDb().prepare('DELETE FROM project_shares WHERE id = ?').run(id)
}

/** 프로젝트 접근 권한 확인: 소유자이면 'owner', 공유 사용자이면 해당 role, 아니면 null */
export function getProjectAccess(projectId: string, userId: string): 'owner' | ShareRole | null {
  const project = getProject(projectId)
  if (!project) return null
  if (project.userId === userId) return 'owner'
  return getProjectShareRole(projectId, userId)
}

// ── Reports ──

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
  cliName: string
  issueIid: number
  issueTitle: string | null
  status: string
  startedAt: string
  endedAt: string | null
  inputTokens: number
  outputTokens: number
  costUsd: number
  turns: number
  issueCreatedAt: string | null
}

export function getExecutionsInRange(userId: string, start: string, end: string): ReportExecution[] {
  // start/end는 KST 날짜(YYYY-MM-DD) → KST 자정의 UTC ISO로 변환하여 비교
  const startISO = kstDateToUTCISO(start)
  const endISO = kstDateToUTCISO(end)
  const rows = getDb().prepare(`
    SELECT te.id, te.project_id, p.name as project_name, p.color as project_color, p.avatar_url as project_avatar_url, p.provider as project_provider,
           te.agent_id, a.name as agent_name, a.avatar as agent_avatar, a.cli_name,
           te.issue_iid, te.issue_title, te.status,
           te.started_at, te.ended_at, te.input_tokens, te.output_tokens, te.cost_usd, te.turns,
           te.issue_created_at
    FROM task_executions te
    JOIN projects p ON p.id = te.project_id
    JOIN agents a ON a.id = te.agent_id
    WHERE (p.user_id = ? OR EXISTS (SELECT 1 FROM project_shares ps WHERE ps.project_id = p.id AND ps.user_id = ?))
      AND te.started_at >= ? AND te.started_at < ?
    ORDER BY te.started_at ASC
  `).all(userId, userId, startISO, endISO) as any[]
  return rows.map(r => ({
    id: r.id, projectId: r.project_id, projectName: r.project_name,
    projectColor: r.project_color, projectAvatarUrl: r.project_avatar_url || '', projectProvider: r.project_provider || 'gitlab',
    agentId: r.agent_id, agentName: r.agent_name, agentAvatar: r.agent_avatar || 'av-01',
    cliName: r.cli_name, issueIid: r.issue_iid, issueTitle: r.issue_title,
    status: r.status, startedAt: r.started_at, endedAt: r.ended_at,
    inputTokens: r.input_tokens ?? 0, outputTokens: r.output_tokens ?? 0,
    costUsd: r.cost_usd ?? 0, turns: r.turns ?? 0,
    issueCreatedAt: r.issue_created_at ?? null,
  }))
}

// ── System Settings ──

export function getSystemSetting(key: string): string | null {
  const r = getDb().prepare('SELECT value FROM system_settings WHERE key = ?').get(key) as any
  return r ? r.value : null
}

export function getSystemSettings(prefix?: string): Record<string, string> {
  const rows = prefix
    ? getDb().prepare('SELECT key, value FROM system_settings WHERE key LIKE ?').all(`${prefix}%`) as any[]
    : getDb().prepare('SELECT key, value FROM system_settings').all() as any[]
  const result: Record<string, string> = {}
  for (const r of rows) result[r.key] = r.value
  return result
}

export function setSystemSetting(key: string, value: string) {
  getDb().prepare(`
    INSERT INTO system_settings (key, value, updated_at) VALUES (?, ?, datetime('now'))
    ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at
  `).run(key, value)
}

export function setSystemSettings(settings: Record<string, string>) {
  const stmt = getDb().prepare(`
    INSERT INTO system_settings (key, value, updated_at) VALUES (?, ?, datetime('now'))
    ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at
  `)
  const tx = getDb().transaction(() => {
    for (const [key, value] of Object.entries(settings)) {
      stmt.run(key, value)
    }
  })
  tx()
}

// ── Issue Stages (로컬 이슈 상태 관리) ──

export type IssueStage = 'waiting' | 'dev' | 'dev_fail' | 'done'

export function getIssueStage(projectId: string, issueIid: number): IssueStage | null {
  const r = getDb().prepare('SELECT stage FROM issue_stages WHERE project_id = ? AND issue_iid = ?').get(projectId, issueIid) as any
  return r ? r.stage as IssueStage : null
}

export function getIssueStageUpdatedAt(projectId: string, issueIid: number): string | null {
  const r = getDb().prepare('SELECT updated_at FROM issue_stages WHERE project_id = ? AND issue_iid = ?').get(projectId, issueIid) as any
  return r ? r.updated_at : null
}

export function getIssueStages(projectId: string): Map<number, { stage: IssueStage; failReason: string | null }> {
  let rows: any[]
  try {
    rows = getDb().prepare('SELECT issue_iid, stage, fail_reason FROM issue_stages WHERE project_id = ?').all(projectId) as any[]
  } catch {
    // fail_reason 컬럼이 아직 없는 경우 fallback
    rows = getDb().prepare('SELECT issue_iid, stage FROM issue_stages WHERE project_id = ?').all(projectId) as any[]
  }
  const map = new Map<number, { stage: IssueStage; failReason: string | null }>()
  for (const r of rows) map.set(r.issue_iid, { stage: r.stage as IssueStage, failReason: r?.fail_reason || null })
  return map
}

export function setIssueStage(projectId: string, issueIid: number, stage: IssueStage, failReason?: string, updatedAt?: string) {
  const ts = updatedAt || new Date().toISOString();
  try {
    getDb().prepare(`
      INSERT INTO issue_stages (project_id, issue_iid, stage, fail_reason, updated_at) VALUES (?, ?, ?, ?, ?)
      ON CONFLICT(project_id, issue_iid) DO UPDATE SET stage = excluded.stage, fail_reason = excluded.fail_reason, updated_at = excluded.updated_at
    `).run(projectId, issueIid, stage, stage === 'dev_fail' ? (failReason || null) : null, ts)
  } catch {
    // fail_reason 컬럼이 아직 없는 경우 fallback
    getDb().prepare(`
      INSERT INTO issue_stages (project_id, issue_iid, stage, updated_at) VALUES (?, ?, ?, ?)
      ON CONFLICT(project_id, issue_iid) DO UPDATE SET stage = excluded.stage, updated_at = excluded.updated_at
    `).run(projectId, issueIid, stage, ts)
  }
}

export function deleteIssueStage(projectId: string, issueIid: number) {
  getDb().prepare('DELETE FROM issue_stages WHERE project_id = ? AND issue_iid = ?').run(projectId, issueIid)
}
