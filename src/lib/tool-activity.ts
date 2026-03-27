/**
 * 실행 중인 에이전트의 현재 도구 활동을 추적하는 인메모리 저장소.
 * 실행이 종료되면 자동으로 정리됩니다.
 */

export type ToolCategory = 'thinking' | 'file' | 'terminal' | 'search' | 'web' | 'agent' | 'db' | 'idle'

export interface ToolActivity {
  executionId: string
  agentId: string
  tool: string          // 원래 도구 이름 (Read, Edit, Bash, etc.)
  category: ToolCategory
  detail: string        // 요약 (파일명, 명령어 등)
  updatedAt: number     // Date.now()
}

// executionId → ToolActivity
const activities = new Map<string, ToolActivity>()

export function categorize(toolName: string): ToolCategory {
  switch (toolName) {
    case 'Read':
    case 'Edit':
    case 'Write':
    case 'Glob':
    case 'NotebookEdit':
      return 'file'
    case 'Bash':
      return 'terminal'
    case 'Grep':
    case 'ToolSearch':
      return 'search'
    case 'WebSearch':
    case 'WebFetch':
      return 'web'
    case 'Agent':
      return 'agent'
    default:
      if (toolName.toLowerCase().includes('db') || toolName.toLowerCase().includes('sql')) return 'db'
      return 'file' // default fallback for unknown tools
  }
}

export function setToolActivity(executionId: string, agentId: string, toolName: string, detail: string) {
  activities.set(executionId, {
    executionId,
    agentId,
    tool: toolName,
    category: categorize(toolName),
    detail,
    updatedAt: Date.now(),
  })
}

export function setThinking(executionId: string, agentId: string) {
  activities.set(executionId, {
    executionId,
    agentId,
    tool: 'thinking',
    category: 'thinking',
    detail: '',
    updatedAt: Date.now(),
  })
}

export function clearActivity(executionId: string) {
  activities.delete(executionId)
}

export function getActivity(executionId: string): ToolActivity | null {
  return activities.get(executionId) ?? null
}

export function getActivityByAgent(agentId: string): ToolActivity | null {
  for (const a of activities.values()) {
    if (a.agentId === agentId) return a
  }
  return null
}

export function getAllActivities(): ToolActivity[] {
  return [...activities.values()]
}
