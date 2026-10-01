/**
 * 순수 유틸리티 함수들 (DB 의존 없음)
 * - 이벤트 포맷팅, 메타데이터 파싱
 */

/**
 * ive-meta 블록이 가리키는 작업 단계.
 *   - 'dev'     : 툴 직접개발(기본값). 이슈 본문에 쌓이는 종전 블록.
 *   - 'verify'  : 에이전트가 수행한 **검증**. 검토 코멘트에 붙인다.
 *   - 'confirm' : 에이전트가 수행한 **확인**. 확인 코멘트에 붙인다.
 * 검증/확인을 에이전트가 대신하면 그 토큰·시간이 어디에도 안 잡히던 것을 이 필드로 구분한다.
 */
export type IveMetaStage = 'dev' | 'verify' | 'confirm'

export type IveMetaSession = {
  model: string | null
  inputTokens: number
  outputTokens: number
  costUsd: number
  turns: number
  startedAt: string | null
  endedAt: string | null
  /** 이 블록이 어느 단계의 작업인지. 없으면 'dev'(하위호환). */
  stage: IveMetaStage
}

/**
 * ive-meta 블록 하나(<!-- ive-meta ... -->)의 본문을 IveMetaSession 으로 파싱한다.
 */
function parseIveMetaBlock(inner: string): IveMetaSession {
  const session: IveMetaSession = { model: null, inputTokens: 0, outputTokens: 0, costUsd: 0, turns: 0, startedAt: null, endedAt: null, stage: 'dev' };
  const lines = inner.split('\n');
  for (const line of lines) {
    const kv = line.match(/^\s*(\w+)\s*:\s*(.+)\s*$/);
    if (!kv) continue;
    const [, key, val] = kv;
    switch (key) {
      case 'model': session.model = val.trim(); break;
      case 'input_tokens': session.inputTokens = Number(val) || 0; break;
      case 'output_tokens': session.outputTokens = Number(val) || 0; break;
      case 'cost_usd': session.costUsd = Number(val) || 0; break;
      case 'turns': session.turns = Number(val) || 0; break;
      // invalid 한 timestamp 는 null 로 (placeholder 'REPLACE_END' 같은 raw 문자열이 DB 에 저장되어
      // 보고서 쿼리의 MAX(ended_at) 등으로 흘러 들어가 RangeError 를 일으키는 사고 회귀 방지).
      case 'started_at': { const d = new Date(val.trim()); session.startedAt = isNaN(d.getTime()) ? null : d.toISOString(); break; }
      case 'ended_at':   { const d = new Date(val.trim()); session.endedAt   = isNaN(d.getTime()) ? null : d.toISOString(); break; }
      // 모르는 값은 'dev' 로 (오타 때문에 개발분이 통계에서 사라지지 않게)
      case 'stage': { const v = val.trim().toLowerCase(); session.stage = (v === 'verify' || v === 'confirm') ? v : 'dev'; break; }
    }
  }
  return session;
}

/**
 * 이슈 본문에서 모든 <!-- ive-meta ... --> 블록을 파싱한다 (작업 세션마다 1블록).
 *
 * 다일(多日) 작업: 한 이슈를 여러 날에 걸쳐 처리하면 작업 세션마다 ive-meta 블록을
 * 하나씩 append 한다. 각 블록 = 그 세션의 실제 start/end·그 세션분(누적 아닌 델타) 토큰/비용.
 * 스캐너가 세션마다 execution 행을 만들어 보고서가 날짜(주)별로 통계를 분배한다.
 *
 * 블록이 1개뿐인(기존) 본문은 길이 1 배열로 그대로 동작 → 하위호환.
 */
export function parseIveMetaSessions(body: string): IveMetaSession[] {
  if (!body) return [];
  const sessions: IveMetaSession[] = [];
  for (const match of body.matchAll(/<!--\s*ive-meta\s([\s\S]*?)-->/g)) {
    sessions.push(parseIveMetaBlock(match[1]));
  }
  return sessions;
}

/**
 * ive-meta 블록의 `fixes:` 줄 — "이 작업이 고치는 이전 이슈" 번호들(같은 프로젝트).
 * 예: `fixes: #412, #418`. 블록이 여러 개면 모두 모은다. 중복·0 이하는 뺀다.
 * 보고서의 "완료 후 뒤집힘"(나중 작업이 이전 결과를 고침)을 판정하는 근거가 된다.
 */
export function parseIveMetaFixes(body: string): number[] {
  if (!body) return [];
  const out = new Set<number>();
  for (const match of body.matchAll(/<!--\s*ive-meta\s([\s\S]*?)-->/g)) {
    for (const line of match[1].split('\n')) {
      const m = line.match(/^\s*fixes\s*:\s*(.+)$/i);
      if (!m) continue;
      for (const n of m[1].matchAll(/#?(\d+)/g)) {
        const v = Number(n[1]);
        if (Number.isInteger(v) && v > 0) out.add(v);
      }
    }
  }
  return [...out];
}

/**
 * 이슈 본문에서 첫 <!-- ive-meta ... --> 블록을 파싱한다 (하위호환 단일 진입점).
 * 다세션 처리는 parseIveMetaSessions 를 사용한다.
 */
export function parseIveMeta(body: string): IveMetaSession {
  const sessions = parseIveMetaSessions(body);
  return sessions[0] ?? { model: null, inputTokens: 0, outputTokens: 0, costUsd: 0, turns: 0, startedAt: null, endedAt: null, stage: 'dev' };
}

/**
 * OpenCode run --format json 이벤트를 읽기 좋은 로그 텍스트로 변환
 */
export function formatOpenCodeEvent(event: any, showToolUsage: boolean = false): string | null {
  switch (event.type) {
    case 'text': {
      // OpenCode 1.x: content is in event.part.text
      const content = event.part?.text ?? event.content ?? event.text ?? '';
      if (!content.trim()) return null;
      return content;
    }
    case 'tool_use': {
      if (!showToolUsage) return null;
      // OpenCode 1.x: tool name is in event.part.tool, input in event.part.state.input
      const toolName = event.part?.tool ?? event.tool ?? event.name ?? '';
      const input = event.part?.state?.input ?? event.input ?? event.args ?? {};
      const summary = formatToolInput(toolName, input);
      return `\x1b[1;34m[Tool] ${toolName}\x1b[0m ${summary}`;
    }
    case 'step_finish': {
      // OpenCode 1.x: completion is step_finish with reason='stop'
      if (event.part?.reason !== 'stop') return null;
      const tokens = event.part?.tokens ?? {};
      const inputT = tokens.input ?? 0;
      const outputT = tokens.output ?? 0;
      const cost = event.part?.cost ?? 0;
      const meta: string[] = [];
      if (inputT || outputT) meta.push(`입력 ${Number(inputT).toLocaleString()} + 출력 ${Number(outputT).toLocaleString()} 토큰`);
      if (cost) meta.push(`비용 $${Number(cost).toFixed(4)}`);
      const metaStr = meta.length > 0 ? `\x1b[90m(${meta.join(' | ')})\x1b[0m ` : '';
      return `\x1b[1;32m[완료]\x1b[0m ${metaStr}`;
    }
    case 'session.status': {
      // Legacy format fallback
      const meta: string[] = [];
      const inputT = event.inputTokens ?? event.input_tokens ?? event.tokens?.input ?? 0;
      const outputT = event.outputTokens ?? event.output_tokens ?? event.tokens?.output ?? 0;
      const cost = event.cost ?? event.costUsd ?? event.cost_usd ?? 0;
      if (inputT || outputT) meta.push(`입력 ${Number(inputT).toLocaleString()} + 출력 ${Number(outputT).toLocaleString()} 토큰`);
      if (cost) meta.push(`비용 $${Number(cost).toFixed(4)}`);
      const metaStr = meta.length > 0 ? `\x1b[90m(${meta.join(' | ')})\x1b[0m ` : '';
      return `\x1b[1;32m[완료]\x1b[0m ${metaStr}`;
    }
    case 'session.error':
    case 'error': {
      // opencode 1.x JSON 오류 이벤트: {"type":"error","error":{"data":{"message":"..."},...}}
      // session.error도 동일 구조를 가질 수 있으므로 같은 추출 체인을 쓴다(객체 stringify 방지).
      const msg = event.error?.data?.message ?? event.error?.message ?? event.error ?? event.message ?? '알 수 없는 오류';
      return `\x1b[1;31m[오류]\x1b[0m ${typeof msg === 'string' ? msg : JSON.stringify(msg)}`;
    }
    default:
      return null;
  }
}

export function formatOpenCodeEventMarkdown(event: any): string | null {
  switch (event.type) {
    case 'text': {
      const content = event.part?.text ?? event.content ?? event.text ?? '';
      return content.trim() || null;
    }
    case 'tool_use': {
      const toolName = event.part?.tool ?? event.tool ?? event.name ?? '';
      const summary = formatToolInputMarkdown(toolName, event.part?.state?.input ?? event.input ?? event.args ?? {});
      return `> **🔧 ${toolName}** ${summary}`;
    }
    case 'step_finish': {
      if (event.part?.reason !== 'stop') return null;
      const tokens = event.part?.tokens ?? {};
      const inputT = tokens.input ?? 0;
      const outputT = tokens.output ?? 0;
      const cost = event.part?.cost ?? 0;
      const meta: string[] = [];
      if (cost) meta.push(`비용: $${Number(cost).toFixed(4)}`);
      if (inputT || outputT) meta.push(`토큰: ${(Number(inputT) + Number(outputT)).toLocaleString()}`);
      return `\n---\n**📊 실행 결과** ${meta.join(' | ')}`;
    }
    case 'session.status': {
      // Legacy format fallback
      const meta: string[] = [];
      const inputT = event.inputTokens ?? event.input_tokens ?? event.tokens?.input ?? 0;
      const outputT = event.outputTokens ?? event.output_tokens ?? event.tokens?.output ?? 0;
      const cost = event.cost ?? event.costUsd ?? event.cost_usd ?? 0;
      const model = event.model ?? event.modelId ?? event.model_id ?? '';
      if (model) meta.push(`모델: ${model}`);
      if (cost) meta.push(`비용: $${Number(cost).toFixed(4)}`);
      if (inputT || outputT) meta.push(`토큰: ${(Number(inputT) + Number(outputT)).toLocaleString()}`);
      return `\n---\n**📊 실행 결과** ${meta.join(' | ')}`;
    }
    case 'session.error':
    case 'error': {
      // session.error도 markdown 노트(이슈 코멘트)에 반드시 남긴다 — 과거엔 error만 처리해 누락됐음.
      const msg = event.error?.data?.message ?? event.error?.message ?? event.error ?? event.message ?? '알 수 없는 오류';
      return `> **⚠️ 오류** ${typeof msg === 'string' ? msg : JSON.stringify(msg)}`;
    }
    default:
      return null;
  }
}

/**
 * Codex CLI `exec --json` 이벤트(JSONL)를 읽기 좋은 로그 텍스트로 변환.
 *
 * 이벤트 형태:
 *   {type:"thread.started", thread_id}
 *   {type:"turn.started"}
 *   {type:"item.started"|"item.completed", item:{id, type, ...}}
 *     - item.type: "agent_message"({text}), "reasoning"({text}),
 *       "command_execution"({command, aggregated_output, exit_code, status}),
 *       "file_change"({changes:[{path, kind}], status})
 *   {type:"turn.completed", usage:{input_tokens, cached_input_tokens, output_tokens, reasoning_output_tokens}}
 *   {type:"turn.failed"|"error", ...}
 */
export function formatCodexEvent(event: any, showToolUsage: boolean = false): string | null {
  switch (event.type) {
    case 'item.started':
    case 'item.completed': {
      const item = event.item ?? {};
      if (item.type === 'agent_message') {
        if (event.type !== 'item.completed') return null;
        return (item.text ?? '').trim() || null;
      }
      if (item.type === 'reasoning') {
        if (event.type !== 'item.completed') return null;
        const text = (item.text ?? item.summary ?? '').trim();
        return text ? `\x1b[90m${text}\x1b[0m` : null;
      }
      if (item.type === 'command_execution') {
        if (!showToolUsage || event.type !== 'item.started') return null;
        const cmd = String(item.command ?? '').substring(0, 120);
        return cmd ? `\x1b[1;34m[Tool] Bash\x1b[0m \x1b[33m$ ${cmd}\x1b[0m` : null;
      }
      if (item.type === 'file_change') {
        if (!showToolUsage || event.type !== 'item.completed') return null;
        const files = (item.changes ?? []).map((c: any) => `${c.kind ?? ''} ${c.path ?? ''}`.trim()).filter(Boolean).join(', ');
        return files ? `\x1b[1;34m[Tool] Edit\x1b[0m ${files}` : null;
      }
      return null;
    }
    case 'turn.completed': {
      const u = event.usage ?? {};
      const inputT = Number(u.input_tokens ?? 0);
      const outputT = Number(u.output_tokens ?? 0) + Number(u.reasoning_output_tokens ?? 0);
      const cachedT = Number(u.cached_input_tokens ?? 0);
      const meta: string[] = [];
      if (inputT || outputT) {
        const parts = [`입력 ${inputT.toLocaleString()}`];
        if (cachedT) parts.push(`캐시 ${cachedT.toLocaleString()}`);
        parts.push(`출력 ${outputT.toLocaleString()} 토큰`);
        meta.push(parts.join(' + '));
      }
      const metaStr = meta.length > 0 ? `\x1b[90m(${meta.join(' | ')})\x1b[0m ` : '';
      return `\x1b[1;32m[완료]\x1b[0m ${metaStr}`;
    }
    case 'turn.failed':
    case 'error': {
      const msg = event.error?.message ?? event.error ?? event.message ?? '알 수 없는 오류';
      return `\x1b[1;31m[오류]\x1b[0m ${msg}`;
    }
    default:
      return null;
  }
}

export function formatCodexEventMarkdown(event: any): string | null {
  if (event.type === 'item.completed') {
    const item = event.item ?? {};
    if (item.type === 'agent_message') return (item.text ?? '').trim() || null;
    if (item.type === 'command_execution') {
      const cmd = String(item.command ?? '').substring(0, 100);
      return cmd ? `> **🔧 Bash** \`$ ${cmd}\`` : null;
    }
    if (item.type === 'file_change') {
      const files = (item.changes ?? []).map((c: any) => c.path).filter(Boolean).join(', ');
      return files ? `> **🔧 Edit** \`${files}\`` : null;
    }
  }
  if (event.type === 'turn.completed') {
    const u = event.usage ?? {};
    const inputT = Number(u.input_tokens ?? 0);
    const outputT = Number(u.output_tokens ?? 0) + Number(u.reasoning_output_tokens ?? 0);
    const info: string[] = [];
    if (inputT || outputT) info.push(`토큰: ${(inputT + outputT).toLocaleString()}`);
    return `\n---\n**📊 실행 결과** ${info.join(' | ')}`;
  }
  return null;
}

/**
 * agy(Antigravity CLI) stream-json 이벤트를 읽기 좋은 로그 텍스트(ANSI)로 변환
 * 이벤트: init / step_update(step_type: user_input|agent_response|tool|checkpoint) / result
 *   - agent_response: state ACTIVE 는 부분 텍스트(text_delta), DONE 은 마지막 조각 + usage
 *   - tool: tool_name + tool_info{parameters, output}
 *   - result: status / response / num_turns / usage
 */
export function formatAgyEvent(event: any, showToolUsage: boolean = false): string | null {
  if (event.event === 'step_update') {
    const su = event.step_update ?? {};
    if (su.step_type === 'agent_response') {
      return (su.text_delta ?? '').toString() || null;
    }
    if (su.step_type === 'tool') {
      if (!showToolUsage) return null;
      // ACTIVE/DONE 두 번 오므로 DONE 에서만 한 줄 남긴다.
      if (su.state !== 'DONE') return null;
      const name = su.tool_name ?? su.tool_info?.name ?? '';
      if (!name) return null;
      const p = su.tool_info?.parameters ?? {};
      const detail = p.CommandLine ?? p.command ?? p.FilePath ?? p.file_path ?? p.path ?? p.query ?? '';
      const detailStr = detail ? ` \x1b[33m${String(detail).substring(0, 120)}\x1b[0m` : '';
      return `\x1b[1;34m[Tool] ${name}\x1b[0m${detailStr}`;
    }
    return null;
  }
  if (event.event === 'result') {
    const r = event.result ?? {};
    const u = r.usage ?? {};
    const inputT = Number(u.input_tokens ?? 0);
    const outputT = Number(u.output_tokens ?? 0);
    const cachedT = Number(u.cache_read_tokens ?? 0);
    const ok = String(r.status ?? '').toUpperCase() === 'SUCCESS';
    if (!ok) {
      const msg = r.error ?? r.status ?? '알 수 없는 오류';
      return `\x1b[1;31m[오류]\x1b[0m ${msg}`;
    }
    const meta: string[] = [];
    if (inputT || outputT) {
      const parts = [`입력 ${inputT.toLocaleString()}`];
      if (cachedT) parts.push(`캐시 ${cachedT.toLocaleString()}`);
      parts.push(`출력 ${outputT.toLocaleString()} 토큰`);
      meta.push(parts.join(' + '));
    }
    const metaStr = meta.length > 0 ? `\x1b[90m(${meta.join(' | ')})\x1b[0m ` : '';
    return `\x1b[1;32m[완료]\x1b[0m ${metaStr}`;
  }
  return null;
}

export function formatAgyEventMarkdown(event: any): string | null {
  if (event.event === 'step_update') {
    const su = event.step_update ?? {};
    if (su.step_type === 'agent_response') {
      return (su.text_delta ?? '').toString() || null;
    }
    if (su.step_type === 'tool' && su.state === 'DONE') {
      const name = su.tool_name ?? su.tool_info?.name ?? '';
      if (!name) return null;
      const p = su.tool_info?.parameters ?? {};
      const detail = p.CommandLine ?? p.command ?? p.FilePath ?? p.file_path ?? p.path ?? p.query ?? '';
      return detail ? `> **🔧 ${name}** \`${String(detail).substring(0, 100)}\`` : `> **🔧 ${name}**`;
    }
    return null;
  }
  if (event.event === 'result') {
    const u = event.result?.usage ?? {};
    const inputT = Number(u.input_tokens ?? 0);
    const outputT = Number(u.output_tokens ?? 0);
    const info: string[] = [];
    if (inputT || outputT) info.push(`토큰: ${(inputT + outputT).toLocaleString()}`);
    return `\n---\n**📊 실행 결과** ${info.join(' | ')}`;
  }
  return null;
}

/**
 * Claude CLI stream-json 이벤트를 읽기 좋은 로그 텍스트로 변환
 */
export function extractMeta(event: any, usage?: any): string | null {
  const meta: string[] = [];
  const u = usage || {};
  const baseInput = Number(u.input_tokens ?? u.inputTokens ?? event.input_tokens ?? 0);
  const cacheCreate = Number(u.cache_creation_input_tokens ?? 0);
  const cacheRead = Number(u.cache_read_input_tokens ?? 0);
  const inputT = baseInput + cacheCreate + cacheRead;
  const outputT = u.output_tokens ?? u.outputTokens ?? event.output_tokens;
  if (inputT || outputT) {
    const parts = [`입력 ${Number(inputT||0).toLocaleString()}`];
    if (cacheRead > 0) parts.push(`캐시읽기 ${cacheRead.toLocaleString()}`);
    if (cacheCreate > 0) parts.push(`캐시쓰기 ${cacheCreate.toLocaleString()}`);
    parts.push(`출력 ${Number(outputT||0).toLocaleString()} 토큰`);
    meta.push(parts.join(' + '));
  }
  const cost = event.total_cost_usd ?? event.cost_usd ?? event.costUsd ?? event.cost;
  if (cost) meta.push(`비용 $${Number(cost).toFixed(4)}`);
  const dur = event.duration_ms ?? event.durationMs ?? event.duration_api_ms;
  if (dur) meta.push(`응답 ${(Number(dur) / 1000).toFixed(1)}초`);
  const turns = event.num_turns ?? event.numTurns;
  if (turns) meta.push(`${turns}턴`);
  return meta.length > 0 ? `(${meta.join(' | ')})` : null;
}

export function formatStreamEvent(event: any, showToolUsage: boolean = false): string | null {
  switch (event.type) {
    case 'assistant': {
      const parts = event.message?.content || [];
      const lines: string[] = [];
      for (const part of parts) {
        if (part.type === 'text' && part.text?.trim()) {
          lines.push(part.text);
        } else if (part.type === 'tool_use' && showToolUsage) {
          const input = part.input || {};
          const summary = formatToolInput(part.name, input);
          lines.push(`\x1b[1;34m[Tool] ${part.name}\x1b[0m ${summary}`);
        }
      }
      if (lines.length === 0) return null;
      const usage = event.message?.usage || event.usage;
      const meta = extractMeta(event, usage);
      if (meta) lines.push(`\x1b[90m${meta}\x1b[0m`);
      return lines.join('\n');
    }
    case 'content_block_delta': {
      const delta = event.delta;
      if (delta?.type === 'text_delta' && delta.text) {
        return delta.text;
      }
      return null;
    }
    case 'result': {
      const meta = extractMeta(event, event.usage) || '';
      const metaStr = meta ? `\x1b[90m${meta}\x1b[0m ` : '';
      return `\x1b[1;32m[완료]\x1b[0m ${metaStr}`;
    }
    case 'system': {
      // system 이벤트 중 의미 있는 메시지만 출력 (JSON 덤프 방지)
      if (event.subtype === 'init' || event.subtype === 'session') {
        const model = event.model ?? event.modelId ?? '';
        return `\x1b[1;36m[시작]\x1b[0m 세션 초기화${model ? ` \x1b[90m(${model})\x1b[0m` : ''}`;
      }
      // task_notification 등 내부 이벤트는 메타만 간략히
      if (event.subtype === 'task_notification') {
        const summary = event.summary || '';
        const tokens = event.usage?.total_tokens ? ` (${event.usage.total_tokens.toLocaleString()} tokens)` : '';
        return summary ? `\x1b[90m[내부작업] ${summary}${tokens}\x1b[0m` : null;
      }
      // 문자열 메시지가 있으면 표시, 아니면 무시
      if (typeof event.message === 'string' && event.message.trim()) {
        return `\x1b[1;36m[System]\x1b[0m ${event.message}`;
      }
      return null; // 나머지 system 이벤트는 무시
    }
    default:
      return null;
  }
}

/**
 * stream-json 이벤트를 GitLab 이슈 노트용 마크다운으로 변환
 */
export function formatStreamEventMarkdown(event: any): string | null {
  switch (event.type) {
    case 'assistant': {
      const parts = event.message?.content || [];
      const lines: string[] = [];
      for (const part of parts) {
        if (part.type === 'text' && part.text?.trim()) {
          lines.push(part.text);
        } else if (part.type === 'tool_use') {
          const summary = formatToolInputMarkdown(part.name, part.input || {});
          lines.push(`> **🔧 ${part.name}** ${summary}`);
        }
      }
      return lines.length > 0 ? lines.join('\n') : null;
    }
    case 'result': {
      const info: string[] = [];
      const cost = event.cost_usd ?? event.costUsd ?? event.cost;
      const duration = event.duration_ms ?? event.durationMs ?? event.duration_api_ms;
      const tokens = event.total_tokens ?? event.totalTokens ?? event.usage?.total_tokens;
      const inputTokens = event.input_tokens ?? event.inputTokens ?? event.usage?.input_tokens;
      const outputTokens = event.output_tokens ?? event.outputTokens ?? event.usage?.output_tokens;
      const turns = event.num_turns ?? event.numTurns;
      const model = event.model ?? event.modelId ?? event.model_id ?? '';
      if (model) info.push(`모델: ${model}`);
      if (cost) info.push(`비용: $${Number(cost).toFixed(4)}`);
      if (duration) info.push(`소요: ${(Number(duration) / 1000).toFixed(1)}s`);
      if (tokens) info.push(`토큰: ${Number(tokens).toLocaleString()}`);
      else if (inputTokens || outputTokens) info.push(`토큰: ${(Number(inputTokens||0) + Number(outputTokens||0)).toLocaleString()}`);
      if (turns) info.push(`턴: ${turns}`);
      return `\n---\n**📊 실행 결과** ${info.join(' | ')}`;
    }
    default:
      return null;
  }
}

export function formatToolInputMarkdown(toolName: string, input: any): string {
  switch (toolName) {
    case 'Read': return `\`${input.file_path || ''}\``;
    case 'Edit': return `\`${input.file_path || ''}\``;
    case 'Write': return `\`${input.file_path || ''}\``;
    case 'Bash': return input.command ? `\`$ ${input.command.substring(0, 100)}\`` : '';
    case 'Glob': return `\`${input.pattern || ''}\``;
    case 'Grep': return `\`"${input.pattern || ''}"\``;
    case 'ToolSearch': return input.query ? `\`${input.query}\`` : '';
    case 'WebSearch': return `\`${input.query || input.search_query || ''}\``;
    case 'WebFetch': return `\`${input.url || ''}\``;
    case 'Agent': return input.description || input.prompt?.substring(0, 80) || '';
    default: {
      const vals = Object.values(input).filter(v => typeof v === 'string').join(' ').substring(0, 80);
      return vals ? `\`${vals}\`` : '';
    }
  }
}

export function formatToolInput(toolName: string, input: any): string {
  switch (toolName) {
    case 'Read':
      return input.file_path || '';
    case 'Edit':
      return `${input.file_path || ''} (edit)`;
    case 'Write':
      return `${input.file_path || ''} (write)`;
    case 'Bash':
      return input.command ? `\x1b[33m$ ${input.command.substring(0, 120)}\x1b[0m` : '';
    case 'Glob':
      return input.pattern || '';
    case 'Grep':
      return `"${input.pattern || ''}" ${input.path || ''}`;
    case 'ToolSearch':
      return input.query || '';
    case 'WebSearch':
      return input.query || input.search_query || '';
    case 'WebFetch':
      return input.url || '';
    case 'Agent':
      return input.description || input.prompt?.substring(0, 80) || '';
    default:
      return Object.values(input).filter(v => typeof v === 'string').join(' ').substring(0, 80) || '';
  }
}
