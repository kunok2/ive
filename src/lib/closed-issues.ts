/**
 * 이력 탭(닫힌 이슈) 페이지 조회의 공통 타입·파라미터 해석.
 * GitLab/GitHub 구현이 같은 모양을 돌려주도록 여기서 정의한다.
 */

export type ClosedIssueSort = 'desc' | 'asc'

export interface ClosedIssuePageOptions {
  page: number
  perPage: number
  /** 최근 갱신일 기준(닫힌 순서에 가장 가까움 — GitLab·GitHub 모두 닫힌 시각 정렬이 없다) — desc=최신순, asc=오래된순 */
  sort: ClosedIssueSort
  /** 제목·본문 검색어, 숫자(#123)면 이슈 번호 */
  search?: string
  /**
   * 이 라벨이 붙은 이슈만 (IVE 대상 라벨). Git 쪽에서 거르지 않고 받은 뒤 거르면 페이지가 비거나
   * (IVE 와 무관한 이슈만 있는 페이지) 건수(total)가 실제 목록과 어긋난다 — 개발계 검증에서 확인.
   */
  label?: string
  /** 이 이슈 번호들로 한정 (GitLab 이 못 하는 짧은 검색어를 IVE DB 제목으로 찾은 결과). 빈 배열이면 결과 없음. */
  iids?: number[]
}

export interface ClosedIssuePage {
  issues: any[] // eslint-disable-line @typescript-eslint/no-explicit-any -- provider 원본 이슈
  /** 전체 닫힌 이슈 수 (provider 가 알려 주지 않으면 null) */
  total: number | null
  hasMore: boolean
}

export const CLOSED_PAGE_SIZE_DEFAULT = 50
export const CLOSED_PAGE_SIZE_MAX = 100

/** 이슈 번호 검색어(#123 / 123)면 그 번호 */
export function parseIidSearch(search: string | undefined): number | null {
  const m = (search || '').trim().match(/^#?(\d+)$/)
  return m ? Number(m[1]) : null
}

/**
 * GitLab 이슈 검색이 그대로 처리할 수 있는 검색어인가.
 * GitLab 은 3글자 미만 단어를 무시한다 — "영어", "버그" 같은 두 글자 한글은 0건이 된다(실측).
 */
export function isGitLabSearchable(search: string): boolean {
  const words = search.trim().split(/\s+/).filter(Boolean)
  return words.length > 0 && words.every(w => Array.from(w).length >= 3)
}

/** 쿼리스트링 → 페이지 옵션 (범위 밖 값은 기본값으로) */
export function parseClosedPageOptions(sp: URLSearchParams): ClosedIssuePageOptions {
  const page = Math.max(1, Math.floor(Number(sp.get('page')) || 1))
  const rawSize = Math.floor(Number(sp.get('perPage')) || CLOSED_PAGE_SIZE_DEFAULT)
  const perPage = Math.min(CLOSED_PAGE_SIZE_MAX, Math.max(1, rawSize))
  const sort: ClosedIssueSort = sp.get('sort') === 'asc' ? 'asc' : 'desc'
  const search = (sp.get('q') || '').trim().slice(0, 200) || undefined
  return { page, perPage, sort, search }
}
