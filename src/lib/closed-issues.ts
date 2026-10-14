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
  /**
   * 또는 이 라벨 (label OR orLabel). 단계 라벨을 붙이면 대상 라벨(IVE)을 떼므로, 새로 끝난 이슈엔
   * 종료 라벨(IVE-E)만 남는다 — 예전 이슈(IVE 부착)와 함께 보려고 둘 중 하나라도 있으면 포함한다.
   */
  orLabel?: string
  /**
   * 그 밖에도 이 라벨 중 하나라도 있으면 포함 — 단계 라벨(IVE-C 등)만 달고 닫힌 이슈(머지의 닫기 키워드로 닫힘, 완료 전)를 이력에 보이려고.
   * 단계 라벨을 붙이면 대상 라벨(ive)을 떼므로 이들은 ive 도 ive:done 도 없다(운영 2115).
   */
  orLabels?: string[]
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

/**
 * 정렬된 두 페이지 흐름(서로 겹치지 않는 조회)을 합쳐 opts.page 한 페이지를 만든다.
 * Git 이 라벨 OR 조회를 못 할 때(GitLab REST) 쓴다 — 각 흐름에서 앞쪽 page×perPage 건만 받으면 충분하다.
 */
export async function mergeClosedIssueStreams(
  opts: ClosedIssuePageOptions,
  fetchers: Array<(page: number, perPage: number) => Promise<ClosedIssuePage>>,
): Promise<ClosedIssuePage> {
  const need = opts.page * opts.perPage
  const BATCH = CLOSED_PAGE_SIZE_MAX
  const streams = await Promise.all(fetchers.map(async fetchPage => {
    const items: any[] = [] // eslint-disable-line @typescript-eslint/no-explicit-any -- provider 원본 이슈
    let total: number | null = 0
    let more = true
    for (let page = 1; more && items.length < need; page++) {
      const r = await fetchPage(page, BATCH)
      items.push(...r.issues)
      total = r.total
      more = r.hasMore
    }
    return { items, total, more }
  }))
  const dir = opts.sort === 'asc' ? 1 : -1
  const merged = streams.flatMap(s => s.items)
    .sort((a, b) => dir * (Date.parse(a.updated_at || '') - Date.parse(b.updated_at || '')))
  const start = (opts.page - 1) * opts.perPage
  const totals = streams.map(s => s.total)
  return {
    issues: merged.slice(start, start + opts.perPage),
    total: totals.every(t => t != null) ? totals.reduce((n, t) => n + (t as number), 0) : null,
    hasMore: merged.length > need || streams.some(s => s.more),
  }
}

/** 이력 조회가 받아들이는 라벨 전체 — label 과 orLabel·orLabels, 겹침 없이 */
export function closedLabelSet(opts: Pick<ClosedIssuePageOptions, 'label' | 'orLabel' | 'orLabels'>): string[] {
  return Array.from(new Set([opts.label, opts.orLabel, ...(opts.orLabels || [])].filter((l): l is string => !!l)))
}
