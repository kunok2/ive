export interface User {
  id: string
  email: string
  name: string
  avatar: string       // 아바타 ID ('av-01'~'av-20') 또는 'photo' (업로드 사진)
  isAdmin: boolean
  maxAgents: number    // 최대 생성 가능 에이전트 수 (0 = 무제한)
  maxTurns: number     // 에이전트 최대 턴 수 상한 (0 = 무제한)
  allowedClis: CliName[]  // 사용 가능한 CLI 도구 목록
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

export type AuthType = 'token' | 'basic'

export interface Project {
  id: string
  userId: string
  name: string
  provider: Provider
  repoUrl: string
  authType: AuthType        // 인증 방식 (token: PAT, basic: 사용자계정)
  gitUsername: string        // basic 인증 시 사용자 이름
  accessToken: string       // token 모드: PAT / basic 모드: 비밀번호
  color: ProjectColor       // 프로젝트 구분 색상
  labelTarget: string      // 대상 이슈 레이블 (예: IVE)
  labelInProgress: string  // 진행 중 레이블 (예: IVE(D))
  labelFailDev: string     // 개발 실패 (예: IVE(F))
  labelDone: string        // 완료 레이블 (예: IVE(E))
  showToolUsage: boolean   // 트레이스에 툴 사용 표시 여부
  checkInterval: number    // 체크 간격 (분)
  lastCheckedAt: string | null // 마지막 체크 시간
  lastScannedIssueCount: number | null // 마지막 스캔 이슈 수
  scannerActive: boolean   // 스캐너 활성화 여부
  lastError: string | null      // 마지막 에러 메시지
  lastErrorAt: string | null    // 마지막 에러 시간
  sortOrder: number             // 표시 순서
  avatarUrl: string             // GitLab 프로젝트 아바타 URL (없으면 빈 문자열)
  snapshotInterval: number      // 스냅샷 수집 간격 (분)
  sparklinePoints: number       // 스파크라인 표시 건수
  statsRetention: number        // 데이터 보관 기간 (일)
  createdAt: string
}

export type CliName = 'claude' | 'gemini' | 'codex' | 'opencode'
export type AgentStatus = 'available' | 'busy' | 'offline'

// 기본 아바타 20종 (FontAwesome 아이콘 + 색상)
export const DEFAULT_AVATARS = [
  { id: 'av-01', icon: 'fa-solid fa-user-astronaut', color: '#60a5fa' },
  { id: 'av-02', icon: 'fa-solid fa-user-ninja', color: '#f472b6' },
  { id: 'av-03', icon: 'fa-solid fa-user-secret', color: '#a78bfa' },
  { id: 'av-04', icon: 'fa-solid fa-hat-wizard', color: '#c084fc' },
  { id: 'av-05', icon: 'fa-solid fa-robot', color: '#22d3ee' },
  { id: 'av-06', icon: 'fa-solid fa-ghost', color: '#e0e0e0' },
  { id: 'av-07', icon: 'fa-solid fa-dragon', color: '#f87171' },
  { id: 'av-08', icon: 'fa-solid fa-cat', color: '#fb923c' },
  { id: 'av-09', icon: 'fa-solid fa-dog', color: '#fbbf24' },
  { id: 'av-10', icon: 'fa-solid fa-hippo', color: '#a78bfa' },
  { id: 'av-11', icon: 'fa-solid fa-crow', color: '#94a3b8' },
  { id: 'av-12', icon: 'fa-solid fa-fish', color: '#22d3ee' },
  { id: 'av-13', icon: 'fa-solid fa-spider', color: '#f87171' },
  { id: 'av-14', icon: 'fa-solid fa-otter', color: '#a3e635' },
  { id: 'av-15', icon: 'fa-solid fa-shield-halved', color: '#60a5fa' },
  { id: 'av-16', icon: 'fa-solid fa-bolt', color: '#fbbf24' },
  { id: 'av-17', icon: 'fa-solid fa-fire', color: '#fb923c' },
  { id: 'av-18', icon: 'fa-solid fa-snowflake', color: '#67e8f9' },
  { id: 'av-19', icon: 'fa-solid fa-gem', color: '#f472b6' },
  { id: 'av-20', icon: 'fa-solid fa-leaf', color: '#4ade80' },
] as const

export type DefaultAvatarId = typeof DEFAULT_AVATARS[number]['id']

export interface Agent {
  id: string
  userId: string
  name: string
  avatar: string              // 기본 아바타 ID ('av-01'~'av-20') 또는 GitLab 아바타 URL
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
  accessToken: string    // 개발자별 액세스 토큰 (빈 문자열이면 프로젝트 토큰 사용)
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
  modelName?: string
  inputTokens: number
  outputTokens: number
  costUsd: number
  turns: number
  issueCreatedAt?: string
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

export type ShareRole = 'viewer' | 'editor'

export interface ProjectShare {
  id: string
  projectId: string
  userId: string
  role: ShareRole
  createdAt: string
}

export interface TokenPricing {
  id: string
  cliName: string
  modelName: string
  inputPrice: number   // $/1M tokens
  outputPrice: number  // $/1M tokens
  updatedAt: string
}

export type ReportType = 'weekly' | 'monthly' | 'yearly'

export interface ReportSchedule {
  id: string
  reportType: ReportType
  enabled: boolean
  recipients: string[]       // 수신자 이메일 목록
  createdAt: string
  updatedAt: string
}

export interface ReportSendLog {
  id: string
  scheduleId: string
  reportType: ReportType
  periodStart: string        // 보고서 기간 시작 (YYYY-MM-DD)
  periodEnd: string          // 보고서 기간 종료 (YYYY-MM-DD)
  recipientEmail: string
  status: 'success' | 'failed'
  errorMessage?: string | null
  sentAt: string
}

// 사용자 활동 로그 카테고리
export type ActivityCategory = 'auth' | 'project' | 'agent' | 'execution' | 'admin' | 'settings'

// 사용자 활동 로그
export interface UserActivityLog {
  id: string
  userId: string
  userName?: string
  userEmail?: string
  category: ActivityCategory
  action: string       // 예: 'login', 'create_project', 'delete_agent' 등
  detail: string       // 사람이 읽을 수 있는 상세 설명
  targetType?: string  // 대상 엔티티 타입 (project, agent, user 등)
  targetId?: string    // 대상 엔티티 ID
  ipAddress?: string   // 접속 IP
  userAgent?: string   // 브라우저 UA
  createdAt: string
}
