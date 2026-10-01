/**
 * 서버 쪽 작업자(단계 작업자 등)가 단계를 옮길 때 쓰는 공용 경로.
 *
 * 화면 단계 버튼(/api/.../stage)과 같은 전이 표(TRANSITIONS)·같은 라벨 정리 규칙을 쓰고,
 * 옮긴 즉시 cached_stage 를 새 단계로 맞춘다 — 그래야 다음 스캔이 이 전이를 "사람이 라벨을 옮긴 것"으로
 * 다시 감지해 검증·확인 마커와 실행 기록을 한 번 더 만들지 않는다(화면 버튼 경로와 같은 이유).
 */
import { Project } from '@/types'
import { TRANSITIONS, staleStageLabelsToRemove } from './stage-transitions'
import { addIssueLabels, removeIssueLabels, fetchSingleIssue } from './provider'
import { stageFromLabels, hasActiveExecution, upsertIssueStageSnapshot } from './db'

export async function applyStageAction(
  project: Project, iid: number, token: string, stage: string, action: string,
): Promise<string | null> {
  const transition = (TRANSITIONS[stage] || []).find(t => t.action === action)
  if (!transition) throw new Error(`허용되지 않는 전이: ${stage} → ${action}`)

  const explicitRemove = transition.removeLabels(project)
  const labelsToAdd = transition.addLabels(project)
  const keepLabel = labelsToAdd[0] || ''
  const remove = keepLabel
    ? Array.from(new Set([...explicitRemove, ...staleStageLabelsToRemove(project, keepLabel)]))
    : explicitRemove
  if (remove.length > 0) await removeIssueLabels(project, iid, token, remove)
  if (labelsToAdd.length > 0) await addIssueLabels(project, iid, token, labelsToAdd)

  const issue = await fetchSingleIssue(project, iid, token)
  const newStage = stageFromLabels(issue?.labels || [], project, { hasActiveExec: hasActiveExecution(project.id, iid) })
  const a = issue?.assignees?.[0] || issue?.author
  upsertIssueStageSnapshot(project.id, iid, {
    cachedStage: newStage,
    assigneeUsername: a?.username || (a as any)?.login || null,
    assigneeName: a?.name || a?.username || (a as any)?.login || null,
    assigneeAvatar: a?.avatar_url || null,
    assigneeProvider: project.provider,
    assigneeGitUserId: a?.id != null ? String(a.id) : null,
    issueTitle: issue?.title || null,
  })
  return newStage
}
