/**
 * 단계 자동화 Phase 1 — 역할 명부·이슈별 배정·프롬프트·안전장치의 불변식.
 * 실제 스키마(initSchema)를 인메모리 DB 에 올려 검사한다.
 *
 *   R-1 이행: 기존 Git 멤버는 검증 역할로 명부에 들어가고, 사람이 뺀 줄은 다시 들어오지 않는다.
 *   R-2 동기화: 새 멤버는 검증 역할로 추가, 빠진 멤버의 자동 줄은 제거, 사람이 손댄 줄은 유지.
 *   R-3 검증자 목록은 명부 기준 — 검증 역할을 끈 사람은 목록에서 빠진다.
 *   A-1 「모든 단계 자동배정」: 처리자 ≠ 검증자, 가장 한가한 에이전트, 후보가 모자라면 이유를 돌려준다. 기본 배정의 검증 에이전트.
 *   A-2 프로젝트 기본 배정은 한 번만, 기본 배정이 없으면 아무것도 하지 않는다(종전 동작).
 *   A-3 처리자 판정(getActualRoleAssignees)은 확인 에이전트 실행 행을 처리자로 보지 않는다.
 *   P-1 프롬프트: 덮어쓰기 저장·이력·판 번호, 같은 내용이면 새 판 없음, 기본값으로 되돌리기.
 *   P-2 처리 프롬프트 덮어쓰기는 편집 줄만 바꾸고 고정 줄(스테이징·커밋 금지·마커·언어)은 유지한다.
 *   S-1 staging 비밀값은 암호화 저장되고 설정 조회에는 이름만 나온다.
 *   S-2 증적 파일 경로 탈출 차단, S-3 비밀값 마스킹.
 *   E-1 에이전트 단계 실행 기록은 열린 행이 있으면 중복 생성하지 않고, 판정별로 센다.
 */
import { describe, it, expect, beforeEach } from 'vitest'
import Database from 'better-sqlite3'
import { initSchema } from '@/lib/db/schema'
import {
  getRoster, setRosterEntry, syncRosterWithMembers, getVerifiersList, replaceProjectMembers,
  getPresetRoles, getAssignMode, getActualRoleAssignees, updateProjectAutomation, getProjectAutomation,
  getStagingSecrets, saveRolePrompt, getRolePromptHistory, getRolePromptOverride, getRolesInitializedAt,
  createExecution, setAssignMode, setPresetRoles, deleteAgent, updateProjectShareRole, setIssueIntakeChannel,
} from '@/lib/db'
import { autoAssignAllAgents, applyDefaultRoles } from '@/lib/role-assignment'
import { buildPrompt } from '@/lib/scanner/prompt-builder'
import { resolveEvidenceFile } from '@/lib/evidence'
import { maskSecrets } from '@/lib/secret-mask'
import { openAgentStageExecution, countAgentStageRuns, setStageVerdict } from '@/lib/scanner/stage-records'
import type { Project } from '@/types'

let db: Database.Database
const P = 'p1'
const project = { id: P, userId: 'owner', provider: 'gitlab', repoUrl: 'https://gitlab.com/g/r', labelEnd: 'IVE-E' } as unknown as Project

function member(username: string, id: string) {
  return { username, name: username.toUpperCase(), avatarUrl: '', provider: 'gitlab', gitUserId: id }
}

beforeEach(() => {
  db = new Database(':memory:')
  ;(globalThis as any).db = db
  initSchema(db)
  db.prepare(`INSERT INTO users (id, email, password, name) VALUES ('owner', 'o@x', '', 'Owner')`).run()
  db.prepare(`INSERT INTO projects (id, user_id, name, provider, repo_url, access_token) VALUES (?, 'owner', 'Proj', 'gitlab', 'https://gitlab.com/g/r', '')`).run(P)
  for (const [id, name] of [['a1', 'Alpha'], ['a2', 'Beta'], ['a3', 'Gamma']]) {
    db.prepare(`INSERT INTO agents (id, user_id, name, cli_name, cli_path) VALUES (?, 'owner', ?, 'claude', 'claude')`).run(id, name)
  }
})

describe('역할 명부', () => {
  it('R-1/R-2 이행·동기화: 새 멤버는 검증, 빠진 자동 줄은 제거, 사람이 뺀 줄은 유지', () => {
    replaceProjectMembers(P, [member('kim', '1'), member('lee', '2')])
    let roster = getRoster(P)
    expect(roster.map(r => [r.subjectId, r.roles.verify, r.source])).toEqual([['kim', true, 'sync'], ['lee', true, 'sync']])

    // 사람이 lee 의 검증 역할을 끔 → manual 제외 줄
    setRosterEntry(P, { subjectType: 'user', subjectId: 'lee', roles: { process: false, verify: false, confirm: false } }, 'owner')
    // 동기화: park 합류, kim 이탈. lee 는 여전히 멤버
    replaceProjectMembers(P, [member('lee', '2'), member('park', '3')])
    roster = getRoster(P)
    const byId = Object.fromEntries(roster.map(r => [r.subjectId, r]))
    expect(byId.kim).toBeUndefined()                 // 자동 줄은 멤버와 함께 빠진다
    expect(byId.lee.roles.verify).toBe(false)         // 사람이 뺀 줄은 다시 들어오지 않는다
    expect(byId.lee.source).toBe('manual')
    expect(byId.park.roles.verify).toBe(true)         // 새 멤버는 검증 역할로
  })

  it('R-3 검증자 목록은 명부 기준', () => {
    replaceProjectMembers(P, [member('kim', '1'), member('lee', '2')])
    expect(getVerifiersList('owner').map(v => v.username).sort()).toEqual(['kim', 'lee'])
    setRosterEntry(P, { subjectType: 'user', subjectId: 'lee', roles: { process: false, verify: false, confirm: true } }, 'owner')
    expect(getVerifiersList('owner').map(v => v.username)).toEqual(['kim'])
  })

  it('에이전트 줄은 역할을 모두 끄면 지워진다', () => {
    setRosterEntry(P, { subjectType: 'agent', subjectId: 'a1', roles: { process: true, verify: false, confirm: false } }, 'owner')
    expect(getRoster(P).filter(r => r.subjectType === 'agent').map(r => r.name)).toEqual(['Alpha'])
    setRosterEntry(P, { subjectType: 'agent', subjectId: 'a1', roles: { process: false, verify: false, confirm: false } }, 'owner')
    expect(getRoster(P).filter(r => r.subjectType === 'agent')).toEqual([])
  })
})

describe('이슈별 배정', () => {
  const agentRoles = (id: string, roles: { process?: boolean; verify?: boolean; confirm?: boolean }) =>
    setRosterEntry(P, { subjectType: 'agent', subjectId: id, roles: { process: !!roles.process, verify: !!roles.verify, confirm: !!roles.confirm } }, 'owner')

  it('A-1 모든 단계 자동배정: 부하 적은 순, 검증자·확인자는 처리자와 다른 쪽 우선', () => {
    agentRoles('a1', { process: true, verify: true, confirm: true })
    agentRoles('a2', { process: true, verify: true, confirm: true })
    // a1 에 부하를 준다 (다른 이슈의 지정 처리자)
    db.prepare(`INSERT INTO issue_stages (project_id, issue_iid, stage, cached_stage, assign_mode, preferred_agent_id) VALUES (?, 99, '', 'dev', 'agent', 'a1')`).run(P)
    const out = autoAssignAllAgents(P, 7)
    expect(out.processor).toBe('a2')          // 더 한가한 쪽
    expect(out.confirmer).toBe('a1')          // 처리자와 다른 쪽 우선
    expect(out.verifier).toBe('a1')           // 처리자(a2)와 다른 에이전트 — 자기 작업을 자기가 검수하지 않는다
    expect(out.warnings).toEqual([])
    expect(getAssignMode(P, 7)).toMatchObject({ mode: 'agent', agentId: 'a2' })
    const preset = getPresetRoles(P, 7)
    expect(preset.verifier).toMatchObject({ mode: 'agent', agentId: 'a1' })
    expect(preset.confirmer).toMatchObject({ mode: 'agent', agentId: 'a1', agentName: 'Alpha' })
  })

  it('A-1 처리 에이전트를 새로 못 골라도 이미 지정된 처리자와 다른 확인자를 우선한다', () => {
    agentRoles('a1', { confirm: true })
    agentRoles('a2', { confirm: true })
    setAssignMode(P, 8, 'agent', 'a1')       // 처리자는 이미 a1 (명부의 처리 역할 없음)
    const out = autoAssignAllAgents(P, 8)
    expect(out.processor).toBeNull()
    expect(out.confirmer).toBe('a2')
    expect(getAssignMode(P, 8)).toMatchObject({ mode: 'agent', agentId: 'a1' }) // 그대로
  })

  it('A-1 기본 배정의 검증 에이전트가 적용된다 (검증 작업자 ③)', () => {
    agentRoles('a3', { verify: true })
    updateProjectAutomation(P, { defaultRoles: { autoAllAgents: false, verifier: { mode: 'agent', userId: null, username: null, agentId: 'a3' } } }, 'owner')
    expect(applyDefaultRoles(project, 9, getRolesInitializedAt(P, 9))).toBe(true)
    expect(getPresetRoles(P, 9).verifier).toMatchObject({ mode: 'agent', agentId: 'a3' })
  })

  it('A-1 처리자만 검증 역할을 가지면 검증자는 배정하지 않는다 (처리자 ≠ 검증자)', () => {
    agentRoles('a1', { process: true, verify: true })
    const out = autoAssignAllAgents(P, 10)
    expect(out.processor).toBe('a1')
    expect(out.verifier).toBeNull()
    expect(out.warnings.join(' ')).toMatch(/처리자와 같은 에이전트뿐/)
    expect(getPresetRoles(P, 10).verifier.mode).toBe('creator')
  })

  it('명부에서 역할을 끄면 프로젝트 기본 배정에서도 빠진다', () => {
    agentRoles('a3', { confirm: true })
    updateProjectAutomation(P, { defaultRoles: { autoAllAgents: false, confirmer: { mode: 'agent', userId: null, username: null, agentId: 'a3' } } }, 'owner')
    agentRoles('a3', { confirm: false })
    expect(getProjectAutomation(P).defaultRoles.confirmer ?? null).toBeNull()
  })

  it('편집 권한 없는 사람의 에이전트는 자동배정 후보가 아니다', () => {
    db.prepare(`INSERT INTO users (id, email, password, name) VALUES ('viewer1', 'v@x', '', 'V')`).run()
    db.prepare(`INSERT INTO agents (id, user_id, name, cli_name, cli_path) VALUES ('av', 'viewer1', 'ViewerAgent', 'claude', 'claude')`).run()
    agentRoles('av', { confirm: true })
    const out = autoAssignAllAgents(P, 13, { dryRun: true })
    expect(out.confirmer).toBeNull()
  })

  it('처리자 배정은 명부·공유 변경으로 풀리지 않는다 (의뢰자 풀에서 직접 고른 처리자 보존)', () => {
    db.prepare(`INSERT INTO users (id, email, password, name) VALUES ('ed3', 'e3@x', '', 'Ed3')`).run()
    db.prepare(`INSERT INTO agents (id, user_id, name, cli_name, cli_path) VALUES ('ax', 'ed3', 'EdX', 'claude', 'claude')`).run()
    db.prepare(`INSERT INTO project_shares (id, project_id, user_id, role) VALUES ('s3', ?, 'ed3', 'editor')`).run(P)
    setAssignMode(P, 14, 'agent', 'ax')                      // 의뢰자(ed3) 본인 풀에서 직접 지정
    agentRoles('ax', { confirm: true })                      // 확인 역할로만 명부에 추가
    agentRoles('ax', { confirm: false })                     // 역할 끔
    expect(getAssignMode(P, 14)).toMatchObject({ mode: 'agent', agentId: 'ax' })
    db.prepare(`UPDATE project_shares SET role = 'editor' WHERE id = 's3'`).run()
    updateProjectShareRole('s3', 'viewer')                   // 권한 하향
    expect(getAssignMode(P, 14)).toMatchObject({ mode: 'agent', agentId: 'ax' })
  })

  it('남의 에이전트 삭제 요청은 배정·명부를 건드리지 않는다', () => {
    db.prepare(`INSERT INTO users (id, email, password, name) VALUES ('other', 'x@x', '', 'Other')`).run()
    agentRoles('a1', { confirm: true })
    setPresetRoles(P, 12, { confirmer: { mode: 'agent', userId: null, username: null, agentId: 'a1' } })
    deleteAgent('a1', 'other')               // 소유자 아님
    expect(getPresetRoles(P, 12).confirmer).toMatchObject({ mode: 'agent', agentId: 'a1' })
    expect(getRoster(P).some(r => r.subjectId === 'a1')).toBe(true)
    deleteAgent('a1', 'owner')               // 소유자 — 정리된다
    expect(getPresetRoles(P, 12).confirmer.mode).toBe('creator')
    expect(getRoster(P).some(r => r.subjectId === 'a1')).toBe(false)
  })

  it('A-2 기본 배정이 없으면 아무것도 하지 않고, 있으면 한 번만 적용', () => {
    expect(applyDefaultRoles(project, 10, getRolesInitializedAt(P, 10))).toBe(false)
    expect(getRolesInitializedAt(P, 10)).toBeNull()
    expect(getPresetRoles(P, 10).confirmer.mode).toBe('creator')

    agentRoles('a3', { confirm: true })
    updateProjectAutomation(P, { defaultRoles: { autoAllAgents: false, confirmer: { mode: 'agent', userId: null, username: null, agentId: 'a3' } } }, 'owner')
    expect(applyDefaultRoles(project, 10, getRolesInitializedAt(P, 10))).toBe(true)
    expect(getPresetRoles(P, 10).confirmer).toMatchObject({ mode: 'agent', agentId: 'a3' })
    // 사람이 바꾼 뒤에는 다시 덮어쓰지 않는다
    db.prepare(`UPDATE issue_stages SET preset_confirmer_mode = 'creator', preset_confirmer_agent_id = NULL WHERE issue_iid = 10`).run()
    expect(applyDefaultRoles(project, 10, getRolesInitializedAt(P, 10))).toBe(false)
    expect(getPresetRoles(P, 10).confirmer.mode).toBe('creator')
  })

  it('A-3 확인 에이전트 실행 행은 처리자로 보이지 않는다', () => {
    const base = { projectId: P, issueIid: 11, issueTitle: 't', startedAt: '2026-09-30T01:00:00.000Z', logPath: '', inputTokens: 0, outputTokens: 0, costUsd: 0, turns: 0 }
    createExecution({ ...base, id: 'ex-1', agentId: 'a1', status: 'success', assigneeType: 'agent' } as any)
    openAgentStageExecution(P, 11, 'confirm', { executionId: 'ex-confirm-1', agentId: 'a2', agentName: 'Beta', logPath: '' })
    expect(getActualRoleAssignees(P, 11).processor?.agentId).toBe('a1')
  })
})

describe('프롬프트', () => {
  it('P-1 저장·이력·판, 같은 내용이면 새 판 없음, 기본값으로', () => {
    expect(saveRolePrompt(P, 'confirm', '- 확인 방법 A', { userId: 'owner', name: 'Owner' })).toBe(1)
    expect(saveRolePrompt(P, 'confirm', '- 확인 방법 A', { userId: 'owner', name: 'Owner' })).toBeNull()
    expect(saveRolePrompt(P, 'confirm', '- 확인 방법 B', { userId: 'owner', name: 'Owner' })).toBe(2)
    expect(getRolePromptOverride(P, 'confirm')?.version).toBe(2)
    expect(saveRolePrompt(P, 'confirm', null, { userId: 'owner', name: 'Owner' })).toBe(3)
    expect(getRolePromptOverride(P, 'confirm')).toBeNull()
    expect(getRolePromptHistory(P, 'confirm').map(h => [h.version, h.body])).toEqual([[3, null], [2, '- 확인 방법 B'], [1, '- 확인 방법 A']])
  })

  it('P-2 처리 프롬프트 덮어쓰기는 고정 줄을 유지한다', () => {
    const gl = { repoUrl: 'https://gitlab.com/g/r.git' } as unknown as Project
    const issue = { title: 'T', description: 'body' }
    const base = buildPrompt(gl, issue, 5, false, false, true, 1, '', '', false, 'ag1', 40)
    const over = buildPrompt(gl, issue, 5, false, false, true, 1, '', '', false, 'ag1', 40, '- 우리 팀 규칙만 따른다')
    expect(over).toContain('- 우리 팀 규칙만 따른다')
    expect(over).not.toContain('thoroughly analyze the relevant files')
    for (const fixed of ['stage them with git add', 'Do NOT git commit or push', '<!-- ive-agent:ag1 -->', 'force-stopped after 40 minutes', 'IMPORTANT: You MUST respond']) {
      expect(base).toContain(fixed)
      expect(over).toContain(fixed)
    }
    // 이슈·API 안내(고정)는 덮어쓰기와 무관하게 같다
    expect(over.split('## Instructions:')[0]).toBe(base.split('## Instructions:')[0])
  })
})

describe('안전장치', () => {
  it('S-1 비밀값은 암호화 저장, 조회는 이름만', () => {
    updateProjectAutomation(P, { stagingSecrets: { STAGING_TEST_PASSWORD: 'p@ssw0rd-123' } }, 'owner')
    const raw = (db.prepare('SELECT staging_secrets FROM project_automation WHERE project_id = ?').get(P) as any).staging_secrets as string
    expect(raw).not.toContain('p@ssw0rd-123')
    expect(getProjectAutomation(P).stagingSecretNames).toEqual(['STAGING_TEST_PASSWORD'])
    expect(JSON.stringify(getProjectAutomation(P))).not.toContain('p@ssw0rd-123')
    expect(getStagingSecrets(P)).toEqual({ STAGING_TEST_PASSWORD: 'p@ssw0rd-123' })
    // 빈 값은 그대로 두고, null 은 삭제
    updateProjectAutomation(P, { stagingSecrets: { STAGING_TEST_PASSWORD: '' } }, 'owner')
    expect(getStagingSecrets(P).STAGING_TEST_PASSWORD).toBe('p@ssw0rd-123')
    updateProjectAutomation(P, { stagingSecrets: { STAGING_TEST_PASSWORD: null } }, 'owner')
    expect(getStagingSecrets(P)).toEqual({})
  })

  it('S-2 증적 파일 경로 탈출 차단', () => {
    expect(resolveEvidenceFile(P, 1, 'confirm-2026', '../../../../etc/passwd')).toBeNull()
    expect(resolveEvidenceFile(P, 1, '../x', 'a.png')).toBeNull()
    expect(resolveEvidenceFile(P, 1, 'confirm-2026', 'screens/../a.png')).toBeNull()
  })

  it('S-3 비밀값 마스킹', () => {
    const out = maskSecrets('clone https://oauth2:glpat-abcdefghijklmnop@gitlab.com/x fatal; pw=p@ssw0rd-123; https://user:tok123456@h/r', ['p@ssw0rd-123'])
    expect(out).not.toContain('glpat-abcdefghijklmnop')
    expect(out).not.toContain('p@ssw0rd-123')
    expect(out).not.toContain('tok123456')
  })
})

describe('에이전트 단계 실행 기록', () => {
  it('E-1 중복 생성 방지와 판정별 집계', () => {
    expect(openAgentStageExecution(P, 20, 'confirm', { executionId: 'ex-confirm-a', agentId: 'a1', agentName: 'Alpha', logPath: '' })).toBe(true)
    expect(openAgentStageExecution(P, 20, 'confirm', { executionId: 'ex-confirm-b', agentId: 'a1', agentName: 'Alpha', logPath: '' })).toBe(false)
    setStageVerdict('ex-confirm-a', 'fail')
    db.prepare(`UPDATE task_executions SET status = 'failed' WHERE id = 'ex-confirm-a'`).run()
    expect(openAgentStageExecution(P, 20, 'confirm', { executionId: 'ex-confirm-c', agentId: 'a1', agentName: 'Alpha', logPath: '' })).toBe(true)
    db.prepare(`UPDATE task_executions SET status = 'failed' WHERE id = 'ex-confirm-c'`).run()  // 판정 없이 죽음
    expect(countAgentStageRuns(P, 20, 'confirm')).toMatchObject({ total: 2, fail: 1, crashed: 1, pass: 0 })
    const row = db.prepare(`SELECT assignee_type, agent_id, stage_kind FROM task_executions WHERE id = 'ex-confirm-a'`).get() as any
    expect(row).toEqual({ assignee_type: 'agent', agent_id: 'a1', stage_kind: 'confirm' })
  })
})

describe('경로별 기본 배정', () => {
  const agentRoles = (id: string, roles: { process?: boolean; verify?: boolean; confirm?: boolean }) =>
    setRosterEntry(P, { subjectType: 'agent', subjectId: id, roles: { process: !!roles.process, verify: !!roles.verify, confirm: !!roles.confirm } }, 'owner')
  beforeEach(() => {
    agentRoles('a1', { confirm: true })
    agentRoles('a2', { confirm: true })
  })
  it('IVE 등록 이슈는 본 기본 배정, 접수 페이지·Git 직접 이슈는 접수 기본 배정', () => {
    updateProjectAutomation(P, { defaultRoles: {
      autoAllAgents: false, confirmer: { mode: 'agent', userId: null, username: null, agentId: 'a1' },
      intake: { autoAllAgents: false, confirmer: { mode: 'agent', userId: null, username: null, agentId: 'a2' } },
    } }, 'owner')
    setIssueIntakeChannel(P, 21, 'ive')
    setIssueIntakeChannel(P, 22, 'report')
    for (const iid of [21, 22, 23]) applyDefaultRoles(project, iid, getRolesInitializedAt(P, iid))
    expect(getPresetRoles(P, 21).confirmer.agentId).toBe('a1')
    expect(getPresetRoles(P, 22).confirmer.agentId).toBe('a2')
    expect(getPresetRoles(P, 23).confirmer.agentId).toBe('a2')   // 경로 기록 없음 = Git 직접·API
  })
  it('접수 기본 배정이 없으면 IVE 등록과 같게 (종전 동작)', () => {
    updateProjectAutomation(P, { defaultRoles: { autoAllAgents: false, confirmer: { mode: 'agent', userId: null, username: null, agentId: 'a1' } } }, 'owner')
    applyDefaultRoles(project, 24, getRolesInitializedAt(P, 24))
    expect(getPresetRoles(P, 24).confirmer.agentId).toBe('a1')
  })
  it('에이전트가 명부에서 빠지면 접수 기본 배정에서도 지운다', () => {
    updateProjectAutomation(P, { defaultRoles: { autoAllAgents: false, intake: { autoAllAgents: false, confirmer: { mode: 'agent', userId: null, username: null, agentId: 'a2' } } } }, 'owner')
    agentRoles('a2', { confirm: false })
    expect(getProjectAutomation(P).defaultRoles.intake?.confirmer ?? null).toBeNull()
  })
})

describe('MR 머지로 이슈 자동 닫기', () => {
  it('설정이 없으면 켬(종전 동작), 끄고 켤 수 있고 다른 설정 저장에 휩쓸리지 않는다', () => {
    expect(getProjectAutomation(P).closeIssueOnMerge).toBe(true)
    updateProjectAutomation(P, { closeIssueOnMerge: false }, 'owner')
    expect(getProjectAutomation(P).closeIssueOnMerge).toBe(false)
    updateProjectAutomation(P, { limits: { maxAutoCycles: 2 } }, 'owner')
    expect(getProjectAutomation(P).closeIssueOnMerge).toBe(false)
    updateProjectAutomation(P, { closeIssueOnMerge: true }, 'owner')
    expect(getProjectAutomation(P).closeIssueOnMerge).toBe(true)
  })
})
