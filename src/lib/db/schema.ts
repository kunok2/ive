import Database from 'better-sqlite3'
import bcrypt from 'bcryptjs'
import { DEFAULT_ADMIN_EMAIL } from '@/lib/constants'
import fs from 'fs'
import { resolveCliPath } from '@/lib/cli-paths'

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
      mail_unsubscribed INTEGER NOT NULL DEFAULT 0,
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
      cli_name TEXT NOT NULL CHECK(cli_name IN ('claude', 'agy', 'codex', 'opencode', 'gemini')),
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
      confirm_waiting INTEGER NOT NULL DEFAULT 0,
      completed INTEGER NOT NULL DEFAULT 0,
      failed INTEGER NOT NULL DEFAULT 0,
      total_tokens INTEGER NOT NULL DEFAULT 0,
      cost_usd REAL NOT NULL DEFAULT 0
    );
    CREATE INDEX IF NOT EXISTS idx_stat_snapshots_entity ON stat_snapshots(entity_type, entity_id, timestamp);
    -- 보고서 대기추이: entity_type 고정 + timestamp 레인지 조회용 (entity_id 무관 전체 스캔 방지)
    CREATE INDEX IF NOT EXISTS idx_stat_snapshots_type_ts ON stat_snapshots(entity_type, timestamp);

    CREATE TABLE IF NOT EXISTS stat_daily_summaries (
      id TEXT PRIMARY KEY,
      entity_type TEXT NOT NULL CHECK(entity_type IN ('project', 'agent')),
      entity_id TEXT NOT NULL,
      date TEXT NOT NULL,
      avg_running REAL NOT NULL DEFAULT 0,
      avg_waiting REAL NOT NULL DEFAULT 0,
      avg_verify_waiting REAL NOT NULL DEFAULT 0,
      avg_confirm_waiting REAL NOT NULL DEFAULT 0,
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
    -- 단가 이력 (유효일자). 보고서는 "지금 단가"가 아니라 "그 실행이 일어난 시점의 단가"로
    -- 계산해야 한다. 단가를 바꾸면 과거 보고서가 소급 변경되던 문제를 막는다.
    --   kind='human'           key=''          input_price=월급(USD),      meta={daysPerWeek,hoursPerDay}
    --   kind='ai_subscription' key=cliName     input_price=월 구독료(USD)
    --   kind='model'           key=modelName   input_price/output_price=$/1M tokens
    --   kind='multiplier'      key=userId      input_price=사람단가 배수
    CREATE TABLE IF NOT EXISTS rate_history (
      id TEXT PRIMARY KEY,
      kind TEXT NOT NULL,
      key TEXT NOT NULL DEFAULT '',
      input_price REAL NOT NULL,
      output_price REAL NOT NULL DEFAULT 0,
      meta TEXT,
      effective_from TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE INDEX IF NOT EXISTS idx_rate_history_lookup ON rate_history(kind, key, effective_from);

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
    // 패드·PC 폭(768px~)의 주 메뉴 위치 — 'top'(기본) | 'bottom' | 'left' | 'right'. NULL = 위(상단바 가운데). 폰 폭은 늘 하단 탭
    if (!tableInfo.some((col: any) => col.name === 'nav_position')) {
      db.exec("ALTER TABLE users ADD COLUMN nav_position TEXT")
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

    -- 확정된 보고서 스냅샷.
    -- 기간이 닫히면(period_end <= now) 그때 계산한 응답을 통째로 저장하고, 이후 조회는
    -- 저장본을 그대로 보여준다. 단가(월급·구독료·모델단가·배수)를 나중에 바꿔도 과거
    -- 보고서 숫자가 소급 변경되지 않는다. 메일로 보낸 수치와 화면이 어긋나지도 않는다.
    -- ⚠️ 보고서는 사용자별로 데이터가 다르므로(getExecutionsInRange(user.id, ...))
    --    반드시 user_id 를 키에 포함해야 한다.
    CREATE TABLE IF NOT EXISTS report_snapshots (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL,
      report_type TEXT NOT NULL,
      period_start TEXT NOT NULL,
      period_end TEXT NOT NULL,
      payload TEXT NOT NULL,
      generated_at TEXT NOT NULL DEFAULT (datetime('now')),
      UNIQUE(user_id, report_type, period_start, period_end)
    );
    CREATE INDEX IF NOT EXISTS idx_report_snapshots_lookup ON report_snapshots(user_id, report_type, period_start, period_end);
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

  // 메일 임시저장(draft) — 작성 후 발송하지 않고 보관. 발송 시 삭제하거나 그대로 둘 수 있다.
  db.exec(`
    CREATE TABLE IF NOT EXISTS mail_drafts (
      id TEXT PRIMARY KEY,
      subject TEXT NOT NULL DEFAULT '',
      body TEXT NOT NULL DEFAULT '',
      target_user_ids TEXT NOT NULL DEFAULT '[]',
      created_by_user_id TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE INDEX IF NOT EXISTS idx_mail_drafts_updated ON mail_drafts(updated_at);
  `)

  // 브로드캐스트 메일의 IVE 접속 링크 클릭(접속) 기록.
  // 누가(user_id) 언제(clicked_at) 어떤 발송(broadcast_log_id)으로 접속했는지 추적한다.
  db.exec(`
    CREATE TABLE IF NOT EXISTS mail_broadcast_clicks (
      id TEXT PRIMARY KEY,
      broadcast_log_id TEXT NOT NULL,
      user_id TEXT,
      email TEXT,
      ip_address TEXT,
      user_agent TEXT,
      clicked_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE INDEX IF NOT EXISTS idx_mail_clicks_log ON mail_broadcast_clicks(broadcast_log_id);
    CREATE INDEX IF NOT EXISTS idx_mail_clicks_log_user ON mail_broadcast_clicks(broadcast_log_id, user_id);
  `)

  // SNS 홍보 게시글(자산). 한 글을 여러 채널에 수기 게시하며 채널별 추적 링크로 유입/전환을 측정한다.
  db.exec(`
    CREATE TABLE IF NOT EXISTS social_posts (
      id TEXT PRIMARY KEY,
      title TEXT NOT NULL DEFAULT '',
      body TEXT NOT NULL DEFAULT '',
      created_by_user_id TEXT,
      status TEXT NOT NULL DEFAULT 'draft',
      note TEXT NOT NULL DEFAULT '',
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE TABLE IF NOT EXISTS social_post_links (
      id TEXT PRIMARY KEY,
      post_id TEXT NOT NULL,
      channel TEXT NOT NULL,
      posted_url TEXT,
      posted_at TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE INDEX IF NOT EXISTS idx_social_links_post ON social_post_links(post_id);
    CREATE TABLE IF NOT EXISTS social_clicks (
      id TEXT PRIMARY KEY,
      post_id TEXT NOT NULL,
      link_id TEXT NOT NULL,
      channel TEXT NOT NULL,
      visitor_id TEXT,
      ip_address TEXT,
      user_agent TEXT,
      referrer TEXT,
      converted_user_id TEXT,
      conversion_type TEXT,
      converted_at TEXT,
      clicked_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE INDEX IF NOT EXISTS idx_social_clicks_post ON social_clicks(post_id);
    CREATE INDEX IF NOT EXISTS idx_social_clicks_link ON social_clicks(link_id);
    CREATE INDEX IF NOT EXISTS idx_social_clicks_visitor ON social_clicks(visitor_id);
    CREATE INDEX IF NOT EXISTS idx_social_clicks_conv ON social_clicks(converted_user_id);
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

  // stat_snapshots: verify_waiting / confirm_waiting 컬럼 추가
  try {
    const snapCols = db.prepare("PRAGMA table_info(stat_snapshots)").all() as any[]
    if (!snapCols.some((c: any) => c.name === 'verify_waiting')) {
      db.exec("ALTER TABLE stat_snapshots ADD COLUMN verify_waiting INTEGER NOT NULL DEFAULT 0")
      console.log('[DB] stat_snapshots: added verify_waiting column')
    }
    if (!snapCols.some((c: any) => c.name === 'confirm_waiting')) {
      db.exec("ALTER TABLE stat_snapshots ADD COLUMN confirm_waiting INTEGER NOT NULL DEFAULT 0")
      console.log('[DB] stat_snapshots: added confirm_waiting column')
    }
    const summaryCols = db.prepare("PRAGMA table_info(stat_daily_summaries)").all() as any[]
    if (!summaryCols.some((c: any) => c.name === 'avg_verify_waiting')) {
      db.exec("ALTER TABLE stat_daily_summaries ADD COLUMN avg_verify_waiting REAL NOT NULL DEFAULT 0")
      console.log('[DB] stat_daily_summaries: added avg_verify_waiting column')
    }
    if (!summaryCols.some((c: any) => c.name === 'avg_confirm_waiting')) {
      db.exec("ALTER TABLE stat_daily_summaries ADD COLUMN avg_confirm_waiting REAL NOT NULL DEFAULT 0")
      console.log('[DB] stat_daily_summaries: added avg_confirm_waiting column')
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
        confirm_waiting INTEGER NOT NULL DEFAULT 0,
        completed INTEGER NOT NULL DEFAULT 0,
        failed INTEGER NOT NULL DEFAULT 0,
        total_tokens INTEGER NOT NULL DEFAULT 0,
        cost_usd REAL NOT NULL DEFAULT 0
      )`)
      db.exec(`INSERT INTO stat_snapshots_new SELECT id, entity_type, entity_id, timestamp, running, waiting, verify_waiting, confirm_waiting, completed, failed, total_tokens, cost_usd FROM stat_snapshots`)
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
        avg_confirm_waiting REAL NOT NULL DEFAULT 0,
        avg_completed REAL NOT NULL DEFAULT 0,
        avg_failed REAL NOT NULL DEFAULT 0,
        avg_total_tokens REAL NOT NULL DEFAULT 0,
        avg_cost_usd REAL NOT NULL DEFAULT 0,
        sample_count INTEGER NOT NULL DEFAULT 0,
        UNIQUE(entity_type, entity_id, date)
      )`)
      db.exec(`INSERT INTO stat_daily_summaries_new SELECT id, entity_type, entity_id, date, avg_running, avg_waiting, avg_verify_waiting, avg_confirm_waiting, avg_completed, avg_failed, avg_total_tokens, avg_cost_usd, sample_count FROM stat_daily_summaries`)
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

  // agents.cli_name CHECK constraint에 agy 추가 + gemini 에이전트 전환
  //   Gemini CLI 가 단종되고 agy(Antigravity CLI)로 대체됐다. 과거 실행 이력의 'gemini' 표기는
  //   보고서 재현을 위해 그대로 두고, 에이전트 행만 agy 로 옮긴다.
  //   컬럼 목록을 하드코딩하지 않도록 현재 CREATE TABLE 문의 CHECK 절만 바꿔 재생성한다.
  try {
    const row = db.prepare("SELECT sql FROM sqlite_master WHERE type='table' AND name='agents'").get() as any
    if (row && row.sql && !row.sql.includes("'agy'")) {
      const newSql = row.sql
        .replace(/CREATE TABLE\s+(?:IF NOT EXISTS\s+)?["'`]?agents["'`]?/i, 'CREATE TABLE agents_new')
        .replace(/CHECK\s*\(\s*cli_name\s+IN\s*\([^)]*\)\s*\)/i,
                 "CHECK(cli_name IN ('claude', 'agy', 'codex', 'opencode', 'gemini'))")
      if (newSql.includes('agents_new') && newSql.includes("'agy'")) {
        db.pragma('foreign_keys = OFF')
        db.exec(newSql)
        db.exec('INSERT INTO agents_new SELECT * FROM agents')
        db.exec('DROP TABLE agents')
        db.exec('ALTER TABLE agents_new RENAME TO agents')
        db.pragma('foreign_keys = ON')
        console.log('[DB] agents cli_name CHECK constraint updated to include agy')
      }
    }
    // 전환 시 경로도 agy 로 바꾼다. 설치 위치가 환경마다 달라(도커 /usr/local/bin,
    // 설치 스크립트 ~/.local/bin) 실제 존재하는 파일을 찾아 넣는다.
    const agyPath = resolveCliPath('agy')
    const moved = db.prepare(
      `UPDATE agents SET cli_name = 'agy',
         cli_path = CASE WHEN cli_path LIKE '%gemini%' THEN ? ELSE cli_path END
       WHERE cli_name = 'gemini'`
    ).run(agyPath)
    if (moved.changes > 0) console.log(`[DB] gemini 에이전트 ${moved.changes}건을 agy 로 전환`)
    // 사용자별 허용 CLI 목록(users.allowed_clis, CSV)의 gemini 도 agy 로 옮긴다.
    // 안 하면 gemini 를 쓰던 사용자가 에이전트 생성 화면에서 agy 를 고를 수 없다.
    const allowed = db.prepare(
      `UPDATE users SET allowed_clis = replace(allowed_clis, 'gemini', 'agy') WHERE allowed_clis LIKE '%gemini%'`
    ).run()
    if (allowed.changes > 0) console.log(`[DB] allowed_clis 의 gemini → agy 전환 ${allowed.changes}건`)
    // 시스템 설정의 agy 경로가 비어 있으면 실제 설치 경로로 채운다(설정 화면 기본값과 일치).
    const hasAgyPath = db.prepare("SELECT 1 FROM system_settings WHERE key = 'cli.agy.path'").get()
    if (!hasAgyPath && fs.existsSync(agyPath)) {
      db.prepare("INSERT INTO system_settings (key, value) VALUES ('cli.agy.path', ?)").run(agyPath)
      console.log(`[DB] cli.agy.path 기본값 설정: ${agyPath}`)
    }
  } catch (e) { console.error('[DB] agy migration failed:', e) }

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

  // users.mail_unsubscribed: 브로드캐스트(관리자 발송) 메일 수신거부 플래그.
  // 1 = 수신거부(브로드캐스트 제외). 인증코드 등 시스템 트랜잭션 메일에는 영향 없음.
  try {
    const userCols = (db.prepare("PRAGMA table_info(users)").all() as any[]).map((c: any) => c.name)
    if (!userCols.includes('mail_unsubscribed')) {
      db.exec("ALTER TABLE users ADD COLUMN mail_unsubscribed INTEGER NOT NULL DEFAULT 0")
      console.log('[DB] users: added mail_unsubscribed column')
    }
  } catch (e) { console.error('[DB] users mail_unsubscribed migration failed:', e) }

  // 본인 Git username (확인자/담당자 → IVE 계정 매핑 fallback). 예전에는 아래 재생성에만 들어 있어 새 DB 에서는 칸이 생기지 않았다.
  try {
    const userCols = (db.prepare("PRAGMA table_info(users)").all() as { name: string }[]).map(c => c.name)
    if (!userCols.includes('gitlab_username')) db.exec("ALTER TABLE users ADD COLUMN gitlab_username TEXT")
    if (!userCols.includes('github_username')) db.exec("ALTER TABLE users ADD COLUMN github_username TEXT")
  } catch (e) { console.error('[DB] users git username columns migration failed:', e) }

  // users.password NOT NULL → NULL 허용 (OAuth 가입자는 비밀번호가 없다)
  // 지금 테이블 정의를 그대로 옮기고 password 제약만 푼다 — 고정 칸 목록으로 다시 만들면 그 사이 추가된 칸이 떨어져 나간다.
  try {
    const sqlRow = db.prepare("SELECT sql FROM sqlite_master WHERE type='table' AND name='users'").get() as any
    if (sqlRow?.sql && /password\s+TEXT\s+NOT\s+NULL/i.test(sqlRow.sql)) {
      console.log('[DB] Migrating users: password NOT NULL → nullable (OAuth 지원)')
      const newSql = String(sqlRow.sql)
        .replace(/^CREATE TABLE\s+(IF NOT EXISTS\s+)?["`\[]?users["`\]]?/i, 'CREATE TABLE users_new')
        .replace(/password\s+TEXT\s+NOT\s+NULL/i, 'password TEXT')
      const cols = (db.prepare("PRAGMA table_info(users)").all() as { name: string }[]).map(c => `"${c.name}"`).join(', ')
      db.pragma('foreign_keys = OFF')
      db.exec('DROP TABLE IF EXISTS users_new')
      db.exec(newSql)
      db.exec(`INSERT INTO users_new (${cols}) SELECT ${cols} FROM users`)
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

  // ── 단가 이력 백필 ──
  try {
    // rate_history 백필: 이력 도입 이전의 현재 단가들을 EPOCH 유효로 한 번만 심는다.
    // 이게 없으면 과거 exec 이 "그 시점 단가 없음" 으로 0원 처리된다.
    const rhCount = db.prepare('SELECT COUNT(*) c FROM rate_history').get() as { c: number }
    if (rhCount.c === 0) {
      const EPOCH0 = '1970-01-01T00:00:00.000Z'
      const ins = db.prepare(`
        INSERT OR IGNORE INTO rate_history (id, kind, key, input_price, output_price, meta, effective_from)
        VALUES (?, ?, ?, ?, ?, ?, ?)
      `)
      type PricingRow = { cli_name: string; model_name: string; input_price: number; output_price: number }
      type SettingRow = { value: string } | undefined
      const pricing = db.prepare('SELECT cli_name, model_name, input_price, output_price FROM token_pricing').all() as PricingRow[]
      let seeded = 0
      for (const p of pricing) {
        if (p.cli_name === 'human') {
          const dpw = db.prepare("SELECT value FROM system_settings WHERE key='human.daysPerWeek'").get() as SettingRow
          const hpd = db.prepare("SELECT value FROM system_settings WHERE key='human.hoursPerDay'").get() as SettingRow
          const meta = JSON.stringify({
            daysPerWeek: parseFloat(dpw?.value ?? '') || 5,
            hoursPerDay: parseFloat(hpd?.value ?? '') || 8,
          })
          ins.run(`rh-human--${EPOCH0}`, 'human', '', p.input_price, 0, meta, EPOCH0)
        } else if (String(p.model_name).startsWith('subscription (')) {
          ins.run(`rh-ai_subscription-${p.cli_name}-${EPOCH0}`, 'ai_subscription', p.cli_name, p.input_price, 0, null, EPOCH0)
        } else {
          ins.run(`rh-model-${p.model_name}-${EPOCH0}`, 'model', p.model_name, p.input_price, p.output_price, null, EPOCH0)
        }
        seeded++
      }
      const users = db.prepare('SELECT id, rate_multiplier FROM users').all() as { id: string; rate_multiplier: number | null }[]
      for (const u of users) {
        ins.run(`rh-multiplier-${u.id}-${EPOCH0}`, 'multiplier', u.id, u.rate_multiplier ?? 1, 0, null, EPOCH0)
        seeded++
      }
      if (seeded > 0) console.log(`[DB] rate_history 백필: ${seeded}건 (EPOCH 유효)`)
    }
  } catch (e) { console.error('Migration failed for rate_history backfill:', e) }

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

  migrateStageAutomation(db)

  seedAdmin(db)
  seedTokenPricing(db)
}

/**
 * 처리·검증·확인 역할에 사람 또는 에이전트를 배정하는 모델 (단계 자동화).
 *
 *   project_role_members : 프로젝트별 역할 명부. 한 줄 = (대상, 역할들). 대상은 사람(Git username) 또는 에이전트.
 *                          source='sync' 는 Git 멤버 동기화로 자동 들어온 줄(멤버가 빠지면 같이 빠짐),
 *                          'manual' 은 사람이 손댄 줄(역할을 전부 끈 줄은 "명시적 제외" 기록으로 남는다).
 *   project_automation   : 프로젝트별 기본 배정·안전장치·상한·staging 정보·비밀값(암호화).
 *   role_prompts(+history): 역할별 프롬프트의 편집 가능한 부분(프로젝트 덮어쓰기)과 변경 이력.
 *   issue_stages         : 검증자·확인자 preset 에 에이전트 지정(mode='agent' + *_agent_id),
 *                          기본 배정 적용 시각, 외부 작성자 이슈의 자동 실행 승인.
 *   task_executions      : 실행 때 쓴 프롬프트 판(prompt_version), 단계 종류(stage_kind).
 */
function migrateStageAutomation(db: Database.Database) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS project_role_members (
      project_id TEXT NOT NULL,
      subject_type TEXT NOT NULL CHECK(subject_type IN ('user', 'agent')),
      subject_id TEXT NOT NULL,
      git_user_id TEXT DEFAULT NULL,
      name TEXT NOT NULL DEFAULT '',
      avatar TEXT NOT NULL DEFAULT '',
      can_process INTEGER NOT NULL DEFAULT 0,
      can_verify INTEGER NOT NULL DEFAULT 0,
      can_confirm INTEGER NOT NULL DEFAULT 0,
      source TEXT NOT NULL DEFAULT 'manual' CHECK(source IN ('sync', 'manual')),
      updated_by TEXT DEFAULT NULL,
      updated_at TEXT NOT NULL DEFAULT (datetime('now')),
      PRIMARY KEY (project_id, subject_type, subject_id),
      FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS project_automation (
      project_id TEXT PRIMARY KEY,
      default_roles TEXT NOT NULL DEFAULT '{}',
      author_allowlist TEXT NOT NULL DEFAULT '[]',
      staging_secrets TEXT NOT NULL DEFAULT '',
      limits TEXT NOT NULL DEFAULT '{}',
      updated_by TEXT DEFAULT NULL,
      updated_at TEXT NOT NULL DEFAULT (datetime('now')),
      FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS role_prompts (
      project_id TEXT NOT NULL,
      kind TEXT NOT NULL,
      body TEXT NOT NULL,
      version INTEGER NOT NULL DEFAULT 1,
      updated_by TEXT DEFAULT NULL,
      updated_at TEXT NOT NULL DEFAULT (datetime('now')),
      PRIMARY KEY (project_id, kind),
      FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS role_prompt_history (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      project_id TEXT NOT NULL,
      kind TEXT NOT NULL,
      version INTEGER NOT NULL,
      body TEXT DEFAULT NULL,
      updated_by TEXT DEFAULT NULL,
      updated_by_name TEXT DEFAULT NULL,
      updated_at TEXT NOT NULL DEFAULT (datetime('now')),
      FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE
    );
    CREATE INDEX IF NOT EXISTS idx_role_prompt_history ON role_prompt_history(project_id, kind, version);
  `)

  // 확인(④) 단계의 staging 정보(주소·배포 커밋 확인 주소 등) — IVE 동작용 메타정보라 IVE 에 둔다
  try { db.exec(`ALTER TABLE project_automation ADD COLUMN staging TEXT NOT NULL DEFAULT '{}'`) } catch { /* 이미 존재 */ }
  try { db.exec(`ALTER TABLE issue_stages ADD COLUMN preset_verifier_agent_id TEXT DEFAULT NULL`) } catch { /* 이미 존재 */ }
  try { db.exec(`ALTER TABLE issue_stages ADD COLUMN preset_confirmer_agent_id TEXT DEFAULT NULL`) } catch { /* 이미 존재 */ }
  try { db.exec(`ALTER TABLE issue_stages ADD COLUMN roles_initialized_at TEXT DEFAULT NULL`) } catch { /* 이미 존재 */ }
  try { db.exec(`ALTER TABLE issue_stages ADD COLUMN automation_approved_at TEXT DEFAULT NULL`) } catch { /* 이미 존재 */ }
  try { db.exec(`ALTER TABLE issue_stages ADD COLUMN automation_approved_by TEXT DEFAULT NULL`) } catch { /* 이미 존재 */ }
  try { db.exec(`ALTER TABLE issue_stages ADD COLUMN author_username TEXT DEFAULT NULL`) } catch { /* 이미 존재 */ }
  try { db.exec(`ALTER TABLE issue_stages ADD COLUMN stage_worker_note TEXT DEFAULT NULL`) } catch { /* 이미 존재 */ }
  // 이슈가 들어온 경로 — 'ive'(IVE 등록 폼) | 'report'(작업 접수 페이지). NULL = Git 직접·API 등 IVE 밖. 경로별 기본 배정·자동 실행 허용에 쓴다
  try { db.exec(`ALTER TABLE issue_stages ADD COLUMN intake_channel TEXT DEFAULT NULL`) } catch { /* 이미 존재 */ }
  // 작업 우선순위 — 0 보통 · 1 높음 · 2 긴급. 에이전트가 대기 작업을 집는 순서(높은 것 먼저, 같으면 먼저 들어온 것)
  try { db.exec(`ALTER TABLE issue_stages ADD COLUMN priority INTEGER NOT NULL DEFAULT 0`) } catch { /* 이미 존재 */ }
  try { db.exec(`ALTER TABLE task_executions ADD COLUMN prompt_version TEXT DEFAULT NULL`) } catch { /* 이미 존재 */ }
  try { db.exec(`ALTER TABLE task_executions ADD COLUMN stage_kind TEXT DEFAULT NULL`) } catch { /* 이미 존재 */ }
  // 단계 작업자 판정 (확인: pass | fail | blocked). 순환 상한·재기동 판단에 쓴다.
  try { db.exec(`ALTER TABLE task_executions ADD COLUMN stage_verdict TEXT DEFAULT NULL`) } catch { /* 이미 존재 */ }
  // 실행이 끝난 사유 — 'restart'(서버 재기동으로 끊김) → 스캐너가 대기로 되돌리면 'restart_requeued', 상한을 넘겨 사람에게 넘기면 'restart_gave_up'.
  try { db.exec(`ALTER TABLE task_executions ADD COLUMN end_reason TEXT DEFAULT NULL`) } catch { /* 이미 존재 */ }
  // 사람 단가 배수 — 프로젝트 × 사람 × 역할 (기본 단가 × 배수). 처음 생길 때 그 사람의 종전 배수(users.rate_multiplier)로 채워
  // 적용 직후 보고서 숫자가 바뀌지 않게 한다. 연결 기준: 명부의 Git 사용자 id = IVE 사용자의 OAuth id (프로젝트와 같은 공급자)
  const rmCols = (db.prepare('PRAGMA table_info(project_role_members)').all() as { name: string }[]).map(c => c.name)
  if (!rmCols.includes('rate_process')) {
    db.exec(`ALTER TABLE project_role_members ADD COLUMN rate_process REAL NOT NULL DEFAULT 1`)
    db.exec(`ALTER TABLE project_role_members ADD COLUMN rate_verify REAL NOT NULL DEFAULT 1`)
    db.exec(`ALTER TABLE project_role_members ADD COLUMN rate_confirm REAL NOT NULL DEFAULT 1`)
    try {
      // 명부 사람 줄 ↔ IVE 사용자: 같은 공급자의 OAuth id, 또는 사용자 정보의 Git username
      const linked = `(SELECT u.rate_multiplier FROM users u JOIN projects p ON p.id = project_role_members.project_id
          LEFT JOIN oauth_providers op ON op.id = u.oauth_provider_id
        WHERE u.rate_multiplier > 0 AND (
          (project_role_members.git_user_id IS NOT NULL AND u.oauth_user_id = project_role_members.git_user_id AND op.type = p.provider)
          OR (p.provider = 'gitlab' AND u.gitlab_username = project_role_members.subject_id)
          OR (p.provider = 'github' AND u.github_username = project_role_members.subject_id))
        ORDER BY u.rate_multiplier DESC LIMIT 1)`
      db.exec(`
        UPDATE project_role_members SET rate_process = ${linked}, rate_verify = ${linked}, rate_confirm = ${linked}
        WHERE subject_type = 'user' AND ${linked} IS NOT NULL
      `)
    } catch (e) { console.warn('[DB] role rate migration skipped:', (e as Error).message) }
  }
  // 머지·검사 설정(자동 머지·검사 명령) — 예전 묶음 배포 때 만든 컬럼 이름을 그대로 쓴다
  try { db.exec(`ALTER TABLE project_automation ADD COLUMN bundle TEXT NOT NULL DEFAULT '{}'`) } catch { /* 이미 존재 */ }
  // MR 머지로 이슈 자동 닫기 — 처리(D) 커밋·MR 문구에 Git 닫기 키워드(resolve #N)를 넣을지. NULL = 켬(종전 동작)
  try { db.exec(`ALTER TABLE project_automation ADD COLUMN close_on_merge INTEGER DEFAULT NULL`) } catch { /* 이미 존재 */ }

  // 예전 묶음 배포 기록(없앤 기능) — 남은 기록을 읽기만 한다(db/bundles.ts). 새로 쌓지 않는다.
  //   stage_bundles      : 묶음 하나(출발·머지·푸시·배포·확인 진행 상태)
  //   stage_bundle_items : 묶음 대기열과 묶음에 실린 이슈 (bundle_id 가 NULL 이면 아직 대기)
  db.exec(`
    CREATE TABLE IF NOT EXISTS stage_bundles (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      project_id TEXT NOT NULL,
      status TEXT NOT NULL,
      target_branch TEXT NOT NULL,
      base_sha TEXT DEFAULT NULL,
      pushed_sha TEXT DEFAULT NULL,
      pipeline_status TEXT DEFAULT NULL,
      pipeline_url TEXT DEFAULT NULL,
      note TEXT DEFAULT NULL,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      approved_at TEXT DEFAULT NULL,
      approved_by TEXT DEFAULT NULL,
      departed_at TEXT DEFAULT NULL,
      pushed_at TEXT DEFAULT NULL,
      deployed_at TEXT DEFAULT NULL,
      finished_at TEXT DEFAULT NULL,
      FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE
    );
    CREATE INDEX IF NOT EXISTS idx_stage_bundles_project ON stage_bundles(project_id, status);

    CREATE TABLE IF NOT EXISTS stage_bundle_items (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      project_id TEXT NOT NULL,
      issue_iid INTEGER NOT NULL,
      bundle_id INTEGER DEFAULT NULL,
      status TEXT NOT NULL,
      source_sha TEXT NOT NULL,
      mr_iid INTEGER DEFAULT NULL,
      mr_url TEXT DEFAULT NULL,
      issue_title TEXT DEFAULT NULL,
      merge_sha TEXT DEFAULT NULL,
      mr_result TEXT DEFAULT NULL,
      note TEXT DEFAULT NULL,
      queued_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now')),
      FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE
    );
    CREATE INDEX IF NOT EXISTS idx_stage_bundle_items_issue ON stage_bundle_items(project_id, issue_iid);
    CREATE INDEX IF NOT EXISTS idx_stage_bundle_items_bundle ON stage_bundle_items(bundle_id);
  `)

  // 사건 로그 — 보고서·평가를 나중에 캐낼 원재료. 추가만 하고 고치거나 지우지 않는다(lib/db/events.ts).
  //   issue_events  : 단계 전이(stage)·배정 대기 사유(wait)·후속 이슈 연결(link). 작업자는 사건마다 남긴다
  //   config_events : 결과에 영향을 주는 설정 변경(에이전트 모델·CLI, 시스템 CLI 모델, 자동화, 명부)
  //   person_aliases: 관리자가 직접 이은 이름·Git 계정 → IVE 사용자
  db.exec(`
    CREATE TABLE IF NOT EXISTS issue_events (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      occurred_at TEXT NOT NULL,
      project_id TEXT NOT NULL,
      issue_iid INTEGER NOT NULL,
      event TEXT NOT NULL,
      from_stage TEXT DEFAULT NULL,
      to_stage TEXT DEFAULT NULL,
      action TEXT DEFAULT NULL,
      actor_type TEXT NOT NULL DEFAULT 'unknown',
      actor_user_id TEXT DEFAULT NULL,
      actor_git_username TEXT DEFAULT NULL,
      actor_agent_id TEXT DEFAULT NULL,
      actor_model TEXT DEFAULT NULL,
      source TEXT NOT NULL,
      execution_id TEXT DEFAULT NULL,
      prompt_version TEXT DEFAULT NULL,
      reason TEXT DEFAULT NULL,
      ref_project_id TEXT DEFAULT NULL,
      ref_issue_iid INTEGER DEFAULT NULL,
      detail TEXT DEFAULT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_issue_events_issue ON issue_events(project_id, issue_iid, occurred_at);
    CREATE INDEX IF NOT EXISTS idx_issue_events_time ON issue_events(occurred_at);
    CREATE INDEX IF NOT EXISTS idx_issue_events_kind ON issue_events(event, occurred_at);

    CREATE TABLE IF NOT EXISTS config_events (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      occurred_at TEXT NOT NULL,
      scope TEXT NOT NULL,
      project_id TEXT DEFAULT NULL,
      target_id TEXT NOT NULL,
      field TEXT NOT NULL,
      old_value TEXT DEFAULT NULL,
      new_value TEXT DEFAULT NULL,
      actor_user_id TEXT DEFAULT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_config_events_target ON config_events(scope, target_id, occurred_at);
    CREATE INDEX IF NOT EXISTS idx_config_events_time ON config_events(occurred_at);

    CREATE TABLE IF NOT EXISTS person_aliases (
      alias TEXT NOT NULL COLLATE NOCASE,
      kind TEXT NOT NULL,
      user_id TEXT NOT NULL,
      source TEXT NOT NULL DEFAULT 'auto',
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now')),
      PRIMARY KEY (alias, kind)
    );
    CREATE INDEX IF NOT EXISTS idx_person_aliases_user ON person_aliases(user_id);
  `)
  // 별칭은 관리자가 직접 연결한 것만 쓴다(자동 판정은 항상 지금의 사용자 표로). 예전에 자동으로 채운 줄은 지운다
  db.exec(`DELETE FROM person_aliases WHERE source <> 'manual'`)
  // 보고서 메일 수신 거부 — 본인만 바꾼다(관리자는 배지로만 본다). 안내·소식 메일(mail_unsubscribed)과 별개
  try { db.exec(`ALTER TABLE users ADD COLUMN report_mail_unsubscribed INTEGER NOT NULL DEFAULT 0`) } catch { /* 이미 존재 */ }
  // 하루 마감 보유 — 프로젝트·날짜(KST)별로 그날 마지막에 본 단계별 보유 건수. 분 단위 스냅샷은 7일 뒤 지워지므로
  // 지난 기간의 "기간 말 보유"와 보유 추이는 이 표에서 읽는다. 수집기가 매분 그날 줄을 덮어쓴다(마지막 값이 마감값).
  db.exec(`
    CREATE TABLE IF NOT EXISTS held_daily (
      project_id TEXT NOT NULL,
      date TEXT NOT NULL,
      waiting INTEGER NOT NULL DEFAULT 0,
      dev INTEGER NOT NULL DEFAULT 0,
      dev_fail INTEGER NOT NULL DEFAULT 0,
      verify_waiting INTEGER NOT NULL DEFAULT 0,
      verifying INTEGER NOT NULL DEFAULT 0,
      confirm_waiting INTEGER NOT NULL DEFAULT 0,
      confirming INTEGER NOT NULL DEFAULT 0,
      updated_at TEXT NOT NULL,
      PRIMARY KEY (project_id, date)
    );
    CREATE INDEX IF NOT EXISTS idx_held_daily_date ON held_daily(date);
  `)
  // 7일 넘게 보유 중인 일 수(그날 마감). 기록 전의 줄은 NULL — 보고서는 "기록 없음"으로 본다
  try { db.exec(`ALTER TABLE held_daily ADD COLUMN over7 INTEGER DEFAULT NULL`) } catch { /* 이미 존재 */ }
  // 보유 건수를 모든 미완료 단계로 세기 위한 스냅샷 칸(종전에는 대기 3단계만 셌다)
  try { db.exec(`ALTER TABLE stat_snapshots ADD COLUMN dev INTEGER NOT NULL DEFAULT 0`) } catch { /* 이미 존재 */ }
  try { db.exec(`ALTER TABLE stat_snapshots ADD COLUMN dev_fail INTEGER NOT NULL DEFAULT 0`) } catch { /* 이미 존재 */ }
  try { db.exec(`ALTER TABLE stat_snapshots ADD COLUMN verifying INTEGER NOT NULL DEFAULT 0`) } catch { /* 이미 존재 */ }
  try { db.exec(`ALTER TABLE stat_snapshots ADD COLUMN confirming INTEGER NOT NULL DEFAULT 0`) } catch { /* 이미 존재 */ }

  // 이행: 지금 검증자 목록에 자동으로 보이던 Git 멤버를 검증 역할로 명부에 넣는다.
  // INSERT OR IGNORE 라 매 기동마다 돌아도 안전하다 — 사람이 역할을 바꾸거나 뺀 줄은 그대로 남는다.
  db.exec(`
    INSERT OR IGNORE INTO project_role_members (project_id, subject_type, subject_id, git_user_id, name, avatar, can_verify, source)
    SELECT project_id, 'user', username, git_user_id, COALESCE(NULLIF(name, ''), username), avatar_url, 1, 'sync'
    FROM project_members
  `)
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
