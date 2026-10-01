/**
 * 사람 단가 배수 — 「프로젝트 × 사람 × 역할」 (기본 단가 × 배수).
 *
 *   M-1 역할 명부의 사람 줄에 역할별 배수가 있고(기본 1), 저장하면 단가 이력에도 남는다. 에이전트 줄에는 두지 않는다.
 *   M-2 이행: 배수 칸이 처음 생길 때 그 사람의 종전 배수(users.rate_multiplier)로 채운다 — OAuth id 또는 Git username 으로 연결.
 *   M-3 보고서: 실행의 프로젝트·역할로 그 사람의 배수를 쓴다 (검증 = ex-verify, 확인 = ex-confirm, 그 밖의 사람 실행 = 처리).
 *       같은 사람이라도 프로젝트가 다르면 배수가 다르다. 명부에 없으면 종전 배수(읽기 전용), 그것도 없으면 1.
 */
import { describe, it, expect, beforeEach } from 'vitest'
import Database from 'better-sqlite3'
import { initSchema } from '@/lib/db/schema'
import { setRosterEntry, setRosterRates, getRoster, getExecutionsInRange } from '@/lib/db'

let db: Database.Database

function exec(id: string, project: string, extra: Record<string, unknown>) {
  const row = {
    id, project_id: project, agent_id: '', issue_iid: 1, issue_title: 't', status: 'success',
    started_at: '2026-10-01T01:00:00.000Z', ended_at: '2026-10-01T02:00:00.000Z', log_path: '',
    assignee_type: 'user', user_id: null, user_name: null, verifier_username: null, ...extra,
  }
  const cols = Object.keys(row)
  db.prepare(`INSERT INTO task_executions (${cols.join(',')}) VALUES (${cols.map(() => '?').join(',')})`).run(...Object.values(row))
}

beforeEach(() => {
  db = new Database(':memory:')
  ;(globalThis as any).db = db
  initSchema(db)
  db.prepare(`INSERT INTO oauth_providers (id, type, name, base_url, client_id, client_secret) VALUES ('gl', 'gitlab', 'GitLab', 'https://gitlab.com', 'c', 's')`).run()
  db.prepare(`INSERT INTO users (id, email, password, name, oauth_provider_id, oauth_user_id, rate_multiplier) VALUES ('owner', 'o@x', '', 'Owner', NULL, NULL, 1)`).run()
  // kim: GitLab 로그인(OAuth id 100) / lee: Slack 로그인이지만 gitlab_username 을 적어 둠
  db.prepare(`INSERT INTO users (id, email, password, name, oauth_provider_id, oauth_user_id, rate_multiplier) VALUES ('u-kim', 'k@x', '', 'Kim', 'gl', '100', 1.5)`).run()
  db.prepare(`INSERT INTO users (id, email, password, name, gitlab_username, rate_multiplier) VALUES ('u-lee', 'l@x', '', 'Lee', 'lee', 2)`).run()
  for (const p of ['pA', 'pB']) {
    db.prepare(`INSERT INTO projects (id, user_id, name, provider, repo_url, access_token) VALUES (?, 'owner', ?, 'gitlab', 'https://gitlab.com/g/r', '')`).run(p, p)
  }
  db.prepare(`INSERT INTO agents (id, user_id, name, cli_name, cli_path) VALUES ('a1', 'owner', 'Alpha', 'claude', 'claude')`).run()
})

describe('M-1 명부의 역할별 배수', () => {
  it('사람 줄은 기본 1, 저장하면 바뀌고 이력이 남는다. 에이전트 줄에는 없다', () => {
    setRosterEntry('pA', { subjectType: 'user', subjectId: 'kim', gitUserId: '999', roles: { process: true, verify: true, confirm: false } }, 'owner')
    setRosterEntry('pA', { subjectType: 'agent', subjectId: 'a1', roles: { process: false, verify: true, confirm: false } }, 'owner')
    const kim = () => getRoster('pA').find(r => r.subjectId === 'kim')!
    expect(kim().rates).toEqual({ process: 1, verify: 1, confirm: 1 })
    expect(getRoster('pA').find(r => r.subjectId === 'a1')!.rates).toBeUndefined()
    expect(setRosterRates('pA', 'kim', { verify: 1.8 }, 'owner')).toBe(true)
    expect(kim().rates).toEqual({ process: 1, verify: 1.8, confirm: 1 })
    const hist = db.prepare(`SELECT key, input_price FROM rate_history WHERE kind = 'multiplier' AND key = 'pA:verify:kim'`).all()
    expect(hist).toEqual([{ key: 'pA:verify:kim', input_price: 1.8 }])
    expect(setRosterRates('pA', 'nobody', { verify: 2 }, 'owner')).toBe(false)
  })
})

describe('M-2 이행', () => {
  it('배수 칸이 처음 생길 때 종전 배수로 채운다 (OAuth id · Git username)', () => {
    setRosterEntry('pA', { subjectType: 'user', subjectId: 'kim', gitUserId: '100', roles: { process: false, verify: true, confirm: false } }, 'owner')
    setRosterEntry('pA', { subjectType: 'user', subjectId: 'lee', gitUserId: '555', roles: { process: false, verify: false, confirm: true } }, 'owner')
    setRosterEntry('pA', { subjectType: 'user', subjectId: 'park', gitUserId: '777', roles: { process: true, verify: false, confirm: false } }, 'owner')
    // 배수 칸이 없던 DB 를 흉내 — 칸을 지우고 다시 초기화
    for (const c of ['rate_process', 'rate_verify', 'rate_confirm']) db.exec(`ALTER TABLE project_role_members DROP COLUMN ${c}`)
    initSchema(db)
    const rates = Object.fromEntries(getRoster('pA').map(r => [r.subjectId, r.rates]))
    expect(rates.kim).toEqual({ process: 1.5, verify: 1.5, confirm: 1.5 })
    expect(rates.lee).toEqual({ process: 2, verify: 2, confirm: 2 })
    expect(rates.park).toEqual({ process: 1, verify: 1, confirm: 1 })   // 연결된 IVE 사용자 없음
    // 이미 있는 칸은 다시 덮어쓰지 않는다
    setRosterRates('pA', 'kim', { verify: 3 }, 'owner')
    initSchema(db)
    expect(getRoster('pA').find(r => r.subjectId === 'kim')!.rates!.verify).toBe(3)
  })
})

describe('M-3 보고서 원가 배수', () => {
  beforeEach(() => {
    setRosterEntry('pA', { subjectType: 'user', subjectId: 'kim', gitUserId: '100', name: 'Kim Dev', roles: { process: true, verify: true, confirm: true } }, 'owner')
    setRosterRates('pA', 'kim', { process: 1.2, verify: 2, confirm: 3 }, 'owner')
    setRosterEntry('pB', { subjectType: 'user', subjectId: 'kim', gitUserId: '100', name: 'Kim Dev', roles: { process: false, verify: true, confirm: false } }, 'owner')
    setRosterRates('pB', 'kim', { verify: 0.5 }, 'owner')
  })
  const mult = () => Object.fromEntries(getExecutionsInRange('owner', '2026-09-30', '2026-10-02').map(e => [e.id, e.rateMultiplier]))

  it('실행 종류로 역할을, 실행의 프로젝트로 배수를 고른다', () => {
    exec('ex-verify-a', 'pA', { user_id: 'u-kim', user_name: 'Kim' })               // 검증 — IVE 사용자(OAuth id 100)
    exec('ex-confirm-a', 'pA', { user_id: 'u-kim', user_name: 'Kim' })              // 확인
    exec('ex-ext-pA-1-0-x', 'pA', { user_id: null, user_name: 'Kim Dev' })         // 툴 직접개발 — 작성자 이름
    exec('ex-dev-a', 'pA', { user_id: '100', user_name: 'Kim Dev' })                // 담당자 처리 — Git 사용자 id
    exec('ex-verify-b', 'pB', { user_id: 'u-kim', user_name: 'Kim' })               // 같은 사람, 다른 프로젝트
    const m = mult()
    expect(m['ex-verify-a']).toBe(2)
    expect(m['ex-confirm-a']).toBe(3)
    expect(m['ex-ext-pA-1-0-x']).toBe(1.2)
    expect(m['ex-dev-a']).toBe(1.2)
    expect(m['ex-verify-b']).toBe(0.5)
  })

  it('명부에 없으면 종전 배수, 그것도 없으면 1. 에이전트 실행은 명부를 보지 않는다', () => {
    exec('ex-verify-lee', 'pA', { user_id: 'u-lee', user_name: 'Lee' })            // 명부에 없음 → 종전 2
    exec('ex-ext-pA-2-0-x', 'pA', { user_id: null, user_name: 'Stranger' })        // 아무 연결 없음 → 1
    exec('ex-agent', 'pA', { assignee_type: 'agent', agent_id: 'a1', user_name: 'Kim Dev' })
    const m = mult()
    expect(m['ex-verify-lee']).toBe(2)
    expect(m['ex-ext-pA-2-0-x']).toBe(1)
    expect(m['ex-agent']).toBe(1)
  })
})

describe('새 DB 사용자 테이블', () => {
  it('비밀번호 제약이 풀리고, 그 사이 추가된 칸이 모두 남는다', () => {
    const fresh = new Database(':memory:')
    initSchema(fresh)
    const cols = (fresh.prepare('PRAGMA table_info(users)').all() as { name: string; notnull: number }[])
    const by = Object.fromEntries(cols.map(c => [c.name, c]))
    expect(by.password.notnull).toBe(0)
    for (const c of ['gitlab_username', 'github_username', 'rate_multiplier', 'mail_unsubscribed', 'oauth_user_id', 'slack_user_id', 'currency']) {
      expect(by[c], c).toBeDefined()
    }
    // 두 번째 기동에도 그대로
    initSchema(fresh)
    expect((fresh.prepare('PRAGMA table_info(users)').all() as unknown[]).length).toBe(cols.length)
  })
})
