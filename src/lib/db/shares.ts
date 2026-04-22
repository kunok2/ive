import { Project, ProjectShare, ShareRole } from '@/types'
import { getDb } from './connection'
import { getProject, mapProject, type ProjectRow } from './projects'
import { fetchSingleIssue } from '@/lib/provider'
import { extractIveAuthorId } from '@/lib/ive-author'

export function getProjectShares(projectId: string): (ProjectShare & { userName: string; userEmail: string })[] {
  const rows = getDb().prepare(`
    SELECT ps.*, u.name as user_name, u.email as user_email
    FROM project_shares ps JOIN users u ON ps.user_id = u.id
    WHERE ps.project_id = ?
    ORDER BY ps.created_at ASC
  `).all(projectId) as any[]
  return rows.map(r => ({
    id: r.id, projectId: r.project_id, userId: r.user_id,
    role: r.role as ShareRole, createdAt: r.created_at,
    userName: r.user_name, userEmail: r.user_email,
  }))
}

export function getSharedProjectsForUser(userId: string): (Project & { shareRole: ShareRole })[] {
  const rows = getDb().prepare(`
    SELECT p.*, ps.role as share_role, COALESCE(
      (SELECT MAX(te.started_at) FROM task_executions te WHERE te.project_id = p.id), ''
    ) as last_exec_at
    FROM project_shares ps JOIN projects p ON ps.project_id = p.id
    WHERE ps.user_id = ?
    ORDER BY last_exec_at DESC, p.name ASC
  `).all(userId) as any[]
  return rows.map(r => ({ ...mapProject(r as ProjectRow), shareRole: r.share_role as ShareRole }))
}

export function getProjectShareRole(projectId: string, userId: string): ShareRole | null {
  const r = getDb().prepare('SELECT role FROM project_shares WHERE project_id = ? AND user_id = ?').get(projectId, userId) as { role: string } | undefined
  return r ? r.role as ShareRole : null
}

export function createProjectShare(share: ProjectShare) {
  getDb().prepare(
    'INSERT INTO project_shares (id, project_id, user_id, role, created_at) VALUES (?, ?, ?, ?, ?)'
  ).run(share.id, share.projectId, share.userId, share.role, share.createdAt)
}

export function updateProjectShareRole(id: string, role: ShareRole) {
  getDb().prepare('UPDATE project_shares SET role = ? WHERE id = ?').run(role, id)
}

export function deleteProjectShare(id: string) {
  getDb().prepare('DELETE FROM project_shares WHERE id = ?').run(id)
}

export function getProjectAccess(projectId: string, userId: string): 'owner' | ShareRole | null {
  const project = getProject(projectId)
  if (!project) return null
  if (project.userId === userId) return 'owner'
  return getProjectShareRole(projectId, userId)
}

/**
 * 실제 Git 이슈를 조회하여 현재 사용자가 담당자인지 확인 (DB 캐시 사용 안함).
 *
 * 규칙 (클라이언트의 isAssignee 로직과 동일):
 *   1) 이슈에 assignees가 있으면 그 중 한 명이어야 true
 *   2) assignees가 비어 있으면 이슈 작성자(author)를 담당자로 간주
 *      → "명시적 담당자가 없을 때는 생성자가 검증/처리 책임자" 규칙
 *   3) 작성자 판정 시 Git author 뿐만 아니라 본문의 `<!-- ive-author:{userId} -->` 마커도 확인.
 *      IVE 내부에서 작성된 이슈는 Git author 가 프로젝트 토큰 소유자로 표시되지만
 *      실제 작성자는 마커의 IVE 사용자이므로 그 사람이 담당자가 돼야 함.
 */
export async function isIssueAssignee(
  project: Project,
  issueIid: number,
  token: string,
  user: { id?: string; oauthUserId?: string | null },
): Promise<boolean> {
  const issue = await fetchSingleIssue(project, issueIid, token)
  if (!issue) return false
  const myGitId = user.oauthUserId ? String(user.oauthUserId) : null
  const assignees: any[] = issue.assignees || []

  if (assignees.length > 0) {
    if (!myGitId) return false
    return assignees.some((a: any) => a?.id != null && String(a.id) === myGitId)
  }

  // assignees 없음 → 작성자(author) 를 담당자로 간주
  // (a) IVE 내부 마커 기반: body 의 ive-author 가 현재 IVE 사용자 id 와 일치
  if (user.id) {
    const markerId = extractIveAuthorId(issue.description)
    if (markerId && markerId === user.id) return true
  }
  // (b) Git author id 기반 (마커 없거나 불일치)
  if (myGitId && issue.author?.id != null && String(issue.author.id) === myGitId) return true
  return false
}

/**
 * 실제 Git 이슈를 조회하여 현재 사용자가 작성자(author)인지 확인.
 * Git author 또는 ive-author 마커 둘 중 하나라도 일치하면 true.
 */
export async function isIssueAuthor(
  project: Project,
  issueIid: number,
  token: string,
  user: { id?: string; oauthUserId?: string | null },
): Promise<boolean> {
  const issue = await fetchSingleIssue(project, issueIid, token)
  if (!issue) return false
  if (user.id) {
    const markerId = extractIveAuthorId(issue.description)
    if (markerId && markerId === user.id) return true
  }
  if (user.oauthUserId && issue.author?.id != null) {
    return String(issue.author.id) === String(user.oauthUserId)
  }
  return false
}
