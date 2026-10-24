/**
 * 사람이 화면에서 단계를 옮기는 중인 작업 표시 — 스캐너가 그 사이의 어긋난 모습을 보고 잘못 판정하지 않게 한다.
 *
 * 사람이 처리·검증·확인을 시작하면 실행 기록을 레이블보다 먼저 만든다(반대면 「실행 없는 처리」= 처리 실패로 잠깐 보인다).
 * 그런데 실행은 이미 있고 레이블은 아직 옛 단계인 짧은 사이에 스캐너가 이슈를 읽으면 「사람이 레이블을 되돌렸다」로 보고
 * 방금 만든 실행을 실패로 닫는다. 곧 레이블이 바뀌면 실행 없는 처리가 되어 처리 실패가 뜨고, 다음 스캔이 실행을 다시 만들 때까지 간다.
 * 스캐너가 이슈 목록을 읽은 뒤에 끝난 단계 변경도 같다(읽은 목록이 옛 것) — 그래서 진행 중이거나 스캔이 시작된 뒤에 끝난 변경은 건너뛴다.
 * 서버는 한 프로세스(Next 와 스캐너가 같은 프로세스)라 메모리로 충분하다.
 */
const g = globalThis as unknown as { __iveStageChanges?: Map<string, number> }
const changes = (g.__iveStageChanges ??= new Map<string, number>())

const IN_FLIGHT = Number.POSITIVE_INFINITY
const KEEP_MS = 10 * 60 * 1000

export const stageChangeKey = (projectId: string, iid: number | string) => `${projectId}:${iid}`

/** 이미 진행 중이면 false(동시 요청 차단) */
export function beginStageChange(key: string): boolean {
  if (changes.get(key) === IN_FLIGHT) return false
  changes.set(key, IN_FLIGHT)
  return true
}

export function endStageChange(key: string, now = Date.now()) {
  changes.set(key, now)
  // 오래된 기록 정리
  for (const [k, t] of changes) if (t !== IN_FLIGHT && now - t > KEEP_MS) changes.delete(k)
}

/** 진행 중이거나 `sinceMs` 이후에 끝난 단계 변경이 있나 — 그 시각 이전에 읽은 레이블은 믿으면 안 된다 */
export function stageChangedSince(key: string, sinceMs: number): boolean {
  const t = changes.get(key)
  return t !== undefined && t >= sinceMs
}
