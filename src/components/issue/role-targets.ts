import type { ActualPerson, ActualProcessor, CreatorInfo, GitMember, PresetRole, ProcessorInfo } from '@/components/issue/RoleAvatarBar'
import type { ProfileTarget } from '@/components/issue/PersonPopover'

/**
 * 역할 아바타를 눌렀을 때 정보를 보여 줄 대상 — 실제로 맡은 사람·에이전트가 정해졌을 때만(미배정·자동배정·처리 안 함은 정보가 없다).
 * 작업 상세(StageProgress)와 보드 카드(RoleAvatarBar)가 같이 쓴다.
 */
export function creatorTarget(label: string, creator: CreatorInfo): ProfileTarget | null {
  return creator.name ? { roleLabel: label, name: creator.name, avatar: creator.avatar || creator.avatarUrl } : null
}

export function processorTargetOf(label: string, actual: ActualProcessor | null | undefined, p: ProcessorInfo): ProfileTarget | null {
  if (actual?.agentId) return { roleLabel: label, agentId: actual.agentId, name: actual.agentName, avatar: actual.agentAvatar }
  if (p.assignMode === 'agent' && p.agentId) return { roleLabel: label, agentId: p.agentId, name: p.agentName, avatar: p.agentAvatar }
  if (p.assignMode === 'assignee' && p.username) return { roleLabel: label, username: p.username, name: p.name, avatar: p.avatarUrl }
  return null
}

export function roleTargetOf(label: string, actual: ActualPerson | null | undefined, preset: PresetRole, members: GitMember[]): ProfileTarget | null {
  if (actual?.userId) return { roleLabel: label, userId: actual.userId, name: actual.name, avatar: actual.avatar }
  if (preset.mode === 'agent' && preset.agentId) return { roleLabel: label, agentId: preset.agentId, name: preset.agentName ?? null, avatar: preset.agentAvatar ?? null }
  if (preset.mode === 'specific') {
    const m = preset.userId ? members.find(x => String(x.id) === preset.userId) : null
    const username = m?.username || preset.username || null
    if (m || username) return { roleLabel: label, username, name: m?.name ?? null, avatar: m?.avatarUrl || null }
  }
  return null
}
