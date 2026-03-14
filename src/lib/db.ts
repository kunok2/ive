import Database from 'better-sqlite3'
import path from 'path'
import bcrypt from 'bcryptjs'
import { User, Project, ProjectRole, Agent, RoleAssignment, TaskExecution, TaskStatus } from '@/types'
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
    global.db = db  // startScanner 전에 먼저 설정 (순환 참조 방지)

    // 백그라운드 스캐너 시작
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

    CREATE TABLE IF NOT EXISTS roles (
      id TEXT PRIMARY KEY,
      project_id TEXT NOT NULL,
      name TEXT NOT NULL,
      category TEXT NOT NULL CHECK(category IN ('개발', '검증')),
      status TEXT NOT NULL DEFAULT 'idle' CHECK(status IN ('active', 'idle', 'paused')),
      access_token TEXT,
      max_agents INTEGER NOT NULL DEFAULT 1,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS agents (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL,
      name TEXT NOT NULL,
      cli_name TEXT NOT NULL CHECK(cli_name IN ('claude', 'gemini', 'codex')),
      cli_path TEXT NOT NULL,
      cli_version TEXT NOT NULL DEFAULT '',
      status TEXT NOT NULL DEFAULT 'available' CHECK(status IN ('available', 'busy', 'offline')),
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS role_assignments (
      id TEXT PRIMARY KEY,
      role_id TEXT NOT NULL,
      agent_id TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'active' CHECK(status IN ('active', 'paused')),
      assigned_at TEXT NOT NULL DEFAULT (datetime('now')),
      FOREIGN KEY (role_id) REFERENCES roles(id) ON DELETE CASCADE,
      FOREIGN KEY (agent_id) REFERENCES agents(id) ON DELETE CASCADE,
      UNIQUE(role_id, agent_id)
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
  `)

  // Migration: access_token 컬럼 추가 (기존에 없던 경우)
  try {
    const tableInfo = db.prepare("PRAGMA table_info(projects)").all() as any[]
    if (!tableInfo.some(col => col.name === 'access_token')) {
      db.exec("ALTER TABLE projects ADD COLUMN access_token TEXT NOT NULL DEFAULT ''")
    }
    if (!tableInfo.some(col => col.name === 'label_target')) {
      db.exec("ALTER TABLE projects ADD COLUMN label_target TEXT NOT NULL DEFAULT 'IVE'")
      db.exec("ALTER TABLE projects ADD COLUMN label_in_progress TEXT NOT NULL DEFAULT 'IVE(D)'")
      db.exec("ALTER TABLE projects ADD COLUMN label_fail_dev TEXT NOT NULL DEFAULT 'IVE(DF)'")
      db.exec("ALTER TABLE projects ADD COLUMN label_validation TEXT NOT NULL DEFAULT 'IVE(V)'")
      db.exec("ALTER TABLE projects ADD COLUMN label_fail_val TEXT NOT NULL DEFAULT 'IVE(VF)'")
      db.exec("ALTER TABLE projects ADD COLUMN label_done TEXT NOT NULL DEFAULT 'IVE(E)'")
    } else if (!tableInfo.some(col => col.name === 'label_fail_dev')) {
      db.exec("ALTER TABLE projects ADD COLUMN label_fail_dev TEXT NOT NULL DEFAULT 'IVE(DF)'")
      db.exec("ALTER TABLE projects ADD COLUMN label_fail_val TEXT NOT NULL DEFAULT 'IVE(VF)'")
    }

    if (!tableInfo.some(col => col.name === 'check_interval')) {
      db.exec("ALTER TABLE projects ADD COLUMN check_interval INTEGER NOT NULL DEFAULT 10")
    }
    if (!tableInfo.some(col => col.name === 'last_checked_at')) {
      db.exec("ALTER TABLE projects ADD COLUMN last_checked_at TEXT")
    }
    if (!tableInfo.some(col => col.name === 'last_scanned_issue_count')) {
      db.exec("ALTER TABLE projects ADD COLUMN last_scanned_issue_count INTEGER")
    }
    if (!tableInfo.some(col => col.name === 'scanner_active')) {
      db.exec("ALTER TABLE projects ADD COLUMN scanner_active INTEGER NOT NULL DEFAULT 1")
    }
  } catch (e) { console.error("Migration failed for projects:", e) }

  try {
    const tableInfo = db.prepare("PRAGMA table_info(roles)").all() as any[]
    if (!tableInfo.some(col => col.name === 'access_token')) {
      db.exec("ALTER TABLE roles ADD COLUMN access_token TEXT")
    }
  } catch (e) { console.error("Migration failed for roles:", e) }

  try {
    const tableInfo = db.prepare("PRAGMA table_info(users)").all() as any[]
    // 만약 password_hash라는 컬럼이 있고 password가 없다면 변경 시도 (SQLite는 RENAME COLUMN 지원)
    if (tableInfo.some(col => col.name === 'password_hash') && !tableInfo.some(col => col.name === 'password')) {
      db.exec("ALTER TABLE users RENAME COLUMN password_hash TO password")
    }
  } catch (e) { console.error("Migration failed for users table:", e) }

  try {
    const tableInfo = db.prepare("PRAGMA table_info(task_executions)").all() as any[]
    if (!tableInfo.some(col => col.name === 'role_id')) {
      db.exec("ALTER TABLE task_executions ADD COLUMN role_id TEXT NOT NULL DEFAULT ''")
    }
    if (!tableInfo.some(col => col.name === 'pid')) {
      db.exec("ALTER TABLE task_executions ADD COLUMN pid INTEGER")
    }
  } catch (e) { console.error("Migration failed for task_executions:", e) }

  // Migration: role_assignments의 UNIQUE(role_id, agent_id) 제약 제거 (멀티슬롯 지원)
  try {
    const tableDef = db.prepare("SELECT sql FROM sqlite_master WHERE type='table' AND name='role_assignments'").get() as { sql: string } | undefined
    if (tableDef?.sql?.includes('UNIQUE')) {
      db.exec(`
        CREATE TABLE role_assignments_new (
          id TEXT PRIMARY KEY,
          role_id TEXT NOT NULL,
          agent_id TEXT NOT NULL,
          status TEXT NOT NULL DEFAULT 'active' CHECK(status IN ('active', 'paused')),
          assigned_at TEXT NOT NULL DEFAULT (datetime('now')),
          FOREIGN KEY (role_id) REFERENCES roles(id) ON DELETE CASCADE,
          FOREIGN KEY (agent_id) REFERENCES agents(id) ON DELETE CASCADE
        );
        INSERT INTO role_assignments_new SELECT * FROM role_assignments;
        DROP TABLE role_assignments;
        ALTER TABLE role_assignments_new RENAME TO role_assignments;
      `)
      console.log('[DB] Migrated role_assignments: removed UNIQUE constraint for multi-slot support')
    }
  } catch (e) { console.error("Migration failed for role_assignments unique constraint:", e) }

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

export function getAllProjects(): Project[] {
  const rows = getDb().prepare('SELECT * FROM projects').all() as {
    id: string; user_id: string; name: string; provider: string;
    repo_url: string; access_token: string; created_at: string;
    label_target: string; label_in_progress: string; label_fail_dev: string;
    label_validation: string; label_fail_val: string; label_done: string;
    check_interval: number; last_checked_at: string | null;
    last_scanned_issue_count: number | null;
    scanner_active: number;
  }[]
  return rows.map(r => ({
    id: r.id, userId: r.user_id, name: r.name, provider: r.provider as Project['provider'],
    repoUrl: r.repo_url, accessToken: r.access_token, createdAt: r.created_at,
    labelTarget: r.label_target, labelInProgress: r.label_in_progress,
    labelFailDev: r.label_fail_dev,
    labelValidation: r.label_validation, labelFailVal: r.label_fail_val,
    labelDone: r.label_done,
    checkInterval: r.check_interval,
    lastCheckedAt: r.last_checked_at,
    lastScannedIssueCount: r.last_scanned_issue_count,
    scannerActive: r.scanner_active === 1,
  }))
}

export function getProjectsByUser(userId: string): Project[] {
  const rows = getDb().prepare('SELECT * FROM projects WHERE user_id = ? ORDER BY created_at DESC').all(userId) as {
    id: string; user_id: string; name: string; provider: string;
    repo_url: string; access_token: string; created_at: string;
    label_target: string; label_in_progress: string; label_fail_dev: string;
    label_validation: string; label_fail_val: string; label_done: string;
    check_interval: number; last_checked_at: string | null;
    last_scanned_issue_count: number | null;
    scanner_active: number;
  }[]
  return rows.map(r => ({
    id: r.id, userId: r.user_id, name: r.name, provider: r.provider as Project['provider'],
    repoUrl: r.repo_url, accessToken: r.access_token, createdAt: r.created_at,
    labelTarget: r.label_target, labelInProgress: r.label_in_progress,
    labelFailDev: r.label_fail_dev,
    labelValidation: r.label_validation, labelFailVal: r.label_fail_val,
    labelDone: r.label_done,
    checkInterval: r.check_interval,
    lastCheckedAt: r.last_checked_at,
    lastScannedIssueCount: r.last_scanned_issue_count,
    scannerActive: r.scanner_active === 1,
  }))
}

export function getProject(id: string): Project | null {
  const r = getDb().prepare('SELECT * FROM projects WHERE id = ?').get(id) as {
    id: string; user_id: string; name: string; provider: string;
    repo_url: string; access_token: string; created_at: string;
    label_target: string; label_in_progress: string; label_fail_dev: string;
    label_validation: string; label_fail_val: string; label_done: string;
    check_interval: number; last_checked_at: string | null;
    last_scanned_issue_count: number | null;
    scanner_active: number;
  } | undefined
  if (!r) return null
  return {
    id: r.id, userId: r.user_id, name: r.name, provider: r.provider as Project['provider'],
    repoUrl: r.repo_url, accessToken: r.access_token, createdAt: r.created_at,
    labelTarget: r.label_target, labelInProgress: r.label_in_progress,
    labelFailDev: r.label_fail_dev,
    labelValidation: r.label_validation, labelFailVal: r.label_fail_val,
    labelDone: r.label_done,
    checkInterval: r.check_interval,
    lastCheckedAt: r.last_checked_at,
    lastScannedIssueCount: r.last_scanned_issue_count,
    scannerActive: r.scanner_active === 1,
  }
}

export function createProject(p: Project) {
  getDb().prepare(
    `INSERT INTO projects (
      id, user_id, name, provider, repo_url, access_token, 
      label_target, label_in_progress, label_fail_dev, label_validation, label_fail_val, label_done,
      check_interval, last_checked_at, last_scanned_issue_count, scanner_active, created_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(
    p.id, p.userId, p.name, p.provider, p.repoUrl, p.accessToken, 
    p.labelTarget, p.labelInProgress, p.labelFailDev, p.labelValidation, p.labelFailVal, p.labelDone,
    p.checkInterval, p.lastCheckedAt, p.lastScannedIssueCount, p.scannerActive ? 1 : 0, p.createdAt
  )
}

export function updateProject(p: Project) {
  getDb().prepare(
    `UPDATE projects SET 
      name = ?, repo_url = ?, access_token = ?, 
      label_target = ?, label_in_progress = ?, label_fail_dev = ?, 
      label_validation = ?, label_fail_val = ?, label_done = ?,
      check_interval = ?, last_checked_at = ?, last_scanned_issue_count = ?,
      scanner_active = ?
      WHERE id = ? AND user_id = ?`
  ).run(
    p.name, p.repoUrl, p.accessToken, 
    p.labelTarget, p.labelInProgress, p.labelFailDev,
    p.labelValidation, p.labelFailVal, p.labelDone,
    p.checkInterval, p.lastCheckedAt, p.lastScannedIssueCount,
    p.scannerActive ? 1 : 0,
    p.id, p.userId
  )
}

export function updateProjectLastChecked(id: string, timestamp: string, issueCount: number) {
  getDb().prepare('UPDATE projects SET last_checked_at = ?, last_scanned_issue_count = ? WHERE id = ?').run(timestamp, issueCount, id)
}

export function deleteProject(id: string, userId: string) {
  getDb().prepare('DELETE FROM projects WHERE id = ? AND user_id = ?').run(id, userId)
}

// ── Roles (역할) ──

export function getRolesByProject(projectId: string): ProjectRole[] {
  const rows = getDb().prepare('SELECT * FROM roles WHERE project_id = ? ORDER BY created_at ASC').all(projectId) as {
    id: string; project_id: string; name: string; category: string; status: string;
    access_token: string | null; max_agents: number; created_at: string
  }[]
  return rows.map(r => ({
    id: r.id, projectId: r.project_id, name: r.name,
    category: r.category as ProjectRole['category'], status: r.status as ProjectRole['status'],
    accessToken: r.access_token || undefined, maxAgents: r.max_agents, createdAt: r.created_at,
  }))
}

export function createRole(r: ProjectRole) {
  getDb().prepare(
    'INSERT INTO roles (id, project_id, name, category, status, access_token, max_agents, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)'
  ).run(r.id, r.projectId, r.name, r.category, r.status, r.accessToken || null, r.maxAgents, r.createdAt)
}

export function updateRole(r: ProjectRole) {
  getDb().prepare(
    'UPDATE roles SET name = ?, category = ?, status = ?, max_agents = ?, access_token = ? WHERE id = ?'
  ).run(r.name, r.category, r.status, r.maxAgents, r.accessToken || null, r.id)
}

export function deleteRole(id: string) {
  getDb().prepare('DELETE FROM roles WHERE id = ?').run(id)
}

// ── Agents ──

export function getAgentsByUser(userId: string): Agent[] {
  const rows = getDb().prepare('SELECT * FROM agents WHERE user_id = ? ORDER BY created_at DESC').all(userId) as {
    id: string; user_id: string; name: string; cli_name: string;
    cli_path: string; cli_version: string; status: string; created_at: string
  }[]
  return rows.map(r => ({
    id: r.id, userId: r.user_id, name: r.name,
    cliName: r.cli_name as Agent['cliName'], cliPath: r.cli_path,
    cliVersion: r.cli_version, status: r.status as Agent['status'], createdAt: r.created_at,
  }))
}

export function getAgent(id: string): Agent | null {
  const r = getDb().prepare('SELECT * FROM agents WHERE id = ?').get(id) as {
    id: string; user_id: string; name: string; cli_name: string;
    cli_path: string; cli_version: string; status: string; created_at: string
  } | undefined
  if (!r) return null
  return {
    id: r.id, userId: r.user_id, name: r.name,
    cliName: r.cli_name as Agent['cliName'], cliPath: r.cli_path,
    cliVersion: r.cli_version, status: r.status as Agent['status'], createdAt: r.created_at,
  }
}

export function createAgent(a: Agent) {
  getDb().prepare(
    'INSERT INTO agents (id, user_id, name, cli_name, cli_path, cli_version, status, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)'
  ).run(a.id, a.userId, a.name, a.cliName, a.cliPath, a.cliVersion, a.status, a.createdAt)
}

export function updateAgent(a: Agent) {
  getDb().prepare(
    'UPDATE agents SET name = ?, cli_name = ?, cli_path = ?, cli_version = ?, status = ? WHERE id = ? AND user_id = ?'
  ).run(a.name, a.cliName, a.cliPath, a.cliVersion, a.status, a.id, a.userId)
}

export function deleteAgent(id: string, userId: string) {
  getDb().prepare('DELETE FROM agents WHERE id = ? AND user_id = ?').run(id, userId)
}

export function updateAgentStatus(id: string, status: Agent['status']) {
  getDb().prepare('UPDATE agents SET status = ? WHERE id = ?').run(status, id)
}

// ── Role Assignments (역할 배정) ──

export function getRoleAssignments(roleId: string): (RoleAssignment & { agent: Agent })[] {
  const rows = getDb().prepare(`
    SELECT ra.*, a.name as agent_name, a.cli_name, a.cli_path, a.cli_version,
           a.status as agent_status, a.user_id, a.created_at as agent_created_at
    FROM role_assignments ra
    JOIN agents a ON ra.agent_id = a.id
    WHERE ra.role_id = ?
    ORDER BY ra.assigned_at ASC
  `).all(roleId) as {
    id: string; role_id: string; agent_id: string; status: string; assigned_at: string;
    agent_name: string; cli_name: string; cli_path: string; cli_version: string;
    agent_status: string; user_id: string; agent_created_at: string
  }[]
  return rows.map(r => ({
    id: r.id, roleId: r.role_id, agentId: r.agent_id,
    status: r.status as RoleAssignment['status'], assignedAt: r.assigned_at,
    agent: {
      id: r.agent_id, userId: r.user_id, name: r.agent_name,
      cliName: r.cli_name as Agent['cliName'], cliPath: r.cli_path,
      cliVersion: r.cli_version, status: r.agent_status as Agent['status'],
      createdAt: r.agent_created_at,
    },
  }))
}

export function getAgentAssignments(agentId: string): RoleAssignment[] {
  const rows = getDb().prepare('SELECT * FROM role_assignments WHERE agent_id = ?').all(agentId) as {
    id: string; role_id: string; agent_id: string; status: string; assigned_at: string
  }[]
  return rows.map(r => ({
    id: r.id, roleId: r.role_id, agentId: r.agent_id,
    status: r.status as RoleAssignment['status'], assignedAt: r.assigned_at,
  }))
}

export function assignAgentToRole(ra: RoleAssignment) {
  getDb().prepare(
    'INSERT INTO role_assignments (id, role_id, agent_id, status, assigned_at) VALUES (?, ?, ?, ?, ?)'
  ).run(ra.id, ra.roleId, ra.agentId, ra.status, ra.assignedAt)
}

export function unassignAgentFromRole(roleId: string, agentId: string) {
  // 한 번에 하나의 슬롯만 제거 (멀티슬롯 지원)
  getDb().prepare(
    'DELETE FROM role_assignments WHERE id = (SELECT id FROM role_assignments WHERE role_id = ? AND agent_id = ? LIMIT 1)'
  ).run(roleId, agentId)
}

export function countActiveExecutionsByAgent(agentId: string): number {
  const r = getDb().prepare(
    "SELECT COUNT(*) as cnt FROM task_executions WHERE agent_id = ? AND status = 'running'"
  ).get(agentId) as { cnt: number }
  return r.cnt
}

export function countRoleAgents(roleId: string): number {
  const r = getDb().prepare('SELECT COUNT(*) as cnt FROM role_assignments WHERE role_id = ?').get(roleId) as { cnt: number }
  return r.cnt
}

// ── Task Executions ──

export function createExecution(ex: TaskExecution) {
  getDb().prepare(
    'INSERT INTO task_executions (id, project_id, role_id, agent_id, issue_iid, status, started_at, log_path) VALUES (?, ?, ?, ?, ?, ?, ?, ?)'
  ).run(ex.id, ex.projectId, ex.roleId, ex.agentId, ex.issueIid, ex.status, ex.startedAt, ex.logPath)
}

export function updateExecutionStatus(id: string, status: TaskStatus, endedAt?: string) {
  if (endedAt) {
    getDb().prepare('UPDATE task_executions SET status = ?, ended_at = ? WHERE id = ?').run(status, endedAt, id)
  } else {
    getDb().prepare('UPDATE task_executions SET status = ? WHERE id = ?').run(status, id)
  }
}

export function getExecution(id: string): TaskExecution | null {
  const r = getDb().prepare('SELECT * FROM task_executions WHERE id = ?').get(id) as any
  if (!r) return null
  return {
    id: r.id, projectId: r.project_id, roleId: r.role_id ?? '', agentId: r.agent_id,
    issueIid: r.issue_iid, status: r.status, startedAt: r.started_at, endedAt: r.ended_at, logPath: r.log_path
  }
}

export function updateExecutionPid(id: string, pid: number) {
  getDb().prepare('UPDATE task_executions SET pid = ? WHERE id = ?').run(pid, id)
}

/** 실행 프로세스를 강제 종료하고 DB를 failed로 업데이트 */
export function killExecution(id: string): boolean {
  const r = getDb().prepare('SELECT * FROM task_executions WHERE id = ?').get(id) as any
  if (!r) return false

  // 프로세스 그룹 kill (pid가 있는 경우)
  if (r.pid) {
    try {
      process.kill(-r.pid, 'SIGKILL')
      console.log(`[DB] Killed process group -${r.pid} for execution ${id}`)
    } catch (e: any) {
      if (e.code !== 'ESRCH') console.warn(`[DB] Kill failed for pid ${r.pid}:`, e.message)
    }
  }

  getDb().prepare(
    "UPDATE task_executions SET status = 'failed', ended_at = ? WHERE id = ?"
  ).run(new Date().toISOString(), id)
  return true
}

/** 서버 재시작 시 고착된 'running' 실행을 프로세스 kill 후 'failed'로 리셋 */
export function resetStuckExecutions() {
  const stuckRows = getDb().prepare(
    "SELECT * FROM task_executions WHERE status = 'running'"
  ).all() as any[]

  for (const r of stuckRows) {
    // 저장된 PID로 프로세스 그룹 강제 종료
    if (r.pid) {
      try {
        process.kill(-r.pid, 'SIGKILL')
        console.log(`[DB] Killed orphan process group -${r.pid} (execution: ${r.id})`)
      } catch (e: any) {
        if (e.code !== 'ESRCH') console.warn(`[DB] Kill failed for pid ${r.pid}:`, e.message)
      }
    }
    getDb().prepare(
      "UPDATE task_executions SET status = 'failed', ended_at = ? WHERE id = ?"
    ).run(new Date().toISOString(), r.id)
    console.log(`[DB] Reset stuck execution ${r.id} (agent: ${r.agent_id})`)
  }

  if (stuckRows.length > 0) {
    console.log(`[DB] Reset ${stuckRows.length} stuck execution(s).`)
  }
}

export function hasActiveExecution(projectId: string, issueIid: number): boolean {
  const r = getDb().prepare(
    "SELECT id FROM task_executions WHERE project_id = ? AND issue_iid = ? AND status = 'running' LIMIT 1"
  ).get(projectId, issueIid)
  return !!r
}

export function getLatestExecutionsByProject(projectId: string, limit: number = 20): TaskExecution[] {
  const rows = getDb().prepare(`
    SELECT te.*,
           a.name  AS agent_name,
           ro.name AS role_name
    FROM task_executions te
    LEFT JOIN agents a  ON a.id  = te.agent_id
    LEFT JOIN roles  ro ON ro.id = te.role_id
    WHERE te.project_id = ?
    ORDER BY te.started_at DESC
    LIMIT ?
  `).all(projectId, limit) as any[]
  return rows.map(r => ({
    id: r.id, projectId: r.project_id, roleId: r.role_id ?? '', agentId: r.agent_id,
    issueIid: r.issue_iid, status: r.status, startedAt: r.started_at, endedAt: r.ended_at,
    logPath: r.log_path, agentName: r.agent_name ?? undefined, roleName: r.role_name ?? undefined
  }))
}
