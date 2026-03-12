import Database from 'better-sqlite3'
import bcrypt from 'bcryptjs'
import path from 'path'
import { User, Project, Slot } from '@/types'

const DB_PATH = path.join(process.cwd(), 'spring-ive.db')

let _db: Database.Database | null = null

function getDb() {
  if (!_db) {
    _db = new Database(DB_PATH)
    _db.pragma('journal_mode = WAL')
    _db.pragma('foreign_keys = ON')
    initSchema(_db)
    seedAdmin(_db)
  }
  return _db
}

function initSchema(db: Database.Database) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS users (
      id TEXT PRIMARY KEY,
      email TEXT NOT NULL UNIQUE,
      name TEXT NOT NULL,
      password_hash TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS projects (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL,
      name TEXT NOT NULL,
      provider TEXT NOT NULL CHECK(provider IN ('github', 'gitlab')),
      repo_url TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS slots (
      id TEXT PRIMARY KEY,
      project_id TEXT NOT NULL,
      name TEXT NOT NULL,
      role TEXT NOT NULL CHECK(role IN ('development', 'verification', 'review')),
      status TEXT NOT NULL DEFAULT 'idle' CHECK(status IN ('active', 'idle', 'paused')),
      access_token TEXT NOT NULL,
      max_agents INTEGER NOT NULL DEFAULT 1,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE
    );
  `)
}

function seedAdmin(db: Database.Database) {
  const exists = db.prepare('SELECT id FROM users WHERE email = ?').get('admin@ive.local')
  if (!exists) {
    const hash = bcrypt.hashSync('admin', 10)
    db.prepare(
      'INSERT INTO users (id, email, name, password_hash) VALUES (?, ?, ?, ?)'
    ).run('admin-001', 'admin@ive.local', '관리자', hash)
  }
}

// ── Users ──

interface UserRow {
  id: string; email: string; name: string; password_hash: string; created_at: string
}

export function getUserByEmail(email: string): (User & { passwordHash: string }) | null {
  const r = getDb().prepare('SELECT * FROM users WHERE email = ?').get(email) as UserRow | undefined
  if (!r) return null
  return { id: r.id, email: r.email, name: r.name, passwordHash: r.password_hash, createdAt: r.created_at }
}

export function getUserById(id: string): User | null {
  const r = getDb().prepare('SELECT id, email, name, created_at FROM users WHERE id = ?').get(id) as {
    id: string; email: string; name: string; created_at: string
  } | undefined
  if (!r) return null
  return { id: r.id, email: r.email, name: r.name, createdAt: r.created_at }
}

export function createUser(id: string, email: string, name: string, passwordHash: string) {
  getDb().prepare(
    'INSERT INTO users (id, email, name, password_hash) VALUES (?, ?, ?, ?)'
  ).run(id, email, name, passwordHash)
}

// ── Projects ──

export function getProjectsByUser(userId: string): Project[] {
  const rows = getDb().prepare('SELECT * FROM projects WHERE user_id = ? ORDER BY created_at DESC').all(userId) as {
    id: string; user_id: string; name: string; provider: string; repo_url: string; created_at: string
  }[]
  return rows.map(r => ({
    id: r.id, userId: r.user_id, name: r.name, provider: r.provider as Project['provider'],
    repoUrl: r.repo_url, createdAt: r.created_at,
  }))
}

export function getProject(id: string): Project | null {
  const r = getDb().prepare('SELECT * FROM projects WHERE id = ?').get(id) as {
    id: string; user_id: string; name: string; provider: string; repo_url: string; created_at: string
  } | undefined
  if (!r) return null
  return { id: r.id, userId: r.user_id, name: r.name, provider: r.provider as Project['provider'], repoUrl: r.repo_url, createdAt: r.created_at }
}

export function createProject(p: Project) {
  getDb().prepare(
    'INSERT INTO projects (id, user_id, name, provider, repo_url, created_at) VALUES (?, ?, ?, ?, ?, ?)'
  ).run(p.id, p.userId, p.name, p.provider, p.repoUrl, p.createdAt)
}

export function updateProject(p: Project) {
  getDb().prepare(
    'UPDATE projects SET name = ?, provider = ?, repo_url = ? WHERE id = ? AND user_id = ?'
  ).run(p.name, p.provider, p.repoUrl, p.id, p.userId)
}

export function deleteProject(id: string, userId: string) {
  getDb().prepare('DELETE FROM projects WHERE id = ? AND user_id = ?').run(id, userId)
}

// ── Slots ──

export function getSlotsByProject(projectId: string): Slot[] {
  const rows = getDb().prepare('SELECT * FROM slots WHERE project_id = ? ORDER BY created_at ASC').all(projectId) as {
    id: string; project_id: string; name: string; role: string; status: string;
    access_token: string; max_agents: number; created_at: string
  }[]
  return rows.map(r => ({
    id: r.id, projectId: r.project_id, name: r.name,
    role: r.role as Slot['role'], status: r.status as Slot['status'],
    accessToken: r.access_token, maxAgents: r.max_agents, createdAt: r.created_at,
  }))
}

export function createSlot(s: Slot) {
  getDb().prepare(
    'INSERT INTO slots (id, project_id, name, role, status, access_token, max_agents, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)'
  ).run(s.id, s.projectId, s.name, s.role, s.status, s.accessToken, s.maxAgents, s.createdAt)
}

export function updateSlot(s: Slot) {
  getDb().prepare(
    'UPDATE slots SET name = ?, role = ?, status = ?, max_agents = ? WHERE id = ?'
  ).run(s.name, s.role, s.status, s.maxAgents, s.id)
}

export function deleteSlot(id: string) {
  getDb().prepare('DELETE FROM slots WHERE id = ?').run(id)
}
