/**
 * GitHub·GitLab 목록 API를 끝 페이지까지 받는다.
 *
 * 두 API 모두 한 번에 최대 100개(기본 GitHub 30 · GitLab 20)만 돌려주므로, 한 번만 부르면
 * 그 뒤가 조용히 잘린다. 스캐너는 "이번 목록에 없는 이슈 = 닫힘"으로 정리하므로 잘린 목록은
 * 곧 오판이다 — 그래서 중간 페이지 하나라도 실패하면 일부 결과가 아니라 실패로 돌려준다.
 *
 * url 에 page·per_page 를 붙여 부른다(이미 있으면 덮어쓴다).
 */
export const PAGE_SIZE = 100

export type PagedResult =
  | { ok: true; items: any[] }
  | { ok: false; status: number; statusText: string; items: [] }

export async function fetchAllPages(
  url: string,
  headers: Record<string, string>,
  maxPages = 50,
): Promise<PagedResult> {
  const items: any[] = []
  for (let page = 1; page <= maxPages; page++) {
    const u = new URL(url)
    u.searchParams.set('per_page', String(PAGE_SIZE))
    u.searchParams.set('page', String(page))
    const res = await fetch(u.toString(), { headers })
    if (!res.ok) return { ok: false, status: res.status, statusText: res.statusText, items: [] }
    const batch = await res.json()
    if (!Array.isArray(batch)) return { ok: false, status: 500, statusText: 'Unexpected response', items: [] }
    items.push(...batch)
    if (batch.length < PAGE_SIZE) break
  }
  return { ok: true, items }
}
