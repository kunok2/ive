import Database from 'better-sqlite3'
import bcrypt from 'bcryptjs'
import { DEFAULT_ADMIN_EMAIL } from '@/lib/constants'

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
      slack_user_id TEXT NOT NULL DEFAULT '',
      slack_notify INTEGER NOT NULL DEFAULT 1,
      terms_agreed_at TEXT,
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
      label_notify TEXT NOT NULL DEFAULT 'IVE-N',
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
      enabled INTEGER NOT NULL DEFAULT 1,
      paused_until TEXT,
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
    // 사용자별 표시 통화 (null = USD, 환산 안 함) + 수동 고정 환율 (null = 자동 글로벌 환율 사용)
    if (!tableInfo.some((col: any) => col.name === 'currency')) {
      db.exec("ALTER TABLE users ADD COLUMN currency TEXT")
    }
    if (!tableInfo.some((col: any) => col.name === 'currency_rate')) {
      db.exec("ALTER TABLE users ADD COLUMN currency_rate REAL")
    }
    // 사용자별 사람단가 배수 (기본 1.0). 최종 사람 비용 = 작업시간 × (기본단가 × 배수).
    // 능력/보수 차이를 반영해 1.8처럼 소수로 지정. 검증자 탭에서 관리자가 편집.
    if (!tableInfo.some((col: any) => col.name === 'rate_multiplier')) {
      db.exec("ALTER TABLE users ADD COLUMN rate_multiplier REAL NOT NULL DEFAULT 1.0")
    }
    // Slack 작업완료 알림 — 본인 Slack member ID(DM·멘션 공용) + 수신 on/off(기본 on, 본인이 최종 veto)
    if (!tableInfo.some((col: any) => col.name === 'slack_user_id')) {
      db.exec("ALTER TABLE users ADD COLUMN slack_user_id TEXT NOT NULL DEFAULT ''")
    }
    if (!tableInfo.some((col: any) => col.name === 'slack_notify')) {
      db.exec("ALTER TABLE users ADD COLUMN slack_notify INTEGER NOT NULL DEFAULT 1")
    }
    // 회원가입/소셜 로그인 시점의 이용약관·개인정보처리방침 동의 시각(ISO). 기존 가입자는 NULL.
    if (!tableInfo.some((col: any) => col.name === 'terms_agreed_at')) {
      db.exec("ALTER TABLE users ADD COLUMN terms_agreed_at TEXT")
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

  // 툴 직접개발 작업의 확정 작업시간(초). 산정 우선순위: ive-meta(ended-started) > GitLab /spend > 0.
  // 보고서가 DB만 읽어 산정하도록 스캐너가 채운다(이슈 열린 기간 created→등록 으로 부풀리지 않기 위함).
  try {
    const tableInfo = db.prepare("PRAGMA table_info(task_executions)").all() as any[]
    if (!tableInfo.some((col: any) => col.name === 'work_sec')) {
      db.exec("ALTER TABLE task_executions ADD COLUMN work_sec INTEGER NOT NULL DEFAULT 0")
      // 백필(1회): ive-meta가 있는 과거 툴개발 exec은 started!=issue_created_at 이므로 (ended-started)로 채운다.
      // ive-meta 없는 건(started==created)은 0으로 남고, GitLab /spend 백필은 별도 잡이 채운다.
      db.exec(`
        UPDATE task_executions
           SET work_sec = CAST((julianday(ended_at) - julianday(started_at)) * 86400 AS INTEGER)
         WHERE assignee_type = 'user'
           AND id NOT LIKE 'ex-verify%' AND id NOT LIKE 'ex-confirm%'
           AND ended_at IS NOT NULL
           AND started_at <> issue_created_at
           AND (julianday(ended_at) - julianday(started_at)) * 86400 > 0
      `)
      console.log('[DB] Added work_sec + backfilled ive-meta tool-dev durations')
    }
  } catch (e) { console.error("Migration failed for work_sec column:", e) }

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

  // Slack 작업완료 알림 — 알림 채널 ID + 사용할 워크스페이스 + 알림 트리거 레이블(IVE-N)
  try {
    const tableInfo = db.prepare("PRAGMA table_info(projects)").all() as any[]
    if (!tableInfo.some((col: any) => col.name === 'slack_notify_channel')) {
      db.exec("ALTER TABLE projects ADD COLUMN slack_notify_channel TEXT NOT NULL DEFAULT ''")
    }
    if (!tableInfo.some((col: any) => col.name === 'slack_workspace_id')) {
      db.exec("ALTER TABLE projects ADD COLUMN slack_workspace_id TEXT NOT NULL DEFAULT ''")
    }
    if (!tableInfo.some((col: any) => col.name === 'label_notify')) {
      db.exec("ALTER TABLE projects ADD COLUMN label_notify TEXT NOT NULL DEFAULT 'IVE-N'")
    }
  } catch (e) { console.error("Migration failed for projects slack notify:", e) }

  // 에이전트 모니터링 설정
  try {
    const tableInfo = db.prepare("PRAGMA table_info(agents)").all() as any[]
    if (!tableInfo.some((col: any) => col.name === 'snapshot_interval')) {
      db.exec("ALTER TABLE agents ADD COLUMN snapshot_interval INTEGER NOT NULL DEFAULT 1")
      db.exec("ALTER TABLE agents ADD COLUMN sparkline_points INTEGER NOT NULL DEFAULT 60")
      db.exec("ALTER TABLE agents ADD COLUMN stats_retention INTEGER NOT NULL DEFAULT 7")
    }
  } catch (e) { console.error("Migration failed for agents monitoring:", e) }

  // 에이전트 사용여부(휴가) — enabled 마스터 스위치 + paused_until 자동복귀 예약
  try {
    const tableInfo = db.prepare("PRAGMA table_info(agents)").all() as any[]
    if (!tableInfo.some((col: any) => col.name === 'enabled')) {
      db.exec("ALTER TABLE agents ADD COLUMN enabled INTEGER NOT NULL DEFAULT 1")
    }
    if (!tableInfo.some((col: any) => col.name === 'paused_until')) {
      db.exec("ALTER TABLE agents ADD COLUMN paused_until TEXT")
    }
  } catch (e) { console.error("Migration failed for agents vacation:", e) }

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
    if (!tableInfo.some((col: any) => col.name === 'test_site_url')) {
      db.exec("ALTER TABLE projects ADD COLUMN test_site_url TEXT NOT NULL DEFAULT ''")
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
  try { db.exec(`ALTER TABLE issue_stages ADD COLUMN confirm_started_at TEXT DEFAULT NULL`) } catch { /* 이미 존재 */ }
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
  // 보고서 범위 조회(getExecutionsInRange)는 started_at 범위 필터 + project_id 조인을 쓴다.
  // 데이터가 커질수록 풀스캔이 느려지므로 인덱스로 보강(보고서 성능).
  try { db.exec(`CREATE INDEX IF NOT EXISTS idx_te_started_at ON task_executions(started_at)`) } catch { /* ignore */ }
  try { db.exec(`CREATE INDEX IF NOT EXISTS idx_te_project_issue ON task_executions(project_id, issue_iid)`) } catch { /* ignore */ }

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

  // 메일 브로드캐스트(관리자 메일발송) 이력 테이블
  db.exec(`
    CREATE TABLE IF NOT EXISTS mail_broadcast_logs (
      id TEXT PRIMARY KEY,
      sender_user_id TEXT,
      sender_name TEXT,
      sender_email TEXT,
      subject TEXT NOT NULL,
      body TEXT NOT NULL,
      recipient_emails TEXT NOT NULL DEFAULT '[]',
      total_count INTEGER NOT NULL DEFAULT 0,
      sent_count INTEGER NOT NULL DEFAULT 0,
      failed_count INTEGER NOT NULL DEFAULT 0,
      failed_recipients TEXT NOT NULL DEFAULT '[]',
      sent_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE INDEX IF NOT EXISTS idx_mail_broadcast_logs_sent_at ON mail_broadcast_logs(sent_at);
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

  // OAuth: oauth_providers 테이블 (github/gitlab 로그인 + slack 통합)
  db.exec(`
    CREATE TABLE IF NOT EXISTS oauth_providers (
      id TEXT PRIMARY KEY,
      type TEXT NOT NULL CHECK(type IN ('github', 'gitlab', 'slack')),
      name TEXT NOT NULL,
      base_url TEXT NOT NULL,
      client_id TEXT NOT NULL,
      client_secret TEXT NOT NULL,
      signing_secret TEXT,
      enabled INTEGER NOT NULL DEFAULT 1,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    )
  `)

  // 기존 oauth_providers를 Slack 통합 스키마로 보강:
  //  - CHECK 제약에 'slack' 추가 (SQLite는 CHECK 변경 불가 → 테이블 재빌드)
  //  - signing_secret 컬럼 추가 (Slack 이벤트 서명 검증용, github/gitlab은 NULL)
  try {
    const sqlRow = db.prepare("SELECT sql FROM sqlite_master WHERE type='table' AND name='oauth_providers'").get() as any
    if (sqlRow?.sql && !/'slack'/.test(sqlRow.sql)) {
      console.log('[DB] Rebuilding oauth_providers (slack type + signing_secret)')
      db.exec(`
        CREATE TABLE oauth_providers_new (
          id TEXT PRIMARY KEY,
          type TEXT NOT NULL CHECK(type IN ('github', 'gitlab', 'slack')),
          name TEXT NOT NULL,
          base_url TEXT NOT NULL,
          client_id TEXT NOT NULL,
          client_secret TEXT NOT NULL,
          signing_secret TEXT,
          enabled INTEGER NOT NULL DEFAULT 1,
          created_at TEXT NOT NULL DEFAULT (datetime('now'))
        )
      `)
      db.exec(`
        INSERT INTO oauth_providers_new (id, type, name, base_url, client_id, client_secret, enabled, created_at)
        SELECT id, type, name, base_url, client_id, client_secret, enabled, created_at FROM oauth_providers
      `)
      db.exec('DROP TABLE oauth_providers')
      db.exec('ALTER TABLE oauth_providers_new RENAME TO oauth_providers')
      console.log('[DB] oauth_providers rebuild complete')
    } else {
      const cols = (db.prepare("PRAGMA table_info(oauth_providers)").all() as any[]).map((c: any) => c.name)
      if (!cols.includes('signing_secret')) {
        db.exec("ALTER TABLE oauth_providers ADD COLUMN signing_secret TEXT")
        console.log('[DB] oauth_providers: added signing_secret column')
      }
    }
  } catch (e) { console.error('[DB] oauth_providers slack migration failed:', e) }

  // system_settings에 있던 Slack 앱 자격증명을 oauth_providers 'slack' 행으로 1회 이관.
  // (값은 이미 encrypt()로 저장돼 있어 그대로 복사 — oauth_providers도 동일하게 암호화 저장)
  try {
    const hasSlack = db.prepare("SELECT 1 FROM oauth_providers WHERE type='slack' LIMIT 1").get()
    const ss = (k: string) => (db.prepare("SELECT value FROM system_settings WHERE key = ?").get(k) as any)?.value || null
    const clientId = ss('slack.client_id')
    if (!hasSlack && clientId) {
      db.prepare(`
        INSERT INTO oauth_providers (id, type, name, base_url, client_id, client_secret, signing_secret, enabled)
        VALUES ('slack', 'slack', 'Slack', 'https://slack.com', ?, ?, ?, ?)
      `).run(clientId, ss('slack.client_secret') || '', ss('slack.signing_secret'), ss('slack.login_enabled') === '1' ? 1 : 0)
      console.log('[DB] migrated system_settings slack.* → oauth_providers row')
    }
  } catch (e) { console.error('[DB] slack settings→provider migration failed:', e) }

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

  // users.avatar_source: 아바타 출처 구분 ('upload'=직접 지정 보호 / 'oauth'=provider서 가져옴, 로그인 시 갱신)
  // 기존 사진(photo)은 사용자 것일 수 있으므로 안전하게 'upload'로 보존(자동 갱신 대상에서 제외).
  try {
    const userCols = (db.prepare("PRAGMA table_info(users)").all() as any[]).map((c: any) => c.name)
    if (!userCols.includes('avatar_source')) {
      db.exec("ALTER TABLE users ADD COLUMN avatar_source TEXT")
      db.exec("UPDATE users SET avatar_source = 'upload' WHERE avatar = 'photo' AND avatar_source IS NULL")
      console.log('[DB] users: added avatar_source column (existing photos kept as upload)')
    }
  } catch (e) { console.error('[DB] users avatar_source migration failed:', e) }

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

  // 프로젝트 신고 페이지 시크릿 토큰
  try {
    const tableInfo = db.prepare("PRAGMA table_info(projects)").all() as any[]
    if (!tableInfo.some((col: any) => col.name === 'report_secret')) {
      db.exec("ALTER TABLE projects ADD COLUMN report_secret TEXT")
      console.log('[DB] Added report_secret to projects')
    }
  } catch (e) { console.error("Migration failed for projects report_secret:", e) }

  // ── Slack 통합 ──
  // 워크스페이스 (행마다 워크스페이스 1개 = 봇 토큰 1쌍). 멀티 워크스페이스 관리.
  db.exec(`
    CREATE TABLE IF NOT EXISTS slack_workspaces (
      id TEXT PRIMARY KEY,
      team_id TEXT NOT NULL UNIQUE,
      team_name TEXT NOT NULL DEFAULT '',
      team_url TEXT NOT NULL DEFAULT '',
      name TEXT NOT NULL DEFAULT '',
      bot_token TEXT NOT NULL,
      signing_secret TEXT NOT NULL,
      bot_user_id TEXT NOT NULL DEFAULT '',
      default_user_id TEXT,
      max_instances INTEGER NOT NULL DEFAULT 3,
      enabled INTEGER NOT NULL DEFAULT 1,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
  `)
  // 기존 slack_workspaces 컬럼 보강
  try {
    const cols = (db.prepare("PRAGMA table_info(slack_workspaces)").all() as any[]).map(c => c.name)
    if (!cols.includes('max_instances')) db.exec("ALTER TABLE slack_workspaces ADD COLUMN max_instances INTEGER NOT NULL DEFAULT 3")
    if (!cols.includes('team_url')) db.exec("ALTER TABLE slack_workspaces ADD COLUMN team_url TEXT NOT NULL DEFAULT ''")
  } catch { /* ignore */ }
  // 채널 ↔ 프로젝트 연결 (채널 = 프로젝트)
  db.exec(`
    CREATE TABLE IF NOT EXISTS slack_channel_config (
      workspace_id TEXT NOT NULL,
      channel_id TEXT NOT NULL,
      channel_name TEXT,
      project_id TEXT,
      ive_user_id TEXT,
      updated_at TEXT NOT NULL DEFAULT (datetime('now')),
      PRIMARY KEY (workspace_id, channel_id)
    );
  `)
  // 스레드 ↔ 이슈 바인딩 (스레드 = 이슈)
  db.exec(`
    CREATE TABLE IF NOT EXISTS slack_thread_session (
      workspace_id TEXT NOT NULL,
      channel_id TEXT NOT NULL,
      thread_ts TEXT NOT NULL,
      issue_iid INTEGER,
      cli_session_id TEXT,
      cli_name TEXT,
      project_id TEXT,
      updated_at TEXT NOT NULL DEFAULT (datetime('now')),
      PRIMARY KEY (workspace_id, channel_id, thread_ts)
    );
  `)
  // 기존 slack_thread_session 컬럼 보강
  //  - cli_name: 어느 CLI가 만든 세션인지 (resume 호환성 판단용)
  //  - project_id: 어느 프로젝트로 시작한 대화인지 (프로젝트가 바뀌면 claude 세션 cwd가 달라져 resume 실패)
  try {
    const cols = (db.prepare("PRAGMA table_info(slack_thread_session)").all() as any[]).map(c => c.name)
    if (!cols.includes('cli_name')) db.exec("ALTER TABLE slack_thread_session ADD COLUMN cli_name TEXT")
    if (!cols.includes('project_id')) db.exec("ALTER TABLE slack_thread_session ADD COLUMN project_id TEXT")
  } catch { /* ignore */ }
  // Slack 유저 ↔ IVE 유저 개인 매핑 (워크스페이스 기본유저 덮어쓰기)
  db.exec(`
    CREATE TABLE IF NOT EXISTS slack_user_map (
      workspace_id TEXT NOT NULL,
      slack_user_id TEXT NOT NULL,
      ive_user_id TEXT NOT NULL,
      PRIMARY KEY (workspace_id, slack_user_id)
    );
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
  const exists = db.prepare('SELECT id FROM users WHERE email = ?').get(DEFAULT_ADMIN_EMAIL)
  if (!exists) {
    db.prepare('INSERT INTO users (id, email, password, name, is_admin, max_agents, max_turns, allowed_clis) VALUES (?, ?, ?, ?, 1, 0, 0, ?)').run(
      'user-admin',
      DEFAULT_ADMIN_EMAIL,
      bcrypt.hashSync('admin', 10),
      '관리자',
      'claude,opencode'
    )
  } else {
    db.prepare('UPDATE users SET is_admin = 1, max_agents = 0, max_turns = 0, allowed_clis = ? WHERE email = ?').run('claude,opencode', DEFAULT_ADMIN_EMAIL)
  }
}
