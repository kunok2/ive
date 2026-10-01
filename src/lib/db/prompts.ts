/**
 * 역할별 프롬프트 — 프로젝트 덮어쓰기(편집 가능한 부분)와 변경 이력.
 * 덮어쓰기가 없으면 IVE 기본값(코드 내장, src/lib/role-prompts.ts)을 쓴다.
 */
import { getDb } from './connection'

export type PromptKind = 'dev' | 'reproduce' | 'verify' | 'confirm'
export const PROMPT_KINDS: PromptKind[] = ['dev', 'reproduce', 'verify', 'confirm']

export interface RolePromptOverride {
  kind: PromptKind
  body: string
  version: number
  updatedBy: string | null
  updatedAt: string
}

export interface RolePromptHistoryEntry {
  version: number
  body: string | null      // null = 기본값으로 되돌림
  updatedBy: string | null
  updatedByName: string | null
  updatedAt: string
}

export function getRolePromptOverride(projectId: string, kind: PromptKind): RolePromptOverride | null {
  const r = getDb().prepare('SELECT * FROM role_prompts WHERE project_id = ? AND kind = ?').get(projectId, kind) as any
  if (!r) return null
  return { kind: r.kind, body: r.body, version: r.version, updatedBy: r.updated_by, updatedAt: r.updated_at }
}

/** 마지막 판 번호 (덮어쓰기를 지워 기본값으로 돌아간 뒤에도 이력은 이어진다) */
function lastVersion(projectId: string, kind: PromptKind): number {
  const r = getDb().prepare('SELECT MAX(version) as v FROM role_prompt_history WHERE project_id = ? AND kind = ?').get(projectId, kind) as any
  return Number(r?.v || 0)
}

/**
 * 덮어쓰기 저장. body 가 null 이거나 기본값과 같으면 덮어쓰기를 지운다(기본값 사용).
 * 어느 쪽이든 이력에 한 줄 남긴다. 내용이 그대로면 아무것도 하지 않는다.
 * @returns 새 판 번호 (변경 없으면 null)
 */
export function saveRolePrompt(
  projectId: string, kind: PromptKind, body: string | null,
  by: { userId: string; name: string },
): number | null {
  const db = getDb()
  const cur = getRolePromptOverride(projectId, kind)
  const nextBody = body && body.trim() ? body : null
  if ((cur?.body ?? null) === nextBody) return null
  const version = lastVersion(projectId, kind) + 1
  const tx = db.transaction(() => {
    if (nextBody === null) {
      db.prepare('DELETE FROM role_prompts WHERE project_id = ? AND kind = ?').run(projectId, kind)
    } else {
      db.prepare(`
        INSERT INTO role_prompts (project_id, kind, body, version, updated_by, updated_at)
        VALUES (?, ?, ?, ?, ?, datetime('now'))
        ON CONFLICT(project_id, kind) DO UPDATE SET body = excluded.body, version = excluded.version,
          updated_by = excluded.updated_by, updated_at = datetime('now')
      `).run(projectId, kind, nextBody, version, by.userId)
    }
    db.prepare(`INSERT INTO role_prompt_history (project_id, kind, version, body, updated_by, updated_by_name)
      VALUES (?, ?, ?, ?, ?, ?)`).run(projectId, kind, version, nextBody, by.userId, by.name)
  })
  tx()
  return version
}

export function getRolePromptHistory(projectId: string, kind: PromptKind, limit = 50): RolePromptHistoryEntry[] {
  return (getDb().prepare(`
    SELECT version, body, updated_by, updated_by_name, updated_at FROM role_prompt_history
    WHERE project_id = ? AND kind = ? ORDER BY version DESC LIMIT ?
  `).all(projectId, kind, limit) as any[]).map(r => ({
    version: r.version, body: r.body, updatedBy: r.updated_by, updatedByName: r.updated_by_name, updatedAt: r.updated_at,
  }))
}

/** 실행 기록에 그때 쓴 프롬프트 판을 남긴다 — 'confirm:default' / 'confirm:v3' */
export function setExecutionPromptVersion(executionId: string, promptVersion: string, stageKind?: string) {
  getDb().prepare('UPDATE task_executions SET prompt_version = ?, stage_kind = COALESCE(?, stage_kind) WHERE id = ?')
    .run(promptVersion, stageKind ?? null, executionId)
}
