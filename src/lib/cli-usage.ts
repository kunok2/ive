/**
 * CLI 스트림(JSON 줄) 이벤트에서 토큰·비용·모델을 누적한다 — 처리 실행(cli-runner)과 AI 대화(chat-agent)가 같은 규칙을 쓴다.
 *
 * 집계 기준(모든 CLI 공통): input = 캐시 포함 총 입력, output = 추론 포함 출력.
 * 비용 필드가 없는 CLI(codex·agy)는 cost 가 0 으로 남고, 호출 측이 DB 단가(calcCostFromDb)로 환산한다.
 * 턴 수는 CLI 마다 세는 방식이 실행 흐름에 얽혀 있어(어시스턴트 메시지 수 등) 여기서 다루지 않는다.
 */
export interface CliUsage {
  input: number
  output: number
  cacheRead: number
  cacheCreation: number
  cost: number
  model: string
}

export function emptyCliUsage(): CliUsage {
  return { input: 0, output: 0, cacheRead: 0, cacheCreation: 0, cost: 0, model: '' }
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function accumulateCliUsage(acc: CliUsage, event: any, cliName: string): void {
  if (!event || typeof event !== 'object') return
  const eventModel = event.model ?? event.modelId ?? event.model_id ?? event.message?.model ?? event.session?.model ?? ''
  if (eventModel && !acc.model && typeof eventModel === 'string') acc.model = eventModel

  if (cliName === 'opencode') {
    // part.tokens = {total, input, output, reasoning, cache:{read, write}} — input/output 은 캐시·추론 제외 순수치
    if (event.type === 'step_finish') {
      const t = event.part?.tokens ?? {}
      const cacheRead = Number(t.cache?.read ?? 0)
      const cacheWrite = Number(t.cache?.write ?? 0)
      acc.input += Number(t.input ?? 0) + cacheRead + cacheWrite
      acc.cacheRead += cacheRead
      acc.cacheCreation += cacheWrite
      acc.output += Number(t.output ?? 0) + Number(t.reasoning ?? 0)
      acc.cost += Number(event.part?.cost ?? 0)
    }
  } else if (cliName === 'codex') {
    // turn.completed 마다 그 턴의 usage(비용 필드 없음)
    if (event.type === 'turn.completed') {
      const u = event.usage ?? {}
      acc.input += Number(u.input_tokens ?? 0)
      acc.cacheRead += Number(u.cached_input_tokens ?? 0)
      acc.output += Number(u.output_tokens ?? 0) + Number(u.reasoning_output_tokens ?? 0)
    }
  } else if (cliName === 'agy') {
    // result.usage 는 실행 전체 누계 — input 은 캐시 포함, output 은 thinking 포함(비용 필드 없음)
    if (event.event === 'result') {
      const u = event.result?.usage ?? {}
      acc.input += Number(u.input_tokens ?? 0)
      acc.cacheRead += Number(u.cache_read_tokens ?? 0)
      acc.output += Number(u.output_tokens ?? 0)
    }
  } else {
    // claude: result 이벤트에 실행 전체 usage·비용
    if (event.type === 'result') {
      const u = event.usage ?? {}
      const cacheCreation = Number(u.cache_creation_input_tokens ?? 0)
      const cacheRead = Number(u.cache_read_input_tokens ?? 0)
      acc.input += Number(u.input_tokens ?? 0) + cacheCreation + cacheRead
      acc.cacheCreation += cacheCreation
      acc.cacheRead += cacheRead
      acc.output += Number(u.output_tokens ?? event.output_tokens ?? event.outputTokens ?? 0)
      acc.cost += Number(event.total_cost_usd ?? event.cost_usd ?? event.costUsd ?? event.cost ?? 0)
    }
  }
}
