/**
 * 단계 전이 시 GitLab/GitHub 이슈 assignee 를 preset 기반으로 교체한다.
 *
 * Assignee 회전 모델 (이슈 #271):
 *   waiting:     생성자
 *   dev:         처리자(없으면 생성자)
 *   verify_*:    검증자 preset (creator | auto | specific)
 *   confirm_*:   확인자 preset (creator | auto | specific)
 *
 * preset 모드:
 *   - creator:  이슈 생성자(Git author)를 assignee 로 지정
 *   - auto:     같은 프로젝트의 열린 이슈 중 본인 배정수가 가장 적은 멤버 자동 선택
 *   - specific: 사전 지정된 사용자
 */
import { Project } from '@/types'
import { updateIssue, fetchSingleIssue, addIssueComment } from './provider'
import { runAutoAssign } from './scanner/auto-assign'
import type { PresetRoleInfo } from './db/issues'

export interface RoleAssignResult {
  success: boolean
  mode: PresetRoleInfo['mode']
  username: string | null
  userId: string | null
}

/**
 * preset 모드에 따라 이슈 assignee 를 교체한다.
 *
 * creator 모드일 때 fallback 순서:
 *   1) issue.author.id / username (Git 의 원작성자)
 *
 * auto 모드는 기존 runAutoAssign 재사용.
 */
export async function applyRoleAssignee(
  project: Project,
  iid: number,
  token: string,
  roleLabel: '검증자' | '확인자',
  preset: PresetRoleInfo,
): Promise<RoleAssignResult> {
  if (preset.mode === 'auto') {
    const r = await runAutoAssign(project, iid, token)
    return {
      success: !!r,
      mode: 'auto',
      username: r?.username ?? null,
      userId: null,
    }
  }

  if (preset.mode === 'specific' && preset.userId) {
    try {
      await updateIssue(project, iid, token, {
        assigneeIds: [Number(preset.userId)],
        assignees: preset.username ? [preset.username] : undefined,
      })
      // 안내 코멘트
      try {
        const note = `<!-- ive-bot -->\n## 🎯 ${roleLabel} 배정\n\n@${preset.username || preset.userId} 님이 ${roleLabel}로 지정되어 있어 단계 전이와 함께 담당자로 배정되었습니다.`
        await addIssueComment(project, iid, token, note)
      } catch (e) { console.warn(`[RoleAssignee] note add failed for #${iid}:`, e) }
      return { success: true, mode: 'specific', username: preset.username, userId: preset.userId }
    } catch (e) {
      console.warn(`[RoleAssignee] specific assign failed for #${iid}:`, e)
      return { success: false, mode: 'specific', username: preset.username, userId: preset.userId }
    }
  }

  // creator 모드 (default fallback) — 이슈 생성자(Git author)를 assignee 로
  try {
    const issue = await fetchSingleIssue(project, iid, token)
    const author = issue?.author
    if (!author?.id) {
      return { success: false, mode: 'creator', username: null, userId: null }
    }
    const authorUsername: string | null = author.username || (author as any).login || null
    await updateIssue(project, iid, token, {
      assigneeIds: [Number(author.id)],
      assignees: authorUsername ? [authorUsername] : undefined,
    })
    try {
      const note = `<!-- ive-bot -->\n## 🎯 ${roleLabel} 배정\n\n${roleLabel}가 별도로 지정되지 않아 작성자(@${authorUsername || author.id})가 담당자로 배정되었습니다.`
      await addIssueComment(project, iid, token, note)
    } catch (e) { console.warn(`[RoleAssignee] note add failed for #${iid}:`, e) }
    return { success: true, mode: 'creator', username: authorUsername, userId: String(author.id) }
  } catch (e) {
    console.warn(`[RoleAssignee] creator assign failed for #${iid}:`, e)
    return { success: false, mode: 'creator', username: null, userId: null }
  }
}
