export interface User {
  id: string
  email: string
  name: string
  createdAt: string
}

export type Provider = 'github' | 'gitlab'

/** URL에서 provider를 자동 감지 (github.com → github, 그 외 → gitlab) */
export function detectProvider(url: string): Provider {
  try {
    const hostname = new URL(url).hostname.toLowerCase()
    if (hostname === 'github.com' || hostname.endsWith('.github.com')) {
      return 'github'
    }
  } catch { /* invalid URL */ }
  return 'gitlab'
}

export const PROJECT_COLORS = [
  { name: '초록', value: '#4ade80' },
  { name: '청록', value: '#22d3ee' },
  { name: '파랑', value: '#60a5fa' },
  { name: '보라', value: '#a78bfa' },
  { name: '분홍', value: '#f472b6' },
  { name: '빨강', value: '#f87171' },
  { name: '주황', value: '#fb923c' },
  { name: '노랑', value: '#fbbf24' },
  { name: '라임', value: '#a3e635' },
  { name: '흰색', value: '#e0e0e0' },
] as const

export type ProjectColor = typeof PROJECT_COLORS[number]['value']

export interface Project {
  id: string
  userId: string
  name: string
  provider: Provider
  repoUrl: string
  accessToken: string
  color: ProjectColor       // 프로젝트 구분 색상
  labelTarget: string      // 대상 이슈 레이블 (예: IVE)
  labelInProgress: string  // 진행 중 레이블 (예: IVE(D))
  labelFailDev: string     // 개발 실패 (예: IVE(DF))
  labelDone: string        // 완료 레이블 (예: IVE(E))
  checkInterval: number    // 체크 간격 (분)
  lastCheckedAt: string | null // 마지막 체크 시간
  lastScannedIssueCount: number | null // 마지막 스캔 이슈 수
  scannerActive: boolean   // 스캐너 활성화 여부
  lastError: string | null      // 마지막 에러 메시지
  lastErrorAt: string | null    // 마지막 에러 시간
  sortOrder: number             // 표시 순서
  snapshotInterval: number      // 스냅샷 수집 간격 (분)
  sparklinePoints: number       // 스파크라인 표시 건수
  statsRetention: number        // 데이터 보관 기간 (일)
  createdAt: string
}

export type CliName = 'claude' | 'gemini' | 'codex'
export type AgentStatus = 'available' | 'busy' | 'offline'

export interface Agent {
  id: string
  userId: string
  name: string
  cliName: CliName
  cliPath: string
  cliVersion: string
  maxTurns: number
  status: AgentStatus
  snapshotInterval: number      // 스냅샷 수집 간격 (분)
  sparklinePoints: number       // 스파크라인 표시 건수
  statsRetention: number        // 데이터 보관 기간 (일)
  createdAt: string
}

export interface ProjectAssignment {
  id: string
  projectId: string
  agentId: string
  assignedAt: string
}

export type TaskStatus = 'running' | 'success' | 'failed'

export interface TaskExecution {
  id: string
  projectId: string
  agentId: string
  issueIid: number
  issueTitle?: string
  status: TaskStatus
  startedAt: string
  endedAt?: string
  logPath: string
  pid?: number
  agentName?: string
  inputTokens: number
  outputTokens: number
  costUsd: number
  turns: number
}

export interface StatSnapshot {
  id: string
  entityType: 'project' | 'agent'
  entityId: string
  timestamp: string
  running: number
  waiting: number
  completed: number
  failed: number
  totalTokens: number
  costUsd: number
}
