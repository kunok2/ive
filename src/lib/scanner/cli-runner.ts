/**
 * CLI 프로세스 실행: 이벤트 파싱, 토큰 집계.
 * (CLI 경로 해석·명령/인자 조립은 ../cli-invocation 으로 통합)
 */
import { spawn } from "child_process";
import { Project, Agent } from "@/types";
import { getSystemSetting, updateExecutionPid, updateExecutionTokens } from "../db";
import { setToolActivity, setThinking, clearActivity } from "../tool-activity";
import { calcCostFromDb } from "../token-pricing";
import { buildCliInvocation, resolveCliPath } from "../cli-invocation";
import {
  formatOpenCodeEvent,
  formatOpenCodeEventMarkdown,
  formatCodexEvent,
  formatCodexEventMarkdown,
  formatAgyEvent,
  formatAgyEventMarkdown,
  formatStreamEvent,
  formatStreamEventMarkdown,
  formatToolInput,
} from "./formatters";
import { stripBenignOpencodeStderr, stripBenignAgyStderr, detectRateLimit } from "./cli-noise";

// resolveCliPath는 cli-invocation으로 이동. 기존 import 경로(execute.ts) 호환을 위해 re-export.
export { resolveCliPath };

export interface CliRunResult {
  durationSeconds: number;
  conversationParts: string[];
}

/**
 * CLI 프로세스를 실행하고 이벤트를 파싱합니다.
 */
export async function runCliProcess(
  executionId: string,
  project: Project,
  agent: Agent,
  prompt: string,
  workspacePath: string,
  token: string,
  resolvedCliPath: string,
  logStream: { write(data: string): void; end(): void },
  log: (msg: string, type?: 'info' | 'error' | 'warn' | 'system') => void,
  imagePaths?: string[],
): Promise<CliRunResult> {
  const isOpenCode = agent.cliName === 'opencode';
  const isCodex = agent.cliName === 'codex';
  const isAgy = agent.cliName === 'agy';
  const systemCliModel = agent.modelName || getSystemSetting(`cli.${agent.cliName}.model`);
  const conversationParts: string[] = [];
  const startTime = Date.now();

  await new Promise<void>((resolve, reject) => {
    // CLI별 명령/인자/환경 조립은 단일 모듈(cli-invocation)에 위임한다.
    // 스캐너는 resume 안 하고(maxTurns는 에이전트 설정), 모델은 systemCliModel을 그대로 전달.
    // (opencode는 macOS 호환을 위해 sh -c + stdin 으로 실행됨 — cli-invocation 참고)
    const { mainCmd, args, env: spawnEnv, stdinInput } = buildCliInvocation({
      cliName: agent.cliName,
      resolvedCliPath,
      prompt,
      token,
      workspacePath,
      maxTurns: agent.maxTurns || 200,
      model: systemCliModel || null,
      cliSessionId: null,
      imagePaths,
    });

    // 보안: 호출 명령어(플래그·인자 포함)는 상세보기 로그에 남기지 않는다.
    if (systemCliModel) log(`MODEL: ${systemCliModel}`, 'system');
    log(`CWD: ${workspacePath}`, 'system');

    const child = spawn(mainCmd, args, {
      cwd: workspacePath,
      stdio: [stdinInput !== undefined ? 'pipe' : 'ignore', 'pipe', 'pipe'],
      env: spawnEnv as NodeJS.ProcessEnv,
      detached: true,
    });

    // 프롬프트를 stdin으로 전달하는 CLI(opencode)는 여기서 써주고 닫는다.
    if (stdinInput !== undefined && child.stdin) {
      try { child.stdin.write(stdinInput); child.stdin.end(); } catch { /* ignore */ }
    }

    // PID를 DB에 저장 (강제 종료 및 좀비 프로세스 정리용)
    if (child.pid) {
      updateExecutionPid(executionId, child.pid);
      log(`PID: ${child.pid} (PGID: -${child.pid})`, 'system');
    }

    // 유휴 워치독: stdout/stderr 무출력이 일정 시간 지속되면 hang으로 간주하고 강제 종료.
    // 정상 에이전트는 도구/텍스트 이벤트를 계속 흘리므로 오탐 위험이 낮다.
    // (특히 opencode가 종료 이벤트 없이 멈춰 실행이 'running'에 영구히 박히는 것을 방지)
    const idleTimeoutSec = Number(getSystemSetting('cli.idleTimeoutSec')) || 900;
    let killedByWatchdog = false;
    let idleTimer: NodeJS.Timeout | null = null;
    const resetIdleTimer = () => {
      if (idleTimer) clearTimeout(idleTimer);
      idleTimer = setTimeout(() => {
        killedByWatchdog = true;
        log(`CLI 무응답 ${Math.floor(idleTimeoutSec / 60)}분 경과 — hang으로 판단하여 프로세스를 강제 종료합니다.`, 'error');
        try {
          if (child.pid) process.kill(-child.pid, 'SIGKILL');
        } catch (e: any) {
          if (e.code !== 'ESRCH') log(`워치독 종료 실패: ${e.message}`, 'warn');
        }
      }, idleTimeoutSec * 1000);
    };
    resetIdleTimer();

    // 토큰/비용 누적 변수
    let stdoutBuffer = '';
    let stderrBuffer = '';
    const STDERR_BUFFER_MAX = 4000;
    let totalInputTokens = 0;
    let totalOutputTokens = 0;
    let totalCacheReadTokens = 0;
    let totalCacheCreationTokens = 0;
    let totalCostUsd = 0;
    let totalTurns = 0;
    let assistantTurnCount = 0;
    let detectedModel = '';
    // opencode 오류 이벤트 메시지(있으면 종료 시 표면화)
    let ocErrorMsg = '';
    // 사용량 한도(rate limit/quota) 의심 줄. 실패 종료 시 원인으로 표면화한다.
    let rateLimitHint = '';
    // agy: agent_response 가 text_delta 로 여러 번 쪼개져 오므로, 연속 구간을 1턴으로 묶기 위한 플래그
    let prevAgyAssistant = false;

    const processEvent = (event: any) => {
      // 모델명 캡처
      const eventModel = event.model ?? event.modelId ?? event.model_id
        ?? event.message?.model ?? event.session?.model ?? '';
      if (eventModel && !detectedModel) detectedModel = eventModel;

      if (isOpenCode) {
        const formatted = formatOpenCodeEvent(event, project.showToolUsage);
        if (formatted) logStream.write(formatted + '\n');
        const md = formatOpenCodeEventMarkdown(event);
        if (md) conversationParts.push(md);
        // 도구 활동 추적
        if (event.type === 'tool_use') {
          const toolName = event.part?.tool ?? event.tool ?? event.name ?? '';
          if (toolName) {
            const detail = formatToolInput(toolName, event.part?.state?.input ?? event.input ?? event.args ?? {});
            setToolActivity(executionId, agent.id, toolName, detail);
          }
        } else if (event.type === 'text') {
          setThinking(executionId, agent.id);
          assistantTurnCount++;
        } else if (event.type === 'step_start') {
          setThinking(executionId, agent.id);
        }
        // 토큰/비용 누적
        // opencode 토큰 스키마(실측): part.tokens = {total, input, output, reasoning, cache:{read, write}}
        //   total = input + output + reasoning + cache.read + cache.write
        //   input/output은 캐시·추론을 제외한 순수치이므로, claude/codex와 동일하게
        //   캐시는 총 입력에 합산하고 reasoning은 출력에 합산해 집계 일관성을 맞춘다.
        if (event.type === 'step_finish') {
          const tokens = event.part?.tokens ?? {};
          const cacheRead = Number(tokens.cache?.read ?? 0);
          const cacheWrite = Number(tokens.cache?.write ?? 0);
          const iT = Number(tokens.input ?? 0);
          const oT = Number(tokens.output ?? 0) + Number(tokens.reasoning ?? 0);
          const cost = Number(event.part?.cost ?? 0);
          totalInputTokens += iT + cacheRead + cacheWrite;
          totalCacheReadTokens += cacheRead;
          totalCacheCreationTokens += cacheWrite;
          totalOutputTokens += oT;
          totalCostUsd += cost;
          if (event.part?.reason === 'stop') totalTurns = assistantTurnCount;
        }
        // opencode error/session.error: 종료 코드와 무관하게 오류를 표면화한다.
        // (opencode는 오류 시에도 exit 0으로 끝나 성공으로 오인될 수 있음)
        if (event.type === 'error' || event.type === 'session.error') {
          const emsg = event.error?.data?.message ?? event.error?.message ?? event.error ?? event.message ?? '알 수 없는 오류';
          const emsgStr = typeof emsg === 'string' ? emsg : JSON.stringify(emsg);
          if (!ocErrorMsg) ocErrorMsg = emsgStr;
          const rl = detectRateLimit(emsgStr);
          if (rl) rateLimitHint = rl;
        }
      } else if (isCodex) {
        // Codex exec --json 이벤트 처리
        const formatted = formatCodexEvent(event, project.showToolUsage);
        if (formatted) logStream.write(formatted + '\n');
        const md = formatCodexEventMarkdown(event);
        if (md) conversationParts.push(md);
        // 도구/사고 활동 추적
        if (event.type === 'item.started') {
          const item = event.item ?? {};
          if (item.type === 'command_execution') {
            const cmd = String(item.command ?? '').substring(0, 120);
            setToolActivity(executionId, agent.id, 'Bash', cmd ? `$ ${cmd}` : '');
          } else if (item.type === 'file_change') {
            const files = (item.changes ?? []).map((c: any) => c.path).filter(Boolean).join(', ');
            setToolActivity(executionId, agent.id, 'Edit', files);
          }
        } else if (event.type === 'item.completed') {
          const item = event.item ?? {};
          if (item.type === 'agent_message') {
            setThinking(executionId, agent.id);
            assistantTurnCount++;
          } else if (item.type === 'reasoning') {
            setThinking(executionId, agent.id);
          }
        }
        // 토큰 누적 (codex는 turn.completed에서 usage 제공, 비용 필드는 없음 → DB 단가로 환산)
        if (event.type === 'turn.completed') {
          const u = event.usage ?? {};
          totalInputTokens += Number(u.input_tokens ?? 0);
          totalCacheReadTokens += Number(u.cached_input_tokens ?? 0);
          totalOutputTokens += Number(u.output_tokens ?? 0) + Number(u.reasoning_output_tokens ?? 0);
          totalTurns += 1;
        }
      } else if (isAgy) {
        // agy(Antigravity CLI) stream-json 이벤트: init / step_update / result
        const formatted = formatAgyEvent(event, project.showToolUsage);
        if (formatted) logStream.write(formatted + '\n');
        const md = formatAgyEventMarkdown(event);
        if (md) conversationParts.push(md);
        const su = event.event === 'step_update' ? (event.step_update ?? {}) : null;
        // 도구/사고 활동 추적
        if (su?.step_type === 'tool') {
          prevAgyAssistant = false;
          const toolName = su.tool_name ?? su.tool_info?.name ?? '';
          if (toolName) {
            const detail = formatToolInput(toolName, su.tool_info?.parameters ?? {});
            setToolActivity(executionId, agent.id, toolName, detail);
          }
        } else if (su?.step_type === 'agent_response') {
          setThinking(executionId, agent.id);
          if (!prevAgyAssistant) assistantTurnCount++; // 연속 text_delta는 1턴으로 묶음
          prevAgyAssistant = true;
        } else if (su?.step_type === 'user_input' || su?.step_type === 'checkpoint') {
          prevAgyAssistant = false;
        }
        // 토큰 누적 + 한도 초과 감지 (result.usage 는 실행 전체 누계, 비용 필드는 없어 DB 단가로 환산)
        if (event.event === 'result') {
          const r = event.result ?? {};
          if (String(r.status ?? '').toUpperCase() !== 'SUCCESS') {
            const rl = detectRateLimit(`${r.status ?? ''} ${r.error ?? ''}`);
            if (rl) rateLimitHint = rl;
          }
          const u = r.usage ?? {};
          // input_tokens 는 캐시 포함 총 입력, output_tokens 는 thinking 포함(total = input + output)
          totalInputTokens += Number(u.input_tokens ?? 0);
          totalCacheReadTokens += Number(u.cache_read_tokens ?? 0);
          totalOutputTokens += Number(u.output_tokens ?? 0);
          const nt = Number(r.num_turns ?? 0);
          if (nt > 0) totalTurns += nt;
        }
      } else {
        // Claude Code 이벤트 처리
        const formatted = formatStreamEvent(event, project.showToolUsage);
        if (formatted) logStream.write(formatted + '\n');
        const md = formatStreamEventMarkdown(event);
        if (md) conversationParts.push(md);
        // 도구 활동 추적
        if (event.type === 'assistant') {
          const parts = event.message?.content || [];
          let foundTool = false;
          for (const part of parts) {
            if (part.type === 'tool_use' && part.name) {
              const detail = formatToolInput(part.name, part.input || '');
              setToolActivity(executionId, agent.id, part.name, detail);
              foundTool = true;
            }
          }
          if (!foundTool) setThinking(executionId, agent.id);
          assistantTurnCount++;
        }
        // 토큰/비용/턴 누적
        if (event.type === 'result') {
          const u = event.usage ?? {};
          const baseInput = Number(u.input_tokens ?? 0);
          const cacheCreation = Number(u.cache_creation_input_tokens ?? 0);
          const cacheRead = Number(u.cache_read_input_tokens ?? 0);
          const oT = u.output_tokens ?? event.output_tokens ?? event.outputTokens ?? 0;
          const cost = event.total_cost_usd ?? event.cost_usd ?? event.costUsd ?? event.cost ?? 0;
          const turns = event.num_turns ?? event.numTurns ?? 0;
          totalInputTokens += baseInput + cacheCreation + cacheRead;
          totalCacheCreationTokens += cacheCreation;
          totalCacheReadTokens += cacheRead;
          totalOutputTokens += Number(oT);
          totalCostUsd += Number(cost);
          totalTurns = Math.max(totalTurns, Number(turns));
        }
      }
    };

    child.stdout?.on('data', (data: Buffer) => {
      resetIdleTimer();
      stdoutBuffer += data.toString();
      const lines = stdoutBuffer.split('\n');
      stdoutBuffer = lines.pop() || '';
      for (const line of lines) {
        if (!line.trim()) continue;
        try {
          const event = JSON.parse(line);
          processEvent(event);
        } catch {
          logStream.write(line + '\n');
        }
      }
    });
    child.stderr?.on('data', (data: Buffer) => {
      resetIdleTimer();
      const raw = data.toString();
      // CLI별 양성 배너는 경고 로그/실패진단 양쪽에서 제외한다.
      // (opencode: DB 마이그레이션 / agy: 배너·업데이트 안내)
      const cleaned = isOpenCode
        ? stripBenignOpencodeStderr(raw)
        : isAgy
          ? stripBenignAgyStderr(raw)
          : raw;
      stderrBuffer += cleaned;
      if (stderrBuffer.length > STDERR_BUFFER_MAX) {
        stderrBuffer = stderrBuffer.slice(-STDERR_BUFFER_MAX);
      }
      // 한도 초과 의심 줄을 기억(가장 최근 것). 실패 시 원인으로 표면화한다.
      const rl = detectRateLimit(cleaned);
      if (rl) rateLimitHint = rl;
      const text = cleaned.trim();
      if (text) log(text, 'warn');
    });

    child.on('close', (code, signal) => {
      if (idleTimer) { clearTimeout(idleTimer); idleTimer = null; }
      // 버퍼에 남은 데이터 처리
      if (stdoutBuffer.trim()) {
        try {
          const event = JSON.parse(stdoutBuffer);
          processEvent(event);
        } catch {
          logStream.write(stdoutBuffer + '\n');
        }
      }
      clearActivity(executionId);
      // opencode가 오류 이벤트를 냈다면 exit 0이라도 실패로 처리한다.
      if (ocErrorMsg) {
        log(`OpenCode 오류: ${ocErrorMsg}`, 'error');
        conversationParts.push(`> **⚠️ 오류** ${ocErrorMsg}`);
      }
      log(`CLI 종료: code=${code}, signal=${signal}`, code === 0 ? 'system' : 'error');
      // 토큰/비용/턴 DB 저장
      const finalTurns = totalTurns > 0 ? totalTurns : assistantTurnCount;
      const finalModel = detectedModel || systemCliModel || undefined;
      if (totalInputTokens || totalOutputTokens || totalCostUsd || finalTurns) {
        const finalCost = totalCostUsd > 0
          ? totalCostUsd
          : calcCostFromDb(totalInputTokens, totalOutputTokens, finalModel);
        updateExecutionTokens(executionId, totalInputTokens, totalOutputTokens, finalCost, finalTurns, finalModel, totalCacheReadTokens, totalCacheCreationTokens);
      } else if (finalModel) {
        updateExecutionTokens(executionId, 0, 0, 0, 0, finalModel, 0, 0);
      }
      if (code === 0 && !ocErrorMsg) {
        resolve();
        return;
      }
      const detail: string[] = [];
      // 사용량 한도(rate limit/quota)로 추정되면 원인을 최상단에 명시한다.
      // (CLI 종료코드만으로는 "왜 실패했는지" 알기 어려워 사용자 혼란 → #463 후속)
      if (rateLimitHint) {
        const rlMsg = `🚦 사용량/속도 제한(rate limit·quota) 도달로 추정됩니다 — ${agent.cliName}: ${rateLimitHint}`;
        log(rlMsg, 'error');
        detail.push(rlMsg);
      }
      if (ocErrorMsg) {
        detail.push(`OpenCode 오류: ${ocErrorMsg}`);
      }
      detail.push(`Agent CLI exited with code ${code}${signal ? ` (signal: ${signal})` : ''}`);
      if (killedByWatchdog) {
        detail.push(`힌트: ${Math.floor(idleTimeoutSec / 60)}분간 무응답(hang)으로 워치독이 강제 종료했습니다. CLI 인증 상태나 인터랙티브 프롬프트 대기 여부를 확인하세요.`);
      } else if (signal === 'SIGKILL' || code === 137) {
        detail.push('힌트: 메모리 부족(OOM) 또는 강제 종료로 추정됩니다.');
      } else if (signal === 'SIGTERM' || code === 143) {
        detail.push('힌트: 외부 신호로 프로세스가 종료되었습니다 (timeout/kill).');
      } else if (assistantTurnCount === 0) {
        detail.push('힌트: 응답을 시작하기 전 종료 — CLI 인증/모델 미설정/인수 오류 가능성.');
      }
      const stderrTail = stderrBuffer.trim();
      if (stderrTail) {
        const tail = stderrTail.length > 800 ? `…${stderrTail.slice(-800)}` : stderrTail;
        detail.push(`stderr:\n${tail}`);
      }
      reject(new Error(detail.join('\n')));
    });
    child.on('error', (err) => {
      if (idleTimer) { clearTimeout(idleTimer); idleTimer = null; }
      log(`CLI 실행 실패: ${err.message}`, 'error');
      reject(err);
    });
  });

  const durationSeconds = Math.floor((Date.now() - startTime) / 1000);
  return { durationSeconds, conversationParts };
}
