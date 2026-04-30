import type { CliName } from '@/types'

export interface IveIssue {
  iid: number
  title: string
  stage: string
  failReason?: string | null
  state: string
  labels: string[]
  createdAt: string
  updatedAt: string
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
  presetVerifier?: { mode: 'creator' | 'auto' | 'specific'; userId: string | null; username: string | null }
  presetConfirmer?: { mode: 'creator' | 'auto' | 'specific'; userId: string | null; username: string | null }
  actualProcessor?: { agentId: string | null; agentName: string | null; agentAvatar: string | null; cliName: string | null } | null
  actualVerifier?: { userId: string | null; name: string | null; avatar: string | null } | null
  actualConfirmer?: { userId: string | null; name: string | null; avatar: string | null } | null
}

export interface ProjectAgent {
  agentId: string
  agent: { id: string; name: string; avatar: string; cliName: CliName; status: string }
}

export interface StageInfo {
  label: string
  color: string
  icon: string
}

export const CLI_CONFIG: Record<CliName, { label: string; icon: string; color: string }> = {
  claude: { label: 'Claude', icon: 'fa-solid fa-atom', color: 'text-ive-amber' },
  gemini: { label: 'Gemini', icon: 'fa-brands fa-google', color: 'text-ive-cyan' },
  codex: { label: 'Codex', icon: 'fa-solid fa-brain', color: 'text-ive-green-light' },
  opencode: { label: 'OpenCode', icon: 'fa-solid fa-terminal', color: 'text-ive-cyan' },
}
