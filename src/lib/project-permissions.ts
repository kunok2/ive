/**
 * 프로젝트 설정(역할 명부·자동화·프롬프트) 권한 — 소유자와 editor 만 편집, viewer 는 읽기.
 */
import { getProject, getProjectAccess, getProjectShares, getAgentsByUser, getUserById } from './db'
import type { Agent, Project } from '@/types'

export type SettingsAccess = { project: Project; canEdit: boolean; isOwner: boolean } | { error: string; status: number }

export function checkProjectSettingsAccess(projectId: string, userId: string): SettingsAccess {
  const project = getProject(projectId)
  const access = project ? getProjectAccess(projectId, userId) : null
  if (!project || !access) return { error: 'Not found', status: 404 }
  return { project, canEdit: access === 'owner' || access === 'editor', isOwner: access === 'owner' }
}

/** 에이전트의 소유자가 지금도 이 프로젝트의 소유자·editor 인가 (편집 권한을 잃으면 그 에이전트는 이 프로젝트 일을 하지 않는다) */
export function isAgentEligibleForProject(project: Project, agent: Pick<Agent, 'userId'>): boolean {
  if (agent.userId === project.userId) return true
  return getProjectShares(project.id).some(s => s.role === 'editor' && s.userId === agent.userId)
}

/** 명부에 넣을 수 있는 에이전트 — 프로젝트 소유자·editor 의 에이전트 */
export function rosterEligibleAgents(project: Project): (Agent & { ownerName: string })[] {
  const ownerIds = new Set<string>([project.userId])
  for (const s of getProjectShares(project.id)) {
    if (s.role === 'editor') ownerIds.add(s.userId)
  }
  const out: (Agent & { ownerName: string })[] = []
  for (const uid of ownerIds) {
    const u = getUserById(uid)
    for (const a of getAgentsByUser(uid)) out.push({ ...a, ownerName: u?.name || '' })
  }
  return out
}
