/**
 * Git 서버(GitLab/GitHub) 호출용 fetch — 응답이 없으면 제한 시간 뒤 끊는다.
 * 기본 fetch 는 시간 제한이 없어, 한 프로젝트의 서버가 멈추면 스캐너 한 바퀴 전체가 그 자리에서 서서
 * 다른 프로젝트의 이슈 반영(상태 전이·실행 정리)이 몇 분씩 밀렸다.
 */
export const GIT_FETCH_TIMEOUT_MS = 30_000

const RETRY_DELAY_MS = 1_000

function isTimeout(e: unknown): boolean {
  const name = (e as { name?: string } | null)?.name
  return name === 'TimeoutError' || name === 'AbortError'
}

function isTransient(e: unknown): boolean {
  if (isTimeout(e)) return true
  // 네트워크 단절(DNS·연결 거부·리셋)은 undici 가 TypeError('fetch failed') 로 낸다
  return e instanceof TypeError
}

/**
 * 읽기(GET/HEAD)는 일시적 실패(시간 초과·네트워크 단절) 시 한 번 더 시도한다.
 * 쓰기는 서버에 이미 반영됐을 수 있어 재시도하지 않는다.
 * 끝내 시간이 초과되면 영어 원문 대신 이유를 알 수 있는 문장으로 던진다.
 */
export async function gitFetch(input: string | URL, init: RequestInit = {}): Promise<Response> {
  const method = (init.method ?? 'GET').toUpperCase()
  const canRetry = (method === 'GET' || method === 'HEAD') && !init.signal
  const attempt = () => fetch(input, { ...init, signal: init.signal ?? AbortSignal.timeout(GIT_FETCH_TIMEOUT_MS) })
  try {
    try {
      return await attempt()
    } catch (e) {
      if (!canRetry || !isTransient(e)) throw e
      await new Promise(r => setTimeout(r, RETRY_DELAY_MS))
      return await attempt()
    }
  } catch (e) {
    if (isTimeout(e)) {
      throw new Error(`Git 서버가 ${GIT_FETCH_TIMEOUT_MS / 1000}초 안에 응답하지 않아 중단했습니다. 잠시 뒤 다시 시도됩니다.`, { cause: e })
    }
    throw e
  }
}
