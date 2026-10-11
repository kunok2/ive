import type { RoleAvatarBarProps } from '@/components/issue/RoleAvatarBar'
import { macroIndexFromStage } from '@/app/issues/[projectId]/[iid]/_components/StageProgress'
import { stageCountsOf } from './IssueBadges'
import type { IveIssue } from './types'

/**
 * 작업 → 역할 아바타 줄(작성자 › 처리자 › 검증자 › 확인자)에 보일 내용.
 * 작업 목록 카드와 넓은 화면 보드 카드가 같이 쓴다(한쪽만 바뀌지 않게) — 편집(후보·핸들러)은 쓰는 쪽이 따로 넘긴다.
 */
export function roleBarPropsOf(issue: IveIssue): Pick<RoleAvatarBarProps,
  'currentMacro' | 'creator' | 'processor' | 'verifier' | 'confirmer' | 'actualProcessor' | 'actualVerifier' | 'actualConfirmer' | 'stageCounts'> {
  return {
    currentMacro: macroIndexFromStage(issue.stage),
    creator: {
      name: issue.author?.name ?? null,
      avatar: issue.author?.avatar ?? null,
      avatarUrl: issue.author?.avatarUrl ?? null,
    },
    processor: {
      assignMode: (issue.assignMode as 'agent' | 'auto' | 'assignee' | 'none' | undefined) ?? 'auto',
      agentName: issue.preferredAgentName ?? null,
      agentAvatar: issue.preferredAgentAvatar ?? null,
      username: issue.assignees?.[0]?.username ?? null,
      name: issue.assignees?.[0]?.name ?? null,
      avatarUrl: issue.assignees?.[0]?.avatarUrl ?? null,
      pendingAuto: !!issue.assigneeAuto,
    },
    verifier: issue.presetVerifier ?? { mode: 'creator', userId: null, username: null },
    confirmer: issue.presetConfirmer ?? { mode: 'creator', userId: null, username: null },
    actualProcessor: issue.actualProcessor ?? null,
    actualVerifier: issue.actualVerifier ?? null,
    actualConfirmer: issue.actualConfirmer ?? null,
    stageCounts: stageCountsOf(issue),
  }
}
