/**
 * IVE 사용자가 Git(이슈/코멘트)에 작성한 컨텐츠임을 표시하는 마커.
 *
 * 배경:
 *   Git API는 다른 사용자 명의로 이슈/코멘트를 생성할 수 없다. 접속자의 OAuth 토큰이
 *   유효하지 않으면 프로젝트 토큰(프로젝트 소유자/관리자 계정)으로 쓸 수밖에 없는데,
 *   이 경우 Git UI에는 토큰 주인이 작성자로 보인다.
 *
 *   IVE UI에서는 "실제 IVE에서 작성한 사용자"를 보여주기 위해, 본문 맨 앞에
 *   `<!-- ive-author:{userId} -->` 마커를 삽입하고 조회 시 파싱해 덮어쓴다.
 *   HTML 주석이라 GitLab/GitHub 렌더링에서는 사용자에게 보이지 않는다.
 *
 * 적용 대상:
 *   - 이슈 본문(description)
 *   - 이슈 코멘트(note body)
 */
import { getUserById, getUserByOAuthId, getUserByGitUsername, getAgent } from '@/lib/db'
import type { User, Agent, Project } from '@/types'
import { isBotName } from '@/lib/git-bot'

/**
 * Git 쪽 행위자(레이블 부착자 / 이슈 작성자)를 IVE 사용자로 식별한다.
 *
 * oauth_user_id(숫자 id) 매칭만 쓰면 **그 provider 로 IVE 에 로그인한 사용자만** 잡힌다.
 * GitHub·Slack·이메일 등 다른 방식으로 가입한 사람은 GitLab 이슈에 IVE-S 를 붙여도
 * 식별되지 않아 의뢰자 판정이 '프로젝트 오너 fallback' 으로 떨어지고, 결과적으로
 * **오너의 에이전트 풀**에서 작업자가 배정된다(본인이 관리하지 않는 에이전트가
 * 자기 이슈를 처리하는 것처럼 보인다). 알림 수신자 매핑에서 이미 같은 문제를
 * git username fallback 으로 해결했으므로 의뢰자 판정도 같은 기준을 쓴다.
 */
function matchGitUser(
  provider: 'github' | 'gitlab',
  userId: string | number | null | undefined,
  username: string | null | undefined,
): User | null {
  if (userId != null && String(userId) !== '') {
    const byId = getUserByOAuthId(provider, String(userId))
    if (byId) return byId
  }
  if (username) {
    const byName = getUserByGitUsername(provider, username)
    if (byName) return byName
  }
  return null
}

/**
 * 단계 라벨(IVE-V/P/C/E …)을 **실제로 부착한 사람**을 찾는다.
 *
 * 에이전트가 검증·확인을 맡으면 IVE 화면 버튼이 아니라 glab/gh 로 라벨을 옮긴다. 그 경로에서
 * 종전에는 "이슈 담당자(assignee)"를 행위자로 간주할 수밖에 없어, 담당자와 실제로 검증한 사람이
 * 다르면 검증자/확인자가 엉뚱하게 기록됐다. 라벨 이벤트에는 누가 언제 달았는지가 남으므로
 * 그것을 우선 쓴다.
 *
 * ⚠️ 봇 계정은 건너뛴다. IVE 자신이 **프로젝트 토큰(봇)** 으로 라벨을 달기 때문에(화면 버튼으로
 * 승인한 경우가 그렇다) 봇을 그대로 행위자로 삼으면 진짜 검증자를 덮어쓴다. 그런 경우는
 * 호출부가 assignee 로 fallback 한다.
 */
export interface StageActor {
  username: string
  /** IVE 계정으로 식별되면 그 사용자. 외부 협력자 등은 null. */
  user: User | null
  createdAt: string
}

export async function resolveStageActorAsync(
  project: Project,
  stageLabel: string,
  fetchLabelEvents: () => Promise<Array<{
    action: 'add' | 'remove'; label: string; userId: string | null; username?: string | null; createdAt: string
  }>>,
): Promise<StageActor | null> {
  if (!stageLabel) return null
  try {
    const events = await fetchLabelEvents()
    const sorted = [...events].sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1))
    for (const ev of sorted) {
      if (ev.action !== 'add' || ev.label !== stageLabel) continue
      const username = ev.username || ''
      if (!username || isBotName(username)) continue
      return { username, user: matchGitUser(project.provider, ev.userId, username), createdAt: ev.createdAt }
    }
  } catch {
    // 레이블 이벤트 조회 실패 → 호출부가 assignee 로 fallback
  }
  return null
}

export const IVE_AUTHOR_MARKER_RE = /<!--\s*ive-author:([a-zA-Z0-9_-]+)\s*-->/
export const IVE_AGENT_MARKER_RE = /<!--\s*ive-agent:([a-zA-Z0-9_-]+)\s*-->/

/** 본문 맨 앞에 마커를 삽입. 기존 본문이 비어있어도 안전. */
export function prependIveAuthorMarker(userId: string, body: string): string {
  return `<!-- ive-author:${userId} -->\n${body || ''}`
}

/** 본문에서 ive-author 마커 제거 (사용자에게 보여줄 때 정리용) */
export function stripIveAuthorMarker(body: string): string {
  if (typeof body !== 'string') return body
  return body.replace(IVE_AUTHOR_MARKER_RE, '').trimStart()
}

/** 본문에서 ive-author 마커의 userId 추출 (없으면 null) */
export function extractIveAuthorId(body: string | null | undefined): string | null {
  if (!body || typeof body !== 'string') return null
  const match = body.match(IVE_AUTHOR_MARKER_RE)
  return match ? match[1] : null
}

/**
 * 본문의 ive-author 마커를 보고 원작성자 정보를 반환.
 * 마커가 없거나 해당 IVE 사용자를 찾을 수 없으면 null.
 *
 * avatar 는 프론트엔드가 "photo" / "av-XX" 아이디를 기반으로 렌더링하므로
 * 파일 경로나 URL 결정 로직은 호출부 몫 (notes 라우트와 동일).
 */
export function resolveIveAuthorFromBody(body: string | null | undefined): User | null {
  const id = extractIveAuthorId(body)
  if (!id) return null
  return getUserById(id)
}

// ──────────────── Agent marker (에이전트 작성 노트) ────────────────
//
// Git 에 댓글을 달 때는 프로젝트 토큰으로 호출돼 작성자가 프로젝트 소유자로 보임.
// 본문에 `<!-- ive-agent:{agentId} -->` 를 포함하면 IVE UI 가 에이전트 이름/아바타로 표시.
// ive-bot 마커는 "봇이 자동 생성했다" 는 플래그일 뿐이고, ive-agent 마커가 실제 식별자.

/** 본문 맨 앞에 에이전트 마커를 삽입. */
export function prependIveAgentMarker(agentId: string, body: string): string {
  return `<!-- ive-agent:${agentId} -->\n${body || ''}`
}

/** 본문에서 ive-agent 마커 제거 */
export function stripIveAgentMarker(body: string): string {
  if (typeof body !== 'string') return body
  return body.replace(IVE_AGENT_MARKER_RE, '').trimStart()
}

/** 본문에서 ive-agent 마커의 agentId 추출 */
export function extractIveAgentId(body: string | null | undefined): string | null {
  if (!body || typeof body !== 'string') return null
  const match = body.match(IVE_AGENT_MARKER_RE)
  return match ? match[1] : null
}

/** 본문의 ive-agent 마커로 Agent 정보 반환 */
export function resolveIveAgentFromBody(body: string | null | undefined): Agent | null {
  const id = extractIveAgentId(body)
  if (!id) return null
  return getAgent(id) || null
}

/** ive-author / ive-agent 마커 모두 한 번에 제거 (UI 표시 전 정리용) */
export function stripAllIveMarkers(body: string): string {
  if (typeof body !== 'string') return body
  return body.replace(IVE_AUTHOR_MARKER_RE, '').replace(IVE_AGENT_MARKER_RE, '').trimStart()
}

// ──────────────── Due date marker (GitHub 전용 마감일 저장) ────────────────
//
// GitHub 이슈에는 네이티브 due_date 필드가 없어, 본문에 `<!-- ive-due:YYYY-MM-DD -->`
// 형태로 저장한다. GitLab은 네이티브 due_date 를 사용하므로 마커는 GitHub만의 약속.

export const IVE_DUE_MARKER_RE = /<!--\s*ive-due:(\d{4}-\d{2}-\d{2})\s*-->/

/** 본문에서 마감일 추출 (없으면 null). YYYY-MM-DD 형식. */
export function extractIveDueDate(body: string | null | undefined): string | null {
  if (!body || typeof body !== 'string') return null
  const m = body.match(IVE_DUE_MARKER_RE)
  return m ? m[1] : null
}

/** 본문에서 ive-due 마커 제거 */
export function stripIveDueMarker(body: string): string {
  if (typeof body !== 'string') return body
  return body.replace(IVE_DUE_MARKER_RE, '').replace(/\n{3,}/g, '\n\n').trim()
}

/**
 * 본문에 마감일 마커를 셋팅. dueDate=null 이면 마커 제거.
 * 기존 마커가 있으면 교체, 없으면 본문 끝에 부착(빈 줄 1개 띄움).
 */
export function setIveDueMarker(body: string, dueDate: string | null): string {
  const base = (body || '').replace(IVE_DUE_MARKER_RE, '').trimEnd()
  if (!dueDate) return base
  return base ? `${base}\n\n<!-- ive-due:${dueDate} -->` : `<!-- ive-due:${dueDate} -->`
}

// ──────────────── Issue requester (이슈 의뢰자) ────────────────
//
// 이슈를 처리할 에이전트를 누구의 풀에서 골라올지 결정하는 핵심 로직.
// "의뢰자" = 이 작업의 처리(=IVE 스캐너 트리거)를 의뢰한 사람.
// 기본은 "Schedule 레이블(IVE-S) 을 부착한 사람" — 작성과 의뢰는 별개의 사건.
//
// 우선순위 (resolveIssueRequesterAsync — 스캐너용):
//   1) 본문 ive-author 마커 (명시적 위임)
//   2) Schedule 레이블(IVE-S) 을 가장 최근 부착한 사람 → oauth_user_id 매칭
//   3) Git author → oauth_user_id 매칭 (레이블 이벤트로 식별 실패 시)
//   4) 프로젝트 오너 fallback
//
// 동기 버전 resolveIssueRequester 는 토큰이 없는 호출부(웹 API)에서 사용하며
// 2단계(레이블 이벤트)는 생략한다.

export interface IssueRequesterResult {
  user: User
  /** 'marker' | 'label-actor' | 'author' | 'owner-fallback' — 디버그/로깅용 */
  source: 'marker' | 'label-actor' | 'author' | 'owner-fallback'
}

export function resolveIssueRequester(project: Project, issue: any): IssueRequesterResult | null {
  // 1) 본문 ive-author 마커
  const markerId = extractIveAuthorId(issue.description || '')
  if (markerId) {
    const u = getUserById(markerId)
    if (u) return { user: u, source: 'marker' }
  }

  // 2) Git author → IVE 사용자 매칭
  const author = matchGitUser(project.provider, issue.author?.id, issue.author?.username)
  if (author) return { user: author, source: 'author' }

  // 3) 프로젝트 오너 fallback
  const owner = getUserById(project.userId)
  if (owner) return { user: owner, source: 'owner-fallback' }
  return null
}

/**
 * 레이블 이벤트 조회까지 포함한 의뢰자 판정. 스캐너가 사용.
 *
 * 동기 버전과의 차이:
 *   - 본문 마커가 없을 때, "Schedule 레이블(IVE-S) 을 가장 최근 부착한 사람"을
 *     이슈 작성자보다 우선해 의뢰자로 본다.
 *
 * 의뢰 행위 = "스캐너에 처리를 맡긴 행위" = "IVE-S 부착" 으로 정의한다.
 * 이슈 작성자와 IVE 처리 의뢰자는 다른 사람일 수 있다 (다른 IVE 계정으로
 * 로그인했거나, 팀원이 대신 만든 이슈를 본인이 IVE-S 로 트리거한 경우 등).
 *
 * fetchLabelEvents 는 provider 추상을 깨지 않으려 호출부에서 주입.
 */
export async function resolveIssueRequesterAsync(
  project: Project,
  issue: any,
  fetchLabelEvents: () => Promise<Array<{
    action: 'add' | 'remove'; label: string; userId: string | null; username?: string | null; createdAt: string
  }>>,
): Promise<IssueRequesterResult | null> {
  // 1) 본문 ive-author 마커
  const markerId = extractIveAuthorId(issue.description || '')
  if (markerId) {
    const u = getUserById(markerId)
    if (u) return { user: u, source: 'marker' }
  }

  // 2) Schedule 레이블(IVE-S) 을 가장 최근 부착한 사람
  const scheduleLabel = project.labelSchedule || 'IVE-S'
  try {
    const events = await fetchLabelEvents()
    const sorted = [...events].sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1))
    for (const ev of sorted) {
      if (ev.action !== 'add' || ev.label !== scheduleLabel) continue
      const u = matchGitUser(project.provider, ev.userId, ev.username)
      if (u) return { user: u, source: 'label-actor' }
    }
  } catch {
    // 레이블 이벤트 조회 실패 → 다음 단계로 fallback
  }

  // 3) Git author → IVE 사용자 매칭
  const author = matchGitUser(project.provider, issue.author?.id, issue.author?.username)
  if (author) return { user: author, source: 'author' }

  // 4) 프로젝트 오너 fallback
  const owner = getUserById(project.userId)
  if (owner) return { user: owner, source: 'owner-fallback' }
  return null
}
