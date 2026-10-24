/**
 * Git 서버(GitLab/GitHub) 호출용 fetch — 응답이 없으면 제한 시간 뒤 끊는다.
 * 기본 fetch 는 시간 제한이 없어, 한 프로젝트의 서버가 멈추면 스캐너 한 바퀴 전체가 그 자리에서 서서
 * 다른 프로젝트의 이슈 반영(상태 전이·실행 정리)이 몇 분씩 밀렸다.
 */
export const GIT_FETCH_TIMEOUT_MS = 30_000

export function gitFetch(input: string | URL, init: RequestInit = {}): Promise<Response> {
  return fetch(input, { ...init, signal: init.signal ?? AbortSignal.timeout(GIT_FETCH_TIMEOUT_MS) })
}
