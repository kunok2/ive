export interface User {
  id: string
  email: string
  name: string
  createdAt: string
}

export type Provider = 'github' | 'gitlab'
export type RoleCategory = '개발' | '검증'
export type RoleStatus = 'active' | 'idle' | 'paused'

export interface Project {
  id: string
  userId: string
  name: string
  provider: Provider
  repoUrl: string
  accessToken: string
  labelTarget: string      // 대상 이슈 레이블 (예: IVE)
  labelInProgress: string  // 진행 중 레이블 (예: IVE(D))
  labelFailDev: string     // 개발 실패 (예: IVE(DF))
  labelValidation: string  // 검증 단계 레이블 (예: IVE(V))
  labelFailVal: string     // 검증 실패 (예: IVE(VF))
  labelDone: string        // 완료 레이블 (예: IVE(E))
  checkInterval: number    // 체크 간격 (분)
  lastCheckedAt: string | null // 마지막 체크 시간
  lastScannedIssueCount: number | null // 마지막 스캔 이슈 수
  scannerActive: boolean   // 스캐너 활성화 여부
  createdAt: string
}

export interface ProjectRole {
  id: string
  projectId: string
  name: string
  category: RoleCategory
  status: RoleStatus
  accessToken?: string
  maxAgents: number
  createdAt: string
}

export type CliName = 'claude' | 'gemini' | 'codex'
export type AgentStatus = 'available' | 'busy' | 'offline'
export type RoleAssignmentStatus = 'active' | 'paused'

export interface Agent {
  id: string
  userId: string
  name: string
  cliName: CliName
  cliPath: string
  cliVersion: string
  status: AgentStatus
  createdAt: string
}

export interface RoleAssignment {
  id: string
  roleId: string
  agentId: string
  status: RoleAssignmentStatus
  assignedAt: string
}

export type TaskStatus = 'running' | 'success' | 'failed'

export interface TaskExecution {
  id: string
  projectId: string
  roleId: string
  agentId: string
  issueIid: number
  status: TaskStatus
  startedAt: string
  endedAt?: string
  logPath: string
  pid?: number        // 에이전트 프로세스 그룹 ID (강제 종료용)
  // joined fields (API 응답에만 포함)
  agentName?: string
  roleName?: string
}
