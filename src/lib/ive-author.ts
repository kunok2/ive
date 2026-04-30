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
import { getUserById, getUserByOAuthId, getAgent } from '@/lib/db'
import type { User, Agent, Project } from '@/types'

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
// "의뢰자" = 이 작업을 해달라고 요청한 사람 = 이슈 작성자.
// (Git assignees는 처리/검증할 사람이지 의뢰자가 아님 — 의뢰자 판정에서 제외.)
//
// 우선순위:
//   1) 본문 ive-author 마커 → IVE 사용자 (IVE 내부에서 만든 이슈)
//   2) Git author → oauth_user_id 매칭 (외부에서 만든 이슈, IVE 가입자)
//   3) 모두 실패 → 프로젝트 오너 (외부인이 GitLab에서 직접 IVE 레이블만 단 케이스)
//
// 1~2는 의뢰자가 명확히 식별된 경우. 3은 fallback (오너가 책임).
// 호출부는 반환값.user.id 로 그 사람의 에이전트 풀을 lookup.

export interface IssueRequesterResult {
  user: User
  /** 'marker' | 'author' | 'owner-fallback' — 디버그/로깅용 */
  source: 'marker' | 'author' | 'owner-fallback'
}

export function resolveIssueRequester(project: Project, issue: any): IssueRequesterResult | null {
  // 1) 본문 ive-author 마커
  const markerId = extractIveAuthorId(issue.description || '')
  if (markerId) {
    const u = getUserById(markerId)
    if (u) return { user: u, source: 'marker' }
  }

  // 2) Git author → IVE 사용자 매칭
  if (issue.author?.id != null) {
    const u = getUserByOAuthId(project.provider, String(issue.author.id))
    if (u) return { user: u, source: 'author' }
  }

  // 3) 프로젝트 오너 fallback
  const owner = getUserById(project.userId)
  if (owner) return { user: owner, source: 'owner-fallback' }
  return null
}
