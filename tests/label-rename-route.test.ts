// 프로젝트 저장(PUT)에서 레이블 이름을 바꾸는 흐름 — 저장소 이름 변경 → 설정 저장 → 가이드 갱신.
// 저장소와 설정이 어긋난 순간 스캔이 돌면 열린 이슈를 사라진 것으로 정리하므로, 그동안 스캔 잠금을 쥔다.
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { setupTestDb, teardownTestDb, seedUser, seedProject, seedAgent, seedExecution } from './helpers/test-db'
import { LEGACY_LABELS } from '@/lib/labels'

vi.mock('@/lib/auth', () => ({ getCurrentUser: async () => ({ id: 'owner', name: '소유자', isAdmin: false }) }))
vi.mock('@/lib/activity', () => ({ logActivity: () => {} }))
vi.mock('@/lib/db', async (orig) => ({
  ...(await orig<typeof import('@/lib/db')>()),
  getProjectAuthToken: () => 'tok',
}))
const renameLabel = vi.fn()
vi.mock('@/lib/provider', async (orig) => ({
  ...(await orig<typeof import('@/lib/provider')>()),
  renameLabel: (...a: unknown[]) => renameLabel(...a),
}))
const installAiGuide = vi.fn()
vi.mock('@/lib/ai-guide', async (orig) => ({
  ...(await orig<typeof import('@/lib/ai-guide')>()),
  installAiGuide: (...a: unknown[]) => installAiGuide(...a),
}))

const PROJ = 'proj-1'
const NEW = {
  labelTarget: 'ive', labelSchedule: 'ive:todo', labelDev: 'ive:doing', labelVerifyWait: 'ive:verify-wait',
  labelVerify: 'ive:verifying', labelConfirmWait: 'ive:confirm-wait', labelConfirm: 'ive:confirming',
  labelEnd: 'ive:done', labelNotify: 'ive:notify',
}

async function put(body: Record<string, unknown>) {
  const { getProject } = await import('@/lib/db')
  const m = await import('@/app/api/projects/[id]/route')
  return m.PUT(new Request('http://x/api', { method: 'PUT', body: JSON.stringify({ ...getProject(PROJ), accessToken: '', ...body }) }),
    { params: Promise.resolve({ id: PROJ }) })
}
const labelsInDb = (db: ReturnType<typeof setupTestDb>) =>
  db.prepare('SELECT label_target, label_verify_wait, label_end FROM projects WHERE id = ?').get(PROJ)

describe('프로젝트 저장 — 레이블 이름 변경', () => {
  let db: ReturnType<typeof setupTestDb>
  beforeEach(() => {
    db = setupTestDb()
    seedUser(db, 'owner', '소유자')
    seedProject(db, PROJ, 'owner', 'P')
    // 옛 기본 이름으로 등록된 기존 프로젝트
    db.prepare(`UPDATE projects SET label_target=?, label_schedule=?, label_dev=?, label_verify_wait=?, label_verify=?,
      label_confirm_wait=?, label_confirm=?, label_end=?, label_notify=? WHERE id=?`).run(
      LEGACY_LABELS.target, LEGACY_LABELS.schedule, LEGACY_LABELS.dev, LEGACY_LABELS.verifyWait, LEGACY_LABELS.verify,
      LEGACY_LABELS.confirmWait, LEGACY_LABELS.confirm, LEGACY_LABELS.end, LEGACY_LABELS.notify, PROJ)
    renameLabel.mockReset().mockResolvedValue('renamed')
    installAiGuide.mockReset().mockResolvedValue({ results: [], mrUrl: 'https://git/mr/1' })
    global.isScanning = false
  })
  afterEach(() => { teardownTestDb(); global.isScanning = false })

  it('저장소 이름 변경 → 설정 저장 → 설치된 가이드 갱신 MR', async () => {
    const res = await put(NEW)
    expect(res.status).toBe(200)
    expect(renameLabel).toHaveBeenCalledTimes(9)
    expect(renameLabel.mock.calls.map(c => [c[2], c[3]])).toContainEqual(['IVE-W', 'ive:verify-wait'])
    expect(labelsInDb(db)).toEqual({ label_target: 'ive', label_verify_wait: 'ive:verify-wait', label_end: 'ive:done' })
    // 가이드는 저장된(새 이름) 설정으로, 설치된 파일만
    const [savedProject, , opts] = installAiGuide.mock.calls[0]
    expect(savedProject.labelVerifyWait).toBe('ive:verify-wait')
    expect(opts).toEqual({ onlyInstalled: true, reason: 'labels' })
    const data = await res.json()
    expect(data.labelRename.renamed).toHaveLength(9)
    expect(data.labelRename.guideMrUrl).toBe('https://git/mr/1')
  })

  it('저장소 이름 변경이 실패하면 설정도 그대로(409)', async () => {
    renameLabel.mockRejectedValueOnce(new Error('둘 다 있음'))
    const res = await put(NEW)
    expect(res.status).toBe(409)
    expect((await res.json()).error).toMatch(/둘 다 있음/)
    expect(labelsInDb(db)).toEqual({ label_target: 'IVE', label_verify_wait: 'IVE-W', label_end: 'IVE-E' })
    expect(installAiGuide).not.toHaveBeenCalled()
  })

  it('실행 중인 작업이 있으면 막는다 — 저장소도 설정도 그대로', async () => {
    seedAgent(db, 'agent-1', 'owner', '처리봇')
    seedExecution(db, { id: 'ex-1', projectId: PROJ, agentId: 'agent-1', issueIid: 1, status: 'running', startedAt: new Date().toISOString(), assigneeType: 'agent' })
    const res = await put(NEW)
    expect(res.status).toBe(409)
    expect((await res.json()).error).toMatch(/실행 중/)
    expect(renameLabel).not.toHaveBeenCalled()
    expect(labelsInDb(db)).toEqual({ label_target: 'IVE', label_verify_wait: 'IVE-W', label_end: 'IVE-E' })
  })

  it('진행 중인 스캔이 끝나기를 기다렸다가, 이름 변경 동안은 스캔 잠금을 쥔다', async () => {
    global.isScanning = true // 스캔 진행 중
    const heldDuringRename: boolean[] = []
    renameLabel.mockImplementation(async () => { heldDuringRename.push(global.isScanning); return 'renamed' })
    const p = put({ labelVerifyWait: 'ive:verify-wait' })
    await new Promise(r => setTimeout(r, 700))
    expect(renameLabel).not.toHaveBeenCalled() // 스캔이 끝나기 전엔 손대지 않는다
    global.isScanning = false // 스캔 끝
    expect((await p).status).toBe(200)
    expect(heldDuringRename).toEqual([true]) // 이름 변경 중엔 잠금을 쥐고 있었다
    expect(global.isScanning).toBe(false)   // 끝나면 푼다
  })

  it('레이블을 안 바꾼 저장은 저장소를 건드리지 않는다', async () => {
    const res = await put({ name: 'P2' })
    expect(res.status).toBe(200)
    expect(renameLabel).not.toHaveBeenCalled()
    expect(installAiGuide).not.toHaveBeenCalled()
    expect((await res.json()).labelRename).toBeNull()
  })
})
