/**
 * 사건 로그(issue_events)의 작업자 표기를 만드는 도우미.
 *
 * 작업자는 이슈마다·단계마다 사람일 수도 에이전트일 수도 있으므로 사건마다 남긴다.
 * 사람은 IVE 사용자 id(통합 식별자)로, 에이전트는 에이전트 id + 그 실행이 쓴 모델로 남긴다.
 */
import type { Agent, Project } from '@/types'
import { getDb, getUserByOAuthId, getUserByGitUsername, resolvePersonAlias, getSystemSetting, type EventActor } from './db'

export function userActor(user: { id: string } | null | undefined, gitUsername?: string | null): EventActor {
  if (!user?.id) return gitUsername ? { type: 'user', gitUsername } : { type: 'unknown' }
  return { type: 'user', userId: user.id, gitUsername: gitUsername ?? null }
}

/**
 * 에이전트 작업자. 모델은 그 실행에 기록된 모델 → 에이전트 설정 모델 → 시스템 CLI 기본 모델 순으로 정한다.
 * 실행 기록의 모델이 실제로 쓴 모델이라 가장 정확하다.
 */
export function agentActor(
  agent: Pick<Agent, 'id' | 'cliName'> & { modelName?: string | null },
  executionId?: string | null,
): EventActor {
  let model: string | null = null
  if (executionId) {
    try {
      const r = getDb().prepare('SELECT model_name FROM task_executions WHERE id = ?').get(executionId) as { model_name: string | null } | undefined
      model = r?.model_name || null
    } catch { /* 모델 없이 기록 */ }
  }
  if (!model) model = agent.modelName || null
  if (!model && agent.cliName) {
    try { model = getSystemSetting(`cli.${agent.cliName}.model`) || null } catch { /* 없음 */ }
  }
  return { type: 'agent', agentId: agent.id, model }
}

/** 실행 기록의 프롬프트 버전(있으면). */
export function executionPromptVersion(executionId: string | null | undefined): string | null {
  if (!executionId) return null
  try {
    const r = getDb().prepare('SELECT prompt_version FROM task_executions WHERE id = ?').get(executionId) as { prompt_version: string | null } | undefined
    return r?.prompt_version ?? null
  } catch { return null }
}

/**
 * Git 계정 → 작업자. Git 숫자 id → 사용자명 → 별칭표 순으로 IVE 사용자를 찾는다.
 * 찾지 못해도 Git 계정은 남겨, 나중에 별칭을 연결하면 소급해서 사람을 알 수 있게 한다.
 */
export function gitActor(
  project: Pick<Project, 'provider'>,
  ident: { username?: string | null; gitUserId?: string | number | null } | null | undefined,
): EventActor {
  const username = ident?.username || null
  const gitUserId = ident?.gitUserId != null ? String(ident.gitUserId) : null
  if (!username && !gitUserId) return { type: 'unknown' }
  const provider = project.provider === 'github' ? 'github' : 'gitlab'
  let userId: string | null = null
  try {
    if (gitUserId) userId = getUserByOAuthId(provider, gitUserId)?.id ?? null
    if (!userId && username) userId = getUserByGitUsername(provider, username)?.id ?? null
    if (!userId && username) userId = resolvePersonAlias(username, provider)
  } catch { /* 찾지 못함 */ }
  return { type: 'user', userId, gitUsername: username }
}
