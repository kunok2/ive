/**
 * CLI 프로세스 실행: node-pty/spawn, 이벤트 파싱, 토큰 집계
 */
import fs from "fs";
import path from "path";
import { promisify } from "util";
import { spawn } from "child_process";
import { Project, Agent } from "@/types";
import { getSystemSetting, updateExecutionPid, updateExecutionTokens } from "../db";
import { setToolActivity, setThinking, clearActivity } from "../tool-activity";
import { calcCostFromDb } from "../token-pricing";
import {
  formatOpenCodeEvent,
  formatOpenCodeEventMarkdown,
  formatStreamEvent,
  formatStreamEventMarkdown,
  formatToolInput,
} from "./formatters";

const execFile = promisify(require('child_process').execFile);

export interface CliRunResult {
  durationSeconds: number;
  conversationParts: string[];
}

/**
 * CLI 경로를 검증/해석합니다. 존재하지 않으면 which로 자동 탐색합니다.
 */
export async function resolveCliPath(
  agent: Agent,
  log: (msg: string, type?: 'info' | 'error' | 'warn' | 'system') => void,
): Promise<string> {
  const systemCliPath = getSystemSetting(`cli.${agent.cliName}.path`);
  let resolvedCliPath = systemCliPath || agent.cliPath;
  const mainBin = resolvedCliPath.split(' ')[0];
  if (!fs.existsSync(mainBin)) {
    try {
      const { stdout } = await execFile('which', [path.basename(mainBin)]);
      const detected = stdout.trim();
      if (detected) {
        log(`CLI 경로 "${mainBin}" 없음 → "${detected}" 감지`, 'system');
        resolvedCliPath = resolvedCliPath.replace(mainBin, detected);
      }
    } catch { /* which 실패 시 원래 경로 유지 */ }
  }
  return resolvedCliPath;
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
): Promise<CliRunResult> {
  const isOpenCode = agent.cliName === 'opencode';
  const systemCliModel = agent.modelName || getSystemSetting(`cli.${agent.cliName}.model`);
  const conversationParts: string[] = [];
  const startTime = Date.now();

  await new Promise<void>((resolve, reject) => {
    const cliParts = resolvedCliPath.split(' ');
    const mainCmd = cliParts[0];

    let args: string[];
    let spawnEnv: Record<string, string | undefined>;

    // MCP 설정 로드 (시스템 전체 설정)
    const mcpConfigRaw = getSystemSetting('mcp.config');
    let mcpServers: Record<string, any> | null = null;
    if (mcpConfigRaw) {
      try { mcpServers = JSON.parse(mcpConfigRaw); } catch { /* 잘못된 JSON 무시 */ }
    }

    if (isOpenCode) {
      // opencode run --format json "prompt"
      const opencodeConfig: any = {
        agent: { coder: { steps: agent.maxTurns || 200, permission: { '*': 'allow' }, ...(systemCliModel ? { model: systemCliModel } : {}) } },
        compaction: { auto: true },
      };
      if (mcpServers) opencodeConfig.mcp = mcpServers;

      args = [
        ...cliParts.slice(1),
        'run',
        '--format', 'json',
        prompt,
      ];
      spawnEnv = {
        ...process.env,
        OPENCODE_CONFIG_CONTENT: JSON.stringify(opencodeConfig),
        IVE_GITLAB_TOKEN: token,
        IVE_GITHUB_TOKEN: token,
      };
    } else {
      // Claude Code: claude --dangerously-skip-permissions --output-format stream-json ...
      if (mcpServers) {
        const claudeMcp: Record<string, any> = {};
        for (const [name, cfg] of Object.entries(mcpServers)) {
          if (cfg.type === 'local' && Array.isArray(cfg.command) && cfg.command.length > 0) {
            claudeMcp[name] = {
              command: cfg.command[0],
              args: cfg.command.slice(1),
              ...(cfg.environment ? { env: cfg.environment } : {}),
            };
          } else if (cfg.type === 'remote' && cfg.url) {
            claudeMcp[name] = { url: cfg.url, ...(cfg.headers ? { headers: cfg.headers } : {}) };
          }
        }
        if (Object.keys(claudeMcp).length > 0) {
          try {
            fs.writeFileSync(
              path.join(workspacePath, '.mcp.json'),
              JSON.stringify({ mcpServers: claudeMcp }, null, 2)
            );
          } catch { /* 파일 쓰기 실패 시 무시 */ }
        }
      }

      const allowedTools = ['Read', 'Edit', 'Write', 'Grep', 'Glob', 'Bash', 'WebFetch'];
      args = [
        ...cliParts.slice(1),
        '--dangerously-skip-permissions',
        '--output-format', 'stream-json',
        '--verbose',
        '--max-turns', String(agent.maxTurns || 200),
        ...(systemCliModel ? ['--model', systemCliModel] : []),
        '--allowedTools', ...allowedTools,
        '-p', prompt,
      ];
      spawnEnv = {
        ...process.env,
        GITLAB_TOKEN: token, GITLAB_API_TOKEN: token,
        GITHUB_TOKEN: token,
        IVE_GITLAB_TOKEN: token,
        IVE_GITHUB_TOKEN: token,
      };
    }

    log(`CMD: ${mainCmd} ${args.slice(0, isOpenCode ? -1 : -2).join(' ')} [prompt omitted]`, 'system');
    if (systemCliModel) log(`MODEL: ${systemCliModel}`, 'system');
    log(`CWD: ${workspacePath}`, 'system');

    const child = spawn(mainCmd, args, {
      cwd: workspacePath,
      stdio: ['ignore', 'pipe', 'pipe'],
      env: spawnEnv as NodeJS.ProcessEnv,
      detached: true,
    });

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
        if (event.type === 'step_finish') {
          const tokens = event.part?.tokens ?? {};
          const iT = tokens.input ?? 0;
          const oT = tokens.output ?? 0;
          const cost = event.part?.cost ?? 0;
          totalInputTokens += Number(iT);
          totalOutputTokens += Number(oT);
          totalCostUsd += Number(cost);
          if (event.part?.reason === 'stop') totalTurns = assistantTurnCount;
        }
        // Legacy session.status 이벤트 처리
        if (event.type === 'session.status') {
          const iT = event.inputTokens ?? event.input_tokens ?? event.tokens?.input ?? 0;
          const oT = event.outputTokens ?? event.output_tokens ?? event.tokens?.output ?? 0;
          const cost = event.cost ?? event.costUsd ?? event.cost_usd ?? 0;
          const turns = event.turns ?? event.numTurns ?? event.num_turns ?? 0;
          totalInputTokens += Number(iT);
          totalOutputTokens += Number(oT);
          totalCostUsd += Number(cost);
          totalTurns = Math.max(totalTurns, Number(turns));
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

    child.stdout.on('data', (data: Buffer) => {
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
    child.stderr.on('data', (data: Buffer) => {
      resetIdleTimer();
      const raw = data.toString();
      stderrBuffer += raw;
      if (stderrBuffer.length > STDERR_BUFFER_MAX) {
        stderrBuffer = stderrBuffer.slice(-STDERR_BUFFER_MAX);
      }
      const text = raw.trim();
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
      if (code === 0) {
        resolve();
        return;
      }
      const detail: string[] = [];
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
