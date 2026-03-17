import {
  getAllProjects,
  updateProjectLastChecked,
  updateProjectError,
  getProjectAssignments,
  createExecution,
  updateExecutionStatus,
  updateExecutionPid,
  updateExecutionTokens,
  resetStuckExecutions,
  hasActiveExecution,
  countActiveExecutionsByAgent
} from "./db";
import { decrypt } from "./crypto";
import { 
  ensureGitLabLabels, 
  fetchGitLabIssues, 
  updateGitLabIssueLabels, 
  addGitLabIssueComment, 
  fetchGitLabIssueNotes, 
  addGitLabSpentTime, 
  createGitLabMR, 
  getGitLabMR, 
  addGitLabMRNote 
} from "./gitlab";
import { Project, Agent } from "@/types";
import { startStatsCollector } from "./stats-collector";
import { spawn } from "child_process";
import fs from "fs";
import path from "path";
import { promisify } from "util";

const exec = promisify(require('child_process').exec);

// CLI별 토큰 단가 (USD per 1M tokens) — cost_usd가 제공되지 않을 때 사용
const TOKEN_PRICING: Record<string, { input: number; output: number }> = {
  claude:  { input: 3.0,  output: 15.0 },   // Sonnet 기본
  gemini:  { input: 1.25, output: 5.0 },     // Gemini 2.0 Flash
  codex:   { input: 2.5,  output: 10.0 },    // GPT-4.1 mini
}

function estimateCost(cliName: string, inputTokens: number, outputTokens: number): number {
  const pricing = TOKEN_PRICING[cliName] || TOKEN_PRICING.claude
  return (inputTokens * pricing.input + outputTokens * pricing.output) / 1_000_000
}

/**
 * Claude CLI stream-json 이벤트를 읽기 좋은 로그 텍스트로 변환
 */
function extractMeta(event: any, usage?: any): string | null {
  const meta: string[] = [];
  const u = usage || {};
  const inputT = u.input_tokens ?? u.inputTokens ?? event.input_tokens;
  const outputT = u.output_tokens ?? u.outputTokens ?? event.output_tokens;
  if (inputT || outputT) meta.push(`입력 ${Number(inputT||0).toLocaleString()} + 출력 ${Number(outputT||0).toLocaleString()} 토큰`);
  const cost = event.cost_usd ?? event.costUsd ?? event.cost;
  if (cost) meta.push(`비용 $${Number(cost).toFixed(4)}`);
  const dur = event.duration_ms ?? event.durationMs ?? event.duration_api_ms;
  if (dur) meta.push(`응답 ${(Number(dur) / 1000).toFixed(1)}초`);
  const turns = event.num_turns ?? event.numTurns;
  if (turns) meta.push(`${turns}턴`);
  return meta.length > 0 ? `(${meta.join(' | ')})` : null;
}

function formatStreamEvent(event: any, showToolUsage: boolean = false): string | null {
  const ts = new Date().toTimeString().slice(0, 8);

  switch (event.type) {
    case 'assistant': {
      const parts = event.message?.content || [];
      const lines: string[] = [];
      for (const part of parts) {
        if (part.type === 'text' && part.text?.trim()) {
          lines.push(`[${ts}] ${part.text}`);
        } else if (part.type === 'tool_use' && showToolUsage) {
          const input = part.input || {};
          const summary = formatToolInput(part.name, input);
          lines.push(`[${ts}] \x1b[1;34m[Tool] ${part.name}\x1b[0m ${summary}`);
        }
      }
      if (lines.length === 0) return null;
      const usage = event.message?.usage || event.usage;
      const meta = extractMeta(event, usage);
      if (meta) lines.push(`\x1b[90m       ${meta}\x1b[0m`);
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
      return `[${ts}] \x1b[1;32m[완료]\x1b[0m ${metaStr}${event.result ? '\n' + event.result : ''}`;
    }
    case 'system': {
      // system 이벤트 중 의미 있는 메시지만 출력 (JSON 덤프 방지)
      if (event.subtype === 'init' || event.subtype === 'session') {
        return `[${ts}] \x1b[1;36m[시작]\x1b[0m 세션 초기화`;
      }
      // task_notification 등 내부 이벤트는 메타만 간략히
      if (event.subtype === 'task_notification') {
        const summary = event.summary || '';
        const tokens = event.usage?.total_tokens ? ` (${event.usage.total_tokens.toLocaleString()} tokens)` : '';
        return summary ? `[${ts}] \x1b[90m[내부작업] ${summary}${tokens}\x1b[0m` : null;
      }
      // 문자열 메시지가 있으면 표시, 아니면 무시
      if (typeof event.message === 'string' && event.message.trim()) {
        return `[${ts}] \x1b[1;36m[System]\x1b[0m ${event.message}`;
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
function formatStreamEventMarkdown(event: any): string | null {
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
      if (cost) info.push(`비용: $${Number(cost).toFixed(4)}`);
      if (duration) info.push(`소요: ${(Number(duration) / 1000).toFixed(1)}s`);
      if (tokens) info.push(`토큰: ${Number(tokens).toLocaleString()}`);
      else if (inputTokens || outputTokens) info.push(`토큰: ${(Number(inputTokens||0) + Number(outputTokens||0)).toLocaleString()}`);
      if (turns) info.push(`턴: ${turns}`);
      return `\n---\n**📊 실행 결과** ${info.join(' | ')}${event.result ? '\n\n' + event.result : ''}`;
    }
    default:
      return null;
  }
}

function formatToolInputMarkdown(toolName: string, input: any): string {
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

function formatToolInput(toolName: string, input: any): string {
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

declare global {
  var scanInterval: NodeJS.Timeout | undefined;
  var isScanning: boolean;
}

export function startScanner() {
  if (global.scanInterval) {
    console.log("[Scanner] Scanner already running. (V2)");
    return;
  }
  
  global.isScanning = false;
  console.log("[Scanner] Starting background scanner... (V2)");

  // 서버 재시작으로 고착된 실행 복구
  resetStuckExecutions();

  // 1분마다 전체 프로젝트 체크 (각 프로젝트의 checkInterval에 따라 실제 작업 수행 결정)
  global.scanInterval = setInterval(runScan, 60 * 1000);

  // 첫 실행은 약간의 지연 후 실행 (서버 초기화 완료 대기)
  setTimeout(runScan, 5000);

  // 통계 수집기 시작
  startStatsCollector();
}

export function stopScanner() {
  if (global.scanInterval) {
    clearInterval(global.scanInterval);
    global.scanInterval = undefined;
    global.isScanning = false;
    console.log("[Scanner] Stopped background scanner.");
  }
}

async function runScan() {
  if (global.isScanning) {
    console.log("[Scanner] Skip: Previous scan still in progress...");
    return;
  }

  global.isScanning = true;
  console.log(`[Scanner] Core Tick: ${new Date().toISOString()}`);
  
  try {
    const projects = getAllProjects();
    for (const project of projects) {
      await scanProject(project, false);
    }
  } catch (err) {
    console.error(`[Scanner] Core runScan error:`, err);
  } finally {
    global.isScanning = false;
  }
}

/**
 * 특정 프로젝트의 스캔을 수행합니다.
 * @param force true인 경우 checkInterval을 무시하고 즉시 스캔합니다.
 */
export async function scanProject(project: Project, force: boolean = false) {
  try {
    // 스캐너 활성화 여부 확인 (수동 실행 시에도 비활성 상태면 건너뜀)
    if (!force && project.scannerActive === false) {
      return;
    }

    const now = new Date();

    // 체크 주기 확인
    if (!force && project.lastCheckedAt) {
      const lastChecked = new Date(project.lastCheckedAt);
      const diffMinutes = (now.getTime() - lastChecked.getTime()) / (1000 * 60);
      if (diffMinutes < project.checkInterval) {
        return; // 아직 체크할 시간이 아님
      }
    }

    console.log(`[Scanner] ${force ? 'FORCED ' : ''}Scanning project: ${project.name}`);
    
    const decryptedToken = decrypt(project.accessToken);
    let issueCount = 0;

    if (project.provider === 'gitlab') {
      await ensureGitLabLabels(project, decryptedToken);

      // 개발 큐: labelTarget (예: IVE)
      const devIssues = await fetchGitLabIssues(project, decryptedToken, project.labelTarget);
      if (devIssues.length > 0) {
        console.log(`[Scanner] Found ${devIssues.length} dev-queue issues for ${project.name}`);
        const { assigned, waiting } = await processIssues(project, devIssues, decryptedToken);
        issueCount += waiting;
      }
    } else if (project.provider === 'github') {
      // 구현 예정
    }

    // 마지막 체크 시간 및 이슈 수 업데이트
    updateProjectLastChecked(project.id, now.toISOString(), issueCount);
    
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.warn(`[Scanner] Error scanning project ${project.name}: ${msg}`);
    updateProjectError(project.id, msg);
  }
}

async function processIssues(project: Project, issues: any[], decryptedToken: string): Promise<{ assigned: number; waiting: number }> {
  const assignments = getProjectAssignments(project.id);
  let assignedCount = 0;
  let waitingCount = 0;
  const busyAgentIds = new Set<string>();

  console.log(`[Scanner] processIssues: ${issues.length} issues, ${assignments.length} agents`);
  for (const issue of issues) {
    // 이미 진행 중이거나 실행 중이면 스킵
    if (
      issue.labels.includes(project.labelInProgress) ||
      hasActiveExecution(project.id, issue.iid)
    ) {
      console.log(`[Scanner] [SKIP-INPROG] Issue #${issue.iid} (labels: ${issue.labels.join(',')}, activeExec: ${hasActiveExecution(project.id, issue.iid)})`);
      continue;
    }

    // 실행 중인 작업이 없는 에이전트 탐색 (이번 루프에서 이미 배정한 에이전트도 제외)
    let availableAgent: Agent | null = null;
    for (const pa of assignments) {
      if (busyAgentIds.has(pa.agentId)) continue;
      const running = countActiveExecutionsByAgent(pa.agentId);
      if (running === 0) {
        availableAgent = pa.agent;
        break;
      }
    }

    if (availableAgent) {
      busyAgentIds.add(availableAgent.id);
      console.log(`[Scanner] [ASSIGN] Project: ${project.name}, Issue: #${issue.iid}, Agent: ${availableAgent.name}`);

      // 레이블 변경: 대기 → 개발 중
      await updateGitLabIssueLabels(project, issue.iid, decryptedToken, [project.labelInProgress], [project.labelTarget]);

      // 비동기로 태스크 실행
      executeTask(project, issue, availableAgent, decryptedToken)
        .then(() => {
          console.log(`[Scanner] [DONE] Issue #${issue.iid} processed.`);
        })
        .catch(err => {
          console.error(`[Scanner] [FAILED] Issue #${issue.iid} error:`, err);
        });

      assignedCount++;
    } else {
      waitingCount++;
      console.log(`[Scanner] [SKIP] No available agent for Issue #${issue.iid}. Will retry in next scan.`);
    }
  }
  console.log(`[Scanner] processIssues result: assigned=${assignedCount}, waiting=${waitingCount}, busyAgents=[${[...busyAgentIds].join(',')}]`);
  return { assigned: assignedCount, waiting: waitingCount };
}

/**
 * 에이전트를 사용하여 실제 작업을 수행합니다. (Git 클론, 브랜칭, CLI 실행, MR 생성 등)
 */
async function executeTask(
  project: Project,
  issue: any,
  agent: Agent,
  token: string,
) {
  const iid = issue.iid;
  const executionId = `ex-${Date.now()}-${Math.floor(Math.random() * 1000)}`;
  const workspacePath = path.join(process.cwd(), 'workspaces', project.id, `issue-${iid}`);
  const logDir = path.join(process.cwd(), 'data', 'logs');
  const logPath = path.join(logDir, `${executionId}.log`);

  if (!fs.existsSync(logDir)) fs.mkdirSync(logDir, { recursive: true });

  // 0. DB에 실행 시작 기록
  createExecution({
    id: executionId,
    projectId: project.id,
    agentId: agent.id,
    issueIid: iid,
    issueTitle: issue.title,
    status: 'running',
    startedAt: new Date().toISOString(),
    logPath: logPath,
    inputTokens: 0,
    outputTokens: 0,
    costUsd: 0,
    turns: 0,
  });

  const conversationParts: string[] = []; // 이슈 노트용 대화 내용 수집
  const logStream = fs.createWriteStream(logPath, { flags: 'a' });
  const log = (msg: string, type: 'info' | 'error' | 'warn' | 'system' = 'info') => {
    const timestamp = new Date().toTimeString().slice(0, 8);
    let colorCode = '';
    if (type === 'system') colorCode = '\x1b[1;32m'; // Bright Green
    if (type === 'error') colorCode = '\x1b[1;31m';  // Bright Red
    if (type === 'warn') colorCode = '\x1b[1;33m';   // Bright Yellow

    const coloredMsg = colorCode ? `${colorCode}${msg}\x1b[0m` : msg;
    logStream.write(`[${timestamp}] ${coloredMsg}\n`);
    console.log(`[Task #${iid}] ${msg}`);
  };

  try {
    // 0-1. 이슈 정보 출력
    log(`\x1b[1;36m${'═'.repeat(50)}\x1b[0m`, 'info');
    log(`Issue #${iid}: ${issue.title}`, 'system');
    log(`Agent : ${agent.name}`, 'system');
    log(`Project: ${project.name}`, 'system');
    log(`\x1b[1;36m${'═'.repeat(50)}\x1b[0m`, 'info');

    // 1. 작업 디렉토리 준비
    log("작업 디렉토리 준비 중...", 'system');
    if (fs.existsSync(workspacePath)) {
      fs.rmSync(workspacePath, { recursive: true, force: true });
    }
    fs.mkdirSync(workspacePath, { recursive: true });

    // 2. Git 클론 및 준비
    const repoUrl = project.repoUrl.replace('https://', `https://oauth2:${token}@`);
    const branchName = `dev-${iid}`;
    
    log("저장소 클론 중...", 'system');
    await exec(`git clone ${repoUrl} .`, { cwd: workspacePath });
    
    let baseBranch = 'staging';
    try {
      await exec(`git fetch origin staging`, { cwd: workspacePath });
      await exec(`git checkout staging`, { cwd: workspacePath });
      await exec(`git pull origin staging`, { cwd: workspacePath });
    } catch {
      baseBranch = 'main';
      await exec(`git checkout main`, { cwd: workspacePath });
      await exec(`git pull origin main`, { cwd: workspacePath });
    }
    
    await exec(`git checkout -B ${branchName}`, { cwd: workspacePath });

    // 3. 이전 작업 이력 확인
    const notes = await fetchGitLabIssueNotes(project, iid, token);
    const iterationCount = notes.filter((n: any) => n.body.includes("IVE(봇) 이슈 해결")).length + 1;
    let iterationContext = "";
    if (iterationCount > 1) {
      const recentNotes = notes.filter((n: any) => !n.system).slice(-5);
      iterationContext = "\n## 이전 작업 이력 및 피드백:\n" + 
        recentNotes.map((n: any) => `### ${n.author.name} (${n.created_at})\n${n.body.substring(0, 500)}`).join('\n');
    }

    // GitLab API 정보 구성
    const repoUrlParsed = new URL(project.repoUrl.replace(/\.git$/, ''));
    const gitlabBaseUrl = `${repoUrlParsed.protocol}//${repoUrlParsed.host}`;
    const projectPath = repoUrlParsed.pathname.startsWith('/') ? repoUrlParsed.pathname.slice(1) : repoUrlParsed.pathname;
    const encodedProjectPath = encodeURIComponent(projectPath);

    const prompt = `다음 GitLab 이슈를 해결해주세요. 한국어로만 보고하세요.

## 이슈 #${iid}: ${issue.title}
${issue.description || "설명 없음"}
${iterationContext}

## GitLab 연동 정보:
- GitLab API: ${gitlabBaseUrl}/api/v4
- Project: ${projectPath} (encoded: ${encodedProjectPath})
- Issue IID: ${iid}
- 인증: 환경변수 GITLAB_TOKEN 사용 (PRIVATE-TOKEN 헤더)

### 사용 가능한 GitLab API 예시:
\`\`\`bash
# 이슈에 코멘트 달기
curl -s --header "PRIVATE-TOKEN: $GITLAB_TOKEN" -X POST "${gitlabBaseUrl}/api/v4/projects/${encodedProjectPath}/issues/${iid}/notes" --data-urlencode "body=코멘트 내용"

# 이슈 정보 조회
curl -s --header "PRIVATE-TOKEN: $GITLAB_TOKEN" "${gitlabBaseUrl}/api/v4/projects/${encodedProjectPath}/issues/${iid}"

# 이슈 코멘트 목록
curl -s --header "PRIVATE-TOKEN: $GITLAB_TOKEN" "${gitlabBaseUrl}/api/v4/projects/${encodedProjectPath}/issues/${iid}/notes"
\`\`\`

## 지시사항:
- 프로젝트 구조와 스타일을 파악하고 관련 코드를 수정하세요.
- 수정 완료 후 git add로 변경 사항을 스테이징하세요.
- git commit/push는 하지 마세요.
- 작업 진행 중 중요한 발견이나 질문이 있으면 이슈에 코멘트를 남기세요.
- 작업 시작 시 간단한 착수 코멘트를 이슈에 남기세요.`;

    // 5. 에이전트 CLI 실행
    const startTime = Date.now();
    await new Promise<void>((resolve, reject) => {
      const cliParts = agent.cliPath.split(' ');
      const mainCmd = cliParts[0];
      const allowedTools = ['Read', 'Edit', 'Write', 'Grep', 'Glob', 'Bash', 'WebFetch'];
      const args = [
        ...cliParts.slice(1),
        '--dangerously-skip-permissions',
        '--output-format', 'stream-json',
        '--verbose',
        '--max-turns', String(agent.maxTurns || 200),
        '--allowedTools', ...allowedTools,
        '-p', prompt
      ];

      log(`CMD: ${mainCmd} ${args.slice(0, -2).join(' ')} [prompt omitted]`, 'system');
      log(`CWD: ${workspacePath}`, 'system');

      const child = spawn(mainCmd, args, {
        cwd: workspacePath,
        stdio: ['ignore', 'pipe', 'pipe'],
        env: { ...process.env, GITLAB_TOKEN: token, GITLAB_API_TOKEN: token },
        detached: true,  // 새 프로세스 그룹 생성 → kill -pgid로 전체 종료 가능
      });

      // PID를 DB에 저장 (강제 종료 및 좀비 프로세스 정리용)
      if (child.pid) {
        updateExecutionPid(executionId, child.pid);
        log(`PID: ${child.pid} (PGID: -${child.pid})`, 'system');
      }

      // stream-json 포맷을 파싱하여 사람이 읽을 수 있는 로그로 변환
      let stdoutBuffer = '';
      let totalInputTokens = 0;
      let totalOutputTokens = 0;
      let totalCostUsd = 0;
      let totalTurns = 0;
      let assistantTurnCount = 0;

      child.stdout.on('data', (data: Buffer) => {
        stdoutBuffer += data.toString();
        const lines = stdoutBuffer.split('\n');
        stdoutBuffer = lines.pop() || ''; // 마지막 불완전한 줄 보관
        for (const line of lines) {
          if (!line.trim()) continue;
          try {
            const event = JSON.parse(line);
            const formatted = formatStreamEvent(event, project.showToolUsage);
            if (formatted) logStream.write(formatted + '\n');
            // 이슈 노트용 마크다운 수집
            const md = formatStreamEventMarkdown(event);
            if (md) conversationParts.push(md);
            // assistant 이벤트 카운트 (턴 수 fallback용)
            if (event.type === 'assistant') {
              assistantTurnCount++;
            }
            // 토큰/비용/턴 누적
            if (event.type === 'result') {
              const iT = event.input_tokens ?? event.inputTokens ?? event.usage?.input_tokens ?? 0;
              const oT = event.output_tokens ?? event.outputTokens ?? event.usage?.output_tokens ?? 0;
              const cost = event.cost_usd ?? event.costUsd ?? event.cost ?? 0;
              const turns = event.num_turns ?? event.numTurns ?? 0;
              totalInputTokens += Number(iT);
              totalOutputTokens += Number(oT);
              totalCostUsd += Number(cost);
              totalTurns = Math.max(totalTurns, Number(turns));
            }
          } catch {
            logStream.write(line + '\n');
          }
        }
      });
      child.stderr.on('data', (data: Buffer) => {
        const text = data.toString().trim();
        if (text) log(text, 'warn');
      });

      child.on('close', (code, signal) => {
        // 버퍼에 남은 데이터 처리
        if (stdoutBuffer.trim()) {
          try {
            const event = JSON.parse(stdoutBuffer);
            const formatted = formatStreamEvent(event, project.showToolUsage);
            if (formatted) logStream.write(formatted + '\n');
          } catch {
            logStream.write(stdoutBuffer + '\n');
          }
        }
        log(`CLI 종료: code=${code}, signal=${signal}`, code === 0 ? 'system' : 'error');
        // 토큰/비용/턴 DB 저장 (CLI가 cost를 제공하지 않으면 토큰 수로 환산)
        // result 이벤트에서 turns를 못 가져왔으면 assistant 이벤트 카운트를 사용
        const finalTurns = totalTurns > 0 ? totalTurns : assistantTurnCount;
        if (totalInputTokens || totalOutputTokens || totalCostUsd || finalTurns) {
          const finalCost = totalCostUsd > 0
            ? totalCostUsd
            : estimateCost(agent.cliName, totalInputTokens, totalOutputTokens);
          updateExecutionTokens(executionId, totalInputTokens, totalOutputTokens, finalCost, finalTurns);
        }
        if (code === 0) resolve();
        else reject(new Error(`Agent CLI exited with code ${code}`));
      });
      child.on('error', (err) => {
        log(`CLI 실행 실패: ${err.message}`, 'error');
        reject(err);
      });
    });

    const durationSeconds = Math.floor((Date.now() - startTime) / 1000);
    const durationStr = `${Math.max(1, Math.floor(durationSeconds/60))}m`;

    // 6. 변경 사항 확인 및 커밋/푸시
    const { stdout: diffResult } = await exec(`git diff --cached --name-only`, { cwd: workspacePath });
    if (diffResult.trim()) {
      log("변경사항 감지. 커밋 및 푸시 중...", 'system');
      await exec(`git commit -m "fix: resolve #${iid} - ${issue.title}"`, { cwd: workspacePath });
      await exec(`git push -f origin ${branchName}`, { cwd: workspacePath });

      const existingMR = await getGitLabMR(project, token, branchName);
      let mrUrl = "";
      if (existingMR) {
        mrUrl = existingMR.web_url;
        await addGitLabMRNote(project, token, existingMR.iid, `## 반복 수정 (${iterationCount}차)\n피드백을 반영하여 추가 수정했습니다.`);
      } else {
        const mrResult = await createGitLabMR(project, token, {
          source_branch: branchName,
          target_branch: baseBranch,
          title: `fix: resolve #${iid} - ${issue.title}`,
          description: `이슈 #${iid} 해결을 위한 자동 MR입니다. (${iterationCount}차 작업)`,
          remove_source_branch: false,
          squash: true
        });
        mrUrl = mrResult?.web_url || "";
      }

      // 대화 내용을 마크다운으로 정리 (최대 60000자 — GitLab 노트 제한 65535)
      const conversationLog = conversationParts.join('\n\n').substring(0, 60000);
      const completionNote = `## IVE(봇) 개발 완료\n\nMR: ${mrUrl}\n소요 시간: ${durationStr}\n\n개발이 완료되었습니다. 리뷰 후 머지해주세요.\n\n<details>\n<summary>🤖 AI 작업 로그 (펼치기)</summary>\n\n${conversationLog}\n\n</details>`;
      await addGitLabIssueComment(project, iid, token, completionNote);
      await addGitLabSpentTime(project, iid, token, durationStr);

      // 개발 완료: IVE(D) → IVE(E) (완료)
      await updateGitLabIssueLabels(project, iid, token, [project.labelDone], [project.labelInProgress]);
      log("작업 완료.", 'system');
      updateExecutionStatus(executionId, 'success', new Date().toISOString());
    } else {
      log("코드 변경사항 없음. 작업 완료로 처리.", 'system');
      const noChangeLog = conversationParts.join('\n\n').substring(0, 60000);
      await addGitLabIssueComment(project, iid, token, `## IVE(봇) 개발 완료\n\n코드 변경 없이 작업을 완료했습니다.\n소요 시간: ${durationStr}\n\n<details>\n<summary>🤖 AI 작업 로그 (펼치기)</summary>\n\n${noChangeLog}\n\n</details>`);
      await addGitLabSpentTime(project, iid, token, durationStr);
      // 개발 완료: IVE(D) → IVE(E) (완료)
      await updateGitLabIssueLabels(project, iid, token, [project.labelDone], [project.labelInProgress]);
      updateExecutionStatus(executionId, 'success', new Date().toISOString());
    }

  } catch (err: any) {
    log(`오류 발생: ${err.message}`, 'error');
    const errorLog = conversationParts.join('\n\n').substring(0, 60000);
    await addGitLabIssueComment(project, iid, token, `## IVE(봇) 실행 오류\n오류가 발생했습니다: ${err.message}\n\n<details>\n<summary>🤖 AI 작업 로그 (펼치기)</summary>\n\n${errorLog}\n\n</details>`);
    await updateGitLabIssueLabels(project, iid, token, [project.labelFailDev], [project.labelInProgress]);
    updateExecutionStatus(executionId, 'failed', new Date().toISOString());
  } finally {
    logStream.end();
    try {
      if (fs.existsSync(workspacePath)) {
        fs.rmSync(workspacePath, { recursive: true, force: true });
      }
    } catch (e) { /* ignore */ }
  }
}
