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
