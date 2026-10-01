/**
 * 사건 로그(issue_events·config_events·person_aliases) 불변식.
 *
 * E-1: 같은 도착 단계로의 전이는 한 번만 남는다 — IVE 가 직접 옮긴 전이를 스캐너가 다시 감지해도 중복되지 않는다.
 * E-2: 단계가 같거나('none'=null 포함) 바뀌지 않으면 남기지 않는다.
 * E-3: 대기 사유는 바뀔 때만 남고, 그 사이 단계가 바뀌었다면 같은 사유라도 다시 남는다.
 * E-4: 후속 이슈 연결은 같은 연결을 한 번만 남긴다.
 * E-5: 설정 변경은 달라진 칸만 남긴다.
 * E-6: 사람 별칭은 사용자 표에서 자동으로 채워지되, 이름이 겹치는 사용자는 이름 별칭을 만들지 않는다.
 *      관리자가 고친 연결은 자동 채우기가 덮어쓰지 않는다.
 * E-7: Git 계정 → IVE 사용자: 숫자 id → 사용자명 → 별칭 순으로 찾는다.
 * E-8: 스키마 — 보유 건수용 스냅샷 칸이 생긴다. 스키마 초기화는 여러 번 돌아도 안전하다.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import Database from 'better-sqlite3'
import { initSchema } from '@/lib/db/schema'
import {
  recordStageEvent, recordWaitIfChanged, recordIssueLink, getIssueEvents, getLastStageEventTo,
  recordConfigChanges, getConfigEvents, addPersonAlias, setPersonAlias, resolvePersonAlias,
  syncPersonAliasesFromUsers, SYSTEM_ACTOR,
} from '@/lib/db'
import { gitActor, agentActor } from '@/lib/event-actor'
import { parseIveMetaFixes } from '@/lib/scanner/formatters'
import { parseCodexConfigModel } from '@/lib/scanner/cli-runner'

let db: Database.Database

function seedUsers(d: Database.Database) {
  d.prepare(`INSERT INTO oauth_providers (id, type, name, base_url, client_id, client_secret) VALUES ('gl', 'gitlab', 'GitLab', 'https://gitlab.com', 'x', 'y')`).run()
  d.prepare(`INSERT INTO users (id, email, name, oauth_provider_id, oauth_user_id, gitlab_username) VALUES ('u1', 'a@x.com', '정균옥', 'gl', '100', 'kojoung')`).run()
  d.prepare(`INSERT INTO users (id, email, name) VALUES ('u2', 'b@x.com', '김개발')`).run()
  d.prepare(`INSERT INTO users (id, email, name) VALUES ('u3', 'c@x.com', '동명이인')`).run()
  d.prepare(`INSERT INTO users (id, email, name) VALUES ('u4', 'd@x.com', '동명이인')`).run()
}

beforeEach(() => {
  db = new Database(':memory:')
  initSchema(db)
  ;(globalThis as any).db = db
})
afterEach(() => { db.close(); (globalThis as any).db = undefined })

describe('recordStageEvent', () => {
  it('E-1: 작업자가 직접 남긴 전이를 스캐너가 다시 감지해도 한 줄만 남는다', () => {
    expect(recordStageEvent({ projectId: 'p', issueIid: 1, fromStage: 'dev', toStage: 'verify_waiting', action: 'complete', source: 'worker', actor: { type: 'agent', agentId: 'a1', model: 'claude-opus-5-5' } })).toBe(true)
    expect(getLastStageEventTo('p', 1)).toBe('verify_waiting')
    expect(recordStageEvent({ projectId: 'p', issueIid: 1, fromStage: 'dev', toStage: 'verify_waiting', source: 'scanner' })).toBe(false)
    const rows = getIssueEvents('p', 1)
    expect(rows).toHaveLength(1)
    expect(rows[0]).toMatchObject({ actorType: 'agent', actorAgentId: 'a1', actorModel: 'claude-opus-5-5', source: 'worker', action: 'complete' })
  })

  it('E-1: 같은 단계로 다시 돌아온 경우(반려 후 재처리)는 사이에 다른 전이가 있으면 다시 남는다', () => {
    recordStageEvent({ projectId: 'p', issueIid: 1, fromStage: 'waiting', toStage: 'dev', source: 'scanner' })
    recordStageEvent({ projectId: 'p', issueIid: 1, fromStage: 'dev', toStage: 'verify_waiting', source: 'scanner' })
    recordStageEvent({ projectId: 'p', issueIid: 1, fromStage: 'verify_waiting', toStage: 'waiting', action: 'retry', source: 'ui' })
    expect(recordStageEvent({ projectId: 'p', issueIid: 1, fromStage: 'waiting', toStage: 'dev', source: 'scanner' })).toBe(true)
    expect(getIssueEvents('p', 1).map(e => e.toStage)).toEqual(['dev', 'verify_waiting', 'waiting', 'dev'])
  })

  it("E-2: 단계가 그대로면 남기지 않는다 ('none' 은 단계 없음과 같다)", () => {
    expect(recordStageEvent({ projectId: 'p', issueIid: 2, fromStage: 'dev', toStage: 'dev', source: 'scanner' })).toBe(false)
    expect(recordStageEvent({ projectId: 'p', issueIid: 2, fromStage: 'none', toStage: null, source: 'ui' })).toBe(false)
    expect(recordStageEvent({ projectId: 'p', issueIid: 2, fromStage: null, toStage: 'none', source: 'ui' })).toBe(false)
    expect(getIssueEvents('p', 2)).toHaveLength(0)
  })

  it('E-2: 화면 경로의 none 은 null 로 저장된다', () => {
    recordStageEvent({ projectId: 'p', issueIid: 3, fromStage: 'none', toStage: 'waiting', action: 'schedule', source: 'ui' })
    expect(getIssueEvents('p', 3)[0]).toMatchObject({ fromStage: null, toStage: 'waiting' })
  })
})

describe('recordWaitIfChanged', () => {
  it('E-3: 같은 사유가 매 스캔 반복돼도 한 번만 남는다', () => {
    expect(recordWaitIfChanged('p', 1, 'preferred_busy', { detail: { agentId: 'a1' } })).toBe(true)
    expect(recordWaitIfChanged('p', 1, 'preferred_busy', { detail: { agentId: 'a1' } })).toBe(false)
    expect(recordWaitIfChanged('p', 1, 'preferred_busy', { detail: { agentId: 'a1' } })).toBe(false)
    expect(getIssueEvents('p', 1)).toHaveLength(1)
  })

  it('E-3: 사유나 세부 내용이 바뀌면 새로 남는다', () => {
    recordWaitIfChanged('p', 1, 'preferred_busy', { detail: { agentId: 'a1' } })
    expect(recordWaitIfChanged('p', 1, 'preferred_paused', { detail: { agentId: 'a1' } })).toBe(true)
    expect(recordWaitIfChanged('p', 1, 'preferred_paused', { detail: { agentId: 'a2' } })).toBe(true)
    expect(getIssueEvents('p', 1).map(e => e.reason)).toEqual(['preferred_busy', 'preferred_paused', 'preferred_paused'])
  })

  it('E-3: 대기가 끝났다가(단계 전이) 같은 사유로 다시 기다리면 다시 남는다', () => {
    recordWaitIfChanged('p', 1, 'no_agent')
    recordStageEvent({ projectId: 'p', issueIid: 1, fromStage: 'waiting', toStage: 'dev', source: 'scanner' })
    recordStageEvent({ projectId: 'p', issueIid: 1, fromStage: 'dev', toStage: 'waiting', action: 'retry', source: 'ui' })
    expect(recordWaitIfChanged('p', 1, 'no_agent')).toBe(true)
    const waits = getIssueEvents('p', 1).filter(e => e.event === 'wait')
    expect(waits).toHaveLength(2)
    expect(waits[0].actorType).toBe('system')
  })
})

describe('recordIssueLink', () => {
  it('E-4: 같은 연결은 한 번만 남는다', () => {
    expect(recordIssueLink('p', 20, 'p', 12)).toBe(true)
    expect(recordIssueLink('p', 20, 'p', 12)).toBe(false)
    expect(recordIssueLink('p', 20, 'p', 13)).toBe(true)
    const links = getIssueEvents('p', 20)
    expect(links.map(l => [l.reason, l.refIssueIid])).toEqual([['fixes', 12], ['fixes', 13]])
  })
})

describe('parseIveMetaFixes', () => {
  it('ive-meta 블록의 fixes 줄에서 이슈 번호를 모은다(블록 밖은 무시)', () => {
    const body = [
      'fixes: #999 (블록 밖 — 무시)',
      '<!-- ive-meta\nmodel: claude-opus-5-5\nfixes: #412, #418\n-->',
      '<!-- ive-meta\nfixes: 418 #420\n-->',
    ].join('\n')
    expect(parseIveMetaFixes(body).sort((a, b) => a - b)).toEqual([412, 418, 420])
    expect(parseIveMetaFixes('<!-- ive-meta\nmodel: x\n-->')).toEqual([])
    expect(parseIveMetaFixes('')).toEqual([])
  })
})

describe('recordConfigChanges', () => {
  it('E-5: 달라진 칸만, 이전 값과 새 값을 남긴다', () => {
    const n = recordConfigChanges('agent', 'a1',
      { cliName: 'claude', modelName: 'claude-opus-5', maxTurns: 50, enabled: true },
      { cliName: 'claude', modelName: 'claude-opus-5-5', maxTurns: 50, enabled: true },
      ['cliName', 'modelName', 'maxTurns', 'enabled'], { actorUserId: 'u1' })
    expect(n).toBe(1)
    expect(getConfigEvents('agent', 'a1')).toEqual([
      expect.objectContaining({ field: 'modelName', oldValue: 'claude-opus-5', newValue: 'claude-opus-5-5', actorUserId: 'u1' }),
    ])
  })

  it('E-5: 객체 값은 JSON 으로 비교·저장한다', () => {
    recordConfigChanges('roster', 'user:kim', { roles: null }, { roles: { process: true, verify: false, confirm: false } }, ['roles'], { projectId: 'p' })
    const [row] = getConfigEvents('roster')
    expect(row.oldValue).toBeNull()
    expect(JSON.parse(row.newValue!)).toEqual({ process: true, verify: false, confirm: false })
    expect(row.projectId).toBe('p')
  })
})

describe('person_aliases', () => {
  it('E-6: 사용자 표에서 이름·Git 계정 별칭을 채우고, 이름이 겹치면 이름 별칭은 만들지 않는다', () => {
    seedUsers(db)
    syncPersonAliasesFromUsers()
    expect(resolvePersonAlias('정균옥', 'name')).toBe('u1')
    expect(resolvePersonAlias('KOJOUNG', 'gitlab')).toBe('u1')
    expect(resolvePersonAlias('동명이인')).toBeNull()
    // 여러 번 돌려도 같은 결과
    expect(syncPersonAliasesFromUsers()).toBe(0)
  })

  it('E-6: 자동 채우기는 관리자가 고친 연결을 덮어쓰지 않는다', () => {
    seedUsers(db)
    setPersonAlias('관리자', 'name', 'u1')
    setPersonAlias('김개발', 'name', 'u1') // 관리자가 일부러 다른 사람에게 연결
    syncPersonAliasesFromUsers()
    expect(addPersonAlias('김개발', 'name', 'u2')).toBe(false)
    expect(resolvePersonAlias('김개발', 'name')).toBe('u1')
    expect(resolvePersonAlias('관리자')).toBe('u1')
  })
})

describe('gitActor', () => {
  const project = { provider: 'gitlab' as const }

  it('E-7: 숫자 id → 사용자명 → 별칭 순으로 IVE 사용자를 찾고, 못 찾아도 Git 계정은 남긴다', () => {
    seedUsers(db)
    expect(gitActor(project, { gitUserId: 100 })).toMatchObject({ type: 'user', userId: 'u1' })
    expect(gitActor(project, { username: 'kojoung' })).toMatchObject({ type: 'user', userId: 'u1', gitUsername: 'kojoung' })
    setPersonAlias('kim-dev', 'gitlab', 'u2')
    expect(gitActor(project, { username: 'kim-dev' })).toMatchObject({ userId: 'u2' })
    expect(gitActor(project, { username: 'stranger' })).toMatchObject({ type: 'user', userId: null, gitUsername: 'stranger' })
    expect(gitActor(project, null)).toEqual({ type: 'unknown' })
  })
})

describe('agentActor', () => {
  it('실행에 기록된 모델 → 에이전트 설정 모델 순으로 쓴다', () => {
    // 프로젝트·에이전트 행 없이 실행 행 하나만 두고 본다
    db.pragma('foreign_keys = OFF')
    db.prepare(`INSERT INTO task_executions (id, project_id, agent_id, issue_iid, status, started_at, model_name) VALUES ('e1', 'p', 'a1', 1, 'success', '2026-10-01T00:00:00Z', 'gpt-5.4-mini')`).run()
    expect(agentActor({ id: 'a1', cliName: 'codex', modelName: '' }, 'e1')).toEqual({ type: 'agent', agentId: 'a1', model: 'gpt-5.4-mini' })
    expect(agentActor({ id: 'a1', cliName: 'claude', modelName: 'claude-opus-5-5' }, null)).toMatchObject({ model: 'claude-opus-5-5' })
  })
})

describe('parseCodexConfigModel', () => {
  it('최상위 model 만 읽고, 섹션 안의 model 은 보지 않는다', () => {
    expect(parseCodexConfigModel('model = "gpt-5.4-mini"\nmodel_reasoning_effort = "medium"\n')).toBe('gpt-5.4-mini')
    expect(parseCodexConfigModel('[profiles.fast]\nmodel = "o4-mini"\n')).toBeNull()
    expect(parseCodexConfigModel("approval = 'never'\nmodel='gpt-5'\n[x]\nmodel='y'")).toBe('gpt-5')
    expect(parseCodexConfigModel('')).toBeNull()
  })
})

describe('schema', () => {
  it('E-8: 보유 건수용 스냅샷 칸과 사건 로그 표가 생기고, 초기화를 다시 돌려도 안전하다', () => {
    const cols = (db.prepare('PRAGMA table_info(stat_snapshots)').all() as { name: string }[]).map(c => c.name)
    expect(cols).toEqual(expect.arrayContaining(['dev', 'dev_fail', 'verifying', 'confirming', 'confirm_waiting']))
    expect(() => initSchema(db)).not.toThrow()
    recordStageEvent({ projectId: 'p', issueIid: 1, fromStage: null, toStage: 'waiting', source: 'scanner', actor: SYSTEM_ACTOR })
    expect(() => initSchema(db)).not.toThrow()
    expect(getIssueEvents('p', 1)).toHaveLength(1)
  })
})
