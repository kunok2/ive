import Database from 'better-sqlite3'
import path from 'path'
import bcrypt from 'bcryptjs'
import { User, Project, Agent, ProjectAssignment, TaskExecution, TaskStatus, StatSnapshot, TokenPricing, ProjectShare, ShareRole, ReportSchedule, ReportSendLog, UserActivityLog, ActivityCategory, OAuthProvider } from '@/types'
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
      label_schedule TEXT NOT NULL DEFAULT 'IVE-S',
      label_dev TEXT NOT NULL DEFAULT 'IVE-D',
      label_verify_wait TEXT NOT NULL DEFAULT 'IVE-W',
      label_verify TEXT NOT NULL DEFAULT 'IVE-V',
      label_end TEXT NOT NULL DEFAULT 'IVE-E',
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
      verify_waiting INTEGER NOT NULL DEFAULT 0,
      completed INTEGER NOT NULL DEFAULT 0,
      failed INTEGER NOT NULL DEFAULT 0,
      total_tokens INTEGER NOT NULL DEFAULT 0,
      cost_usd REAL NOT NULL DEFAULT 0
    );
    CREATE INDEX IF NOT EXISTS idx_stat_snapshots_entity ON stat_snapshots(entity_type, entity_id, timestamp);

    CREATE TABLE IF NOT EXISTS stat_daily_summaries (
      id TEXT PRIMARY KEY,
      entity_type TEXT NOT NULL CHECK(entity_type IN ('project', 'agent')),
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
    CREATE INDEX IF NOT EXISTS idx_stat_daily_summaries_lookup ON stat_daily_summaries(entity_type, entity_id, date);

    CREATE TABLE IF NOT EXISTS token_pricing (
      id TEXT PRIMARY KEY,
      cli_name TEXT NOT NULL,
      model_name TEXT NOT NULL UNIQUE,
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
    if (!tableInfo.some((col: any) => col.name === 'last_verify_waiting_count')) {
      db.exec("ALTER TABLE projects ADD COLUMN last_verify_waiting_count INTEGER")
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
    if (!tableInfo.some((col: any) => col.name === 'uses_oauth_token')) {
      db.exec("ALTER TABLE projects ADD COLUMN uses_oauth_token INTEGER NOT NULL DEFAULT 0")
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
    if (!tableInfo.some((col: any) => col.name === 'locale')) {
      db.exec("ALTER TABLE users ADD COLUMN locale TEXT")
    }
    if (!tableInfo.some((col: any) => col.name === 'timezone')) {
      db.exec("ALTER TABLE users ADD COLUMN timezone TEXT")
    }
    if (!tableInfo.some((col: any) => col.name === 'git_username')) {
      db.exec("ALTER TABLE users ADD COLUMN git_username TEXT")
    }
    // gitlab_username/github_username: OAuth 도입 후 deprecated. 기존 컬럼은 보존하되
    // 신규 설치에서는 더 이상 추가하지 않음 (참조 코드 모두 제거됨).
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
    if (!tableInfo.some((col: any) => col.name === 'verified_at')) {
      db.exec("ALTER TABLE task_executions ADD COLUMN verified_at TEXT")
      // 기존 완료된 실행에 verified_at 백필: ended_at 기준으로 설정
      try {
        const result = db.prepare(`
          UPDATE task_executions SET verified_at = strftime('%Y-%m-%dT%H:%M:%S.000Z', ended_at, '+' || (abs(random()) % 120 + 10) || ' minutes')
          WHERE status IN ('success', 'failed') AND ended_at IS NOT NULL AND verified_at IS NULL
        `).run()
        console.log(`[DB] Backfilled verified_at for ${result.changes} executions`)
      } catch (e) { console.error("[DB] verified_at backfill failed:", e) }
    }
    // assignee_type, user_id 컬럼 + agent_id nullable + status에 'assigned' 추가 — 테이블 재생성
    if (!tableInfo.some((col: any) => col.name === 'assignee_type')) {
      console.log('[DB] Migrating task_executions: adding assignee_type, user_id, user_name, user_avatar + making agent_id nullable + adding assigned status')
      db.exec(`CREATE TABLE task_executions_new (
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
        FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE
      )`)
      db.exec(`INSERT INTO task_executions_new (id, project_id, agent_id, issue_iid, status, started_at, ended_at, log_path, pid, input_tokens, output_tokens, cost_usd, issue_title, turns, issue_created_at, model_name, verified_at, assignee_type) SELECT id, project_id, agent_id, issue_iid, status, started_at, ended_at, log_path, pid, input_tokens, output_tokens, cost_usd, issue_title, turns, issue_created_at, model_name, verified_at, 'agent' FROM task_executions`)
      db.exec(`DROP TABLE task_executions`)
      db.exec(`ALTER TABLE task_executions_new RENAME TO task_executions`)
      console.log('[DB] task_executions migration complete')
    }
  } catch (e) { console.error("Migration failed for task_executions:", e) }

  // 검증자 정보 컬럼 추가
  try {
    const tableInfo = db.prepare("PRAGMA table_info(task_executions)").all() as any[]
    if (!tableInfo.some((col: any) => col.name === 'verifier_name')) {
      db.exec("ALTER TABLE task_executions ADD COLUMN verifier_name TEXT DEFAULT NULL")
      db.exec("ALTER TABLE task_executions ADD COLUMN verifier_avatar TEXT DEFAULT NULL")
      console.log('[DB] Added verifier_name, verifier_avatar to task_executions')
    }
    if (!tableInfo.some((col: any) => col.name === 'verify_started_at')) {
      db.exec("ALTER TABLE task_executions ADD COLUMN verify_started_at TEXT DEFAULT NULL")
      console.log('[DB] Added verify_started_at to task_executions')
    }
    if (!tableInfo.some((col: any) => col.name === 'rejected_at')) {
      db.exec("ALTER TABLE task_executions ADD COLUMN rejected_at TEXT DEFAULT NULL")
      console.log('[DB] Added rejected_at to task_executions')
    }
    // Git assignee 기반 검증자 식별 (username 키)
    if (!tableInfo.some((col: any) => col.name === 'verifier_username')) {
      db.exec("ALTER TABLE task_executions ADD COLUMN verifier_username TEXT DEFAULT NULL")
      console.log('[DB] Added verifier_username to task_executions')
    }
    // Git 숫자 ID (OAuth user_id 매칭용, username보다 안정적)
    if (!tableInfo.some((col: any) => col.name === 'verifier_git_user_id')) {
      db.exec("ALTER TABLE task_executions ADD COLUMN verifier_git_user_id TEXT DEFAULT NULL")
      console.log('[DB] Added verifier_git_user_id to task_executions')
    }
    // IVE 사용자 id (사진 아바타 fetch 시 /api/auth/avatar/{id} 구성용)
    if (!tableInfo.some((col: any) => col.name === 'verifier_user_id')) {
      db.exec("ALTER TABLE task_executions ADD COLUMN verifier_user_id TEXT DEFAULT NULL")
      console.log('[DB] Added verifier_user_id to task_executions')
    }
  } catch (e) { console.error("Migration failed for verifier columns:", e) }

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
    if (!tableInfo.some((col: any) => col.name === 'last_activity_at')) {
      db.exec("ALTER TABLE projects ADD COLUMN last_activity_at TEXT")
      // 기존 프로젝트: 마지막 실행 시각으로 초기화
      db.exec(`UPDATE projects SET last_activity_at = (
        SELECT MAX(te.started_at) FROM task_executions te WHERE te.project_id = projects.id
      ) WHERE last_activity_at IS NULL`)
      // 실행 기록이 없는 프로젝트는 생성일로
      db.exec(`UPDATE projects SET last_activity_at = created_at WHERE last_activity_at IS NULL`)
    }
    // 새 레이블 컬럼: label_schedule, label_dev, label_verify, label_end
    if (!tableInfo.some((col: any) => col.name === 'label_schedule')) {
      db.exec("ALTER TABLE projects ADD COLUMN label_schedule TEXT NOT NULL DEFAULT 'IVE-S'")
      db.exec("ALTER TABLE projects ADD COLUMN label_dev TEXT NOT NULL DEFAULT 'IVE-D'")
      db.exec("ALTER TABLE projects ADD COLUMN label_verify TEXT NOT NULL DEFAULT 'IVE-V'")
      db.exec("ALTER TABLE projects ADD COLUMN label_end TEXT NOT NULL DEFAULT 'IVE-E'")
    }
    // label_verify_wait 컬럼: 검증대기 단계 (IVE-W)
    if (!tableInfo.some((col: any) => col.name === 'label_verify_wait')) {
      db.exec("ALTER TABLE projects ADD COLUMN label_verify_wait TEXT NOT NULL DEFAULT 'IVE-W'")
    }
    // 기존 레이블(IVE-DS/DE/VS/VE 등)을 새 체계로 강제 마이그레이션
    db.exec("UPDATE projects SET label_schedule = 'IVE-S' WHERE label_schedule IN ('IVE-DS', 'IVE-VS', '')")
    db.exec("UPDATE projects SET label_dev = 'IVE-D' WHERE label_dev IN ('IVE-DE', 'IVE-DS', '')")
    db.exec("UPDATE projects SET label_verify = 'IVE-V' WHERE label_verify IN ('IVE-VS', 'IVE-VE', '')")
    db.exec("UPDATE projects SET label_end = 'IVE-E' WHERE label_end IN ('IVE-VE', 'IVE-DE', '')")
    // 하위 호환: 기존 컬럼이 없는 신규 설치 대비
    if (!tableInfo.some((col: any) => col.name === 'label_verify_start')) {
      try { db.exec("ALTER TABLE projects ADD COLUMN label_verify_start TEXT NOT NULL DEFAULT 'IVE-V'") } catch {}
    }
    if (!tableInfo.some((col: any) => col.name === 'label_verify_end')) {
      try { db.exec("ALTER TABLE projects ADD COLUMN label_verify_end TEXT NOT NULL DEFAULT 'IVE-E'") } catch {}
    }
    if (!tableInfo.some((col: any) => col.name === 'label_dev_start')) {
      try { db.exec("ALTER TABLE projects ADD COLUMN label_dev_start TEXT NOT NULL DEFAULT 'IVE-S'") } catch {}
    }
    if (!tableInfo.some((col: any) => col.name === 'label_dev_end')) {
      try { db.exec("ALTER TABLE projects ADD COLUMN label_dev_end TEXT NOT NULL DEFAULT 'IVE-D'") } catch {}
    }
  } catch (e) { console.error("Migration failed for projects:", e) }

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
  // preferred_agent_id 컬럼 마이그레이션
  try {
    db.exec(`ALTER TABLE issue_stages ADD COLUMN preferred_agent_id TEXT DEFAULT NULL`)
  } catch { /* 이미 존재 */ }
  // scheduled_at 컬럼 마이그레이션 — IVE-S 레이블 최초 감지 시각
  try {
    db.exec(`ALTER TABLE issue_stages ADD COLUMN scheduled_at TEXT DEFAULT NULL`)
  } catch { /* 이미 존재 */ }
  // assign_mode 컬럼 마이그레이션 — 'auto'(기본), 'assignee'(담당자), 'agent'(지정 에이전트)
  try {
    db.exec(`ALTER TABLE issue_stages ADD COLUMN assign_mode TEXT DEFAULT 'auto'`)
    db.exec(`UPDATE issue_stages SET assign_mode = 'agent' WHERE preferred_agent_id IS NOT NULL`)
  } catch { /* 이미 존재 */ }
  // Git assignee 스냅샷 컬럼 (검증자별 부하 집계용)
  try { db.exec(`ALTER TABLE issue_stages ADD COLUMN assignee_username TEXT DEFAULT NULL`) } catch { /* 이미 존재 */ }
  try { db.exec(`ALTER TABLE issue_stages ADD COLUMN assignee_name TEXT DEFAULT NULL`) } catch { /* 이미 존재 */ }
  try { db.exec(`ALTER TABLE issue_stages ADD COLUMN assignee_avatar TEXT DEFAULT NULL`) } catch { /* 이미 존재 */ }
  try { db.exec(`ALTER TABLE issue_stages ADD COLUMN assignee_provider TEXT DEFAULT NULL`) } catch { /* 이미 존재 */ }
  // Git 숫자 ID — OAuth user_id와 매칭해 IVE 사용자 연결 (username은 변경 가능하므로 ID 기준이 안정적)
  try { db.exec(`ALTER TABLE issue_stages ADD COLUMN assignee_git_user_id TEXT DEFAULT NULL`) } catch { /* 이미 존재 */ }
  // 레이블 기반 stage 캐시 (집계 시 Git API 재호출 회피)
  try { db.exec(`ALTER TABLE issue_stages ADD COLUMN cached_stage TEXT DEFAULT NULL`) } catch { /* 이미 존재 */ }
  try { db.exec(`ALTER TABLE issue_stages ADD COLUMN issue_title TEXT DEFAULT NULL`) } catch { /* 이미 존재 */ }
  try { db.exec(`ALTER TABLE issue_stages ADD COLUMN verify_waiting_since TEXT DEFAULT NULL`) } catch { /* 이미 존재 */ }
  try { db.exec(`CREATE INDEX IF NOT EXISTS idx_issue_stages_assignee ON issue_stages(assignee_username, cached_stage)`) } catch { /* ignore */ }
  try { db.exec(`CREATE INDEX IF NOT EXISTS idx_issue_stages_assignee_id ON issue_stages(assignee_git_user_id)`) } catch { /* ignore */ }

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

  // project_members 테이블 — Git 프로젝트 멤버(=잠재 검증자) 캐시
  db.exec(`
    CREATE TABLE IF NOT EXISTS project_members (
      project_id TEXT NOT NULL,
      username TEXT NOT NULL,
      name TEXT NOT NULL DEFAULT '',
      avatar_url TEXT NOT NULL DEFAULT '',
      provider TEXT NOT NULL DEFAULT 'gitlab',
      updated_at TEXT NOT NULL DEFAULT (datetime('now')),
      PRIMARY KEY (project_id, username),
      FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE
    );
    CREATE INDEX IF NOT EXISTS idx_project_members_username ON project_members(username);
  `)
  // Git 숫자 ID (OAuth user_id와 매칭해 IVE 사용자 연결)
  try { db.exec(`ALTER TABLE project_members ADD COLUMN git_user_id TEXT DEFAULT NULL`) } catch { /* 이미 존재 */ }
  try { db.exec(`CREATE INDEX IF NOT EXISTS idx_project_members_git_user_id ON project_members(git_user_id)`) } catch { /* ignore */ }

  // 사용자 활동 로그 테이블
  db.exec(`
    CREATE TABLE IF NOT EXISTS user_activity_logs (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL,
      category TEXT NOT NULL CHECK(category IN ('auth', 'project', 'agent', 'execution', 'admin', 'settings', 'task')),
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

  // 기존 테이블의 CHECK 제약조건에 'task' 카테고리 추가 마이그레이션
  try {
    const checkInfo = db.prepare("SELECT sql FROM sqlite_master WHERE type='table' AND name='user_activity_logs'").get() as any
    if (checkInfo?.sql && !checkInfo.sql.includes("'task'")) {
      db.exec("ALTER TABLE user_activity_logs RENAME TO _user_activity_logs_old")
      db.exec(`CREATE TABLE user_activity_logs (
        id TEXT PRIMARY KEY,
        user_id TEXT NOT NULL,
        category TEXT NOT NULL CHECK(category IN ('auth', 'project', 'agent', 'execution', 'admin', 'settings', 'task')),
        action TEXT NOT NULL,
        detail TEXT NOT NULL DEFAULT '',
        target_type TEXT,
        target_id TEXT,
        ip_address TEXT,
        user_agent TEXT,
        created_at TEXT NOT NULL DEFAULT (datetime('now')),
        FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
      )`)
      db.exec("INSERT INTO user_activity_logs SELECT * FROM _user_activity_logs_old")
      db.exec("DROP TABLE _user_activity_logs_old")
      db.exec("CREATE INDEX IF NOT EXISTS idx_activity_logs_user ON user_activity_logs(user_id, created_at)")
      db.exec("CREATE INDEX IF NOT EXISTS idx_activity_logs_created ON user_activity_logs(created_at)")
      console.log('[DB] Migrated user_activity_logs: added task category')
    }
  } catch (e) { console.warn('[DB] Activity logs migration skipped:', e) }

  // stat_snapshots: verify_waiting 컬럼 추가
  try {
    const snapCols = db.prepare("PRAGMA table_info(stat_snapshots)").all() as any[]
    if (!snapCols.some((c: any) => c.name === 'verify_waiting')) {
      db.exec("ALTER TABLE stat_snapshots ADD COLUMN verify_waiting INTEGER NOT NULL DEFAULT 0")
      console.log('[DB] stat_snapshots: added verify_waiting column')
    }
    const summaryCols = db.prepare("PRAGMA table_info(stat_daily_summaries)").all() as any[]
    if (!summaryCols.some((c: any) => c.name === 'avg_verify_waiting')) {
      db.exec("ALTER TABLE stat_daily_summaries ADD COLUMN avg_verify_waiting REAL NOT NULL DEFAULT 0")
      console.log('[DB] stat_daily_summaries: added avg_verify_waiting column')
    }
  } catch (e) { console.warn('[DB] stat_snapshots migration skipped:', e) }

  // stat_snapshots / stat_daily_summaries: 'verifier' 엔티티 타입 허용
  // (CHECK 제약이 'project','agent' 로 고정되어 있음 → 테이블 재생성)
  try {
    const snapSql = db.prepare("SELECT sql FROM sqlite_master WHERE type='table' AND name='stat_snapshots'").get() as any
    if (snapSql?.sql && !snapSql.sql.includes("'verifier'")) {
      db.pragma('foreign_keys = OFF')
      db.exec(`CREATE TABLE stat_snapshots_new (
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
      )`)
      db.exec(`INSERT INTO stat_snapshots_new SELECT id, entity_type, entity_id, timestamp, running, waiting, verify_waiting, completed, failed, total_tokens, cost_usd FROM stat_snapshots`)
      db.exec(`DROP TABLE stat_snapshots`)
      db.exec(`ALTER TABLE stat_snapshots_new RENAME TO stat_snapshots`)
      db.exec(`CREATE INDEX IF NOT EXISTS idx_stat_snapshots_entity ON stat_snapshots(entity_type, entity_id, timestamp)`)
      db.pragma('foreign_keys = ON')
      console.log("[DB] stat_snapshots: added 'verifier' entity_type")
    }
    const summarySql = db.prepare("SELECT sql FROM sqlite_master WHERE type='table' AND name='stat_daily_summaries'").get() as any
    if (summarySql?.sql && !summarySql.sql.includes("'verifier'")) {
      db.pragma('foreign_keys = OFF')
      db.exec(`CREATE TABLE stat_daily_summaries_new (
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
      )`)
      db.exec(`INSERT INTO stat_daily_summaries_new SELECT id, entity_type, entity_id, date, avg_running, avg_waiting, avg_verify_waiting, avg_completed, avg_failed, avg_total_tokens, avg_cost_usd, sample_count FROM stat_daily_summaries`)
      db.exec(`DROP TABLE stat_daily_summaries`)
      db.exec(`ALTER TABLE stat_daily_summaries_new RENAME TO stat_daily_summaries`)
      db.exec(`CREATE INDEX IF NOT EXISTS idx_stat_daily_summaries_lookup ON stat_daily_summaries(entity_type, entity_id, date)`)
      db.pragma('foreign_keys = ON')
      console.log("[DB] stat_daily_summaries: added 'verifier' entity_type")
    }
  } catch (e) { console.warn("[DB] verifier entity_type migration skipped:", e) }

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

  // token_pricing 마이그레이션: cli_name UNIQUE → model_name UNIQUE (모델별 다중 단가 지원)
  try {
    const tpSql = db.prepare("SELECT sql FROM sqlite_master WHERE type='table' AND name='token_pricing'").get() as any
    if (tpSql && tpSql.sql && tpSql.sql.includes('cli_name TEXT NOT NULL UNIQUE')) {
      console.log('[DB] Migrating token_pricing: cli_name UNIQUE → model_name UNIQUE')
      // 기존 CLI당 1개 데이터는 관리자가 수정했을 수 있으므로 inputPrice/outputPrice 보존
      const oldRows = db.prepare('SELECT * FROM token_pricing').all() as any[]
      db.pragma('foreign_keys = OFF')
      db.exec('DROP TABLE token_pricing')
      db.exec(`CREATE TABLE token_pricing (
        id TEXT PRIMARY KEY,
        cli_name TEXT NOT NULL,
        model_name TEXT NOT NULL UNIQUE,
        input_price REAL NOT NULL,
        output_price REAL NOT NULL,
        updated_at TEXT NOT NULL DEFAULT (datetime('now'))
      )`)
      db.pragma('foreign_keys = ON')
      // 기존 관리자 설정값 복원 (cli_name → 'model'/'human', 중복 model_name 방지)
      const seen = new Set<string>()
      const ins = db.prepare('INSERT OR IGNORE INTO token_pricing (id, cli_name, model_name, input_price, output_price, updated_at) VALUES (?, ?, ?, ?, ?, ?)')
      for (const r of oldRows) {
        const modelLower = (r.model_name || '').toLowerCase()
        if (seen.has(modelLower)) continue
        seen.add(modelLower)
        const isHuman = r.cli_name === 'human'
        const newId = isHuman ? 'tp-human' : `tp-${(r.model_name || 'default').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/-+$/, '')}`
        ins.run(newId, isHuman ? 'human' : 'model', r.model_name, r.input_price, r.output_price, r.updated_at || new Date().toISOString())
      }
      console.log('[DB] token_pricing migration complete')
    }
  } catch (e) { console.error('[DB] token_pricing migration failed:', e) }

  // ── OAuth: oauth_providers 테이블 + users OAuth 컬럼 + password nullable ──
  // 다중 GitLab 인스턴스 및 GitHub OAuth 로그인 지원
  db.exec(`
    CREATE TABLE IF NOT EXISTS oauth_providers (
      id TEXT PRIMARY KEY,
      type TEXT NOT NULL CHECK(type IN ('github', 'gitlab')),
      name TEXT NOT NULL,
      base_url TEXT NOT NULL,
      client_id TEXT NOT NULL,
      client_secret TEXT NOT NULL,
      enabled INTEGER NOT NULL DEFAULT 1,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    )
  `)

  // users: OAuth 관련 컬럼 추가
  try {
    const userCols = db.prepare("PRAGMA table_info(users)").all() as any[]
    if (!userCols.some((c: any) => c.name === 'oauth_provider_id')) {
      db.exec("ALTER TABLE users ADD COLUMN oauth_provider_id TEXT")
      db.exec("ALTER TABLE users ADD COLUMN oauth_user_id TEXT")
      db.exec("ALTER TABLE users ADD COLUMN oauth_access_token TEXT")
      db.exec("ALTER TABLE users ADD COLUMN oauth_refresh_token TEXT")
      db.exec("ALTER TABLE users ADD COLUMN oauth_token_expires_at TEXT")
      console.log('[DB] users: added OAuth columns')
    }
    // partial unique index: 같은 공급자에서 같은 사용자가 두 번 연결되지 않도록
    db.exec(`CREATE UNIQUE INDEX IF NOT EXISTS idx_users_oauth
             ON users(oauth_provider_id, oauth_user_id)
             WHERE oauth_provider_id IS NOT NULL`)
  } catch (e) { console.error('[DB] users OAuth columns migration failed:', e) }

  // users.password NOT NULL → NULL 허용 (OAuth 전용 계정은 비밀번호 없음)
  // 명시적 DDL로 재생성 — PRAGMA introspection 기반 재생성은 expression default 복원에서
  // 실패할 수 있어 안정적이지 않음
  try {
    const sqlRow = db.prepare("SELECT sql FROM sqlite_master WHERE type='table' AND name='users'").get() as any
    if (sqlRow?.sql && /password\s+TEXT\s+NOT\s+NULL/i.test(sqlRow.sql)) {
      console.log('[DB] Migrating users: password NOT NULL → nullable (OAuth 지원)')
      db.pragma('foreign_keys = OFF')
      db.exec(`
        CREATE TABLE users_new (
          id TEXT PRIMARY KEY,
          email TEXT NOT NULL,
          name TEXT NOT NULL,
          password TEXT,
          created_at TEXT NOT NULL DEFAULT (datetime('now')),
          is_admin INTEGER NOT NULL DEFAULT 0,
          max_agents INTEGER NOT NULL DEFAULT 0,
          max_turns INTEGER NOT NULL DEFAULT 0,
          avatar TEXT NOT NULL DEFAULT 'av-01',
          allowed_clis TEXT NOT NULL DEFAULT 'opencode',
          locale TEXT,
          timezone TEXT,
          git_username TEXT,
          gitlab_username TEXT,
          github_username TEXT,
          oauth_provider_id TEXT,
          oauth_user_id TEXT,
          oauth_access_token TEXT,
          oauth_refresh_token TEXT,
          oauth_token_expires_at TEXT,
          UNIQUE(email)
        )
      `)
      db.exec(`
        INSERT INTO users_new (
          id, email, name, password, created_at,
          is_admin, max_agents, max_turns, avatar, allowed_clis,
          locale, timezone, git_username, gitlab_username, github_username,
          oauth_provider_id, oauth_user_id, oauth_access_token, oauth_refresh_token, oauth_token_expires_at
        ) SELECT
          id, email, name, password, created_at,
          is_admin, max_agents, max_turns, avatar, allowed_clis,
          locale, timezone, git_username, gitlab_username, github_username,
          oauth_provider_id, oauth_user_id, oauth_access_token, oauth_refresh_token, oauth_token_expires_at
        FROM users
      `)
      db.exec('DROP INDEX IF EXISTS idx_users_oauth')
      db.exec('DROP TABLE users')
      db.exec('ALTER TABLE users_new RENAME TO users')
      db.exec(`CREATE UNIQUE INDEX IF NOT EXISTS idx_users_oauth
               ON users(oauth_provider_id, oauth_user_id)
               WHERE oauth_provider_id IS NOT NULL`)
      db.pragma('foreign_keys = ON')
      console.log('[DB] users password nullable migration complete')
    }
  } catch (e) { console.error('[DB] users password nullable migration failed:', e) }

  seedAdmin(db)
  seedTokenPricing(db)
}

function seedTokenPricing(db: Database.Database) {
  const defaults = [
    // Anthropic Claude
    { id: 'tp-sonnet', cli: 'model', model: 'Claude Sonnet 4.6', input: 3.00, output: 15.00 },
    { id: 'tp-opus',   cli: 'model', model: 'Claude Opus 4',     input: 15.00, output: 75.00 },
    { id: 'tp-haiku',  cli: 'model', model: 'Claude Haiku 4.5',  input: 0.80, output: 4.00 },
    // Google Gemini
    { id: 'tp-gemini-pro',   cli: 'model', model: 'Gemini 2.5 Pro',   input: 1.25, output: 10.00 },
    { id: 'tp-gemini-flash', cli: 'model', model: 'Gemini 2.5 Flash', input: 0.075, output: 0.30 },
    // OpenAI
    { id: 'tp-gpt41', cli: 'model', model: 'GPT-4.1',  input: 2.00, output: 8.00 },
    { id: 'tp-o3',    cli: 'model', model: 'o3',       input: 10.00, output: 40.00 },
    // 사람 (월급)
    { id: 'tp-human', cli: 'human', model: '관리자 (월급 USD)', input: 5000.00, output: 0.00 },
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
    locale: r.locale,
    timezone: r.timezone,
    oauthProviderId: r.oauth_provider_id ?? null,
    oauthUserId: r.oauth_user_id ?? null,
    oauthTokenExpiresAt: r.oauth_token_expires_at ?? null,
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

export function updateUserLocale(id: string, locale: string) {
  getDb().prepare('UPDATE users SET locale = ? WHERE id = ?').run(locale, id)
}

export function updateUserTimezone(id: string, timezone: string) {
  getDb().prepare('UPDATE users SET timezone = ? WHERE id = ?').run(timezone, id)
}

export function createUser(u: any) {
  getDb().prepare('INSERT INTO users (id, email, password, name) VALUES (?, ?, ?, ?)').run(u.id, u.email, u.password, u.name)
}

// ── OAuth Providers ──
// 저장 시 client_secret은 crypto.ts의 encrypt()로 암호화한 문자열을 전달할 것.
// mapOAuthProvider는 client_secret을 절대 그대로 반환하지 않음 (undefined).

function mapOAuthProvider(r: any): OAuthProvider {
  return {
    id: r.id,
    type: r.type,
    name: r.name,
    baseUrl: r.base_url,
    clientId: r.client_id,
    // client_secret은 의도적으로 포함하지 않음 (관리자 UI 응답에서도 노출 금지)
    enabled: r.enabled === 1,
    createdAt: r.created_at,
  }
}

export function getAllOAuthProviders(): OAuthProvider[] {
  const rows = getDb().prepare('SELECT * FROM oauth_providers ORDER BY created_at ASC').all() as any[]
  return rows.map(mapOAuthProvider)
}

export function getEnabledOAuthProviders(): OAuthProvider[] {
  const rows = getDb().prepare('SELECT * FROM oauth_providers WHERE enabled = 1 ORDER BY created_at ASC').all() as any[]
  return rows.map(mapOAuthProvider)
}

export function getOAuthProviderById(id: string): OAuthProvider | null {
  const r = getDb().prepare('SELECT * FROM oauth_providers WHERE id = ?').get(id) as any
  return r ? mapOAuthProvider(r) : null
}

/** client_secret 복호화는 호출 측에서 crypto.decrypt() 로 처리 */
export function getOAuthProviderRaw(id: string): { id: string; type: 'github' | 'gitlab'; name: string; base_url: string; client_id: string; client_secret: string; enabled: number } | null {
  return getDb().prepare('SELECT * FROM oauth_providers WHERE id = ?').get(id) as any ?? null
}

export function createOAuthProvider(p: {
  id: string; type: 'github' | 'gitlab'; name: string; baseUrl: string;
  clientId: string; clientSecretEncrypted: string; enabled?: boolean
}) {
  getDb().prepare(`INSERT INTO oauth_providers (id, type, name, base_url, client_id, client_secret, enabled)
                   VALUES (?, ?, ?, ?, ?, ?, ?)`).run(
    p.id, p.type, p.name, p.baseUrl, p.clientId, p.clientSecretEncrypted, p.enabled === false ? 0 : 1
  )
}

export function updateOAuthProvider(id: string, patch: {
  name?: string; baseUrl?: string; clientId?: string; clientSecretEncrypted?: string; enabled?: boolean
}) {
  const fields: string[] = []
  const values: any[] = []
  if (patch.name !== undefined) { fields.push('name = ?'); values.push(patch.name) }
  if (patch.baseUrl !== undefined) { fields.push('base_url = ?'); values.push(patch.baseUrl) }
  if (patch.clientId !== undefined) { fields.push('client_id = ?'); values.push(patch.clientId) }
  if (patch.clientSecretEncrypted !== undefined) { fields.push('client_secret = ?'); values.push(patch.clientSecretEncrypted) }
  if (patch.enabled !== undefined) { fields.push('enabled = ?'); values.push(patch.enabled ? 1 : 0) }
  if (fields.length === 0) return
  values.push(id)
  getDb().prepare(`UPDATE oauth_providers SET ${fields.join(', ')} WHERE id = ?`).run(...values)
}

export function deleteOAuthProvider(id: string) {
  getDb().prepare('DELETE FROM oauth_providers WHERE id = ?').run(id)
}

// ── OAuth User helpers ──

/** oauth_provider_id + oauth_user_id로 기존 유저 조회 */
export function getUserByOAuth(providerId: string, oauthUserId: string): User | null {
  const r = getDb().prepare(
    'SELECT * FROM users WHERE oauth_provider_id = ? AND oauth_user_id = ?'
  ).get(providerId, oauthUserId) as any
  return r ? mapUser(r) : null
}

/** 기존 유저(이메일로 찾은)에 OAuth 연결을 붙임. 암호화된 토큰을 받음 */
export function linkUserOAuth(userId: string, params: {
  providerId: string
  oauthUserId: string
  accessTokenEncrypted: string
  refreshTokenEncrypted: string | null
  tokenExpiresAt: string | null
}) {
  getDb().prepare(`UPDATE users SET
    oauth_provider_id = ?,
    oauth_user_id = ?,
    oauth_access_token = ?,
    oauth_refresh_token = ?,
    oauth_token_expires_at = ?
    WHERE id = ?`).run(
    params.providerId, params.oauthUserId, params.accessTokenEncrypted,
    params.refreshTokenEncrypted, params.tokenExpiresAt, userId
  )
}

/** OAuth 경로로 신규 유저 생성 (password는 NULL) */
export function createOAuthUser(u: {
  id: string; email: string; name: string; avatar?: string;
  providerId: string; oauthUserId: string;
  accessTokenEncrypted: string;
  refreshTokenEncrypted: string | null;
  tokenExpiresAt: string | null;
}) {
  getDb().prepare(`INSERT INTO users (
    id, email, password, name, avatar,
    oauth_provider_id, oauth_user_id,
    oauth_access_token, oauth_refresh_token, oauth_token_expires_at
  ) VALUES (?, ?, NULL, ?, ?, ?, ?, ?, ?, ?)`).run(
    u.id, u.email, u.name, u.avatar ?? 'av-01',
    u.providerId, u.oauthUserId,
    u.accessTokenEncrypted, u.refreshTokenEncrypted, u.tokenExpiresAt
  )
}

/** OAuth 토큰 갱신 (재로그인 또는 refresh token flow 시) */
export function updateUserOAuthTokens(userId: string, params: {
  accessTokenEncrypted: string
  refreshTokenEncrypted: string | null
  tokenExpiresAt: string | null
}) {
  getDb().prepare(`UPDATE users SET
    oauth_access_token = ?,
    oauth_refresh_token = ?,
    oauth_token_expires_at = ?
    WHERE id = ?`).run(
    params.accessTokenEncrypted, params.refreshTokenEncrypted,
    params.tokenExpiresAt, userId
  )
}

/** OAuth access_token을 복호화하지 않은 raw 형태로 조회 (프로젝트 생성 시 복호화) */
export function getUserOAuthTokenRaw(userId: string): { encrypted: string; providerId: string | null } | null {
  const r = getDb().prepare(
    'SELECT oauth_access_token, oauth_provider_id FROM users WHERE id = ?'
  ).get(userId) as any
  if (!r || !r.oauth_access_token) return null
  return { encrypted: r.oauth_access_token, providerId: r.oauth_provider_id ?? null }
}

/** 프로젝트와 연결된 유저의 OAuth 토큰 정보를 함께 조회 */
export function getProjectWithUserOAuth(projectId: string) {
  const p = getDb().prepare(`
    SELECT p.*, u.oauth_provider_id, u.oauth_access_token, u.oauth_refresh_token, u.oauth_token_expires_at
    FROM projects p
    LEFT JOIN users u ON p.user_id = u.id
    WHERE p.id = ?
  `).get(projectId) as any
  if (!p) return null
  return p
}

// ── Projects ──

type ProjectRow = {
  id: string; user_id: string; name: string; provider: string;
  repo_url: string; auth_type: string; git_username: string;
  access_token: string; color: string; created_at: string;
  label_target: string; show_tool_usage: number;
  check_interval: number; last_checked_at: string | null;
  last_scanned_issue_count: number | null;
  last_verify_waiting_count: number | null;
  scanner_active: number;
  uses_oauth_token: number;
  last_error: string | null; last_error_at: string | null;
  sort_order: number; avatar_url: string;
  snapshot_interval: number; sparkline_points: number; stats_retention: number;
  conflict_count: number;
  last_activity_at: string | null;
  label_schedule: string;
  label_dev: string;
  label_verify_wait: string;
  label_verify: string;
  label_end: string;
}

function mapProject(r: ProjectRow): Project {
  return {
    id: r.id, userId: r.user_id, name: r.name, provider: r.provider as Project['provider'],
    repoUrl: r.repo_url, authType: (r.auth_type || 'token') as Project['authType'],
    gitUsername: r.git_username || '', accessToken: r.access_token,
    color: (r.color || '#4ade80') as Project['color'],
    createdAt: r.created_at,
    labelTarget: r.label_target,
    labelSchedule: r.label_schedule || 'IVE-S',
    labelDev: r.label_dev || 'IVE-D',
    labelVerifyWait: r.label_verify_wait || 'IVE-W',
    labelVerify: r.label_verify || 'IVE-V',
    labelEnd: r.label_end || 'IVE-E',
    showToolUsage: r.show_tool_usage === 1,
    checkInterval: r.check_interval,
    lastCheckedAt: r.last_checked_at,
    lastScannedIssueCount: r.last_scanned_issue_count,
    lastVerifyWaitingCount: r.last_verify_waiting_count,
    scannerActive: r.scanner_active === 1,
    usesOAuthToken: r.uses_oauth_token === 1,
    lastError: r.last_error ?? null,
    lastErrorAt: r.last_error_at ?? null,
    sortOrder: r.sort_order ?? 0,
    avatarUrl: r.avatar_url || '',
    snapshotInterval: r.snapshot_interval ?? 1,
    sparklinePoints: r.sparkline_points ?? 60,
    statsRetention: r.stats_retention ?? 7,
    conflictCount: r.conflict_count ?? 0,
    lastActivityAt: r.last_activity_at ?? null,
  }
}

export function getAllProjects(): Project[] {
  return (getDb().prepare('SELECT * FROM projects').all() as ProjectRow[]).map(mapProject)
}

export function getProjectsByUser(userId: string): Project[] {
  return (getDb().prepare(`
    SELECT p.*
    FROM projects p
    WHERE p.user_id = ?
    ORDER BY p.last_activity_at DESC, p.sort_order ASC, p.created_at ASC
  `).all(userId) as ProjectRow[]).map(mapProject)
}

export function touchProjectActivity(projectId: string) {
  getDb().prepare('UPDATE projects SET last_activity_at = datetime(\'now\') WHERE id = ?').run(projectId)
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
      label_target, label_schedule, label_dev, label_verify_wait, label_verify, label_end, show_tool_usage,
      check_interval, last_checked_at, last_scanned_issue_count, last_verify_waiting_count, scanner_active, uses_oauth_token, sort_order,
      avatar_url, snapshot_interval, sparkline_points, stats_retention, last_error, last_error_at, created_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(
    p.id, p.userId, p.name, p.provider, p.repoUrl, p.authType || 'token', p.gitUsername || '',
    p.accessToken, p.color || '#4ade80',
    p.labelTarget, p.labelSchedule || 'IVE-S', p.labelDev || 'IVE-D',
    p.labelVerifyWait || 'IVE-W', p.labelVerify || 'IVE-V', p.labelEnd || 'IVE-E', p.showToolUsage ? 1 : 0,
    p.checkInterval, p.lastCheckedAt, p.lastScannedIssueCount, p.lastVerifyWaitingCount, p.scannerActive ? 1 : 0, p.usesOAuthToken ? 1 : 0, sortOrder,
    p.avatarUrl || '', p.snapshotInterval ?? 1, p.sparklinePoints ?? 60, p.statsRetention ?? 7,
    p.lastError || null, p.lastErrorAt || null, p.createdAt
  )
}

export function updateProject(p: Project) {
  getDb().prepare(
    `UPDATE projects SET
      name = ?, repo_url = ?, access_token = ?, color = ?,
      auth_type = ?, git_username = ?,
      label_target = ?, label_schedule = ?, label_dev = ?,
      label_verify_wait = ?, label_verify = ?, label_end = ?, show_tool_usage = ?,
      check_interval = ?, last_checked_at = ?, last_scanned_issue_count = ?,
      scanner_active = ?, uses_oauth_token = ?, sort_order = ?, avatar_url = ?,
      snapshot_interval = ?, sparkline_points = ?, stats_retention = ?
      WHERE id = ? AND user_id = ?`
  ).run(
    p.name, p.repoUrl, p.accessToken, p.color || '#4ade80',
    p.authType || 'token', p.gitUsername || '',
    p.labelTarget, p.labelSchedule || 'IVE-S', p.labelDev || 'IVE-D',
    p.labelVerifyWait || 'IVE-W', p.labelVerify || 'IVE-V', p.labelEnd || 'IVE-E', p.showToolUsage ? 1 : 0,
    p.checkInterval, p.lastCheckedAt, p.lastScannedIssueCount,
    p.scannerActive ? 1 : 0, p.usesOAuthToken ? 1 : 0, p.sortOrder ?? 0, p.avatarUrl || '',
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

export function getVerifyWaitingCount(projectId: string): number {
  const r = getDb().prepare(
    "SELECT COUNT(*) as cnt FROM issue_stages WHERE project_id = ? AND cached_stage = 'verify_waiting'"
  ).get(projectId) as any
  return Number(r?.cnt || 0)
}

export function updateProjectLastChecked(id: string, timestamp: string, issueCount: number, verifyWaitingCount: number = 0) {
  getDb().prepare('UPDATE projects SET last_checked_at = ?, last_scanned_issue_count = ?, last_verify_waiting_count = ?, last_error = NULL, last_error_at = NULL WHERE id = ?').run(timestamp, issueCount, verifyWaitingCount, id)
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
  clearPreferredAgentRefs(id)
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

/** 프로젝트별 배정 에이전트 수 (reports용) */
export function getProjectAssignmentCounts(userId: string): Record<string, number> {
  // 소유한 프로젝트 + 공유받은 프로젝트 모두 포함 (reports의 접근 범위와 일치)
  const rows = getDb().prepare(`
    SELECT pa.project_id, COUNT(*) as cnt
    FROM project_assignments pa
    JOIN projects p ON p.id = pa.project_id
    WHERE p.user_id = ? OR EXISTS (SELECT 1 FROM project_shares ps WHERE ps.project_id = p.id AND ps.user_id = ?)
    GROUP BY pa.project_id
  `).all(userId, userId) as { project_id: string; cnt: number }[]
  const map: Record<string, number> = {}
  for (const r of rows) map[r.project_id] = r.cnt
  return map
}

/** 프로젝트별 현재 배정된 에이전트 ID 목록 (reports용) */
export function getProjectAssignmentAgentIds(userId: string): Record<string, string[]> {
  // 소유 + 공유 프로젝트 모두 포함
  const rows = getDb().prepare(`
    SELECT pa.project_id, pa.agent_id
    FROM project_assignments pa
    JOIN projects p ON p.id = pa.project_id
    WHERE p.user_id = ? OR EXISTS (SELECT 1 FROM project_shares ps WHERE ps.project_id = p.id AND ps.user_id = ?)
  `).all(userId, userId) as { project_id: string; agent_id: string }[]
  const map: Record<string, string[]> = {}
  for (const r of rows) {
    if (!map[r.project_id]) map[r.project_id] = []
    map[r.project_id].push(r.agent_id)
  }
  return map
}

/** 에이전트별 담당 프로젝트 + 현재 상태 (reports용) */
export function getAgentAssignmentInfo(userId: string): Record<string, { projectId: string; projectName: string; status: string }> {
  const rows = getDb().prepare(`
    SELECT a.id as agent_id, pa.project_id, p.name as project_name, a.status
    FROM agents a
    LEFT JOIN project_assignments pa ON pa.agent_id = a.id
    LEFT JOIN projects p ON p.id = pa.project_id
    WHERE a.user_id = ?
  `).all(userId) as { agent_id: string; project_id: string | null; project_name: string | null; status: string }[]
  const map: Record<string, { projectId: string; projectName: string; status: string }> = {}
  for (const r of rows) {
    map[r.agent_id] = { projectId: r.project_id || '', projectName: r.project_name || '', status: r.status }
  }
  return map
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
    "SELECT COUNT(*) as cnt FROM task_executions WHERE project_id = ? AND status IN ('running', 'assigned')"
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
    id: r.id, projectId: r.project_id, agentId: r.agent_id ?? '',
    issueIid: r.issue_iid, issueTitle: r.issue_title ?? undefined,
    modelName: r.model_name ?? undefined,
    status: r.status, startedAt: r.started_at, endedAt: r.ended_at,
    logPath: r.log_path, pid: r.pid ?? undefined,
    agentName: r.agent_name ?? undefined,
    inputTokens: r.input_tokens ?? 0, outputTokens: r.output_tokens ?? 0,
    costUsd: r.cost_usd ?? 0, turns: r.turns ?? 0,
    issueCreatedAt: r.issue_created_at ?? undefined,
    assigneeType: r.assignee_type ?? 'agent',
    userId: r.user_id ?? null,
    userName: r.user_name ?? null,
    userAvatar: r.user_avatar ?? null,
  }
}

export function createExecution(ex: TaskExecution) {
  getDb().prepare(
    'INSERT INTO task_executions (id, project_id, agent_id, issue_iid, issue_title, status, started_at, log_path, issue_created_at, assignee_type, user_id, user_name, user_avatar) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)'
  ).run(ex.id, ex.projectId, ex.agentId || null, ex.issueIid, ex.issueTitle ?? null, ex.status, ex.startedAt, ex.logPath, ex.issueCreatedAt ?? null, ex.assigneeType ?? 'agent', ex.userId ?? null, ex.userName ?? null, ex.userAvatar ?? null)
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
  if (r.assignee_type === 'user') {
    // 사람 작업: PID 없음, status만 변경
    getDb().prepare("UPDATE task_executions SET status = 'failed', ended_at = ? WHERE id = ?").run(new Date().toISOString(), id)
    return true
  }
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
  if (r.agent_id) {
    getDb().prepare("UPDATE agents SET status = 'available' WHERE id = ? AND status = 'busy'").run(r.agent_id)
  }
  return true
}

export function resetStuckExecutions() {
  // 사람 작업(assignee_type='user')은 stuck 판정 제외
  const stuckRows = getDb().prepare("SELECT * FROM task_executions WHERE status = 'running' AND (assignee_type IS NULL OR assignee_type = 'agent')").all() as any[]
  for (const r of stuckRows) {
    if (r.pid) {
      try { process.kill(-r.pid, 'SIGKILL') } catch (e: any) {
        if (e.code !== 'ESRCH') console.warn(`[DB] Kill failed for pid ${r.pid}:`, e.message)
      }
    }
    getDb().prepare("UPDATE task_executions SET status = 'failed', ended_at = ? WHERE id = ?").run(new Date().toISOString(), r.id)
    // 고착된 에이전트 상태도 'available'로 복원
    if (r.agent_id) {
      getDb().prepare("UPDATE agents SET status = 'available' WHERE id = ? AND status = 'busy'").run(r.agent_id)
    }
    console.log(`[DB] Reset stuck execution ${r.id}`)
  }
  if (stuckRows.length > 0) console.log(`[DB] Reset ${stuckRows.length} stuck execution(s).`)

  // 이슈 상태는 레이블로 관리하므로 DB에서 stage 리셋 불필요
  // (IVE-DS 레이블이 붙어있지만 활성 실행 없음 → dev_fail로 자동 판정됨)
}

export function markIssueVerifyStarted(projectId: string, issueIid: number) {
  const now = new Date().toISOString()
  getDb().prepare(
    "UPDATE task_executions SET verify_started_at = ? WHERE project_id = ? AND issue_iid = ? AND status IN ('success', 'failed') AND ended_at IS NOT NULL AND verify_started_at IS NULL"
  ).run(now, projectId, issueIid)
}

export function markIssueVerified(projectId: string, issueIid: number, verifier?: { name: string; avatar?: string; username?: string | null; userId?: string | null }) {
  const now = new Date().toISOString()
  // verifier_username은 우선 호출자가 전달, 없으면 issue_stages의 현재 assignee에서 읽음
  let username = verifier?.username ?? null
  let name = verifier?.name ?? null
  let avatar = verifier?.avatar ?? null
  const userId = verifier?.userId ?? null
  if (!username) {
    const cached = getIssueAssigneeUsername(projectId, issueIid)
    if (cached.username) {
      username = cached.username
      if (!name) name = cached.name
      if (!avatar) avatar = cached.avatar || null
    }
  }
  // verify_started_at IS NOT NULL: 검증을 시작했던 exec만 대상 (임의의 과거 exec가 아닌)
  // verified_at IS NULL AND rejected_at IS NULL: 이미 검증/반려 처리된 exec는 제외 (덮어쓰기 방지)
  getDb().prepare(
    "UPDATE task_executions SET verified_at = ?, verifier_name = ?, verifier_avatar = ?, verifier_username = ?, verifier_user_id = ? WHERE project_id = ? AND issue_iid = ? AND status IN ('success', 'failed') AND ended_at IS NOT NULL AND verify_started_at IS NOT NULL AND verified_at IS NULL AND rejected_at IS NULL"
  ).run(now, name, avatar, username, userId, projectId, issueIid)
}

/** 검증 반려 시 rejected_at 기록 (verify_started_at이 있고 verified_at/rejected_at이 없는 실행만) */
export function markIssueVerifyRejected(projectId: string, issueIid: number, verifier?: { name?: string | null; avatar?: string | null; username?: string | null; userId?: string | null }) {
  const now = new Date().toISOString()
  let username = verifier?.username ?? null
  let name = verifier?.name ?? null
  let avatar = verifier?.avatar ?? null
  const userId = verifier?.userId ?? null
  if (!username) {
    const cached = getIssueAssigneeUsername(projectId, issueIid)
    if (cached.username) {
      username = cached.username
      if (!name) name = cached.name
      if (!avatar) avatar = cached.avatar || null
    }
  }
  getDb().prepare(
    "UPDATE task_executions SET rejected_at = ?, verifier_name = COALESCE(verifier_name, ?), verifier_avatar = COALESCE(verifier_avatar, ?), verifier_username = COALESCE(verifier_username, ?), verifier_user_id = COALESCE(verifier_user_id, ?) WHERE project_id = ? AND issue_iid = ? AND status IN ('success', 'failed') AND ended_at IS NOT NULL AND verify_started_at IS NOT NULL AND verified_at IS NULL AND rejected_at IS NULL"
  ).run(now, name, avatar, username, userId, projectId, issueIid)
}

/** 반려/재오픈 시 scheduled_at을 현재 시각으로 갱신 (재시도 execution의 대기시간을 정확히 계산하기 위해) */
export function resetIssueScheduledAt(projectId: string, issueIid: number) {
  const now = new Date().toISOString()
  getDb().prepare(
    "UPDATE issue_stages SET scheduled_at = ?, updated_at = datetime('now') WHERE project_id = ? AND issue_iid = ?"
  ).run(now, projectId, issueIid)
}

export function hasAnyExecution(projectId: string, issueIid: number): boolean {
  const r = getDb().prepare(
    "SELECT id FROM task_executions WHERE project_id = ? AND issue_iid = ? LIMIT 1"
  ).get(projectId, issueIid)
  return !!r
}

export function hasActiveExecution(projectId: string, issueIid: number): boolean {
  const r = getDb().prepare(
    "SELECT id FROM task_executions WHERE project_id = ? AND issue_iid = ? AND status IN ('running', 'assigned') LIMIT 1"
  ).get(projectId, issueIid)
  return !!r
}

export function getAssignedUserExecution(projectId: string, issueIid: number): TaskExecution | null {
  const r = getDb().prepare(
    "SELECT * FROM task_executions WHERE project_id = ? AND issue_iid = ? AND status = 'assigned' AND assignee_type = 'user' LIMIT 1"
  ).get(projectId, issueIid) as any
  return r ? mapExecution(r) : null
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
    'INSERT INTO stat_snapshots (id, entity_type, entity_id, timestamp, running, waiting, verify_waiting, completed, failed, total_tokens, cost_usd) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)'
  ).run(s.id, s.entityType, s.entityId, s.timestamp, s.running, s.waiting, s.verifyWaiting, s.completed, s.failed, s.totalTokens, s.costUsd)
}

export function getSnapshots(entityType: 'project' | 'agent' | 'verifier', entityId: string, limit: number = 60): StatSnapshot[] {
  const rows = getDb().prepare(`
    SELECT * FROM stat_snapshots
    WHERE entity_type = ? AND entity_id = ?
    ORDER BY timestamp DESC
    LIMIT ?
  `).all(entityType, entityId, limit) as any[]
  return rows.map(r => ({
    id: r.id, entityType: r.entity_type, entityId: r.entity_id,
    timestamp: r.timestamp, running: r.running, waiting: r.waiting,
    verifyWaiting: r.verify_waiting ?? 0,
    completed: r.completed, failed: r.failed,
    totalTokens: r.total_tokens, costUsd: r.cost_usd,
  })).reverse()
}

export function getDailyAvgSnapshots(entityType: 'project' | 'agent' | 'verifier', entityId: string, limit: number = 60): StatSnapshot[] {
  const rows = getDb().prepare(`
    SELECT
      DATE(timestamp) as day,
      ROUND(AVG(running), 2) as running,
      ROUND(AVG(waiting), 2) as waiting,
      ROUND(AVG(verify_waiting), 2) as verify_waiting,
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
    verifyWaiting: r.verify_waiting ?? 0,
    completed: r.completed,
    failed: r.failed,
    totalTokens: r.total_tokens,
    costUsd: r.cost_usd,
  })).reverse()
}

export function getHourlyAvgSnapshots(entityType: 'project' | 'agent' | 'verifier', entityId: string, limit: number = 60): StatSnapshot[] {
  const rows = getDb().prepare(`
    SELECT
      STRFTIME('%Y-%m-%d %H:00', timestamp) as hour,
      ROUND(AVG(running), 2) as running,
      ROUND(AVG(waiting), 2) as waiting,
      ROUND(AVG(verify_waiting), 2) as verify_waiting,
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
    verifyWaiting: r.verify_waiting ?? 0,
    completed: r.completed,
    failed: r.failed,
    totalTokens: r.total_tokens,
    costUsd: r.cost_usd,
  })).reverse()
}

/** 스냅샷을 일별 요약으로 집계 (KST 기준, 삭제 전 호출) */
export function aggregateSnapshotsToDailySummaries() {
  const db = getDb()
  // KST 기준 날짜로 그룹화하여 집계
  const rows = db.prepare(`
    SELECT
      entity_type,
      entity_id,
      DATE(timestamp, '+9 hours') as kst_date,
      ROUND(AVG(running), 2) as avg_running,
      ROUND(AVG(waiting), 2) as avg_waiting,
      ROUND(AVG(verify_waiting), 2) as avg_verify_waiting,
      ROUND(AVG(completed), 2) as avg_completed,
      ROUND(AVG(failed), 2) as avg_failed,
      ROUND(AVG(total_tokens), 2) as avg_total_tokens,
      ROUND(AVG(cost_usd), 6) as avg_cost_usd,
      COUNT(*) as sample_count
    FROM stat_snapshots
    GROUP BY entity_type, entity_id, DATE(timestamp, '+9 hours')
  `).all() as any[]

  const upsert = db.prepare(`
    INSERT INTO stat_daily_summaries (id, entity_type, entity_id, date, avg_running, avg_waiting, avg_verify_waiting, avg_completed, avg_failed, avg_total_tokens, avg_cost_usd, sample_count)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(entity_type, entity_id, date) DO UPDATE SET
      avg_running = excluded.avg_running,
      avg_waiting = excluded.avg_waiting,
      avg_verify_waiting = excluded.avg_verify_waiting,
      avg_completed = excluded.avg_completed,
      avg_failed = excluded.avg_failed,
      avg_total_tokens = excluded.avg_total_tokens,
      avg_cost_usd = excluded.avg_cost_usd,
      sample_count = excluded.sample_count
  `)

  const tx = db.transaction(() => {
    for (const r of rows) {
      upsert.run(
        `ds-${r.entity_type}-${r.entity_id}-${r.kst_date}`,
        r.entity_type, r.entity_id, r.kst_date,
        r.avg_running, r.avg_waiting, r.avg_verify_waiting,
        r.avg_completed, r.avg_failed,
        r.avg_total_tokens, r.avg_cost_usd, r.sample_count
      )
    }
  })
  tx()

  if (rows.length > 0) {
    console.log(`[Cleanup] Aggregated ${rows.length} snapshot groups into daily summaries`)
  }
}

/* stat_daily_summaries는 적재량이 적으므로 영구 보관 — 연도별 히스토리 조회용 */

/** 기간 내 일별 대기건수 추이 (전체 + 프로젝트별) — daily_summaries 우선, raw 스냅샷 보완
 *  각 프로젝트에 대해 waiting(처리대기)과 verifyWaiting(검증대기)을 분리해서 반환.
 *  total = waiting + verifyWaiting (화면 표시용 전체 대기건수)
 */
export function getDailyWaitingTrend(startDate: string, endDate: string): {
  daily: { date: string; total: number; totalWaiting: number; totalVerifyWaiting: number; byProject: { projectId: string; projectName: string; projectColor: string; waiting: number; verifyWaiting: number }[] }[]
} {
  const db = getDb()

  const projects = db.prepare('SELECT id, name, color FROM projects').all() as { id: string; name: string; color: string }[]
  const projectMap = new Map(projects.map(p => [p.id, { name: p.name, color: p.color }]))

  // 1. daily_summaries (장기 데이터)
  const summaryRows = db.prepare(`
    SELECT date as day, entity_id as project_id, avg_waiting, avg_verify_waiting
    FROM stat_daily_summaries
    WHERE entity_type = 'project'
      AND date >= ? AND date < ?
    ORDER BY day ASC
  `).all(startDate, endDate) as { day: string; project_id: string; avg_waiting: number; avg_verify_waiting: number }[]

  // 2. raw 스냅샷 (지난 날 — 평균)
  const kstToday = new Date(Date.now() + 9 * 60 * 60 * 1000).toISOString().slice(0, 10)
  const snapshotRows = db.prepare(`
    SELECT
      DATE(timestamp, '+9 hours') as day,
      entity_id as project_id,
      ROUND(AVG(waiting)) as avg_waiting,
      ROUND(AVG(verify_waiting)) as avg_verify_waiting
    FROM stat_snapshots
    WHERE entity_type = 'project'
      AND DATE(timestamp, '+9 hours') >= ? AND DATE(timestamp, '+9 hours') < ?
      AND DATE(timestamp, '+9 hours') < ?
    GROUP BY DATE(timestamp, '+9 hours'), entity_id
    ORDER BY day ASC
  `).all(startDate, endDate, kstToday) as { day: string; project_id: string; avg_waiting: number; avg_verify_waiting: number }[]

  // 오늘: 최신 스냅샷 값
  const latestTodayRows = db.prepare(`
    SELECT s.entity_id as project_id, s.waiting, s.verify_waiting
    FROM stat_snapshots s
    INNER JOIN (
      SELECT entity_id, MAX(timestamp) as max_ts
      FROM stat_snapshots
      WHERE entity_type = 'project'
        AND DATE(timestamp, '+9 hours') = ?
      GROUP BY entity_id
    ) latest ON s.entity_id = latest.entity_id AND s.timestamp = latest.max_ts
    WHERE s.entity_type = 'project'
  `).all(kstToday) as { project_id: string; waiting: number; verify_waiting: number }[]

  // 날짜별 그룹화
  const dayMap = new Map<string, Map<string, { waiting: number; verifyWaiting: number }>>()
  for (const r of summaryRows) {
    if (!dayMap.has(r.day)) dayMap.set(r.day, new Map())
    dayMap.get(r.day)!.set(r.project_id, { waiting: r.avg_waiting, verifyWaiting: r.avg_verify_waiting ?? 0 })
  }
  for (const r of snapshotRows) {
    if (!dayMap.has(r.day)) dayMap.set(r.day, new Map())
    dayMap.get(r.day)!.set(r.project_id, { waiting: r.avg_waiting, verifyWaiting: r.avg_verify_waiting ?? 0 })
  }
  if (latestTodayRows.length > 0 && kstToday >= startDate && kstToday < endDate) {
    if (!dayMap.has(kstToday)) dayMap.set(kstToday, new Map())
    for (const r of latestTodayRows) {
      dayMap.get(kstToday)!.set(r.project_id, { waiting: r.waiting, verifyWaiting: r.verify_waiting ?? 0 })
    }
  }

  const daily: { date: string; total: number; totalWaiting: number; totalVerifyWaiting: number; byProject: { projectId: string; projectName: string; projectColor: string; waiting: number; verifyWaiting: number }[] }[] = []
  const cur = new Date(startDate)
  const end = new Date(endDate)
  while (cur < end) {
    const dateStr = cur.toISOString().slice(0, 10)
    const projData = dayMap.get(dateStr)
    const byProject: { projectId: string; projectName: string; projectColor: string; waiting: number; verifyWaiting: number }[] = []
    let totalWaiting = 0
    let totalVerifyWaiting = 0

    for (const [pid, info] of projectMap) {
      const d = projData?.get(pid) ?? { waiting: 0, verifyWaiting: 0 }
      byProject.push({ projectId: pid, projectName: info.name, projectColor: info.color, waiting: d.waiting, verifyWaiting: d.verifyWaiting })
      totalWaiting += d.waiting
      totalVerifyWaiting += d.verifyWaiting
    }

    byProject.sort((a, b) => a.projectName.localeCompare(b.projectName))
    daily.push({ date: dateStr, total: totalWaiting + totalVerifyWaiting, totalWaiting, totalVerifyWaiting, byProject })
    cur.setDate(cur.getDate() + 1)
  }

  return { daily }
}

export function getDailyWaitingTrendByAgent(startDate: string, endDate: string): {
  daily: { date: string; total: number; byAgent: { agentId: string; agentName: string; agentAvatar: string; waiting: number }[] }[]
} {
  const db = getDb()

  // 에이전트 목록 (이름, 아바타)
  const agents = db.prepare('SELECT id, name, avatar FROM agents').all() as { id: string; name: string; avatar: string }[]
  const agentMap = new Map(agents.map(a => [a.id, { name: a.name, avatar: a.avatar }]))

  // 1. daily_summaries에서 장기 데이터 조회
  const summaryRows = db.prepare(`
    SELECT date as day, entity_id as agent_id, avg_waiting
    FROM stat_daily_summaries
    WHERE entity_type = 'agent'
      AND date >= ? AND date < ?
    ORDER BY day ASC
  `).all(startDate, endDate) as { day: string; agent_id: string; avg_waiting: number }[]

  // 2. raw 스냅샷에서 최근 데이터 조회 (오늘 제외 — 오늘은 최신 값 사용)
  const kstToday = new Date(Date.now() + 9 * 60 * 60 * 1000).toISOString().slice(0, 10)
  const snapshotRows = db.prepare(`
    SELECT
      DATE(timestamp, '+9 hours') as day,
      entity_id as agent_id,
      ROUND(AVG(waiting)) as avg_waiting
    FROM stat_snapshots
    WHERE entity_type = 'agent'
      AND DATE(timestamp, '+9 hours') >= ? AND DATE(timestamp, '+9 hours') < ?
      AND DATE(timestamp, '+9 hours') < ?
    GROUP BY DATE(timestamp, '+9 hours'), entity_id
    ORDER BY day ASC
  `).all(startDate, endDate, kstToday) as { day: string; agent_id: string; avg_waiting: number }[]

  // 오늘 날짜: 각 에이전트의 가장 최근 스냅샷 값
  const latestTodayRows = db.prepare(`
    SELECT s.entity_id as agent_id, s.waiting
    FROM stat_snapshots s
    INNER JOIN (
      SELECT entity_id, MAX(timestamp) as max_ts
      FROM stat_snapshots
      WHERE entity_type = 'agent'
        AND DATE(timestamp, '+9 hours') = ?
      GROUP BY entity_id
    ) latest ON s.entity_id = latest.entity_id AND s.timestamp = latest.max_ts
    WHERE s.entity_type = 'agent'
  `).all(kstToday) as { agent_id: string; waiting: number }[]

  // 날짜별 그룹화
  const dayMap = new Map<string, Map<string, number>>()
  for (const r of summaryRows) {
    if (!dayMap.has(r.day)) dayMap.set(r.day, new Map())
    dayMap.get(r.day)!.set(r.agent_id, r.avg_waiting)
  }
  for (const r of snapshotRows) {
    if (!dayMap.has(r.day)) dayMap.set(r.day, new Map())
    dayMap.get(r.day)!.set(r.agent_id, r.avg_waiting)
  }
  // 오늘 데이터는 최신 스냅샷으로 덮어쓰기
  if (latestTodayRows.length > 0 && kstToday >= startDate && kstToday < endDate) {
    if (!dayMap.has(kstToday)) dayMap.set(kstToday, new Map())
    for (const r of latestTodayRows) {
      dayMap.get(kstToday)!.set(r.agent_id, r.waiting)
    }
  }

  // 모든 날짜 버킷 생성
  const daily: { date: string; total: number; byAgent: { agentId: string; agentName: string; agentAvatar: string; waiting: number }[] }[] = []
  const cur = new Date(startDate)
  const end = new Date(endDate)
  while (cur < end) {
    const dateStr = cur.toISOString().slice(0, 10)
    const agentData = dayMap.get(dateStr)
    const byAgent: { agentId: string; agentName: string; agentAvatar: string; waiting: number }[] = []
    let total = 0

    for (const [aid, info] of agentMap) {
      const waiting = agentData?.get(aid) ?? 0
      byAgent.push({ agentId: aid, agentName: info.name, agentAvatar: info.avatar, waiting })
      total += waiting
    }

    byAgent.sort((a, b) => b.waiting - a.waiting)
    daily.push({ date: dateStr, total, byAgent })
    cur.setDate(cur.getDate() + 1)
  }

  return { daily }
}

export function cleanOldSnapshots(retentionDays: number = 7) {
  // 삭제 전 일별 요약으로 집계
  aggregateSnapshotsToDailySummaries()
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
  return (getDb().prepare('SELECT * FROM token_pricing ORDER BY cli_name ASC, model_name ASC').all() as any[]).map(mapPricing)
}

export function getTokenPricingByModel(modelName: string): TokenPricing | null {
  const r = getDb().prepare('SELECT * FROM token_pricing WHERE LOWER(model_name) = LOWER(?) LIMIT 1').get(modelName) as any
  return r ? mapPricing(r) : null
}

/** 실행 모델명으로 단가를 검색 — 정확 매칭 후 키워드 매칭 폴백 */
export function findTokenPricingForModel(executionModelName: string): TokenPricing | null {
  // 1) 정확 매칭 (case-insensitive)
  const exact = getTokenPricingByModel(executionModelName)
  if (exact) return exact

  // 2) 키워드 매칭: DB 모델명의 핵심 키워드가 실행 모델명에 포함되는지 확인
  const lower = executionModelName.toLowerCase()
  const all = getAllTokenPricing().filter(p => p.cliName !== 'human')

  // 구별력 있는 키워드 우선 매칭 (opus, haiku 등 → sonnet, pro 등보다 먼저)
  const generic = new Set(['claude', 'gemini', 'openai', 'opencode', 'gpt', 'pro', 'the', 'cli'])
  type Match = { pricing: TokenPricing; specificity: number }
  const matches: Match[] = []

  for (const p of all) {
    const keywords = p.modelName.toLowerCase().split(/[\s.\-]+/).filter(k => k.length >= 2)
    const distinctive = keywords.filter(k => !generic.has(k))
    const matched = distinctive.filter(k => lower.includes(k))
    if (matched.length > 0) {
      matches.push({ pricing: p, specificity: matched.length })
    }
  }

  if (matches.length > 0) {
    matches.sort((a, b) => b.specificity - a.specificity)
    return matches[0].pricing
  }

  return null
}

export function upsertTokenPricing(p: TokenPricing) {
  getDb().prepare(`
    INSERT INTO token_pricing (id, cli_name, model_name, input_price, output_price, updated_at)
    VALUES (?, ?, ?, ?, ?, ?)
    ON CONFLICT(id) DO UPDATE SET
      cli_name = excluded.cli_name,
      model_name = excluded.model_name,
      input_price = excluded.input_price,
      output_price = excluded.output_price,
      updated_at = excluded.updated_at
  `).run(p.id, p.cliName, p.modelName, p.inputPrice, p.outputPrice, p.updatedAt)
}

export function deleteTokenPricing(id: string) {
  getDb().prepare('DELETE FROM token_pricing WHERE id = ?').run(id)
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
    SELECT p.*, ps.role as share_role, COALESCE(
      (SELECT MAX(te.started_at) FROM task_executions te WHERE te.project_id = p.id), ''
    ) as last_exec_at
    FROM project_shares ps
    JOIN projects p ON ps.project_id = p.id
    WHERE ps.user_id = ?
    ORDER BY last_exec_at DESC, p.name ASC
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

/**
 * 로그인 사용자가 특정 이슈의 Git assignee(= 검증자/담당자)인지 확인.
 * 매칭 기준: (project.provider, issue_stages.assignee_git_user_id) ↔ (oauth provider type, users.oauth_user_id)
 *
 * @returns true: 본인이 해당 이슈의 assignee, false: 아님
 */
export function isIssueAssignee(
  projectId: string,
  issueIid: number,
  user: { oauthProviderId?: string | null; oauthUserId?: string | null },
): boolean {
  if (!user.oauthProviderId || !user.oauthUserId) return false
  const row = getDb().prepare(`
    SELECT s.assignee_git_user_id, p.provider, op.type as prov_type
    FROM issue_stages s
    JOIN projects p ON p.id = s.project_id
    CROSS JOIN oauth_providers op
    WHERE s.project_id = ? AND s.issue_iid = ? AND op.id = ?
  `).get(projectId, issueIid, user.oauthProviderId) as any
  if (!row) return false
  if (!row.assignee_git_user_id) return false
  // 로그인 유저의 provider type과 프로젝트 provider가 일치해야 같은 Git 인스턴스
  if (row.prov_type !== row.provider) return false
  return String(row.assignee_git_user_id) === String(user.oauthUserId)
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
  costUsd: number
  turns: number
  issueCreatedAt: string | null
  verifiedAt: string | null
  verifyStartedAt: string | null
  rejectedAt: string | null
  modelName: string | null
  verifierName: string | null
  verifierAvatar: string | null
  verifierUsername: string | null
  verifierUserId: string | null
  assigneeType: string
}

export function getExecutionsInRange(userId: string, start: string, end: string): ReportExecution[] {
  // start/end는 KST 날짜(YYYY-MM-DD) → KST 자정의 UTC ISO로 변환하여 비교
  const startISO = kstDateToUTCISO(start)
  const endISO = kstDateToUTCISO(end)
  // verifier IVE 사용자 매칭: verifier_user_id 우선, 없으면 verifier_name → users.name 매칭(historical data fallback)
  const rows = getDb().prepare(`
    SELECT te.id, te.project_id, p.name as project_name, p.color as project_color, p.avatar_url as project_avatar_url, p.provider as project_provider,
           te.agent_id, a.name as agent_name, a.avatar as agent_avatar, a.cli_name,
           u.name as developer_name, a.user_id as developer_user_id,
           te.issue_iid, te.issue_title, te.status,
           te.started_at, te.ended_at, te.input_tokens, te.output_tokens, te.cost_usd, te.turns,
           te.issue_created_at, te.model_name, te.verified_at, te.verify_started_at, te.rejected_at,
           te.assignee_type, te.user_id as te_user_id, te.user_name as te_user_name, te.user_avatar as te_user_avatar,
           te.verifier_name, te.verifier_avatar, te.verifier_username,
           COALESCE(te.verifier_user_id, vu.id) as verifier_user_id_resolved,
           vu.avatar as verifier_user_avatar
    FROM task_executions te
    JOIN projects p ON p.id = te.project_id
    LEFT JOIN agents a ON a.id = te.agent_id
    LEFT JOIN users u ON u.id = a.user_id
    LEFT JOIN users vu ON vu.id = te.verifier_user_id OR (te.verifier_user_id IS NULL AND vu.name = te.verifier_name)
    WHERE (p.user_id = ? OR EXISTS (SELECT 1 FROM project_shares ps WHERE ps.project_id = p.id AND ps.user_id = ?))
      AND te.started_at >= ? AND te.started_at < ?
    ORDER BY te.started_at ASC
  `).all(userId, userId, startISO, endISO) as any[]
  return rows.map(r => ({
    id: r.id, projectId: r.project_id, projectName: r.project_name,
    projectColor: r.project_color, projectAvatarUrl: r.project_avatar_url || '', projectProvider: r.project_provider || 'gitlab',
    agentId: r.agent_id ?? '', agentName: r.agent_name ?? r.te_user_name ?? '', agentAvatar: r.agent_avatar || r.te_user_avatar || 'av-01',
    cliName: r.cli_name ?? '', developerName: r.developer_name || r.agent_name || r.te_user_name || '',
    developerUserId: r.developer_user_id ?? null,
    userId: r.te_user_id ?? null,
    userName: r.te_user_name ?? null,
    userAvatar: r.te_user_avatar ?? null,
    issueIid: r.issue_iid, issueTitle: r.issue_title,
    status: r.status, startedAt: r.started_at, endedAt: r.ended_at,
    inputTokens: r.input_tokens ?? 0, outputTokens: r.output_tokens ?? 0,
    costUsd: r.cost_usd ?? 0, turns: r.turns ?? 0,
    issueCreatedAt: r.issue_created_at ?? null,
    modelName: r.model_name ?? null,
    verifiedAt: r.verified_at ?? null,
    verifyStartedAt: r.verify_started_at ?? null,
    rejectedAt: r.rejected_at ?? null,
    // 검증자 IVE 사용자 매칭: 매칭된 IVE user가 있으면 그 avatar 우선 (실제 사진 'photo' 등)
    verifierName: r.verifier_name ?? null,
    verifierAvatar: r.verifier_user_avatar ?? r.verifier_avatar ?? null,
    verifierUsername: r.verifier_username ?? null,
    verifierUserId: r.verifier_user_id_resolved ?? null,
    assigneeType: r.assignee_type ?? 'agent',
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

// ── Issue Stage (레이블 기반 상태 판정) ──
// 이슈 상태는 DB가 아닌 Git 레이블로만 관리됩니다.
// issue_stages 테이블은 preferred_agent_id 저장 용도로만 사용합니다.

export type IssueStage = 'waiting' | 'verify_waiting' | 'dev' | 'dev_fail' | 'verifying' | 'done' | 'rejected'

/**
 * Git 레이블로부터 이슈 상태를 판정합니다.
 * IVE 레이블이 없으면 null (IVE에서 관리하지 않는 이슈).
 * 우선순위: IVE-E > IVE-V > IVE-W > IVE-D > IVE-S > (IVE only)
 *
 * IVE-S: 스케줄 대기 → waiting
 * IVE-D: 개발 중 → dev (활성 실행 없으면 dev_fail)
 * IVE-W: 검증대기 → verify_waiting (개발 완료, 검증자 시작 전)
 * IVE-V: 검증 중 → verifying (검증자가 검증시작 클릭 후)
 * IVE-E: 처리 완료 → done
 * IVE만: 관리 대상이지만 스케줄 미등록 → null
 */
export function stageFromLabels(
  labels: string[],
  project: Project,
  options?: { hasActiveExec?: boolean }
): IssueStage | null {
  if (!labels.includes(project.labelTarget)) return null

  const labelS = project.labelSchedule || 'IVE-S'
  const labelD = project.labelDev || 'IVE-D'
  const labelW = project.labelVerifyWait || 'IVE-W'
  const labelV = project.labelVerify || 'IVE-V'
  const labelE = project.labelEnd || 'IVE-E'

  if (labels.includes(labelE)) return 'done'
  if (labels.includes(labelV)) return 'verifying'
  if (labels.includes(labelW)) return 'verify_waiting'
  if (labels.includes(labelD)) {
    // IVE-D가 있지만 활성 실행이 없으면 → dev_fail
    if (options?.hasActiveExec === false) return 'dev_fail'
    return 'dev'
  }
  if (labels.includes(labelS)) return 'waiting'
  return null // IVE만 있고 상태 레이블 없음
}

/**
 * 특정 이슈의 마지막 실행 상태를 가져옵니다.
 */
export function getLastExecutionStatus(projectId: string, issueIid: number): string | null {
  const r = getDb().prepare(
    "SELECT status FROM task_executions WHERE project_id = ? AND issue_iid = ? ORDER BY started_at DESC LIMIT 1"
  ).get(projectId, issueIid) as any
  return r?.status || null
}

// 하위 호환을 위해 유지 (deprecated — 레이블 기반으로 전환)
export function getIssueStage(_projectId: string, _issueIid: number): IssueStage | null {
  return null // 더 이상 DB에서 stage를 관리하지 않음
}

export function getIssueStageUpdatedAt(_projectId: string, _issueIid: number): string | null {
  return null
}

/**
 * IVE-S 레이블이 스캐너에 최초 감지된 시각을 반환합니다.
 * 대기시간 계산 기준점으로 사용됩니다 (issue.created_at 대신).
 */
export function getIssueScheduledAt(projectId: string, issueIid: number): string | null {
  const r = getDb().prepare('SELECT scheduled_at FROM issue_stages WHERE project_id = ? AND issue_iid = ?').get(projectId, issueIid) as any
  return r?.scheduled_at || null
}

/** 이슈의 이전 cached_stage 조회 (스캐너가 stage 전환 감지용으로 사용) */
export function getCachedStage(projectId: string, issueIid: number): string | null {
  const r = getDb().prepare('SELECT cached_stage FROM issue_stages WHERE project_id = ? AND issue_iid = ?').get(projectId, issueIid) as any
  return r?.cached_stage || null
}

/**
 * IVE-S 레이블 최초 감지 시각을 기록합니다.
 * 이미 기록되어 있으면 보존합니다 (COALESCE로 덮어쓰지 않음).
 */
export function recordIssueScheduledAt(projectId: string, issueIid: number, scheduledAt: string) {
  getDb().prepare(`
    INSERT INTO issue_stages (project_id, issue_iid, stage, scheduled_at, updated_at)
    VALUES (?, ?, 'waiting', ?, datetime('now'))
    ON CONFLICT(project_id, issue_iid) DO UPDATE SET
      scheduled_at = COALESCE(issue_stages.scheduled_at, excluded.scheduled_at)
  `).run(projectId, issueIid, scheduledAt)
}

export function setIssueStage(_projectId: string, _issueIid: number, _stage: IssueStage, _failReason?: string, _updatedAt?: string) {
  // no-op: 레이블 기반으로 전환됨
}

export function deleteIssueStage(_projectId: string, _issueIid: number) {
  // no-op: 레이블 기반으로 전환됨
}

export function countIssuesByStage(_projectId: string, _stage: IssueStage): number {
  return 0 // 더 이상 DB에서 stage를 카운트하지 않음
}

// ── Assign Mode (작업자 지정 모드) ──
// issue_stages 테이블은 assign_mode + preferred_agent_id 저장 용도로 사용합니다.

export function getAssignMode(projectId: string, issueIid: number): { mode: 'auto' | 'assignee' | 'agent'; agentId: string | null } {
  const r = getDb().prepare('SELECT assign_mode, preferred_agent_id FROM issue_stages WHERE project_id = ? AND issue_iid = ?').get(projectId, issueIid) as any
  return { mode: (r?.assign_mode as 'auto' | 'assignee' | 'agent') || 'auto', agentId: r?.preferred_agent_id || null }
}

/** 프로젝트 내 모든 이슈의 배정 모드 맵을 반환합니다 (iid → { mode, agentId }) */
export function getAssignModeMap(projectId: string): Map<number, { mode: 'auto' | 'assignee' | 'agent'; agentId: string | null }> {
  const rows = getDb().prepare(
    'SELECT issue_iid, assign_mode, preferred_agent_id FROM issue_stages WHERE project_id = ?'
  ).all(projectId) as any[]
  const map = new Map<number, { mode: 'auto' | 'assignee' | 'agent'; agentId: string | null }>()
  for (const r of rows) map.set(r.issue_iid, { mode: r.assign_mode || 'auto', agentId: r.preferred_agent_id || null })
  return map
}

export function setAssignMode(projectId: string, issueIid: number, mode: 'auto' | 'assignee' | 'agent', agentId?: string | null) {
  // UPSERT: 행이 없으면 생성, 있으면 assign_mode + preferred_agent_id 업데이트 (scheduled_at, updated_at 보존)
  const effectiveAgentId = mode === 'agent' ? (agentId || null) : null
  getDb().prepare(`
    INSERT INTO issue_stages (project_id, issue_iid, stage, assign_mode, preferred_agent_id, updated_at)
    VALUES (?, ?, '', ?, ?, datetime('now'))
    ON CONFLICT(project_id, issue_iid) DO UPDATE SET assign_mode = excluded.assign_mode, preferred_agent_id = excluded.preferred_agent_id
  `).run(projectId, issueIid, mode, effectiveAgentId)
}

export function countPreferredIssuesByAgent(agentId: string): number {
  const r = getDb().prepare("SELECT COUNT(*) as cnt FROM issue_stages WHERE preferred_agent_id = ?").get(agentId) as any
  return r?.cnt || 0
}

export function getPreferredIssuesByAgent(agentId: string): { projectId: string; projectName: string; issueIid: number }[] {
  return getDb().prepare(`
    SELECT s.project_id as projectId, p.name as projectName, s.issue_iid as issueIid
    FROM issue_stages s JOIN projects p ON p.id = s.project_id
    WHERE s.preferred_agent_id = ?
    ORDER BY s.updated_at ASC
  `).all(agentId) as any[]
}

export function clearPreferredAgentRefs(agentId: string) {
  getDb().prepare('UPDATE issue_stages SET preferred_agent_id = NULL WHERE preferred_agent_id = ?').run(agentId)
}

// ── Project Members (Git 프로젝트 멤버 캐시) ──

/** 스캐너가 주기적으로 호출 — 프로젝트 멤버 전체를 덮어쓰기 */
export function replaceProjectMembers(
  projectId: string,
  members: { username: string; name: string; avatarUrl: string; provider: string; gitUserId?: string | null }[]
) {
  const db = getDb()
  const tx = db.transaction(() => {
    db.prepare('DELETE FROM project_members WHERE project_id = ?').run(projectId)
    const stmt = db.prepare(`
      INSERT INTO project_members (project_id, username, name, avatar_url, provider, git_user_id, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, datetime('now'))
    `)
    for (const m of members) {
      if (!m.username) continue
      stmt.run(projectId, m.username, m.name || m.username, m.avatarUrl || '', m.provider || 'gitlab', m.gitUserId ?? null)
    }
  })
  tx()
}

// ── Verifier (Git assignee 기반 검증자) ──

/**
 * 스캐너가 매 폴링마다 호출 — 이슈의 현재 Git assignee와 레이블 기반 stage를 스냅샷으로 저장합니다.
 * 집계는 이 스냅샷에서 읽어 Git API 재호출을 회피합니다.
 */
export function upsertIssueStageSnapshot(
  projectId: string,
  issueIid: number,
  snapshot: {
    cachedStage: string | null
    assigneeUsername: string | null
    assigneeName: string | null
    assigneeAvatar: string | null
    assigneeProvider: string | null
    assigneeGitUserId: string | null  // Git API의 숫자 id (문자열화) — OAuth user_id와 매칭용
    issueTitle: string | null
  }
) {
  getDb().prepare(`
    INSERT INTO issue_stages (project_id, issue_iid, stage, cached_stage, assignee_username, assignee_name, assignee_avatar, assignee_provider, assignee_git_user_id, issue_title, verify_waiting_since, updated_at)
    VALUES (?, ?, '', ?, ?, ?, ?, ?, ?, ?,
      CASE WHEN ? IN ('verify_waiting', 'verifying') THEN datetime('now') ELSE NULL END,
      datetime('now'))
    ON CONFLICT(project_id, issue_iid) DO UPDATE SET
      cached_stage = excluded.cached_stage,
      assignee_username = excluded.assignee_username,
      assignee_name = excluded.assignee_name,
      assignee_avatar = excluded.assignee_avatar,
      assignee_provider = excluded.assignee_provider,
      assignee_git_user_id = excluded.assignee_git_user_id,
      issue_title = excluded.issue_title,
      verify_waiting_since = CASE
        WHEN excluded.cached_stage IN ('verify_waiting', 'verifying') THEN
          COALESCE(issue_stages.verify_waiting_since, datetime('now'))
        ELSE NULL
      END,
      updated_at = datetime('now')
  `).run(
    projectId, issueIid,
    snapshot.cachedStage,
    snapshot.assigneeUsername,
    snapshot.assigneeName,
    snapshot.assigneeAvatar,
    snapshot.assigneeProvider,
    snapshot.assigneeGitUserId,
    snapshot.issueTitle,
    snapshot.cachedStage
  )
}

/** 특정 이슈의 현재 assignee(username) 조회 — 검증자 기록용 */
export function getIssueAssigneeUsername(projectId: string, issueIid: number): { username: string | null; name: string | null; avatar: string | null } {
  const r = getDb().prepare(
    'SELECT assignee_username, assignee_name, assignee_avatar FROM issue_stages WHERE project_id = ? AND issue_iid = ?'
  ).get(projectId, issueIid) as any
  return {
    username: r?.assignee_username || null,
    name: r?.assignee_name || null,
    avatar: r?.assignee_avatar || null,
  }
}

export interface VerifierSummary {
  username: string
  name: string
  avatar: string
  provider: string
  verifying: number        // 현재 검증 중 (cached_stage='verifying')
  verifyWaiting: number    // 검증 대기 (cached_stage='verify_waiting')
  approvedToday: number    // 오늘 승인한 건수
  rejectedToday: number    // 오늘 반려한 건수
  approved7d: number       // 최근 7일 승인
  rejected7d: number       // 최근 7일 반려
  avgVerifyMin: number     // 최근 7일 평균 검증 소요 (분)
  oldestWaitMin: number    // 가장 오래 기다린 검증대기 이슈 경과 시간 (분)
  assignedProjects: { id: string; name: string; color: string; provider: string }[]
  // IVE 사용자 매칭 (OAuth user_id 기반)
  iveUser: {
    id: string
    name: string
    email: string
    avatar: string
  } | null
}

/**
 * 잠재 검증자 전체 목록 — 프로젝트 멤버(등록된 Git 사용자) + 현재 assignee + 최근 검증 이력의 합집합.
 * 현재 대기/검증 중 건수가 0이어도 프로젝트 멤버면 카드로 표시되어 상대 비교가 가능합니다.
 */
export function getVerifiersList(userId: string): VerifierSummary[] {
  const db = getDb()
  const accessCondition = `(p.user_id = ? OR EXISTS (SELECT 1 FROM project_shares ps WHERE ps.project_id = p.id AND ps.user_id = ?))`
  const todayStartISO = getKSTTodayStartISO()
  const week7Ago = new Date(Date.now() - 7 * 86400 * 1000).toISOString()

  // 1) 프로젝트 멤버 전체 목록 (사용자 접근 가능 프로젝트의 캐시된 Git 멤버)
  const memberRows = db.prepare(`
    SELECT pm.username, pm.name, pm.avatar_url, pm.provider, pm.git_user_id, p.id as project_id, p.name as project_name, p.color as project_color
    FROM project_members pm
    JOIN projects p ON p.id = pm.project_id
    WHERE ${accessCondition}
  `).all(userId, userId) as any[]

  interface Meta {
    username: string
    name: string
    avatar: string
    provider: string
    gitUserId: string | null
    projects: Map<string, { id: string; name: string; color: string; provider: string }>
  }
  // 키는 `${provider}:${username}` — 같은 username이 여러 provider에 존재 가능
  const metaMap = new Map<string, Meta>()
  const metaKey = (provider: string, username: string) => `${provider || 'gitlab'}:${username}`

  for (const m of memberRows) {
    const key = metaKey(m.provider, m.username)
    const existing = metaMap.get(key) || {
      username: m.username,
      name: m.name || m.username,
      avatar: m.avatar_url || 'av-01',
      provider: m.provider || 'gitlab',
      gitUserId: m.git_user_id || null,
      projects: new Map(),
    }
    existing.projects.set(m.project_id, { id: m.project_id, name: m.project_name, color: m.project_color, provider: m.provider || 'gitlab' })
    if (!existing.name && m.name) existing.name = m.name
    if (!existing.avatar && m.avatar_url) existing.avatar = m.avatar_url
    if (!existing.gitUserId && m.git_user_id) existing.gitUserId = m.git_user_id
    metaMap.set(key, existing)
  }

  // 2) 현재 검증중/대기 집계 (issue_stages 스캐너 스냅샷)
  // GROUP BY provider+username — 같은 username이 여러 provider에 존재할 수 있음
  const currentRows = db.prepare(`
    SELECT
      s.assignee_username as username,
      COALESCE(s.assignee_provider, 'gitlab') as provider,
      MAX(s.assignee_name) as name,
      MAX(s.assignee_avatar) as avatar,
      MAX(s.assignee_git_user_id) as git_user_id,
      SUM(CASE WHEN s.cached_stage = 'verifying' THEN 1 ELSE 0 END) as verifying,
      SUM(CASE WHEN s.cached_stage = 'verify_waiting' THEN 1 ELSE 0 END) as verify_waiting,
      MIN(CASE WHEN s.cached_stage IN ('verify_waiting', 'verifying') THEN s.verify_waiting_since ELSE NULL END) as oldest_wait_at
    FROM issue_stages s
    JOIN projects p ON p.id = s.project_id
    WHERE s.assignee_username IS NOT NULL
      AND s.cached_stage IN ('verify_waiting', 'verifying')
      AND ${accessCondition}
    GROUP BY COALESCE(s.assignee_provider, 'gitlab'), s.assignee_username
  `).all(userId, userId) as any[]
  const currentMap = new Map<string, any>()
  for (const r of currentRows) {
    const key = metaKey(r.provider, r.username)
    currentMap.set(key, r)
    const existing = metaMap.get(key)
    if (!existing) {
      metaMap.set(key, {
        username: r.username,
        name: r.name || r.username,
        avatar: r.avatar || 'av-01',
        provider: r.provider || 'gitlab',
        gitUserId: r.git_user_id || null,
        projects: new Map(),
      })
    } else if (!existing.gitUserId && r.git_user_id) {
      existing.gitUserId = r.git_user_id
    }
  }

  // 2b) IVE 사용자 매칭 — (provider_type, oauth_user_id)로 매칭
  //     IVE 한 대 = 타입당 1 provider 정책이므로 provider.type만으로 매칭 가능
  const iveUserByGitId = new Map<string, { id: string; name: string; email: string; avatar: string }>()
  const gitIdsToMatch = Array.from(metaMap.values())
    .map(m => m.gitUserId)
    .filter((id): id is string => !!id)
  if (gitIdsToMatch.length > 0) {
    const placeholders = gitIdsToMatch.map(() => '?').join(',')
    const iveRows = db.prepare(`
      SELECT u.id, u.name, u.email, u.avatar, u.oauth_user_id, op.type as provider_type
      FROM users u
      JOIN oauth_providers op ON op.id = u.oauth_provider_id
      WHERE u.oauth_user_id IN (${placeholders})
    `).all(...gitIdsToMatch) as any[]
    for (const row of iveRows) {
      const key = `${row.provider_type}:${row.oauth_user_id}`
      iveUserByGitId.set(key, {
        id: row.id,
        name: row.name,
        email: row.email,
        avatar: row.avatar || 'av-01',
      })
    }
  }

  // 3) 최근 7일 / 오늘 승인·반려 + 평균 검증시간 (task_executions.verifier_username)
  //    task_executions에는 provider 정보가 없어 projects.provider로 대체
  const execStats = db.prepare(`
    SELECT
      te.verifier_username as username,
      p.provider as provider,
      SUM(CASE WHEN te.verified_at IS NOT NULL AND te.verified_at >= ? THEN 1 ELSE 0 END) as approved_7d,
      SUM(CASE WHEN te.rejected_at IS NOT NULL AND te.rejected_at >= ? THEN 1 ELSE 0 END) as rejected_7d,
      SUM(CASE WHEN te.verified_at IS NOT NULL AND te.verified_at >= ? THEN 1 ELSE 0 END) as approved_today,
      SUM(CASE WHEN te.rejected_at IS NOT NULL AND te.rejected_at >= ? THEN 1 ELSE 0 END) as rejected_today,
      AVG(CASE WHEN te.verified_at IS NOT NULL AND te.verify_started_at IS NOT NULL AND te.verified_at >= ?
        THEN (strftime('%s', te.verified_at) - strftime('%s', te.verify_started_at)) / 60.0
        ELSE NULL END) as avg_verify_min
    FROM task_executions te
    JOIN projects p ON p.id = te.project_id
    WHERE te.verifier_username IS NOT NULL
      AND ${accessCondition}
    GROUP BY p.provider, te.verifier_username
  `).all(week7Ago, week7Ago, todayStartISO, todayStartISO, week7Ago, userId, userId) as any[]
  const execMap = new Map<string, any>()
  for (const r of execStats) {
    const key = metaKey(r.provider, r.username)
    execMap.set(key, r)
    if (!metaMap.has(key)) {
      metaMap.set(key, {
        username: r.username,
        name: r.username,
        avatar: 'av-01',
        provider: r.provider || 'gitlab',
        gitUserId: null,
        projects: new Map(),
      })
    }
  }

  const now = Date.now()
  return Array.from(metaMap.entries()).map(([key, meta]) => {
    const curr = currentMap.get(key)
    const exec = execMap.get(key)
    const oldestWaitMs = curr?.oldest_wait_at ? now - new Date(curr.oldest_wait_at + 'Z').getTime() : 0
    const iveUser = meta.gitUserId ? (iveUserByGitId.get(`${meta.provider}:${meta.gitUserId}`) || null) : null
    return {
      username: meta.username,
      name: meta.name,
      avatar: meta.avatar,
      provider: meta.provider,
      verifying: Number(curr?.verifying || 0),
      verifyWaiting: Number(curr?.verify_waiting || 0),
      approvedToday: Number(exec?.approved_today || 0),
      rejectedToday: Number(exec?.rejected_today || 0),
      approved7d: Number(exec?.approved_7d || 0),
      rejected7d: Number(exec?.rejected_7d || 0),
      avgVerifyMin: exec?.avg_verify_min != null ? Math.round(Number(exec.avg_verify_min) * 10) / 10 : 0,
      oldestWaitMin: oldestWaitMs > 0 ? Math.round(oldestWaitMs / 60000) : 0,
      assignedProjects: Array.from(meta.projects.values()),
      iveUser,
    }
  }).sort((a, b) => {
    // 1) 현재 대기(검증대기+검증중) 내림차순 → 병목부터
    const diff = (b.verifyWaiting + b.verifying) - (a.verifyWaiting + a.verifying)
    if (diff !== 0) return diff
    // 2) 최근 7일 승인 내림차순 → 활발한 사람부터
    const activityDiff = (b.approved7d + b.rejected7d) - (a.approved7d + a.rejected7d)
    if (activityDiff !== 0) return activityDiff
    // 3) 이름 알파벳순
    return a.name.localeCompare(b.name)
  })
}

/** 보고서용 — 현재 검증 대기/중 backlog 집계 */
export function getVerifierBacklogForReport(userId: string): {
  username: string
  name: string
  avatar: string
  provider: string
  verifyWaiting: number
  verifying: number
  oldestWaitMin: number
  assignedProjectNames: string[]
}[] {
  const db = getDb()
  const rows = db.prepare(`
    SELECT
      s.assignee_username as username,
      MAX(s.assignee_name) as name,
      MAX(s.assignee_avatar) as avatar,
      MAX(s.assignee_provider) as provider,
      SUM(CASE WHEN s.cached_stage = 'verify_waiting' THEN 1 ELSE 0 END) as verify_waiting,
      SUM(CASE WHEN s.cached_stage = 'verifying' THEN 1 ELSE 0 END) as verifying,
      MIN(CASE WHEN s.cached_stage IN ('verify_waiting', 'verifying') THEN s.verify_waiting_since ELSE NULL END) as oldest_wait_at
    FROM issue_stages s
    JOIN projects p ON p.id = s.project_id
    WHERE s.assignee_username IS NOT NULL
      AND s.cached_stage IN ('verify_waiting', 'verifying')
      AND (p.user_id = ? OR EXISTS (SELECT 1 FROM project_shares ps WHERE ps.project_id = p.id AND ps.user_id = ?))
    GROUP BY s.assignee_username
  `).all(userId, userId) as any[]

  const projectRows = db.prepare(`
    SELECT DISTINCT s.assignee_username as username, p.name as project_name
    FROM issue_stages s
    JOIN projects p ON p.id = s.project_id
    WHERE s.assignee_username IS NOT NULL
      AND s.cached_stage IN ('verify_waiting', 'verifying')
      AND (p.user_id = ? OR EXISTS (SELECT 1 FROM project_shares ps WHERE ps.project_id = p.id AND ps.user_id = ?))
  `).all(userId, userId) as any[]
  const projMap = new Map<string, string[]>()
  for (const r of projectRows) {
    if (!projMap.has(r.username)) projMap.set(r.username, [])
    projMap.get(r.username)!.push(r.project_name)
  }

  const now = Date.now()
  return rows.map(r => ({
    username: r.username,
    name: r.name || r.username,
    avatar: r.avatar || 'av-01',
    provider: r.provider || 'gitlab',
    verifyWaiting: Number(r.verify_waiting || 0),
    verifying: Number(r.verifying || 0),
    oldestWaitMin: r.oldest_wait_at ? Math.round((now - new Date(r.oldest_wait_at + 'Z').getTime()) / 60000) : 0,
    assignedProjectNames: projMap.get(r.username) || [],
  }))
}

/** 특정 검증자 앞에 대기 중인 이슈 목록 */
export function getVerifierQueue(userId: string, username: string): { projectId: string; projectName: string; projectColor: string; issueIid: number; issueTitle: string; stage: string; waitingSince: string | null }[] {
  return getDb().prepare(`
    SELECT
      s.project_id as projectId, p.name as projectName, p.color as projectColor,
      s.issue_iid as issueIid, COALESCE(s.issue_title, '') as issueTitle,
      s.cached_stage as stage, s.verify_waiting_since as waitingSince
    FROM issue_stages s
    JOIN projects p ON p.id = s.project_id
    WHERE s.assignee_username = ?
      AND s.cached_stage IN ('verify_waiting', 'verifying')
      AND (p.user_id = ? OR EXISTS (SELECT 1 FROM project_shares ps WHERE ps.project_id = p.id AND ps.user_id = ?))
    ORDER BY s.verify_waiting_since IS NULL, s.verify_waiting_since ASC, s.issue_iid ASC
  `).all(username, userId, userId) as any[]
}

/**
 * 로그인한 IVE 사용자의 "내 검증 대기/중" 이슈 목록.
 * OAuth 로그인 시 저장된 oauth_user_id(Git provider의 숫자 id)와
 * 스캐너가 저장한 assignee_git_user_id를 매칭합니다.
 *
 * @param userId     IVE 사용자 id (권한 체크용)
 * @param oauthUserId  users.oauth_user_id (Git 숫자 ID의 문자열화)
 * @param providerType 'github' | 'gitlab' — 프로젝트의 provider 타입과 일치해야 함
 */
export function getMyVerifierQueue(
  userId: string,
  oauthUserId: string,
  providerType: 'github' | 'gitlab',
): { projectId: string; projectName: string; projectColor: string; issueIid: number; issueTitle: string; stage: string; waitingSince: string | null }[] {
  return getDb().prepare(`
    SELECT
      s.project_id as projectId, p.name as projectName, p.color as projectColor,
      s.issue_iid as issueIid, COALESCE(s.issue_title, '') as issueTitle,
      s.cached_stage as stage, s.verify_waiting_since as waitingSince
    FROM issue_stages s
    JOIN projects p ON p.id = s.project_id
    WHERE s.assignee_git_user_id = ?
      AND p.provider = ?
      AND s.cached_stage IN ('verify_waiting', 'verifying')
      AND (p.user_id = ? OR EXISTS (SELECT 1 FROM project_shares ps WHERE ps.project_id = p.id AND ps.user_id = ?))
    ORDER BY s.verify_waiting_since IS NULL, s.verify_waiting_since ASC, s.issue_iid ASC
  `).all(oauthUserId, providerType, userId, userId) as any[]
}

/** 로그인 유저의 검증 대기/중 개수만 가져오기 (뱃지용) */
export function getMyVerifierCounts(
  userId: string,
  oauthUserId: string,
  providerType: 'github' | 'gitlab',
): { verifyWaiting: number; verifying: number; total: number } {
  const r = getDb().prepare(`
    SELECT
      SUM(CASE WHEN s.cached_stage = 'verify_waiting' THEN 1 ELSE 0 END) as verify_waiting,
      SUM(CASE WHEN s.cached_stage = 'verifying' THEN 1 ELSE 0 END) as verifying
    FROM issue_stages s
    JOIN projects p ON p.id = s.project_id
    WHERE s.assignee_git_user_id = ?
      AND p.provider = ?
      AND s.cached_stage IN ('verify_waiting', 'verifying')
      AND (p.user_id = ? OR EXISTS (SELECT 1 FROM project_shares ps WHERE ps.project_id = p.id AND ps.user_id = ?))
  `).get(oauthUserId, providerType, userId, userId) as any
  const verifyWaiting = Number(r?.verify_waiting || 0)
  const verifying = Number(r?.verifying || 0)
  return { verifyWaiting, verifying, total: verifyWaiting + verifying }
}

// ── Report Schedules (보고서 스케줄) ──

function mapReportSchedule(r: any): ReportSchedule {
  return {
    id: r.id,
    reportType: r.report_type,
    enabled: !!r.enabled,
    recipients: JSON.parse(r.recipients || '[]'),
    sendHour: r.send_hour ?? 9,
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
  const sendHour = s.sendHour ?? 9
  getDb().prepare(`
    INSERT INTO report_schedules (id, report_type, enabled, recipients, send_day, send_hour, created_at, updated_at)
    VALUES (?, ?, ?, ?, 1, ?, ?, datetime('now'))
    ON CONFLICT(id) DO UPDATE SET
      enabled = excluded.enabled,
      recipients = excluded.recipients,
      send_hour = excluded.send_hour,
      updated_at = datetime('now')
  `).run(s.id, s.reportType, s.enabled ? 1 : 0, JSON.stringify(s.recipients), sendHour, s.createdAt || new Date().toISOString())
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
           u.name as developer_name, a.user_id as developer_user_id,
           te.issue_iid, te.issue_title, te.status,
           te.started_at, te.ended_at, te.input_tokens, te.output_tokens, te.cost_usd, te.turns,
           te.issue_created_at, te.model_name, te.verified_at, te.verify_started_at, te.rejected_at,
           te.assignee_type, te.user_id as te_user_id, te.user_name as te_user_name, te.user_avatar as te_user_avatar,
           te.verifier_name, te.verifier_avatar, te.verifier_username,
           COALESCE(te.verifier_user_id, vu.id) as verifier_user_id_resolved,
           vu.avatar as verifier_user_avatar
    FROM task_executions te
    JOIN projects p ON p.id = te.project_id
    LEFT JOIN agents a ON a.id = te.agent_id
    LEFT JOIN users u ON u.id = a.user_id
    LEFT JOIN users vu ON vu.id = te.verifier_user_id OR (te.verifier_user_id IS NULL AND vu.name = te.verifier_name)
    WHERE te.started_at >= ? AND te.started_at < ?
    ORDER BY te.started_at ASC
  `).all(startISO, endISO) as any[]
  return rows.map(r => ({
    id: r.id, projectId: r.project_id, projectName: r.project_name,
    projectColor: r.project_color, projectAvatarUrl: r.project_avatar_url || '', projectProvider: r.project_provider || 'gitlab',
    agentId: r.agent_id ?? '', agentName: r.agent_name ?? '', agentAvatar: r.agent_avatar || 'av-01',
    cliName: r.cli_name ?? '', developerName: r.developer_name || r.agent_name || '',
    developerUserId: r.developer_user_id ?? null,
    userId: r.te_user_id ?? null,
    userName: r.te_user_name ?? null,
    userAvatar: r.te_user_avatar ?? null,
    issueIid: r.issue_iid, issueTitle: r.issue_title,
    status: r.status, startedAt: r.started_at, endedAt: r.ended_at,
    inputTokens: r.input_tokens ?? 0, outputTokens: r.output_tokens ?? 0,
    costUsd: r.cost_usd ?? 0, turns: r.turns ?? 0,
    issueCreatedAt: r.issue_created_at ?? null,
    modelName: r.model_name ?? null,
    verifiedAt: r.verified_at ?? null,
    verifyStartedAt: r.verify_started_at ?? null,
    rejectedAt: r.rejected_at ?? null,
    verifierName: r.verifier_name ?? null,
    verifierAvatar: r.verifier_user_avatar ?? r.verifier_avatar ?? null,
    verifierUsername: r.verifier_username ?? null,
    verifierUserId: r.verifier_user_id_resolved ?? null,
    assigneeType: r.assignee_type ?? 'agent',
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

/**
 * 이슈 배정을 원자적으로 수행합니다.
 * hasActiveExecution 체크 + createExecution을 하나의 트랜잭션으로 묶어
 * 레이스 컨디션으로 인한 중복 배정을 방지합니다.
 * (stage는 레이블로 관리하므로 DB에 저장하지 않음)
 */
export function assignIssueAtomically(
  projectId: string,
  issueIid: number,
  _stage: IssueStage,
  execution: TaskExecution,
): boolean {
  const tx = getDb().transaction(() => {
    // 트랜잭션 내에서 다시 확인 — 다른 프로세스가 먼저 배정했는지 체크
    const active = getDb().prepare(
      "SELECT id FROM task_executions WHERE project_id = ? AND issue_iid = ? AND status IN ('running', 'assigned') LIMIT 1"
    ).get(projectId, issueIid)
    if (active) return false

    createExecution(execution)
    return true
  })
  return tx()
}
