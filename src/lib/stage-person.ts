/**
 * 검증자·확인자로 기록하는 사람.
 *
 * 검증·확인은 IVE 에 계정이 없는 사람에게도 맡길 수 있다 — Git(GitLab/GitHub) 사람이면 된다.
 * IVE 계정과 연결돼 있으면 그 계정(id·이름·아바타)으로, 아니면 Git 신원 그대로(userId = Git 사용자 id) 기록한다.
 */
import { getDb, getUserByOAuthId, getUserByGitUsername } from '@/lib/db'

export interface StagePerson {
  userId: string
  name: string
  avatar: string | null
  username: string | null
  gitUserId: string | null
}

/** Git 이슈의 담당자·작성자·프로젝트 멤버 객체(어느 모양이든)를 기록용 사람으로 바꾼다. 신원이 없으면 null. */
export function stagePersonFromGit(
  provider: 'github' | 'gitlab',
  p: { id?: number | string | null; username?: string | null; login?: string | null; name?: string | null; avatar_url?: string | null; avatarUrl?: string | null } | null | undefined,
): StagePerson | null {
  if (!p) return null
  const gitUserId = p.id != null && String(p.id) !== '' ? String(p.id) : null
  const username = p.username || p.login || null
  if (!gitUserId && !username) return null
  const u = (gitUserId ? getUserByOAuthId(provider, gitUserId) : null) || (username ? getUserByGitUsername(provider, username) : null)
  return {
    userId: u?.id ?? gitUserId ?? username!,
    name: u?.name || p.name || username || gitUserId!,
    avatar: u?.avatar || p.avatar_url || p.avatarUrl || null,
    username,
    gitUserId,
  }
}

const KIND_PREFIX = { verify: 'ex-verify-%', confirm: 'ex-confirm-%' } as const

/** 사람이 연 검증·확인 기록 중 아직 열려 있는 것 (최근 것 먼저) */
function openHumanStageExecs(projectId: string, iid: number, kind: 'verify' | 'confirm') {
  return getDb().prepare(
    `SELECT id, user_id AS userId, user_name AS name, user_avatar AS avatar FROM task_executions
     WHERE project_id = ? AND issue_iid = ? AND id LIKE ? AND status IN ('running', 'assigned') AND COALESCE(assignee_type, '') <> 'agent'
     ORDER BY started_at DESC`
  ).all(projectId, iid, KIND_PREFIX[kind]) as { id: string; userId: string | null; name: string | null; avatar: string | null }[]
}

export function hasOpenHumanStageExec(projectId: string, iid: number, kind: 'verify' | 'confirm'): boolean {
  return openHumanStageExecs(projectId, iid, kind).length > 0
}

/** 열린 검증·확인 기록의 사람 — 완료·반려를 누른 사람이 아니라 그 단계를 맡은 사람으로 기록하기 위해 쓴다 */
export function openStagePerson(projectId: string, iid: number, kind: 'verify' | 'confirm'): { userId: string; name: string; avatar: string | null } | null {
  const row = openHumanStageExecs(projectId, iid, kind).find(r => r.userId)
  return row ? { userId: row.userId!, name: row.name || row.userId!, avatar: row.avatar } : null
}

/** 열린 검증·확인 기록을 새 사람에게 옮긴다. 옮긴 건수를 돌려준다. */
export function moveOpenStageExecs(projectId: string, iid: number, kind: 'verify' | 'confirm', person: StagePerson): number {
  const rows = openHumanStageExecs(projectId, iid, kind)
  const upd = getDb().prepare('UPDATE task_executions SET user_id = ?, user_name = ?, user_avatar = ? WHERE id = ?')
  for (const r of rows) upd.run(person.userId, person.name, person.avatar, r.id)
  return rows.length
}

/**
 * Git 담당자를 따라간다 — IVE 를 쓰지 않는 사람은 Git 에서 담당자를 바꾸므로, 검증 중·확인 중인 작업은
 * Git 의 첫 담당자가 곧 그 단계를 맡은 사람이다. 열린 사람 기록이 다른 사람이면 그 사람에게 옮긴다.
 * 담당자가 비었거나 에이전트가 맡은 단계면 그대로 둔다. 옮겼으면 true.
 */
export function followGitAssignee(
  provider: 'github' | 'gitlab',
  projectId: string,
  iid: number,
  stage: string | null | undefined,
  assignees: any[] | null | undefined,
): boolean {
  const kind = stage === 'verifying' ? 'verify' : stage === 'confirming' ? 'confirm' : null
  if (!kind) return false
  const person = stagePersonFromGit(provider, assignees?.[0])
  if (!person) return false
  const rows = openHumanStageExecs(projectId, iid, kind)
  if (rows.length === 0 || rows.every(r => r.userId === person.userId)) return false
  moveOpenStageExecs(projectId, iid, kind, person)
  return true
}
