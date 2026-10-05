// 실행 강제종료는 그 프로젝트를 편집할 수 있는 사람·그 에이전트 주인·관리자만.
//
// 종전 /api/executions/[id]/kill 은 로그인만 보고 누구의 실행이든 끌 수 있었다.
// 중지 버튼이 트레이스 화면 밖(작업 상세·넓은 화면 보드 카드)으로 늘어나면서 권한을 서버에서 막는다.
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { setupTestDb, teardownTestDb, seedUser, seedProject, seedAgent, seedExecution } from './helpers/test-db'

let currentUser: { id: string; name: string; isAdmin: boolean } = { id: 'owner', name: '소유자', isAdmin: false }
vi.mock('@/lib/auth', () => ({ getCurrentUser: async () => currentUser }))
vi.mock('@/lib/activity', () => ({ logActivity: () => {} }))

const PROJ = 'proj-1'
const EXEC = 'ex-1'
const NOW = new Date().toISOString()

function kill(id = EXEC) {
  return import('@/app/api/executions/[id]/kill/route').then(m =>
    m.POST(new Request('http://x/api', { method: 'POST' }), { params: Promise.resolve({ id }) }))
}
const statusOf = (db: ReturnType<typeof setupTestDb>) =>
  (db.prepare('SELECT status FROM task_executions WHERE id = ?').get(EXEC) as { status: string }).status

describe('실행 강제종료 권한', () => {
  let db: ReturnType<typeof setupTestDb>
  beforeEach(() => {
    db = setupTestDb()
    for (const [id, name] of [['owner', '소유자'], ['editor', '편집자'], ['viewer', '뷰어'], ['stranger', '남'], ['agent-owner', '에이전트주인'], ['admin', '관리자']]) seedUser(db, id, name)
    seedProject(db, PROJ, 'owner', 'P')
    db.prepare("INSERT INTO project_shares (id, project_id, user_id, role) VALUES ('s1', ?, 'editor', 'editor'), ('s2', ?, 'viewer', 'viewer')").run(PROJ, PROJ)
    seedAgent(db, 'agent-1', 'agent-owner', '처리봇')
    // pid 없는 실행 — 프로세스는 건드리지 않고 상태만 바뀐다
    seedExecution(db, { id: EXEC, projectId: PROJ, agentId: 'agent-1', issueIid: 1, status: 'running', startedAt: NOW, assigneeType: 'agent' })
  })
  afterEach(() => teardownTestDb())

  for (const [id, isAdmin] of [['owner', false], ['editor', false], ['agent-owner', false], ['admin', true]] as const) {
    it(`${id} 는 끌 수 있다`, async () => {
      currentUser = { id, name: id, isAdmin }
      const res = await kill()
      expect(res.status).toBe(200)
      expect(statusOf(db)).toBe('failed')
    })
  }

  for (const id of ['viewer', 'stranger']) {
    it(`${id} 는 403 이고 실행은 그대로다`, async () => {
      currentUser = { id, name: id, isAdmin: false }
      const res = await kill()
      expect(res.status).toBe(403)
      expect(statusOf(db)).toBe('running')
    })
  }

  it('없는 실행은 404', async () => {
    currentUser = { id: 'owner', name: '소유자', isAdmin: false }
    expect((await kill('nope')).status).toBe(404)
  })
})
