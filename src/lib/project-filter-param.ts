/**
 * 화면의 프로젝트 필터(?projects=id,id…)를 읽는다 — 없거나 비면 null(전체).
 * 받은 id 는 조회 조건을 좁히는 데만 쓴다. 접근 범위(소유·공유)는 각 조회가 따로 지킨다.
 */
export function parseProjectsParam(url: string | URL): string[] | null {
  const raw = new URL(url).searchParams.get('projects') || ''
  const ids = [...new Set(raw.split(',').map(s => s.trim()).filter(Boolean))]
  return ids.length ? ids : null
}
