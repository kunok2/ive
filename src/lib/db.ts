import Database from 'better-sqlite3'
import path from 'path'
import bcrypt from 'bcryptjs'
import { User, Project, Agent, ProjectAssignment, TaskExecution, TaskStatus, StatSnapshot, TokenPricing, ProjectShare, ShareRole, ReportSchedule, ReportSendLog, UserActivityLog, ActivityCategory } from '@/types'
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
    if (!tableInfo.some((col: any) => col.name === 'allowed_clis')) {
      db.exec("ALTER TABLE users ADD COLUMN allowed_clis TEXT NOT NULL DEFAULT 'opencode'")
      // 기존 관리자 계정은 모든 CLI 허용
      db.exec("UPDATE users SET allowed_clis = 'claude,opencode' WHERE is_admin = 1")
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
    if (!tableInfo.some((col: any) => col.name === 'model_name')) {
      db.exec("ALTER TABLE task_executions ADD COLUMN model_name TEXT")
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

  // 충돌 수 캐시 컬럼
  try {
    const tableInfo = db.prepare("PRAGMA table_info(projects)").all() as any[]
    if (!tableInfo.some((col: any) => col.name === 'conflict_count')) {
      db.exec("ALTER TABLE projects ADD COLUMN conflict_count INTEGER NOT NULL DEFAULT 0")
    }
  } catch (e) { console.error("Migration failed for projects conflict_count:", e) }

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

  // 보고서 스케줄 테이블
  db.exec(`
    CREATE TABLE IF NOT EXISTS report_schedules (
      id TEXT PRIMARY KEY,
      report_type TEXT NOT NULL CHECK(report_type IN ('weekly', 'monthly', 'yearly')),
      enabled INTEGER NOT NULL DEFAULT 1,
      recipients TEXT NOT NULL DEFAULT '[]',
      send_day INTEGER NOT NULL DEFAULT 1,
      send_hour INTEGER NOT NULL DEFAULT 9,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    )
  `)

  // 보고서 발송 이력 테이블
  db.exec(`
    CREATE TABLE IF NOT EXISTS report_send_logs (
      id TEXT PRIMARY KEY,
      schedule_id TEXT NOT NULL,
      report_type TEXT NOT NULL,
      period_start TEXT NOT NULL,
      period_end TEXT NOT NULL,
      recipient_email TEXT NOT NULL,
      status TEXT NOT NULL CHECK(status IN ('success', 'failed')),
      error_message TEXT,
      sent_at TEXT NOT NULL DEFAULT (datetime('now')),
      FOREIGN KEY (schedule_id) REFERENCES report_schedules(id) ON DELETE CASCADE
    );
    CREATE INDEX IF NOT EXISTS idx_report_send_logs_schedule ON report_send_logs(schedule_id, period_start, period_end);
    CREATE INDEX IF NOT EXISTS idx_report_send_logs_sent_at ON report_send_logs(sent_at);
  `)

  // 사용자 활동 로그 테이블
  db.exec(`
    CREATE TABLE IF NOT EXISTS user_activity_logs (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL,
      category TEXT NOT NULL CHECK(category IN ('auth', 'project', 'agent', 'execution', 'admin', 'settings')),
      action TEXT NOT NULL,
      detail TEXT NOT NULL DEFAULT '',
      target_type TEXT,
      target_id TEXT,
      ip_address TEXT,
      user_agent TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
    )
  `)
  db.exec(`CREATE INDEX IF NOT EXISTS idx_activity_logs_user ON user_activity_logs(user_id, created_at)`)
  db.exec(`CREATE INDEX IF NOT EXISTS idx_activity_logs_created ON user_activity_logs(created_at)`)

  // Chat sessions & messages (Issue Chat feature)
  db.exec(`
    CREATE TABLE IF NOT EXISTS chat_sessions (
      id TEXT PRIMARY KEY,
      project_id TEXT NOT NULL,
      issue_iid INTEGER NOT NULL,
      agent_id TEXT,
      execution_id TEXT,
      cli_session_id TEXT,
      workspace_path TEXT,
      status TEXT NOT NULL DEFAULT 'active' CHECK(status IN ('active', 'ended')),
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      last_active_at TEXT NOT NULL DEFAULT (datetime('now')),
      FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE
    );
    CREATE INDEX IF NOT EXISTS idx_chat_sessions_issue ON chat_sessions(project_id, issue_iid, status);
  `)
  // Migrate: add execution_id, cli_session_id columns if missing
  try {
    const cols = db.prepare("PRAGMA table_info(chat_sessions)").all() as any[]
    const colNames = cols.map((c: any) => c.name)
    if (!colNames.includes('execution_id')) db.exec("ALTER TABLE chat_sessions ADD COLUMN execution_id TEXT")
    if (!colNames.includes('cli_session_id')) db.exec("ALTER TABLE chat_sessions ADD COLUMN cli_session_id TEXT")
  } catch { /* ignore */ }
  db.exec(`
    CREATE TABLE IF NOT EXISTS chat_messages (
      id TEXT PRIMARY KEY,
      session_id TEXT NOT NULL,
      role TEXT NOT NULL CHECK(role IN ('user', 'assistant')),
      content TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      FOREIGN KEY (session_id) REFERENCES chat_sessions(id) ON DELETE CASCADE
    );
    CREATE INDEX IF NOT EXISTS idx_chat_messages_session ON chat_messages(session_id, created_at);
  `)

  // agents.cli_name CHECK constraint에 opencode 추가 — 테이블 재생성 (구문별 개별 실행)
  try {
    const row = db.prepare("SELECT sql FROM sqlite_master WHERE type='table' AND name='agents'").get() as any
    if (row && row.sql && !row.sql.includes("'opencode'")) {
      db.pragma('foreign_keys = OFF')
      db.exec(`CREATE TABLE agents_new (
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
      )`)
      db.exec(`INSERT INTO agents_new SELECT id, user_id, name, cli_name, cli_path, cli_version, max_turns, status, snapshot_interval, sparkline_points, stats_retention, avatar, created_at FROM agents`)
      db.exec(`DROP TABLE agents`)
      db.exec(`ALTER TABLE agents_new RENAME TO agents`)
      db.pragma('foreign_keys = ON')
      console.log('[DB] agents cli_name CHECK constraint updated to include opencode')
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
    db.prepare('INSERT INTO users (id, email, password, name, is_admin, max_agents, max_turns, allowed_clis) VALUES (?, ?, ?, ?, 1, 0, 0, ?)').run(
      'user-admin',
      'admin@ive.local',
      bcrypt.hashSync('admin', 10),
      '관리자',
      'claude,opencode'
    )
  } else {
    // 기존 admin 계정에 is_admin + 무제한 + 모든 CLI 보장
    db.prepare('UPDATE users SET is_admin = 1, max_agents = 0, max_turns = 0, allowed_clis = ? WHERE email = ?').run('claude,opencode', 'admin@ive.local')
  }
}

// ── Users ──

export function getUserByEmail(email: string): any {
  return getDb().prepare('SELECT * FROM users WHERE email = ?').get(email)
}

function parseAllowedClis(raw: string | null | undefined): string[] {
  if (!raw) return ['opencode']
  return raw.split(',').map(s => s.trim()).filter(Boolean)
}

function mapUser(r: any): User {
  return {
    id: r.id, email: r.email, name: r.name, avatar: r.avatar || 'av-01',
    isAdmin: !!r.is_admin, maxAgents: r.max_agents ?? 0, maxTurns: r.max_turns ?? 0,
    allowedClis: parseAllowedClis(r.allowed_clis) as User['allowedClis'],
    createdAt: r.created_at,
  }
}

export function getUserById(id: string): User | null {
  const row = getDb().prepare('SELECT * FROM users WHERE id = ?').get(id) as any
  if (!row) return null
  return mapUser(row)
}

export function getAllUsers(): User[] {
  const rows = getDb().prepare('SELECT * FROM users ORDER BY created_at ASC').all() as any[]
  return rows.map(mapUser)
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
  label_target: string; show_tool_usage: number;
  check_interval: number; last_checked_at: string | null;
  last_scanned_issue_count: number | null; scanner_active: number;
  last_error: string | null; last_error_at: string | null;
  sort_order: number; avatar_url: string;
  snapshot_interval: number; sparkline_points: number; stats_retention: number;
  conflict_count: number;
}

function mapProject(r: ProjectRow): Project {
  return {
    id: r.id, userId: r.user_id, name: r.name, provider: r.provider as Project['provider'],
    repoUrl: r.repo_url, authType: (r.auth_type || 'token') as Project['authType'],
    gitUsername: r.git_username || '', accessToken: r.access_token,
    color: (r.color || '#4ade80') as Project['color'],
    createdAt: r.created_at,
    labelTarget: r.label_target,
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
    conflictCount: r.conflict_count ?? 0,
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
      label_target, show_tool_usage,
      check_interval, last_checked_at, last_scanned_issue_count, scanner_active, sort_order,
      avatar_url, snapshot_interval, sparkline_points, stats_retention, created_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(
    p.id, p.userId, p.name, p.provider, p.repoUrl, p.authType || 'token', p.gitUsername || '',
    p.accessToken, p.color || '#4ade80',
    p.labelTarget, p.showToolUsage ? 1 : 0,
    p.checkInterval, p.lastCheckedAt, p.lastScannedIssueCount, p.scannerActive ? 1 : 0, sortOrder,
    p.avatarUrl || '', p.snapshotInterval ?? 1, p.sparklinePoints ?? 60, p.statsRetention ?? 7, p.createdAt
  )
}

export function updateProject(p: Project) {
  getDb().prepare(
    `UPDATE projects SET
      name = ?, repo_url = ?, access_token = ?, color = ?,
      auth_type = ?, git_username = ?,
      label_target = ?, show_tool_usage = ?,
      check_interval = ?, last_checked_at = ?, last_scanned_issue_count = ?,
      scanner_active = ?, sort_order = ?, avatar_url = ?,
      snapshot_interval = ?, sparkline_points = ?, stats_retention = ?
      WHERE id = ? AND user_id = ?`
  ).run(
    p.name, p.repoUrl, p.accessToken, p.color || '#4ade80',
    p.authType || 'token', p.gitUsername || '',
    p.labelTarget, p.showToolUsage ? 1 : 0,
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

export function updateProjectConflictCount(id: string, count: number) {
  getDb().prepare('UPDATE projects SET conflict_count = ? WHERE id = ?').run(count, id)
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
    modelName: r.model_name ?? undefined,
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

export function updateExecutionTokens(id: string, inputTokens: number, outputTokens: number, costUsd: number, turns: number = 0, modelName?: string) {
  if (modelName) {
    getDb().prepare('UPDATE task_executions SET input_tokens = ?, output_tokens = ?, cost_usd = ?, turns = ?, model_name = ? WHERE id = ?')
      .run(inputTokens, outputTokens, costUsd, turns, modelName, id)
  } else {
    getDb().prepare('UPDATE task_executions SET input_tokens = ?, output_tokens = ?, cost_usd = ?, turns = ? WHERE id = ?')
      .run(inputTokens, outputTokens, costUsd, turns, id)
  }
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
  // JS ISO 형식으로 통일 (datetime('now')는 'YYYY-MM-DD HH:MM:SS' 형식이라 timezone 파싱 불일치 위험)
  const restartTs = new Date().toISOString()
  const stuckIssues = getDb().prepare("UPDATE issue_stages SET stage = 'waiting', updated_at = ? WHERE stage = 'dev'").run(restartTs)
  if (stuckIssues.changes > 0) console.log(`[DB] Reset ${stuckIssues.changes} stuck issue(s) from 'dev' to 'waiting'.`)
}

export function hasActiveExecution(projectId: string, issueIid: number): boolean {
  const r = getDb().prepare(
    "SELECT id FROM task_executions WHERE project_id = ? AND issue_iid = ? AND status = 'running' LIMIT 1"
  ).get(projectId, issueIid)
  return !!r
}

export function hasPastExecution(projectId: string, issueIid: number): boolean {
  const r = getDb().prepare(
    "SELECT id FROM task_executions WHERE project_id = ? AND issue_iid = ? AND status IN ('success', 'failed') LIMIT 1"
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

export function getTokenPricingByModel(modelName: string): TokenPricing | null {
  const r = getDb().prepare('SELECT * FROM token_pricing WHERE LOWER(model_name) = LOWER(?) LIMIT 1').get(modelName) as any
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
  developerName: string
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
           u.name as developer_name,
           te.issue_iid, te.issue_title, te.status,
           te.started_at, te.ended_at, te.input_tokens, te.output_tokens, te.cost_usd, te.turns,
           te.issue_created_at
    FROM task_executions te
    JOIN projects p ON p.id = te.project_id
    JOIN agents a ON a.id = te.agent_id
    LEFT JOIN users u ON u.id = a.user_id
    WHERE (p.user_id = ? OR EXISTS (SELECT 1 FROM project_shares ps WHERE ps.project_id = p.id AND ps.user_id = ?))
      AND te.started_at >= ? AND te.started_at < ?
    ORDER BY te.started_at ASC
  `).all(userId, userId, startISO, endISO) as any[]
  return rows.map(r => ({
    id: r.id, projectId: r.project_id, projectName: r.project_name,
    projectColor: r.project_color, projectAvatarUrl: r.project_avatar_url || '', projectProvider: r.project_provider || 'gitlab',
    agentId: r.agent_id, agentName: r.agent_name, agentAvatar: r.agent_avatar || 'av-01',
    cliName: r.cli_name, developerName: r.developer_name || r.agent_name,
    issueIid: r.issue_iid, issueTitle: r.issue_title,
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

// ── Report Schedules (보고서 스케줄) ──

function mapReportSchedule(r: any): ReportSchedule {
  return {
    id: r.id,
    reportType: r.report_type,
    enabled: !!r.enabled,
    recipients: JSON.parse(r.recipients || '[]'),
    createdAt: r.created_at,
    updatedAt: r.updated_at,
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
  getDb().prepare(`
    INSERT INTO report_schedules (id, report_type, enabled, recipients, send_day, send_hour, created_at, updated_at)
    VALUES (?, ?, ?, ?, 1, 9, ?, datetime('now'))
    ON CONFLICT(id) DO UPDATE SET
      enabled = excluded.enabled,
      recipients = excluded.recipients,
      updated_at = datetime('now')
  `).run(s.id, s.reportType, s.enabled ? 1 : 0, JSON.stringify(s.recipients), s.createdAt || new Date().toISOString())
}

export function deleteReportSchedule(id: string) {
  getDb().prepare('DELETE FROM report_schedules WHERE id = ?').run(id)
}

// ── Report Send Logs (보고서 발송 이력) ──

function mapReportSendLog(r: any): ReportSendLog {
  return {
    id: r.id,
    scheduleId: r.schedule_id,
    reportType: r.report_type,
    periodStart: r.period_start,
    periodEnd: r.period_end,
    recipientEmail: r.recipient_email,
    status: r.status,
    errorMessage: r.error_message,
    sentAt: r.sent_at,
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

/** 중복발송 체크: 동일 스케줄의 동일 기간에 성공 발송 이력이 있는지 확인 */
export function hasAlreadySent(scheduleId: string, periodStart: string, periodEnd: string, recipientEmail: string): boolean {
  const r = getDb().prepare(
    "SELECT id FROM report_send_logs WHERE schedule_id = ? AND period_start = ? AND period_end = ? AND recipient_email = ? AND status = 'success' LIMIT 1"
  ).get(scheduleId, periodStart, periodEnd, recipientEmail)
  return !!r
}

/** 전체 보고서 통계 데이터 조회 (모든 프로젝트/에이전트) */
export function getGlobalExecutionsInRange(start: string, end: string): ReportExecution[] {
  const startISO = kstDateToUTCISO(start)
  const endISO = kstDateToUTCISO(end)
  const rows = getDb().prepare(`
    SELECT te.id, te.project_id, p.name as project_name, p.color as project_color, p.avatar_url as project_avatar_url, p.provider as project_provider,
           te.agent_id, a.name as agent_name, a.avatar as agent_avatar, a.cli_name,
           u.name as developer_name,
           te.issue_iid, te.issue_title, te.status,
           te.started_at, te.ended_at, te.input_tokens, te.output_tokens, te.cost_usd, te.turns,
           te.issue_created_at
    FROM task_executions te
    JOIN projects p ON p.id = te.project_id
    JOIN agents a ON a.id = te.agent_id
    LEFT JOIN users u ON u.id = a.user_id
    WHERE te.started_at >= ? AND te.started_at < ?
    ORDER BY te.started_at ASC
  `).all(startISO, endISO) as any[]
  return rows.map(r => ({
    id: r.id, projectId: r.project_id, projectName: r.project_name,
    projectColor: r.project_color, projectAvatarUrl: r.project_avatar_url || '', projectProvider: r.project_provider || 'gitlab',
    agentId: r.agent_id, agentName: r.agent_name, agentAvatar: r.agent_avatar || 'av-01',
    cliName: r.cli_name, developerName: r.developer_name || r.agent_name,
    issueIid: r.issue_iid, issueTitle: r.issue_title,
    status: r.status, startedAt: r.started_at, endedAt: r.ended_at,
    inputTokens: r.input_tokens ?? 0, outputTokens: r.output_tokens ?? 0,
    costUsd: r.cost_usd ?? 0, turns: r.turns ?? 0,
    issueCreatedAt: r.issue_created_at ?? null,
  }))
}

// ── User Activity Logs (사용자 활동 로그) ──

function mapActivityLog(r: any): UserActivityLog {
  return {
    id: r.id,
    userId: r.user_id,
    userName: r.user_name ?? undefined,
    userEmail: r.user_email ?? undefined,
    category: r.category as ActivityCategory,
    action: r.action,
    detail: r.detail || '',
    targetType: r.target_type ?? undefined,
    targetId: r.target_id ?? undefined,
    ipAddress: r.ip_address ?? undefined,
    userAgent: r.user_agent ?? undefined,
    createdAt: r.created_at,
  }
}

export function createActivityLog(log: {
  userId: string
  category: ActivityCategory
  action: string
  detail: string
  targetType?: string
  targetId?: string
  ipAddress?: string
  userAgent?: string
}) {
  const id = `al-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
  getDb().prepare(
    `INSERT INTO user_activity_logs (id, user_id, category, action, detail, target_type, target_id, ip_address, user_agent)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(id, log.userId, log.category, log.action, log.detail, log.targetType ?? null, log.targetId ?? null, log.ipAddress ?? null, log.userAgent ?? null)
  return id
}

export function getActivityLogs(opts: {
  limit?: number
  offset?: number
  userId?: string
  category?: string
  startDate?: string
  endDate?: string
}): { logs: UserActivityLog[]; total: number } {
  const conditions: string[] = []
  const params: any[] = []

  if (opts.userId) {
    conditions.push('al.user_id = ?')
    params.push(opts.userId)
  }
  if (opts.category) {
    conditions.push('al.category = ?')
    params.push(opts.category)
  }
  if (opts.startDate) {
    conditions.push('al.created_at >= ?')
    params.push(opts.startDate)
  }
  if (opts.endDate) {
    conditions.push('al.created_at < ?')
    params.push(opts.endDate)
  }

  const where = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : ''

  const countRow = getDb().prepare(`SELECT COUNT(*) as cnt FROM user_activity_logs al ${where}`).get(...params) as { cnt: number }

  const limit = opts.limit || 50
  const offset = opts.offset || 0
  const rows = getDb().prepare(`
    SELECT al.*, u.name as user_name, u.email as user_email
    FROM user_activity_logs al
    LEFT JOIN users u ON al.user_id = u.id
    ${where}
    ORDER BY al.created_at DESC
    LIMIT ? OFFSET ?
  `).all(...params, limit, offset) as any[]

  return { logs: rows.map(mapActivityLog), total: countRow.cnt }
}

export function cleanOldActivityLogs(retentionDays: number = 90) {
  const cutoff = new Date(Date.now() - retentionDays * 86400000).toISOString()
  const result = getDb().prepare('DELETE FROM user_activity_logs WHERE created_at < ?').run(cutoff)
  if (result.changes > 0) {
    console.log(`[Cleanup] Purged ${result.changes} activity logs (retention: ${retentionDays}d)`)
  }
}

// ── Chat Sessions & Messages ──

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
    id: r.id,
    projectId: r.project_id,
    issueIid: r.issue_iid,
    agentId: r.agent_id,
    executionId: r.execution_id ?? null,
    cliSessionId: r.cli_session_id ?? null,
    workspacePath: r.workspace_path,
    status: r.status,
    createdAt: r.created_at,
    lastActiveAt: r.last_active_at,
  }
}

function mapChatMessage(r: any): ChatMessage {
  return {
    id: r.id,
    sessionId: r.session_id,
    role: r.role,
    content: r.content,
    createdAt: r.created_at,
  }
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

export function getChatHistoryForPrompt(sessionId: string): string {
  const msgs = getChatMessages(sessionId)
  if (msgs.length === 0) return ''
  return msgs.map(m => `**${m.role === 'user' ? '👤 User' : '🤖 AI'}**: ${m.content}`).join('\n\n')
}
