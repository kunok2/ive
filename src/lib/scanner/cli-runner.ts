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
  formatCodexEvent,
  formatCodexEventMarkdown,
  formatGeminiEvent,
  formatGeminiEventMarkdown,
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
  const isCodex = agent.cliName === 'codex';
  const isGemini = agent.cliName === 'gemini';
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
    } else if (isCodex) {
      // Codex: codex exec --json --skip-git-repo-check --dangerously-bypass-approvals-and-sandbox "prompt"
      //   - exec: 비대화형 실행, --json: JSONL 이벤트 스트림
      //   - IVE는 Docker로 외부 샌드박싱되며 브랜치/커밋/푸시는 IVE가 직접 처리하므로,
      //     승인 대기로 인한 hang을 막기 위해 승인/샌드박스를 우회한다(claude의 --dangerously-skip-permissions와 동일 취지).
      //   - codex 자체 MCP는 ~/.codex/config.toml에서 로드되므로 IVE mcp.config는 주입하지 않는다.
      args = [
        ...cliParts.slice(1),
        'exec',
        '--json',
        '--skip-git-repo-check',
        '--dangerously-bypass-approvals-and-sandbox',
        ...(systemCliModel ? ['-m', systemCliModel] : []),
        prompt,
      ];
      spawnEnv = {
        ...process.env,
        GITLAB_TOKEN: token, GITLAB_API_TOKEN: token,
        GITHUB_TOKEN: token,
        IVE_GITLAB_TOKEN: token,
        IVE_GITHUB_TOKEN: token,
      };
    } else if (isGemini) {
      // Gemini CLI: gemini --yolo --skip-trust --output-format stream-json -m <model> -p "prompt"
      //   - --yolo: 모든 도구 호출 자동 승인(claude --dangerously-skip-permissions와 동일 취지)
      //   - --skip-trust: headless 환경에서 워크스페이스 신뢰 확인 건너뜀(미설정 시 도구 실행이 차단됨)
      //   - gemini 자체 MCP는 `gemini mcp`로 관리되므로 IVE mcp.config는 주입하지 않는다(codex와 동일).
      args = [
        ...cliParts.slice(1),
        '--yolo',
        '--skip-trust',
        '--output-format', 'stream-json',
        ...(systemCliModel ? ['-m', systemCliModel] : []),
        '-p', prompt,
      ];
      spawnEnv = {
        ...process.env,
        GEMINI_CLI_TRUST_WORKSPACE: 'true',
        GITLAB_TOKEN: token, GITLAB_API_TOKEN: token,
        GITHUB_TOKEN: token,
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

    // 보안: 호출 명령어(플래그·인자 포함)는 상세보기 로그에 남기지 않는다.
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
    // Gemini: assistant 메시지가 delta로 여러 번 쪼개져 오므로, 연속된 assistant 구간을 1턴으로 묶기 위한 플래그
    let prevGeminiAssistant = false;

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
      } else if (isGemini) {
        // Gemini stream-json 이벤트 처리: init / message / tool_use / tool_result / result
        const formatted = formatGeminiEvent(event, project.showToolUsage);
        if (formatted) logStream.write(formatted + '\n');
        const md = formatGeminiEventMarkdown(event);
        if (md) conversationParts.push(md);
        // 도구/사고 활동 추적
        if (event.type === 'tool_use') {
          prevGeminiAssistant = false;
          const toolName = event.tool_name ?? '';
          if (toolName) {
            const detail = formatToolInput(toolName, event.parameters ?? {});
            setToolActivity(executionId, agent.id, toolName, detail);
          }
        } else if (event.type === 'message' && event.role === 'assistant') {
          setThinking(executionId, agent.id);
          if (!prevGeminiAssistant) assistantTurnCount++; // 연속 delta는 1턴으로 묶음
          prevGeminiAssistant = true;
        } else if (event.type === 'tool_result' || (event.type === 'message' && event.role === 'user')) {
          prevGeminiAssistant = false;
        }
        // 토큰 누적 (result.stats; 비용 필드 없음 → DB 단가로 환산)
        if (event.type === 'result') {
          const s = event.stats ?? {};
          // input_tokens는 캐시 포함 총 입력, cached는 캐시 읽기분(claude 패턴과 동일하게 총입력에 포함)
          totalInputTokens += Number(s.input_tokens ?? 0);
          totalCacheReadTokens += Number(s.cached ?? 0);
          totalOutputTokens += Number(s.output_tokens ?? 0);
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
