/**
 * 검증(V)·확인(C) 단계의 실행 기록(ex-verify-/ex-confirm-)을 **Git 라벨 전이로부터** 남긴다.
 *
 * 종전에는 이 기록을 IVE 화면의 단계 버튼(`/api/projects/:id/issues/:iid/stage`)만 만들었다.
 * 그런데 검증·확인을 에이전트가 맡으면 IVE 화면이 아니라 `glab`/`gh` 로 라벨을 옮긴다.
 * 그 경로에서는 행이 생기지 않아 **검증·확인이 보고서에 통째로 빠졌다**(작업량도 비용도 0).
 *
 * 여기서는 스캐너가 감지한 전이(markersForStageChange)에 맞춰 같은 모양의 행을 만든다.
 *   - 사람이 한 검증/확인: 종전과 동일 — 근무시간(검증시작→종료)이 사람 비용.
 *   - 에이전트가 한 검증/확인: 코멘트의 `<!-- ive-meta stage: verify|confirm ... -->` 블록을
 *     읽어 토큰·비용·구간을 행에 채운다. 토큰이 있는 행은 AI 가 한 것이므로 사람 시간은 0으로
 *     계산된다(token-pricing.humanWorkMinutes).
 */
import { getDb, createExecution, updateExecutionStatus, updateExecutionTokens } from '../db'
import { parseIveMetaSessions, type IveMetaSession } from './formatters'

export type StageKind = 'verify' | 'confirm'

const PREFIX: Record<StageKind, string> = { verify: 'ex-verify', confirm: 'ex-confirm' }
const ACTIVE = "status IN ('running', 'assigned')"

/** 이 이슈에 열려 있는 해당 단계의 실행 기록이 있는가 (중복 생성 방지) */
export function hasOpenStageExecution(projectId: string, issueIid: number, kind: StageKind): boolean {
  const row = getDb().prepare(
    `SELECT 1 FROM task_executions
      WHERE project_id = ? AND issue_iid = ? AND id LIKE ? AND ${ACTIVE} LIMIT 1`
  ).get(projectId, issueIid, `${PREFIX[kind]}-%`)
  return !!row
}

/**
 * 단계 시작 기록 생성. 이미 열린 행이 있으면(화면 버튼으로 이미 시작) 아무것도 하지 않는다.
 * @returns 생성한 execution id, 이미 있으면 null
 */
export function openStageExecution(
  projectId: string,
  issueIid: number,
  kind: StageKind,
  opts: { issueTitle?: string | null; issueCreatedAt?: string | null; userId?: string | null; userName?: string | null; userAvatar?: string | null },
): string | null {
  if (hasOpenStageExecution(projectId, issueIid, kind)) return null
  const now = new Date().toISOString()
  const id = `${PREFIX[kind]}-${Date.now()}-${Math.floor(Math.random() * 1000)}`
  createExecution({
    id,
    projectId,
    agentId: '',
    issueIid,
    issueTitle: opts.issueTitle ?? null,
    status: 'assigned',
    startedAt: now,
    logPath: '',
    inputTokens: 0, outputTokens: 0, costUsd: 0, turns: 0,
    issueCreatedAt: opts.issueCreatedAt || now,
    assigneeType: 'user',
    userId: opts.userId ?? null,
    userName: opts.userName ?? null,
    userAvatar: opts.userAvatar ?? null,
  } as Parameters<typeof createExecution>[0])
  return id
}

/**
 * 단계 종료 기록. 열려 있는 해당 단계 행을 모두 닫고, 에이전트가 수행했다면(meta) 토큰·구간을 채운다.
 * @returns 닫은 행 수
 */
export function closeStageExecutions(
  projectId: string,
  issueIid: number,
  kind: StageKind,
  status: 'success' | 'failed',
  meta?: IveMetaSession | null,
): number {
  const rows = getDb().prepare(
    `SELECT id FROM task_executions
      WHERE project_id = ? AND issue_iid = ? AND id LIKE ? AND ${ACTIVE}`
  ).all(projectId, issueIid, `${PREFIX[kind]}-%`) as { id: string }[]
  const endedAt = meta?.endedAt || new Date().toISOString()
  for (const r of rows) {
    updateExecutionStatus(r.id, status, endedAt)
    if (meta && (meta.inputTokens || meta.outputTokens || meta.costUsd || meta.turns || meta.model)) {
      updateExecutionTokens(r.id, meta.inputTokens, meta.outputTokens, meta.costUsd, meta.turns, meta.model || undefined, 0, 0)
    }
    // 에이전트가 남긴 실제 구간이 있으면 시작 시각도 그것으로 맞춘다
    // (스캐너가 전이를 늦게 본 만큼 구간이 늘어나 보이지 않도록).
    if (meta?.startedAt) {
      getDb().prepare('UPDATE task_executions SET started_at = ? WHERE id = ?').run(meta.startedAt, r.id)
    }
  }
  return rows.length
}

/**
 * 이슈 코멘트들에서 해당 단계의 ive-meta 블록을 고른다 (가장 마지막 것이 그 단계의 기록).
 * 없으면 null — 사람이 직접 한 것으로 본다.
 */
export function pickStageMeta(notes: Array<{ body?: string | null }> | null | undefined, kind: StageKind): IveMetaSession | null {
  if (!notes || notes.length === 0) return null
  let found: IveMetaSession | null = null
  for (const n of notes) {
    for (const s of parseIveMetaSessions(n?.body || '')) {
      if (s.stage === kind) found = s
    }
  }
  return found
}

// ── 에이전트가 단계 작업자로 수행하는 실행 기록 ──
// 사람 행과 같은 접두(ex-verify-/ex-confirm-)를 쓰되 agent_id·assignee_type='agent' 로 남긴다.
// 토큰·비용은 CLI 가 실측해 채우므로 보고서에서 AI 비용으로 잡히고 사람 시간은 0 이다(token-pricing).

export function newStageExecutionId(kind: StageKind): string {
  return `${PREFIX[kind]}-${Date.now()}-${Math.floor(Math.random() * 1000)}`
}

/**
 * 에이전트 단계 실행 기록 생성 — 같은 단계의 열린 행이 있으면 만들지 않는다(중복 기동 방지, 트랜잭션).
 * @returns 생성했으면 true
 */
export function openAgentStageExecution(
  projectId: string, issueIid: number, kind: StageKind,
  opts: { executionId: string; agentId: string; agentName: string; agentAvatar?: string | null; issueTitle?: string | null; issueCreatedAt?: string | null; logPath: string },
): boolean {
  const db = getDb()
  const tx = db.transaction(() => {
    if (hasOpenStageExecution(projectId, issueIid, kind)) return false
    const now = new Date().toISOString()
    createExecution({
      id: opts.executionId,
      projectId,
      agentId: opts.agentId,
      issueIid,
      issueTitle: opts.issueTitle ?? null,
      status: 'running',
      startedAt: now,
      logPath: opts.logPath,
      inputTokens: 0, outputTokens: 0, costUsd: 0, turns: 0,
      issueCreatedAt: opts.issueCreatedAt || now,
      assigneeType: 'agent',
      userId: null,
      userName: opts.agentName,
      userAvatar: opts.agentAvatar ?? null,
    } as Parameters<typeof createExecution>[0])
    db.prepare('UPDATE task_executions SET stage_kind = ? WHERE id = ?').run(kind, opts.executionId)
    return true
  })
  return tx() as boolean
}

export function setStageVerdict(executionId: string, verdict: 'pass' | 'fail' | 'blocked') {
  getDb().prepare('UPDATE task_executions SET stage_verdict = ? WHERE id = ?').run(verdict, executionId)
}

/** 이 이슈에서 에이전트가 이 단계를 수행한 기록 수 (판정별). 순환 상한·재기동 판단용 */
export function countAgentStageRuns(projectId: string, issueIid: number, kind: StageKind): { total: number; pass: number; fail: number; blocked: number; crashed: number } {
  const db = getDb()
  const rows = db.prepare(`
    SELECT stage_verdict as v, status, julianday(started_at) as jd FROM task_executions
    WHERE project_id = ? AND issue_iid = ? AND id LIKE ? AND assignee_type = 'agent'
      AND status IN ('success', 'failed')
  `).all(projectId, issueIid, `${PREFIX[kind]}-%`) as { v: string | null; status: string; jd: number | null }[]
  // 비정상 종료(판정 없음)는 이번 사이클 — 마지막 처리(D) 실행 이후 — 것만 센다(일시 장애가 이슈 평생 누적되지 않게).
  // 판정(실패 등)은 「자동 순환 상한」 뜻대로 전체를 센다.
  // 시각은 UTC(Z)·KST(+09:00) 표기가 섞일 수 있어 문자열이 아니라 julianday 로 비교한다
  const lastDev = db.prepare(`
    SELECT MAX(julianday(started_at)) as t FROM task_executions
    WHERE project_id = ? AND issue_iid = ? AND id NOT LIKE 'ex-verify-%' AND id NOT LIKE 'ex-confirm-%' AND id NOT LIKE 'ex-reproduce-%'
  `).get(projectId, issueIid) as { t: number | null }
  const out = { total: rows.length, pass: 0, fail: 0, blocked: 0, crashed: 0 }
  for (const r of rows) {
    if (r.v === 'pass') out.pass++
    else if (r.v === 'fail') out.fail++
    else if (r.v === 'blocked') out.blocked++
    else if (lastDev?.t == null || (r.jd ?? 0) > lastDev.t) out.crashed++
  }
  return out
}

/** 지금 돌고 있는 에이전트 단계 실행 수 (동시 실행 상한). projectId 를 주면 그 프로젝트만 */
export function countRunningAgentStage(kind: StageKind, projectId?: string): number {
  const r = getDb().prepare(`
    SELECT COUNT(*) as c FROM task_executions
    WHERE id LIKE ? AND assignee_type = 'agent' AND status = 'running' ${projectId ? 'AND project_id = ?' : ''}
  `).get(`${PREFIX[kind]}-%`, ...(projectId ? [projectId] : [])) as { c: number }
  return r.c
}
