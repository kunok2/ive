/**
 * 테스트용 인메모리 SQLite DB 헬퍼
 * 실제 DB 스키마를 그대로 사용하되, 인메모리로 격리된 환경을 제공
 */
import Database from 'better-sqlite3'

// global.db를 인메모리 DB로 교체
export function setupTestDb(): Database.Database {
  const db = new Database(':memory:')
  db.pragma('foreign_keys = ON')

  // 테스트에 필요한 최소 스키마
  db.exec(`
    CREATE TABLE token_pricing (
      id TEXT PRIMARY KEY,
      cli_name TEXT NOT NULL,
      model_name TEXT NOT NULL UNIQUE,
      input_price REAL NOT NULL,
      output_price REAL NOT NULL,
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE users (
      id TEXT PRIMARY KEY,
      email TEXT UNIQUE NOT NULL,
      password TEXT NOT NULL DEFAULT '',
      name TEXT NOT NULL,
      avatar TEXT NOT NULL DEFAULT 'av-01',
      is_admin INTEGER NOT NULL DEFAULT 0,
      max_agents INTEGER NOT NULL DEFAULT 1,
      max_turns INTEGER NOT NULL DEFAULT 20,
      rate_multiplier REAL NOT NULL DEFAULT 1.0,
      oauth_provider_id TEXT,
      oauth_user_id TEXT,
      oauth_access_token TEXT,
      oauth_refresh_token TEXT,
      oauth_token_expires_at TEXT,
      gitlab_username TEXT,
      github_username TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE oauth_providers (
      id TEXT PRIMARY KEY,
      type TEXT NOT NULL CHECK(type IN ('github', 'gitlab')),
      name TEXT NOT NULL,
      base_url TEXT NOT NULL,
      client_id TEXT NOT NULL,
      client_secret TEXT NOT NULL,
      enabled INTEGER NOT NULL DEFAULT 1,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE projects (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL,
      name TEXT NOT NULL,
      provider TEXT NOT NULL CHECK(provider IN ('github', 'gitlab')),
      repo_url TEXT NOT NULL DEFAULT '',
      auth_type TEXT NOT NULL DEFAULT 'token',
      git_username TEXT NOT NULL DEFAULT '',
      access_token TEXT NOT NULL DEFAULT '',
      color TEXT NOT NULL DEFAULT '#4ade80',
      label_target TEXT NOT NULL DEFAULT 'IVE',
      label_schedule TEXT NOT NULL DEFAULT 'IVE-S',
      label_dev TEXT NOT NULL DEFAULT 'IVE-D',
      label_verify_wait TEXT NOT NULL DEFAULT 'IVE-W',
      label_verify TEXT NOT NULL DEFAULT 'IVE-V',
      label_confirm_wait TEXT NOT NULL DEFAULT 'IVE-P',
      label_confirm TEXT NOT NULL DEFAULT 'IVE-C',
      label_end TEXT NOT NULL DEFAULT 'IVE-E',
      label_notify TEXT NOT NULL DEFAULT 'IVE-N',
      base_branch TEXT NOT NULL DEFAULT '',
      confirm_base_branch TEXT NOT NULL DEFAULT '',
      test_site_url TEXT NOT NULL DEFAULT '',
      show_tool_usage INTEGER NOT NULL DEFAULT 0,
      check_interval INTEGER NOT NULL DEFAULT 1,
      last_checked_at TEXT,
      last_scanned_issue_count INTEGER,
      last_verify_waiting_count INTEGER,
      scanner_active INTEGER NOT NULL DEFAULT 0,
      uses_oauth_token INTEGER NOT NULL DEFAULT 0,
      last_error TEXT,
      last_error_at TEXT,
      sort_order INTEGER NOT NULL DEFAULT 0,
      avatar_url TEXT NOT NULL DEFAULT '',
      snapshot_interval INTEGER NOT NULL DEFAULT 1,
      sparkline_points INTEGER NOT NULL DEFAULT 60,
      stats_retention INTEGER NOT NULL DEFAULT 7,
      conflict_count INTEGER NOT NULL DEFAULT 0,
      last_activity_at TEXT,
      slack_notify_channel TEXT NOT NULL DEFAULT '',
      slack_workspace_id TEXT NOT NULL DEFAULT '',
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
    );

    CREATE TABLE agents (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL,
      name TEXT NOT NULL,
      avatar TEXT NOT NULL DEFAULT 'av-01',
      cli_name TEXT NOT NULL CHECK(cli_name IN ('claude', 'agy', 'codex', 'opencode', 'gemini')),
      cli_path TEXT NOT NULL DEFAULT '',
      cli_version TEXT NOT NULL DEFAULT '',
      model TEXT NOT NULL DEFAULT '',
      max_turns INTEGER NOT NULL DEFAULT 200,
      status TEXT NOT NULL DEFAULT 'available' CHECK(status IN ('available', 'busy', 'offline')),
      snapshot_interval INTEGER NOT NULL DEFAULT 1,
      sparkline_points INTEGER NOT NULL DEFAULT 60,
      stats_retention INTEGER NOT NULL DEFAULT 7,
      enabled INTEGER NOT NULL DEFAULT 1,
      paused_until TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
    );

    CREATE TABLE project_assignments (
      id TEXT PRIMARY KEY,
      project_id TEXT NOT NULL,
      agent_id TEXT NOT NULL,
      access_token TEXT NOT NULL DEFAULT '',
      assigned_at TEXT NOT NULL DEFAULT (datetime('now')),
      FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE,
      FOREIGN KEY (agent_id) REFERENCES agents(id) ON DELETE CASCADE,
      UNIQUE(project_id, agent_id)
    );

    CREATE TABLE task_executions (
      id TEXT PRIMARY KEY,
      project_id TEXT NOT NULL,
      agent_id TEXT DEFAULT NULL,
      issue_iid INTEGER NOT NULL,
      status TEXT NOT NULL CHECK(status IN ('running', 'success', 'failed', 'assigned')),
      started_at TEXT NOT NULL DEFAULT (datetime('now')),
      ended_at TEXT,
      log_path TEXT NOT NULL DEFAULT '',
      pid INTEGER,
      input_tokens INTEGER NOT NULL DEFAULT 0,
      output_tokens INTEGER NOT NULL DEFAULT 0,
      cost_usd REAL NOT NULL DEFAULT 0,
      issue_title TEXT,
      turns INTEGER NOT NULL DEFAULT 0,
      issue_created_at TEXT,
      model_name TEXT,
      verified_at TEXT,
      assignee_type TEXT NOT NULL DEFAULT 'agent' CHECK(assignee_type IN ('agent', 'user')),
      user_id TEXT DEFAULT NULL,
      user_name TEXT DEFAULT NULL,
      user_avatar TEXT DEFAULT NULL,
      verifier_name TEXT DEFAULT NULL,
      verifier_avatar TEXT DEFAULT NULL,
      verify_started_at TEXT DEFAULT NULL,
      rejected_at TEXT DEFAULT NULL,
      verifier_username TEXT DEFAULT NULL,
      verifier_git_user_id TEXT DEFAULT NULL,
      verifier_user_id TEXT DEFAULT NULL,
      cache_read_input_tokens INTEGER NOT NULL DEFAULT 0,
      cache_creation_input_tokens INTEGER NOT NULL DEFAULT 0,
      work_sec INTEGER NOT NULL DEFAULT 0,
      stage_verdict TEXT DEFAULT NULL,
      FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE
    );

    CREATE TABLE project_shares (
      id TEXT PRIMARY KEY,
      project_id TEXT NOT NULL,
      user_id TEXT NOT NULL,
      role TEXT NOT NULL DEFAULT 'viewer',
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE
    );

    CREATE TABLE issue_stages (
      project_id TEXT NOT NULL,
      issue_iid INTEGER NOT NULL,
      stage TEXT NOT NULL DEFAULT 'waiting',
      updated_at TEXT NOT NULL DEFAULT (datetime('now')),
      fail_reason TEXT DEFAULT NULL,
      preferred_agent_id TEXT DEFAULT NULL,
      scheduled_at TEXT DEFAULT NULL,
      assign_mode TEXT DEFAULT 'auto',
      assignee_username TEXT DEFAULT NULL,
      assignee_name TEXT DEFAULT NULL,
      assignee_avatar TEXT DEFAULT NULL,
      assignee_provider TEXT DEFAULT NULL,
      cached_stage TEXT DEFAULT NULL,
      issue_title TEXT DEFAULT NULL,
      verify_waiting_since TEXT DEFAULT NULL,
      assignee_git_user_id TEXT DEFAULT NULL,
      confirm_started_at TEXT DEFAULT NULL,
      confirmed_at TEXT DEFAULT NULL,
      confirmer_user_id TEXT DEFAULT NULL,
      confirmer_name TEXT DEFAULT NULL,
      confirmer_avatar TEXT DEFAULT NULL,
      PRIMARY KEY (project_id, issue_iid),
      FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE
    );

    -- 역할 명부 (보고서가 사람 단가 배수를 「프로젝트 × 사람 × 역할」로 읽는다)
    CREATE TABLE project_role_members (
      project_id TEXT NOT NULL,
      subject_type TEXT NOT NULL,
      subject_id TEXT NOT NULL,
      git_user_id TEXT DEFAULT NULL,
      name TEXT NOT NULL DEFAULT '',
      avatar TEXT NOT NULL DEFAULT '',
      can_process INTEGER NOT NULL DEFAULT 0,
      can_verify INTEGER NOT NULL DEFAULT 0,
      can_confirm INTEGER NOT NULL DEFAULT 0,
      rate_process REAL NOT NULL DEFAULT 1,
      rate_verify REAL NOT NULL DEFAULT 1,
      rate_confirm REAL NOT NULL DEFAULT 1,
      source TEXT NOT NULL DEFAULT 'manual',
      updated_by TEXT DEFAULT NULL,
      updated_at TEXT NOT NULL DEFAULT (datetime('now')),
      PRIMARY KEY (project_id, subject_type, subject_id)
    );

    CREATE TABLE system_settings (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL,
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE stat_snapshots (
      id TEXT PRIMARY KEY,
      entity_type TEXT NOT NULL CHECK(entity_type IN ('project', 'agent', 'verifier')),
      entity_id TEXT NOT NULL,
      timestamp TEXT NOT NULL,
      running INTEGER NOT NULL DEFAULT 0,
      waiting INTEGER NOT NULL DEFAULT 0,
      verify_waiting INTEGER NOT NULL DEFAULT 0,
      completed INTEGER NOT NULL DEFAULT 0,
      failed INTEGER NOT NULL DEFAULT 0,
      total_tokens INTEGER NOT NULL DEFAULT 0,
      cost_usd REAL NOT NULL DEFAULT 0
    );
    CREATE INDEX idx_stat_snapshots_entity ON stat_snapshots(entity_type, entity_id, timestamp);

    CREATE TABLE stat_daily_summaries (
      id TEXT PRIMARY KEY,
      entity_type TEXT NOT NULL CHECK(entity_type IN ('project', 'agent', 'verifier')),
      entity_id TEXT NOT NULL,
      date TEXT NOT NULL,
      avg_running REAL NOT NULL DEFAULT 0,
      avg_waiting REAL NOT NULL DEFAULT 0,
      avg_verify_waiting REAL NOT NULL DEFAULT 0,
      avg_completed REAL NOT NULL DEFAULT 0,
      avg_failed REAL NOT NULL DEFAULT 0,
      avg_total_tokens REAL NOT NULL DEFAULT 0,
      avg_cost_usd REAL NOT NULL DEFAULT 0,
      sample_count INTEGER NOT NULL DEFAULT 0,
      UNIQUE(entity_type, entity_id, date)
    );
  `)

  // global.db를 교체
  ;(globalThis as any).db = db

  return db
}

export function teardownTestDb() {
  const db = (globalThis as any).db as Database.Database | undefined
  if (db) {
    db.close()
    ;(globalThis as any).db = undefined
  }
}

// ── 시드 데이터 생성 헬퍼 ──

export function seedUser(db: Database.Database, id: string, name: string, opts?: {
  isAdmin?: boolean
  avatar?: string
  oauthProviderId?: string | null
  oauthUserId?: string | null
  oauthAccessToken?: string | null
  gitlabUsername?: string | null
  githubUsername?: string | null
}) {
  db.prepare(`INSERT INTO users
    (id, email, password, name, avatar, is_admin, oauth_provider_id, oauth_user_id, oauth_access_token,
     gitlab_username, github_username)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`).run(
    id, `${id}@test.com`, 'hash', name, opts?.avatar ?? 'av-01', opts?.isAdmin ? 1 : 0,
    opts?.oauthProviderId ?? null, opts?.oauthUserId ?? null, opts?.oauthAccessToken ?? null,
    opts?.gitlabUsername ?? null, opts?.githubUsername ?? null,
  )
}

export function seedOAuthProvider(db: Database.Database, id: string, type: 'github' | 'gitlab', opts?: {
  baseUrl?: string; clientId?: string; clientSecret?: string; enabled?: boolean
}) {
  db.prepare(`INSERT INTO oauth_providers
    (id, type, name, base_url, client_id, client_secret, enabled)
    VALUES (?, ?, ?, ?, ?, ?, ?)`).run(
    id, type, `${type}-provider`,
    opts?.baseUrl ?? (type === 'gitlab' ? 'https://gitlab.com' : 'https://github.com'),
    opts?.clientId ?? 'client-id',
    opts?.clientSecret ?? 'client-secret',
    opts?.enabled === false ? 0 : 1,
  )
}

export function seedProject(db: Database.Database, id: string, userId: string, name: string, opts?: { provider?: string }) {
  db.prepare('INSERT INTO projects (id, user_id, name, provider) VALUES (?, ?, ?, ?)').run(
    id, userId, name, opts?.provider ?? 'gitlab'
  )
}

export function seedAgent(db: Database.Database, id: string, userId: string, name: string, opts?: { cliName?: string }) {
  db.prepare('INSERT INTO agents (id, user_id, name, cli_name) VALUES (?, ?, ?, ?)').run(
    id, userId, name, opts?.cliName ?? 'claude'
  )
}

export interface SeedExecution {
  id: string
  projectId: string
  agentId?: string | null
  issueIid: number
  issueTitle?: string
  status: 'running' | 'success' | 'failed' | 'assigned'
  startedAt: string
  endedAt?: string | null
  issueCreatedAt?: string | null
  assigneeType?: 'agent' | 'user'
  userId?: string | null
  userName?: string | null
  inputTokens?: number
  outputTokens?: number
  costUsd?: number
  turns?: number
  modelName?: string | null
  verifiedAt?: string | null
  verifyStartedAt?: string | null
  rejectedAt?: string | null
  verifierName?: string | null
  verifierUsername?: string | null
  verifierUserId?: string | null
  cacheReadInputTokens?: number
  cacheCreationInputTokens?: number
}

export interface SeedIssueStage {
  projectId: string
  issueIid: number
  cachedStage?: string | null
  confirmedAt?: string | null
  issueTitle?: string | null
}

export function seedIssueStage(db: Database.Database, s: SeedIssueStage) {
  db.prepare(`
    INSERT INTO issue_stages (project_id, issue_iid, stage, cached_stage, confirmed_at, issue_title)
    VALUES (?, ?, '', ?, ?, ?)
  `).run(s.projectId, s.issueIid, s.cachedStage ?? null, s.confirmedAt ?? null, s.issueTitle ?? null)
}

export function seedExecution(db: Database.Database, ex: SeedExecution) {
  db.prepare(`
    INSERT INTO task_executions (
      id, project_id, agent_id, issue_iid, issue_title, status,
      started_at, ended_at, issue_created_at, assignee_type,
      user_id, user_name, input_tokens, output_tokens, cost_usd, turns,
      model_name, verified_at, verify_started_at, rejected_at,
      verifier_name, verifier_username, verifier_user_id,
      cache_read_input_tokens, cache_creation_input_tokens
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    ex.id, ex.projectId, ex.agentId ?? null, ex.issueIid, ex.issueTitle ?? null, ex.status,
    ex.startedAt, ex.endedAt ?? null, ex.issueCreatedAt ?? null, ex.assigneeType ?? 'agent',
    ex.userId ?? null, ex.userName ?? null, ex.inputTokens ?? 0, ex.outputTokens ?? 0,
    ex.costUsd ?? 0, ex.turns ?? 0, ex.modelName ?? null, ex.verifiedAt ?? null,
    ex.verifyStartedAt ?? null, ex.rejectedAt ?? null, ex.verifierName ?? null,
    ex.verifierUsername ?? null, ex.verifierUserId ?? null,
    ex.cacheReadInputTokens ?? 0, ex.cacheCreationInputTokens ?? 0,
  )
}
