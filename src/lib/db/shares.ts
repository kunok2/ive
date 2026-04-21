import { Project, ProjectShare, ShareRole } from '@/types'
import { getDb } from './connection'
import { getProject, mapProject, type ProjectRow } from './projects'
import { fetchSingleIssue } from '@/lib/provider'

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

/** 실제 Git 이슈를 조회하여 현재 사용자가 담당자인지 확인 (DB 캐시 사용 안함) */
export async function isIssueAssignee(
  project: Project,
  issueIid: number,
  token: string,
  user: { oauthUserId?: string | null },
): Promise<boolean> {
  if (!user.oauthUserId) return false
  const issue = await fetchSingleIssue(project, issueIid, token)
  if (!issue) return false
  const assignees: any[] = issue.assignees || []
  return assignees.some((a: any) => String(a.id) === String(user.oauthUserId))
}
