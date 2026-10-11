import type { PresetRole } from '@/components/issue/RoleAvatarBar'
import type { CliName } from '@/types'

export interface IveIssue {
  iid: number
  title: string
  stage: string
  failReason?: string | null
  state: string
  /** 진행 중인 AI 채팅 세션이 있는지 (카드 "대화중" 표시) */
  chatActive?: boolean
  /** 채팅 에이전트가 현재 응답 생성 중인지 (카드 "생각중" 애니메이션) */
  chatProcessing?: boolean
  labels: string[]
  createdAt: string
  updatedAt: string
  /** 닫힌 시각 — 이력 카드에 보인다 */
  closedAt?: string | null
  dueDate?: string | null
  /** 0 보통 · 1 높음 · 2 긴급 (IVE 에만 저장) */
  priority?: 0 | 1 | 2
  author: { name: string; avatar?: string; avatarUrl?: string }
  iveAuthorId?: string | null
  authorId?: number | null
  assignMode?: string
  preferredAgentId?: string | null
  preferredAgentName?: string | null
  preferredAgentAvatar?: string | null
  preferredAgentCliName?: string | null
  assigneeAuto?: boolean
  assignees?: { id: number; username: string; name: string; avatarUrl: string }[]
  presetVerifier?: PresetRole
  presetConfirmer?: PresetRole
  /** 단계 작업자(에이전트)가 기동하지 못한 이유 등 사람이 봐야 할 한 줄 */
  stageWorkerNote?: string | null
  deployState?: 'unmerged' | 'deploying' | 'deployed' | 'failed' | null
  actualProcessor?: { agentId: string | null; agentName: string | null; agentAvatar: string | null; cliName: string | null } | null
  actualVerifier?: { userId: string | null; name: string | null; avatar: string | null } | null
  actualConfirmer?: { userId: string | null; name: string | null; avatar: string | null } | null
  /** 회차 — 단계별(처리·검증·확인) 진입 횟수 / 되돌리기 합계. 카드의 역할 아바타 옆 숫자 */
  iterationCounts?: { processCount: number; verifyCount?: number; confirmCount?: number; retryTotal: number }
}

export interface ProjectAgent {
  agentId: string
  agent: { id: string; name: string; avatar: string; cliName: CliName; status: string; enabled?: boolean; pausedUntil?: string | null }
}

export interface StageInfo {
  label: string
  color: string
  icon: string
}

export const CLI_CONFIG: Record<CliName, { label: string; icon: string; color: string }> = {
  claude: { label: 'Claude', icon: 'fa-solid fa-atom', color: 'text-ive-amber' },
  agy: { label: 'Antigravity CLI', icon: 'fa-brands fa-google', color: 'text-ive-cyan' },
  gemini: { label: 'Gemini', icon: 'fa-brands fa-google', color: 'text-ive-cyan' }, // 레거시
  codex: { label: 'Codex', icon: 'fa-solid fa-brain', color: 'text-ive-green-light' },
  opencode: { label: 'OpenCode', icon: 'fa-solid fa-terminal', color: 'text-ive-cyan' },
}
