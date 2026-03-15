import {
  getAllProjects,
  updateProjectLastChecked,
  getRolesByProject,
  getRoleAssignments,
  createExecution,
  updateExecutionStatus,
  updateExecutionPid,
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
import { spawn } from "child_process";
import fs from "fs";
import path from "path";
import { promisify } from "util";

const exec = promisify(require('child_process').exec);

/**
 * Claude CLI stream-json 이벤트를 읽기 좋은 로그 텍스트로 변환
 */
function formatStreamEvent(event: any): string | null {
  const ts = new Date().toTimeString().slice(0, 8);

  switch (event.type) {
    case 'assistant': {
      // assistant 메시지: content 배열에서 text/tool_use 추출
      const parts = event.message?.content || [];
      const lines: string[] = [];
      for (const part of parts) {
        if (part.type === 'text' && part.text?.trim()) {
          lines.push(`[${ts}] ${part.text}`);
        } else if (part.type === 'tool_use') {
          const input = part.input || {};
          const summary = formatToolInput(part.name, input);
          lines.push(`[${ts}] \x1b[1;34m[Tool] ${part.name}\x1b[0m ${summary}`);
        }
      }
      return lines.length > 0 ? lines.join('\n') : null;
    }
    case 'content_block_delta': {
      const delta = event.delta;
      if (delta?.type === 'text_delta' && delta.text) {
        return delta.text; // 스트리밍 텍스트는 타임스탬프 없이
      }
      return null;
    }
    case 'result': {
      const cost = event.cost_usd ? `$${event.cost_usd.toFixed(4)}` : '';
      const dur = event.duration_ms ? `${(event.duration_ms / 1000).toFixed(1)}s` : '';
      const tokens = event.total_tokens ? `${event.total_tokens} tokens` : '';
      return `[${ts}] \x1b[1;32m[Result]\x1b[0m ${event.result || ''} ${[cost, dur, tokens].filter(Boolean).join(' | ')}`;
    }
    case 'system': {
      const msg = event.message || event.data || JSON.stringify(event);
      return `[${ts}] \x1b[1;36m[System]\x1b[0m ${msg}`;
    }
    default:
      return null; // 불필요한 이벤트는 무시
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
      if (event.cost_usd) info.push(`비용: $${event.cost_usd.toFixed(4)}`);
      if (event.duration_ms) info.push(`소요: ${(event.duration_ms / 1000).toFixed(1)}s`);
      if (event.total_tokens) info.push(`토큰: ${event.total_tokens.toLocaleString()}`);
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
    default: return '';
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
    default:
      return '';
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
        const assignedCount = await processIssues(project, devIssues, decryptedToken, true);
        issueCount = devIssues.length - assignedCount;
      }

      // 검증 큐: labelValidation (예: IVE(V)) - 개발 완료 후 대기 중인 이슈
      const valIssues = await fetchGitLabIssues(project, decryptedToken, project.labelValidation);
      if (valIssues.length > 0) {
        console.log(`[Scanner] Found ${valIssues.length} val-queue issues for ${project.name}`);
        await processIssues(project, valIssues, decryptedToken, false);
      }

      if (issueCount < 0) issueCount = 0;
    } else if (project.provider === 'github') {
      // 구현 예정
    }

    // 마지막 체크 시간 및 이슈 수 업데이트
    updateProjectLastChecked(project.id, now.toISOString(), issueCount);
    
  } catch (err) {
    console.error(`[Scanner] Error scanning project ${project.name}:`, err);
  }
}

async function processIssues(project: Project, issues: any[], decryptedToken: string, isDevelop: boolean): Promise<number> {
  const targetCategory = isDevelop ? '개발' : '검증';
  const roles = getRolesByProject(project.id).filter(r => r.status !== 'paused');
  const targetRoles = roles.filter(r => r.category === targetCategory);
  let assignedCount = 0;

  for (const issue of issues) {
    // 개발 큐: 이미 IVE(D) 또는 IVE(V) 레이블이 있거나 실행 중이면 스킵
    if (isDevelop && (
      issue.labels.includes(project.labelInProgress) ||
      issue.labels.includes(project.labelValidation) ||
      hasActiveExecution(project.id, issue.iid)
    )) {
      continue;
    }
    // 검증 큐: 이미 실행 중인 execution이 있으면 스킵 (중복 배정 방지)
    if (!isDevelop && hasActiveExecution(project.id, issue.iid)) {
      continue;
    }

    let assigned = false;

    for (const role of targetRoles) {
      const assignments = getRoleAssignments(role.id);

      // 에이전트별 슬롯 수 집계 (멀티슬롯: 같은 에이전트를 여러 번 배정 가능)
      const agentSlots = new Map<string, { assignment: typeof assignments[0], slots: number }>();
      for (const a of assignments) {
        const existing = agentSlots.get(a.agentId);
        if (existing) {
          existing.slots++;
        } else {
          agentSlots.set(a.agentId, { assignment: a, slots: 1 });
        }
      }

      // 실행 중인 작업 수가 슬롯보다 적은 에이전트 탐색
      let availableAssignment: typeof assignments[0] | null = null;
      for (const [agentId, { assignment, slots }] of agentSlots) {
        const running = countActiveExecutionsByAgent(agentId);
        if (running < slots) {
          availableAssignment = assignment;
          break;
        }
      }

      if (availableAssignment) {
        console.log(`[Scanner] [ASSIGN] Project: ${project.name}, Issue: #${issue.iid}, Agent: ${availableAssignment.agent.name} (${targetCategory})`);

        // 레이블 변경
        //    개발: IVE → IVE(D)
        //    검증: IVE(V) 그대로 유지 (이미 검증 큐 레이블이 붙어 있음)
        const currentLabel = isDevelop ? project.labelTarget : project.labelValidation;
        const inProgressLabel = isDevelop ? project.labelInProgress : project.labelValidation;
        if (isDevelop) {
          await updateGitLabIssueLabels(project, issue.iid, decryptedToken, [inProgressLabel], [currentLabel]);
        }

        // 비동기로 태스크 실행
        executeTask(project, issue, availableAssignment.agent, decryptedToken, inProgressLabel, isDevelop, role.id)
          .then(() => {
            console.log(`[Scanner] [DONE] Issue #${issue.iid} processed.`);
          })
          .catch(err => {
            console.error(`[Scanner] [FAILED] Issue #${issue.iid} error:`, err);
          });

        assigned = true;
        break;
      }
    }

    if (assigned) {
      assignedCount++;
    } else {
      console.log(`[Scanner] [SKIP] No available agent for Issue #${issue.iid} (Category: ${targetCategory}). Will retry in next scan.`);
    }
  }
  return assignedCount;
}

/**
 * 에이전트를 사용하여 실제 작업을 수행합니다. (Git 클론, 브랜칭, CLI 실행, MR 생성 등)
 */
async function executeTask(
  project: Project,
  issue: any,
  agent: Agent,
  token: string,
  currentLabel: string,
  isDevelop: boolean,
  roleId: string
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
    roleId: roleId,
    agentId: agent.id,
    issueIid: iid,
    status: 'running',
    startedAt: new Date().toISOString(),
    logPath: logPath
  });

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
    log(`Agent : ${agent.name} (${isDevelop ? '개발' : '검증'})`, 'system');
    log(`Project: ${project.name}`, 'system');
    log(`\x1b[1;36m${'═'.repeat(50)}\x1b[0m`, 'info');

    // 1. 작업 디렉토리 준비
    log("Preparing workspace...", 'system');
    if (fs.existsSync(workspacePath)) {
      fs.rmSync(workspacePath, { recursive: true, force: true });
    }
    fs.mkdirSync(workspacePath, { recursive: true });

    // 2. Git 클론 및 준비
    const repoUrl = project.repoUrl.replace('https://', `https://oauth2:${token}@`);
    const branchName = isDevelop ? `dev-${iid}` : `val-${iid}`;
    
    log("Cloning repository...", 'system');
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
    const conversationParts: string[] = []; // 이슈 노트용 대화 내용 수집

    await new Promise<void>((resolve, reject) => {
      const cliParts = agent.cliPath.split(' ');
      const mainCmd = cliParts[0];
      const args = [...cliParts.slice(1), '--dangerously-skip-permissions', '--output-format', 'stream-json', '-p', prompt];

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
      child.stdout.on('data', (data: Buffer) => {
        stdoutBuffer += data.toString();
        const lines = stdoutBuffer.split('\n');
        stdoutBuffer = lines.pop() || ''; // 마지막 불완전한 줄 보관
        for (const line of lines) {
          if (!line.trim()) continue;
          try {
            const event = JSON.parse(line);
            const formatted = formatStreamEvent(event);
            if (formatted) logStream.write(formatted + '\n');
            // 이슈 노트용 마크다운 수집
            const md = formatStreamEventMarkdown(event);
            if (md) conversationParts.push(md);
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
            const formatted = formatStreamEvent(event);
            if (formatted) logStream.write(formatted + '\n');
          } catch {
            logStream.write(stdoutBuffer + '\n');
          }
        }
        log(`Agent CLI exited: code=${code}, signal=${signal}`, code === 0 ? 'system' : 'error');
        if (code === 0) resolve();
        else reject(new Error(`Agent CLI exited with code ${code}`));
      });
      child.on('error', (err) => {
        log(`Failed to spawn agent CLI: ${err.message}`, 'error');
        reject(err);
      });
    });

    const durationSeconds = Math.floor((Date.now() - startTime) / 1000);
    const durationStr = `${Math.max(1, Math.floor(durationSeconds/60))}m`;

    // 6. 변경 사항 확인 및 커밋/푸시
    const { stdout: diffResult } = await exec(`git diff --cached --name-only`, { cwd: workspacePath });
    if (diffResult.trim()) {
      log("Changes detected. Committing and pushing...", 'system');
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
      const completionNote = `## IVE(봇) ${isDevelop ? '개발' : '검증'} 완료\n\nMR: ${mrUrl}\n소요 시간: ${durationStr}\n\n${isDevelop ? '개발이 완료되었습니다. 검증 단계로 전환합니다.' : '검증이 완료되었습니다. 리뷰 후 머지해주세요.'}\n\n<details>\n<summary>🤖 AI 작업 로그 (펼치기)</summary>\n\n${conversationLog}\n\n</details>`;
      await addGitLabIssueComment(project, iid, token, completionNote);
      await addGitLabSpentTime(project, iid, token, durationStr);
      
      if (isDevelop) {
        // 개발 완료: IVE(D) → IVE(V) (검증 큐로 이동)
        await updateGitLabIssueLabels(project, iid, token, [project.labelValidation], [currentLabel]);
      } else {
        // 검증 완료: IVE(V) → IVE(E) (완료)
        await updateGitLabIssueLabels(project, iid, token, [project.labelDone], [currentLabel]);
      }
      log("Task successfully completed.", 'system');
      updateExecutionStatus(executionId, 'success', new Date().toISOString());
    } else {
      log("No changes generated.", 'warn');
      const noChangeLog = conversationParts.join('\n\n').substring(0, 60000);
      await addGitLabIssueComment(project, iid, token, `## IVE(봇) 작업 보고\n적용할 코드가 감지되지 않았습니다.\n\n<details>\n<summary>🤖 AI 작업 로그 (펼치기)</summary>\n\n${noChangeLog}\n\n</details>`);
      await updateGitLabIssueLabels(project, iid, token, [isDevelop ? project.labelFailDev : project.labelFailVal], [currentLabel]);
      updateExecutionStatus(executionId, 'success', new Date().toISOString());
    }

  } catch (err: any) {
    log(`Error occurred: ${err.message}`, 'error');
    const errorLog = conversationParts.join('\n\n').substring(0, 60000);
    await addGitLabIssueComment(project, iid, token, `## IVE(봇) 실행 오류\n오류가 발생했습니다: ${err.message}\n\n<details>\n<summary>🤖 AI 작업 로그 (펼치기)</summary>\n\n${errorLog}\n\n</details>`);
    await updateGitLabIssueLabels(project, iid, token, [isDevelop ? project.labelFailDev : project.labelFailVal], [currentLabel]);
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
