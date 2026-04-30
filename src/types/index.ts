export interface User {
  id: string
  email: string
  name: string
  avatar: string       // 아바타 ID ('av-01'~'av-20') 또는 'photo' (업로드 사진)
  isAdmin: boolean
  maxAgents: number    // 최대 생성 가능 에이전트 수 (0 = 무제한)
  maxTurns: number     // 에이전트 최대 턴 수 상한 (0 = 무제한)
  allowedClis: CliName[]  // 사용 가능한 CLI 도구 목록
  locale?: string      // 사용자 지정 언어
  timezone?: string    // 사용자 지정 타임존 (예: 'Asia/Seoul')
  oauthProviderId?: string | null  // OAuth 로그인 공급자 ID (oauth_providers.id)
  oauthUserId?: string | null      // 공급자 측 사용자 고유 ID (문자열화)
  oauthTokenExpiresAt?: string | null // OAuth access_token 만료 시각 (ISO)
  createdAt: string
}

export type Provider = 'github' | 'gitlab'

/** OAuth 공급자(애플리케이션) — GitLab/GitHub 인스턴스별로 다중 등록 가능 */
export interface OAuthProvider {
  id: string
  type: Provider            // 'github' | 'gitlab'
  name: string              // 표시명 ("gitlab.com", "회사 GitLab")
  baseUrl: string           // https://gitlab.com, https://github.com, https://gitlab.example.com
  clientId: string
  clientSecret?: string     // 응답 시에는 마스킹 — DB에서 encrypt 저장
  enabled: boolean
  createdAt: string
}

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
  { name: 'green', value: '#4ade80' },
  { name: 'cyan', value: '#22d3ee' },
  { name: 'blue', value: '#60a5fa' },
  { name: 'purple', value: '#a78bfa' },
  { name: 'pink', value: '#f472b6' },
  { name: 'red', value: '#f87171' },
  { name: 'orange', value: '#fb923c' },
  { name: 'yellow', value: '#fbbf24' },
  { name: 'lime', value: '#a3e635' },
  { name: 'white', value: '#e0e0e0' },
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
  labelTarget: string      // IVE 관리 대상 표시 (예: IVE)
  labelSchedule: string   // 스케줄 대상 (예: IVE-S) — 스캐너가 이 레이블의 이슈를 배정
  labelDev: string         // 개발 중 (예: IVE-D) — 에이전트 배정 시 부착
  labelVerifyWait: string  // 검증 대기 (예: IVE-W) — 개발 완료 후 부착 (검증자 시작 전)
  labelVerify: string      // 검증 중 (예: IVE-V) — 검증자가 검증시작 클릭 후 부착
  labelConfirmWait: string // 확인 대기 (예: IVE-P) — 머지 완료 후 부착 (확인자 시작 전)
  labelConfirm: string     // 확인 중 (예: IVE-C) — 확인자가 확인시작 클릭 후 부착
  labelEnd: string         // 처리 완료 (예: IVE-E) — 확인 완료 후 부착
  baseBranch: string       // 베이스 브랜치 (빈 값이면 origin/HEAD 자동 감지 → main fallback)
  confirmBaseBranch: string // 확인 단계 승격 베이스 브랜치 (빈 값이면 승격 MR 미생성, accept 시 단순 close)
  testSiteUrl: string      // 테스트 사이트 URL (프로젝트 카드에서 새 탭으로 열기)
  showToolUsage: boolean   // 트레이스에 툴 사용 표시 여부
  checkInterval: number    // 체크 간격 (분)
  lastCheckedAt: string | null // 마지막 체크 시간
  lastScannedIssueCount: number | null       // 마지막 스캔 시 처리 대기(waiting) 이슈 수
  lastVerifyWaitingCount: number | null      // 마지막 스캔 시 검증 대기(verify_waiting) 이슈 수
  scannerActive: boolean   // 스캐너 활성화 여부
  usesOAuthToken: boolean   // OAuth 토큰 사용 여부 (true면 Authorization: Bearer 헤더 사용)
  lastError: string | null      // 마지막 에러 메시지
  lastErrorAt: string | null    // 마지막 에러 시간
  sortOrder: number             // 표시 순서
  avatarUrl: string             // GitLab 프로젝트 아바타 URL (없으면 빈 문자열)
  snapshotInterval: number      // 스냅샷 수집 간격 (분)
  sparklinePoints: number       // 스파크라인 표시 건수
  statsRetention: number        // 데이터 보관 기간 (일)
  conflictCount: number          // 충돌 MR/PR 수 (ConflictWorker가 갱신, 서버 전용)
  lastActivityAt: string | null  // 최종 활동 시각 (이슈 등록, 실행 등)
  createdAt: string
}

export type CliName = 'claude' | 'gemini' | 'codex' | 'opencode'
export type AgentStatus = 'available' | 'busy' | 'offline'

// 기본 아바타 20종 — 아이콘으로 정체성 구분, 색은 브랜드(cyan) 변주로 통일.
// 디자인 시스템 외 색(보라/핑크/주황) 사용하지 않음. 6가지 cyan 톤이 순환.
const AVATAR_TONES = [
  '#a5f3fc',  // cyan-200 — 가장 옅음
  '#67e8f9',  // cyan-300
  '#22d3ee',  // cyan-400 (브랜드)
  '#06b6d4',  // cyan-500
  '#0891b2',  // cyan-600
  '#155e75',  // cyan-800 — 가장 짙음
] as const

const AVATAR_ICONS = [
  'fa-solid fa-user-astronaut',
  'fa-solid fa-user-ninja',
  'fa-solid fa-user-secret',
  'fa-solid fa-hat-wizard',
  'fa-solid fa-robot',
  'fa-solid fa-ghost',
  'fa-solid fa-dragon',
  'fa-solid fa-cat',
  'fa-solid fa-dog',
  'fa-solid fa-hippo',
  'fa-solid fa-crow',
  'fa-solid fa-fish',
  'fa-solid fa-spider',
  'fa-solid fa-otter',
  'fa-solid fa-shield-halved',
  'fa-solid fa-bolt',
  'fa-solid fa-fire',
  'fa-solid fa-snowflake',
  'fa-solid fa-gem',
  'fa-solid fa-leaf',
] as const

export const DEFAULT_AVATARS = AVATAR_ICONS.map((icon, i) => ({
  id: `av-${String(i + 1).padStart(2, '0')}`,
  icon,
  color: AVATAR_TONES[i % AVATAR_TONES.length],
})) as ReadonlyArray<{ id: string; icon: string; color: string }>

export type DefaultAvatarId =
  | 'av-01' | 'av-02' | 'av-03' | 'av-04' | 'av-05'
  | 'av-06' | 'av-07' | 'av-08' | 'av-09' | 'av-10'
  | 'av-11' | 'av-12' | 'av-13' | 'av-14' | 'av-15'
  | 'av-16' | 'av-17' | 'av-18' | 'av-19' | 'av-20'

export interface Agent {
  id: string
  userId: string
  name: string
  avatar: string              // 기본 아바타 ID ('av-01'~'av-20') 또는 GitLab 아바타 URL
  cliName: CliName
  cliPath: string
  cliVersion: string
  modelName: string           // 에이전트별 모델명 (빈 문자열이면 시스템 설정 폴백)
  maxTurns: number
  status: AgentStatus
  snapshotInterval: number      // 스냅샷 수집 간격 (분)
  sparklinePoints: number       // 스파크라인 표시 건수
  statsRetention: number        // 데이터 보관 기간 (일)
  createdAt: string
  pendingCount?: number         // 지정 대기 이슈 수 (API 응답에만 포함, 정렬용)
}

export type TaskStatus = 'running' | 'success' | 'failed' | 'assigned'

export type AssignMode = 'auto' | 'assignee' | 'agent'

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
  agentAvatar?: string
  modelName?: string
  inputTokens: number
  outputTokens: number
  cacheReadInputTokens?: number
  cacheCreationInputTokens?: number
  costUsd: number
  turns: number
  issueCreatedAt?: string
  assigneeType?: 'agent' | 'user'
  userId?: string | null
  userName?: string | null
  userAvatar?: string | null
  verifiedAt?: string | null
  rejectedAt?: string | null
}

export interface StatSnapshot {
  id: string
  entityType: 'project' | 'agent' | 'verifier'
  entityId: string
  timestamp: string
  running: number
  waiting: number          // 처리 대기 (에이전트 배정 기다림)
  verifyWaiting: number    // 검증 대기 (사람 검증 기다림)
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
  sendHour: number           // 발송 시각 (0~23, KST)
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
export type ActivityCategory = 'auth' | 'project' | 'agent' | 'execution' | 'admin' | 'settings' | 'task'

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
