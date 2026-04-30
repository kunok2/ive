import Database from 'better-sqlite3'
import bcrypt from 'bcryptjs'

export function initSchema(db: Database.Database) {
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
      label_confirm_wait TEXT NOT NULL DEFAULT 'IVE-P',
      label_confirm TEXT NOT NULL DEFAULT 'IVE-C',
      label_end TEXT NOT NULL DEFAULT 'IVE-E',
      base_branch TEXT NOT NULL DEFAULT '',
      confirm_base_branch TEXT NOT NULL DEFAULT '',
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

    -- project_assignments 테이블은 #272에서 제거됨 (전역 에이전트 풀 + 의뢰자 기준 선택)

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
      try {
        const result = db.prepare(`
          UPDATE task_executions SET verified_at = strftime('%Y-%m-%dT%H:%M:%S.000Z', ended_at, '+' || (abs(random()) % 120 + 10) || ' minutes')
          WHERE status IN ('success', 'failed') AND ended_at IS NOT NULL AND verified_at IS NULL
        `).run()
        console.log(`[DB] Backfilled verified_at for ${result.changes} executions`)
      } catch (e) { console.error("[DB] verified_at backfill failed:", e) }
    }
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
    if (!tableInfo.some((col: any) => col.name === 'verifier_username')) {
      db.exec("ALTER TABLE task_executions ADD COLUMN verifier_username TEXT DEFAULT NULL")
      console.log('[DB] Added verifier_username to task_executions')
    }
    if (!tableInfo.some((col: any) => col.name === 'verifier_git_user_id')) {
      db.exec("ALTER TABLE task_executions ADD COLUMN verifier_git_user_id TEXT DEFAULT NULL")
      console.log('[DB] Added verifier_git_user_id to task_executions')
    }
    if (!tableInfo.some((col: any) => col.name === 'verifier_user_id')) {
      db.exec("ALTER TABLE task_executions ADD COLUMN verifier_user_id TEXT DEFAULT NULL")
      console.log('[DB] Added verifier_user_id to task_executions')
    }
  } catch (e) { console.error("Migration failed for verifier columns:", e) }

  // 캐시 토큰 분리 저장 컬럼
  try {
    const tableInfo = db.prepare("PRAGMA table_info(task_executions)").all() as any[]
    if (!tableInfo.some((col: any) => col.name === 'cache_read_input_tokens')) {
      db.exec("ALTER TABLE task_executions ADD COLUMN cache_read_input_tokens INTEGER NOT NULL DEFAULT 0")
      db.exec("ALTER TABLE task_executions ADD COLUMN cache_creation_input_tokens INTEGER NOT NULL DEFAULT 0")
      console.log('[DB] Added cache_read_input_tokens, cache_creation_input_tokens to task_executions')
    }
  } catch (e) { console.error("Migration failed for cache token columns:", e) }

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

  // #272: project_assignments 테이블 제거 (전역 에이전트 풀로 전환)
  try {
    db.exec('DROP TABLE IF EXISTS project_assignments')
  } catch (e) { console.error("Migration failed dropping project_assignments:", e) }

  // agents에 avatar 컬럼 추가
  try {
    const tableInfo = db.prepare("PRAGMA table_info(agents)").all() as any[]
    if (!tableInfo.some((col: any) => col.name === 'avatar')) {
      db.exec("ALTER TABLE agents ADD COLUMN avatar TEXT NOT NULL DEFAULT 'av-01'")
    }
  } catch (e) { console.error("Migration failed for agents avatar:", e) }

  // agents에 model 컬럼 추가 (에이전트별 모델 지정)
  try {
    const tableInfo = db.prepare("PRAGMA table_info(agents)").all() as any[]
    if (!tableInfo.some((col: any) => col.name === 'model')) {
      db.exec("ALTER TABLE agents ADD COLUMN model TEXT NOT NULL DEFAULT ''")
    }
  } catch (e) { console.error("Migration failed for agents model:", e) }

  // projects에 avatar_url 컬럼 추가
  try {
    const tableInfo = db.prepare("PRAGMA table_info(projects)").all() as any[]
    if (!tableInfo.some((col: any) => col.name === 'avatar_url')) {
      db.exec("ALTER TABLE projects ADD COLUMN avatar_url TEXT NOT NULL DEFAULT ''")
    }
    if (!tableInfo.some((col: any) => col.name === 'last_activity_at')) {
      db.exec("ALTER TABLE projects ADD COLUMN last_activity_at TEXT")
      db.exec(`UPDATE projects SET last_activity_at = (
        SELECT MAX(te.started_at) FROM task_executions te WHERE te.project_id = projects.id
      ) WHERE last_activity_at IS NULL`)
      db.exec(`UPDATE projects SET last_activity_at = created_at WHERE last_activity_at IS NULL`)
    }
    if (!tableInfo.some((col: any) => col.name === 'label_schedule')) {
      db.exec("ALTER TABLE projects ADD COLUMN label_schedule TEXT NOT NULL DEFAULT 'IVE-S'")
      db.exec("ALTER TABLE projects ADD COLUMN label_dev TEXT NOT NULL DEFAULT 'IVE-D'")
      db.exec("ALTER TABLE projects ADD COLUMN label_verify TEXT NOT NULL DEFAULT 'IVE-V'")
      db.exec("ALTER TABLE projects ADD COLUMN label_end TEXT NOT NULL DEFAULT 'IVE-E'")
    }
    if (!tableInfo.some((col: any) => col.name === 'label_verify_wait')) {
      db.exec("ALTER TABLE projects ADD COLUMN label_verify_wait TEXT NOT NULL DEFAULT 'IVE-W'")
    }
    db.exec("UPDATE projects SET label_schedule = 'IVE-S' WHERE label_schedule IN ('IVE-DS', 'IVE-VS', '')")
    db.exec("UPDATE projects SET label_dev = 'IVE-D' WHERE label_dev IN ('IVE-DE', 'IVE-DS', '')")
    db.exec("UPDATE projects SET label_verify = 'IVE-V' WHERE label_verify IN ('IVE-VS', 'IVE-VE', '')")
    db.exec("UPDATE projects SET label_end = 'IVE-E' WHERE label_end IN ('IVE-VE', 'IVE-DE', '')")
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
    if (!tableInfo.some((col: any) => col.name === 'base_branch')) {
      db.exec("ALTER TABLE projects ADD COLUMN base_branch TEXT NOT NULL DEFAULT ''")
    }
    if (!tableInfo.some((col: any) => col.name === 'label_confirm_wait')) {
      db.exec("ALTER TABLE projects ADD COLUMN label_confirm_wait TEXT NOT NULL DEFAULT 'IVE-P'")
    }
    if (!tableInfo.some((col: any) => col.name === 'label_confirm')) {
      db.exec("ALTER TABLE projects ADD COLUMN label_confirm TEXT NOT NULL DEFAULT 'IVE-C'")
    }
    if (!tableInfo.some((col: any) => col.name === 'confirm_base_branch')) {
      db.exec("ALTER TABLE projects ADD COLUMN confirm_base_branch TEXT NOT NULL DEFAULT ''")
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

  // issue_stages 테이블
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
  try { db.exec(`ALTER TABLE issue_stages ADD COLUMN fail_reason TEXT DEFAULT NULL`) } catch { /* 이미 존재 */ }
  try { db.exec(`ALTER TABLE issue_stages ADD COLUMN preferred_agent_id TEXT DEFAULT NULL`) } catch { /* 이미 존재 */ }
  try { db.exec(`ALTER TABLE issue_stages ADD COLUMN scheduled_at TEXT DEFAULT NULL`) } catch { /* 이미 존재 */ }
  try {
    db.exec(`ALTER TABLE issue_stages ADD COLUMN assign_mode TEXT DEFAULT 'auto'`)
    db.exec(`UPDATE issue_stages SET assign_mode = 'agent' WHERE preferred_agent_id IS NOT NULL`)
  } catch { /* 이미 존재 */ }
  try { db.exec(`ALTER TABLE issue_stages ADD COLUMN assignee_username TEXT DEFAULT NULL`) } catch { /* 이미 존재 */ }
  try { db.exec(`ALTER TABLE issue_stages ADD COLUMN assignee_name TEXT DEFAULT NULL`) } catch { /* 이미 존재 */ }
  try { db.exec(`ALTER TABLE issue_stages ADD COLUMN assignee_avatar TEXT DEFAULT NULL`) } catch { /* 이미 존재 */ }
  try { db.exec(`ALTER TABLE issue_stages ADD COLUMN assignee_provider TEXT DEFAULT NULL`) } catch { /* 이미 존재 */ }
  try { db.exec(`ALTER TABLE issue_stages ADD COLUMN assignee_git_user_id TEXT DEFAULT NULL`) } catch { /* 이미 존재 */ }
  try { db.exec(`ALTER TABLE issue_stages ADD COLUMN cached_stage TEXT DEFAULT NULL`) } catch { /* 이미 존재 */ }
  try { db.exec(`ALTER TABLE issue_stages ADD COLUMN issue_title TEXT DEFAULT NULL`) } catch { /* 이미 존재 */ }
  try { db.exec(`ALTER TABLE issue_stages ADD COLUMN verify_waiting_since TEXT DEFAULT NULL`) } catch { /* 이미 존재 */ }
  try { db.exec(`ALTER TABLE issue_stages ADD COLUMN assignee_auto INTEGER DEFAULT 0`) } catch { /* 이미 존재 */ }
  try { db.exec(`ALTER TABLE issue_stages ADD COLUMN confirmed_at TEXT DEFAULT NULL`) } catch { /* 이미 존재 */ }
  try { db.exec(`ALTER TABLE issue_stages ADD COLUMN confirmer_user_id TEXT DEFAULT NULL`) } catch { /* 이미 존재 */ }
  try { db.exec(`ALTER TABLE issue_stages ADD COLUMN confirmer_name TEXT DEFAULT NULL`) } catch { /* 이미 존재 */ }
  try { db.exec(`ALTER TABLE issue_stages ADD COLUMN confirmer_avatar TEXT DEFAULT NULL`) } catch { /* 이미 존재 */ }
  // 검증자/확인자 사전 배정 (이슈 생성 시 지정). mode: 'creator' | 'auto' | 'specific'
  // (실제 수행자 정보는 task_executions.verifier_* / issue_stages.confirmer_* 사용)
  try { db.exec(`ALTER TABLE issue_stages ADD COLUMN preset_verifier_mode TEXT DEFAULT 'creator'`) } catch { /* 이미 존재 */ }
  try { db.exec(`ALTER TABLE issue_stages ADD COLUMN preset_verifier_user_id TEXT DEFAULT NULL`) } catch { /* 이미 존재 */ }
  try { db.exec(`ALTER TABLE issue_stages ADD COLUMN preset_verifier_username TEXT DEFAULT NULL`) } catch { /* 이미 존재 */ }
  try { db.exec(`ALTER TABLE issue_stages ADD COLUMN preset_confirmer_mode TEXT DEFAULT 'creator'`) } catch { /* 이미 존재 */ }
  try { db.exec(`ALTER TABLE issue_stages ADD COLUMN preset_confirmer_user_id TEXT DEFAULT NULL`) } catch { /* 이미 존재 */ }
  try { db.exec(`ALTER TABLE issue_stages ADD COLUMN preset_confirmer_username TEXT DEFAULT NULL`) } catch { /* 이미 존재 */ }
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

  // project_members 테이블
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

  // Chat sessions & messages
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

  // agents.cli_name CHECK constraint에 opencode 추가
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

  // token_pricing 마이그레이션
  try {
    const tpSql = db.prepare("SELECT sql FROM sqlite_master WHERE type='table' AND name='token_pricing'").get() as any
    if (tpSql && tpSql.sql && tpSql.sql.includes('cli_name TEXT NOT NULL UNIQUE')) {
      console.log('[DB] Migrating token_pricing: cli_name UNIQUE → model_name UNIQUE')
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

  // OAuth: oauth_providers 테이블
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
    db.exec(`CREATE UNIQUE INDEX IF NOT EXISTS idx_users_oauth
             ON users(oauth_provider_id, oauth_user_id)
             WHERE oauth_provider_id IS NOT NULL`)
  } catch (e) { console.error('[DB] users OAuth columns migration failed:', e) }

  // users.password NOT NULL → NULL 허용
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

  // 이메일 인증 코드 테이블 (서버 재시작에도 코드 유지)
  db.exec(`
    CREATE TABLE IF NOT EXISTS verification_codes (
      email TEXT PRIMARY KEY,
      code TEXT NOT NULL,
      expires_at INTEGER NOT NULL
    )
  `)

  seedAdmin(db)
  seedTokenPricing(db)
}

function seedTokenPricing(db: Database.Database) {
  const defaults = [
    { id: 'tp-sonnet', cli: 'model', model: 'Claude Sonnet 4.6', input: 3.00, output: 15.00 },
    { id: 'tp-opus',   cli: 'model', model: 'Claude Opus 4',     input: 15.00, output: 75.00 },
    { id: 'tp-haiku',  cli: 'model', model: 'Claude Haiku 4.5',  input: 0.80, output: 4.00 },
    { id: 'tp-gemini-pro',   cli: 'model', model: 'Gemini 2.5 Pro',   input: 1.25, output: 10.00 },
    { id: 'tp-gemini-flash', cli: 'model', model: 'Gemini 2.5 Flash', input: 0.075, output: 0.30 },
    { id: 'tp-gpt41', cli: 'model', model: 'GPT-4.1',  input: 2.00, output: 8.00 },
    { id: 'tp-o3',    cli: 'model', model: 'o3',       input: 10.00, output: 40.00 },
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
    db.prepare('UPDATE users SET is_admin = 1, max_agents = 0, max_turns = 0, allowed_clis = ? WHERE email = ?').run('claude,opencode', 'admin@ive.local')
  }
}
