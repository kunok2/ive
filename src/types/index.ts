export interface User {
  id: string
  email: string
  name: string
  avatar: string       // 아바타 ID ('av-01'~'av-20') 또는 'photo' (사진)
  avatarSource?: string | null // 'upload'(사용자가 직접 지정 — 보호) | 'oauth'(provider에서 가져옴 — 로그인 시 갱신) | null
  isAdmin: boolean
  maxAgents: number    // 최대 생성 가능 에이전트 수 (0 = 무제한)
  maxTurns: number     // 에이전트 최대 턴 수 상한 (0 = 무제한)
  allowedClis: CliName[]  // 사용 가능한 CLI 도구 목록
  locale?: string      // 사용자 지정 언어
  timezone?: string    // 사용자 지정 타임존 (예: 'Asia/Seoul')
  currency?: string | null     // 표시 통화 코드 (ISO 4217, 예: 'KRW'). null/'USD' = 환산 안 함
  currencyRate?: number | null // 수동 고정 환율 (USD→통화). null = 자동 글로벌 환율 사용 (있으면 자동보다 우선)
  gitlabUsername?: string | null  // 본인 GitLab username. 확인자/담당자→IVE 계정 매핑 fallback(oauth id 매칭 실패 시). 로그인 시 자동 저장 + 직접 입력
  githubUsername?: string | null  // 본인 GitHub username. 위와 동일(GitHub 프로젝트용)
  slackUserId?: string     // 본인 Slack member ID (U...). 작업완료 DM·채널멘션 대상. 빈 값이면 DM 불가
  slackNotify: boolean     // 작업완료 Slack 알림 수신 여부 (기본 true). false면 라벨이 있어도 안 받음(본인 veto)
  mailUnsubscribed: boolean // 브로드캐스트(관리자 발송) 메일 수신거부 여부 (기본 false). true면 일괄 발송 대상에서 제외
  oauthProviderId?: string | null  // OAuth 로그인 공급자 ID (oauth_providers.id)
  oauthUserId?: string | null      // 공급자 측 사용자 고유 ID (문자열화)
  oauthTokenExpiresAt?: string | null // OAuth access_token 만료 시각 (ISO)
  createdAt: string
}

export type Provider = 'github' | 'gitlab'

/** OAuth 공급자(애플리케이션) — GitLab/GitHub 인스턴스별로 다중 등록 가능 */
/** OAuth provider 타입 — 코드 로그인(github/gitlab) + Slack(OIDC 로그인 + 봇 앱 자격증명) */
export type OAuthProviderType = Provider | 'slack'

export interface OAuthProvider {
  id: string
  type: OAuthProviderType   // 'github' | 'gitlab' | 'slack'
  name: string              // 표시명 ("gitlab.com", "회사 GitLab", "Slack")
  baseUrl: string           // https://gitlab.com, https://github.com, https://slack.com
  clientId: string
  clientSecret?: string     // 응답 시에는 마스킹 — DB에서 encrypt 저장
  hasSigningSecret?: boolean // slack 전용 — signing_secret 설정 여부 (값은 노출 안 함)
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
  labelNotify: string      // 알림 트리거 (예: IVE-N) — 이 레이블이 붙은 이슈만 완료 시 Slack 알림 발송
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
  reportSecret: string | null    // 신고 페이지 접근 시크릿 토큰 (null = 미사용)
  slackNotifyChannel: string     // 작업완료 알림 Slack 채널 ID (빈 값이면 채널 알림 안 함, DM은 별개)
  slackWorkspaceId: string       // 알림 발송에 사용할 Slack 워크스페이스 ID (빈 값이면 활성 워크스페이스 자동 사용)
  createdAt: string
}

// 'gemini' 는 레거시 — Gemini CLI 가 단종되고 agy(Antigravity CLI)로 대체됐다.
// 새 에이전트는 만들 수 없지만 과거 실행 이력 표시를 위해 타입에는 남긴다.
export type CliName = 'claude' | 'agy' | 'codex' | 'opencode' | 'gemini'
/** 현재 새로 만들 수 있는 CLI (레거시 제외) */
export const ACTIVE_CLI_NAMES = ['claude', 'agy', 'codex', 'opencode'] as const
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
  enabled: boolean              // 사용여부 마스터 스위치. false면 무기한 휴가(수동 복귀)
  pausedUntil?: string | null   // 자동 복귀 예약 시각(ISO). 이 시각 전까지는 기간제 휴가
  createdAt: string
  pendingCount?: number         // 지정 대기 이슈 수 (API 응답에만 포함, 정렬용)
  /** 역할 요약 (API 응답에만) — 명부에서 가진 역할별 프로젝트 수, 검증자·확인자로 지정된 이슈의 대기·진행 */
  roleSummary?: {
    roles: { process: number; verify: number; confirm: number }
    verifyWaiting: number; verifying: number; confirmWaiting: number; confirming: number
  }
}

/**
 * 에이전트가 지금 작업에 사용 가능한지 판정 (휴가/사용중지 반영).
 * - enabled=false → 무기한 휴가
 * - pausedUntil 이 미래 → 기간제 휴가 (그 시각 지나면 자동 복귀)
 * Codex 같은 사용량 한도 만료처럼 자동 감지가 불가능한 경우, 사용자가 수동으로 쉬게 한다.
 */
export function isAgentAvailableNow(
  agent: { enabled?: boolean | null; pausedUntil?: string | null },
  nowMs: number = Date.now(),
): boolean {
  if (agent.enabled === false) return false
  if (agent.pausedUntil) {
    const t = new Date(agent.pausedUntil).getTime()
    if (!Number.isNaN(t) && nowMs < t) return false
  }
  return true
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
  workSec?: number | null  // 툴 직접개발 확정 작업시간(초): ive-meta>/spend>0
}

export interface StatSnapshot {
  id: string
  entityType: 'project' | 'agent' | 'verifier'
  entityId: string
  timestamp: string
  running: number
  waiting: number          // 처리 대기 (에이전트 배정 기다림)
  verifyWaiting: number    // 검증 대기 (사람 검증 기다림)
  confirmWaiting: number   // 확인 대기 (사람 확인 기다림)
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

// ── Slack 통합 ──

// Slack 워크스페이스 (행마다 워크스페이스 1개 = 봇 토큰 1쌍). 멀티 워크스페이스 관리.
export interface SlackWorkspace {
  id: string
  teamId: string          // Slack 워크스페이스 ID (이벤트 라우팅 키, 고유)
  teamName: string        // Slack 측 워크스페이스 이름 (auth.test로 자동 채움)
  teamUrl: string         // Slack 워크스페이스 URL (auth.test url)
  name: string            // IVE 내 표시 이름
  botUserId: string       // 봇 자신의 user id (자기멘션 무한루프 차단용)
  defaultUserId: string | null  // 워크스페이스 소유자(IVE 유저). 이 유저의 에이전트·프로젝트만 사용
  enabled: boolean
  createdAt: string
  // botToken / signingSecret은 암호화 저장되며 응답에 포함하지 않음
}

// 채널 ↔ 프로젝트 연결 (채널 = 프로젝트)
export interface SlackChannelConfig {
  workspaceId: string
  channelId: string
  channelName: string | null
  projectId: string | null   // null = 일반 대화
  iveUserId: string | null   // 이 채널 멘션 시 사용할 IVE 유저 (null = 워크스페이스 기본)
  updatedAt: string
}

// 스레드 ↔ 이슈 바인딩 (스레드 = 이슈)
export interface SlackThreadSession {
  workspaceId: string
  channelId: string
  threadTs: string
  issueIid: number | null    // null = 일반 질문
  cliSessionId: string | null // chat-agent --resume 용
  cliName: string | null      // 그 세션을 만든 CLI (resume 호환성 — 다른 CLI면 재사용 금지)
  projectId: string | null    // 그 세션이 바인딩된 프로젝트 (바뀌면 워크스페이스 cwd가 달라져 resume 불가)
  updatedAt: string
}

// Slack 유저 ↔ IVE 유저 개인 매핑 (워크스페이스 기본유저 덮어쓰기)
export interface SlackUserMap {
  workspaceId: string
  slackUserId: string
  iveUserId: string
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
