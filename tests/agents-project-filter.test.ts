/**
 * 개발자 탭 프로젝트 필터 — 고른 프로젝트에 걸린 사람·에이전트만, 숫자도 그 프로젝트 것만.
 *  F-1 사람 목록(검증자): 고른 프로젝트의 명부·일감만. 고르지 않으면 종전 그대로(전체)
 *  F-2 접근 범위 밖 프로젝트 id 를 넣어도 넓어지지 않는다(소유·공유 조건이 먼저)
 *  F-3 에이전트: 명부·실행 기록·지정 이슈로 그 프로젝트에 걸린 것만(agentsInProjects)
 *  F-4 에이전트 숫자(지정 대기·검증 대기·오늘 실행)도 그 프로젝트 것만
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import Database from 'better-sqlite3'
import { initSchema } from '@/lib/db/schema'
import { getVerifiersList, agentsInProjects, getAgentRoleSummary, countPreferredIssuesByAgent, getTodayExecutionsByAgent } from '@/lib/db'

let db: Database.Database
beforeEach(() => {
  db = new Database(':memory:')
  initSchema(db)
  ;(globalThis as any).db = db
  db.pragma('foreign_keys = OFF')
  db.prepare(`INSERT INTO users (id, email, name) VALUES ('u1','a@x','나'), ('u2','b@x','남')`).run()
  db.prepare(`INSERT INTO projects (id, user_id, name, repo_url, access_token, provider) VALUES ('p1','u1','Shop','x','t','gitlab'), ('p2','u1','Portal','x','t','gitlab'), ('p9','u2','Secret','x','t','gitlab')`).run()
  db.prepare(`INSERT INTO agents (id, user_id, name, cli_name, cli_path) VALUES ('a1','u1','Alpha','claude','claude'), ('a2','u1','Beta','claude','claude'), ('a3','u1','Gamma','claude','claude')`).run()
  const member = db.prepare(`INSERT INTO project_role_members (project_id, subject_type, subject_id, name, can_verify) VALUES (?, ?, ?, ?, 1)`)
  member.run('p1', 'user', 'kim', '김검증')
  member.run('p2', 'user', 'lee', '이검증')
  member.run('p9', 'user', 'secret', '비밀')
  member.run('p1', 'agent', 'a1', 'Alpha')
  const stage = db.prepare(`INSERT INTO issue_stages (project_id, issue_iid, cached_stage, assignee_username, assignee_name, preset_verifier_mode, preset_verifier_agent_id, preferred_agent_id) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`)
  stage.run('p1', 1, 'verify_waiting', 'kim', '김검증', 'creator', null, null)
  stage.run('p2', 2, 'verify_waiting', 'lee', '이검증', 'creator', null, null)
  stage.run('p1', 3, 'verify_waiting', null, null, 'agent', 'a1', null)
  stage.run('p2', 4, 'verify_waiting', null, null, 'agent', 'a1', null)
  stage.run('p2', 5, 'waiting', null, null, 'creator', null, 'a2')
  const ex = db.prepare(`INSERT INTO task_executions (id, project_id, agent_id, issue_iid, status, started_at) VALUES (?, ?, ?, ?, 'success', ?)`)
  const now = new Date().toISOString()
  ex.run('ex-1', 'p1', 'a1', 1, now)
  ex.run('ex-2', 'p2', 'a1', 2, now)
})
afterEach(() => { db.close(); (globalThis as any).db = undefined })

describe('개발자 탭 프로젝트 필터', () => {
  it('F-1 검증자: 고른 프로젝트만, 고르지 않으면 전체', () => {
    expect(getVerifiersList('u1').map(v => v.name).sort()).toEqual(['김검증', '이검증'])
    const shop = getVerifiersList('u1', ['p1'])
    expect(shop.map(v => [v.name, v.verifyWaiting])).toEqual([['김검증', 1]])
    expect(getVerifiersList('u1', ['p1', 'p2']).length).toBe(2)
  })

  it('F-2 접근 범위 밖 프로젝트는 넣어도 보이지 않는다', () => {
    expect(getVerifiersList('u1', ['p9'])).toEqual([])
    expect(getVerifiersList('u1', ["p1') OR ('1'='1"]).map(v => v.name)).toEqual([]) // 이상한 id 는 지워진 글자만 남아 아무것도 안 맞는다
  })

  it('F-3 에이전트: 명부·실행·지정 이슈로 걸린 것만', () => {
    expect([...agentsInProjects(['a1', 'a2', 'a3'], ['p1'])].sort()).toEqual(['a1'])
    expect([...agentsInProjects(['a1', 'a2', 'a3'], ['p2'])].sort()).toEqual(['a1', 'a2'])
    expect([...agentsInProjects(['a1', 'a2', 'a3'], ['p9'])]).toEqual([])
  })

  it('F-4 에이전트 숫자도 그 프로젝트 것만', () => {
    expect(getAgentRoleSummary('a1').verifyWaiting).toBe(2)
    expect(getAgentRoleSummary('a1', ['p1']).verifyWaiting).toBe(1)
    expect(getAgentRoleSummary('a1', ['p2']).roles.verify).toBe(0) // 명부는 p1 에만
    expect(countPreferredIssuesByAgent('a2')).toBe(1)
    expect(countPreferredIssuesByAgent('a2', ['p1'])).toBe(0)
    expect(getTodayExecutionsByAgent('a1').length).toBe(2)
    expect(getTodayExecutionsByAgent('a1', ['p2']).map(e => e.id)).toEqual(['ex-2'])
  })
})
