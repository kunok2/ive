/**
 * 에이전트를 사용하여 실제 작업을 수행합니다. (Git 클론, 브랜칭, CLI 실행, MR 생성 등)
 * 충돌 감지 관련 함수도 포함.
 */
import {
  getProject,
  createExecution,
  updateExecutionStatus,
  updateExecutionPid,
  updateExecutionTokens,
  hasActiveExecution,
  countActiveExecutionsByAgent,
  updateAgentStatus,
  getLastCompletedAt,
  getSystemSetting,
  updateProjectConflictCount,
  getUserById,
  assignIssueAtomically,
  createActivityLog,
  touchProjectActivity,
  getIssueScheduledAt,
  upsertIssueStageSnapshot,
  getProjectAssignments,
  getDb,
} from "../db";
import {
  addIssueLabels,
  removeIssueLabels,
  addIssueComment,
  fetchProjectMembers,
} from "../provider";
import {
  addGitLabIssueComment,
  fetchGitLabIssueNotes,
  addGitLabSpentTime,
  createGitLabMR,
  getGitLabMR,
  addGitLabMRNote,
} from "../gitlab";
import {
  addGitHubIssueComment,
  fetchGitHubIssueNotes,
  createGitHubPR,
  getGitHubPR,
  addGitHubPRNote,
} from "../github";
import { Project, Agent } from "@/types";
import { decrypt } from "../crypto";
import { defaultLocale } from "@/i18n/config";
import { spawn } from "child_process";
import fs from "fs";
import path from "path";
import { promisify } from "util";
import { setToolActivity, setThinking, clearActivity } from "../tool-activity";
import { calcCostFromDb } from "../token-pricing";
import {
  formatOpenCodeEvent,
  formatOpenCodeEventMarkdown,
  formatStreamEvent,
  formatStreamEventMarkdown,
  formatToolInput,
} from "./formatters";

const exec = promisify(require('child_process').exec);
const execFile = promisify(require('child_process').execFile);

/**
 * 에이전트를 사용하여 실제 작업을 수행합니다. (Git 클론, 브랜칭, CLI 실행, MR 생성 등)
 */
export async function executeTask(
  project: Project,
  issue: any,
  agent: Agent,
  token: string,
  waitingSince?: string | null,
) {
  const iid = issue.iid;
  const isConflictTask = iid === 0; // iid=0: 충돌 감지 작업
  const executionId = isConflictTask
    ? `ex-conflict-${Date.now()}-${Math.floor(Math.random() * 1000)}`
    : `ex-${Date.now()}-${Math.floor(Math.random() * 1000)}`;
  const workspacePath = path.join(process.cwd(), 'workspaces', project.id, isConflictTask ? 'conflict-check' : `issue-${iid}`);
  const logDir = path.join(process.cwd(), 'data', 'logs');
  const logPath = path.join(logDir, `${executionId}.log`);

  if (!fs.existsSync(logDir)) fs.mkdirSync(logDir, { recursive: true });

  // 0. 에이전트 상태를 'busy'로 변경
  updateAgentStatus(agent.id, 'busy');

  // 0. DB에 실행 시작 기록 — 트랜잭션으로 중복 배정 방지
  // 대기시간 기준: IVE-S 레이블 최초 감지 시각 (issue_stages.scheduled_at)
  const effectiveCreatedAt = waitingSince || new Date().toISOString();
  const execution: Parameters<typeof createExecution>[0] = {
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
    issueCreatedAt: effectiveCreatedAt,
  };

  if (!isConflictTask && !assignIssueAtomically(project.id, iid, 'dev', execution)) {
    console.log(`[Scanner] [SKIP] Issue #${iid} already has active execution (race condition prevented in executeTask)`);
    updateAgentStatus(agent.id, 'available');
    return;
  }
  if (isConflictTask) {
    createExecution(execution);
  }

  // 배정 즉시 cached_stage를 'dev'로 업데이트
  // — 다음 스캔 전까지 issue_stages.cached_stage='waiting'으로 남아
  //   stats API에서 대기+작업중이 동시에 1로 보이는 문제 방지
  if (!isConflictTask) {
    try {
      const assignee = (issue.assignees && issue.assignees.length > 0) ? issue.assignees[0] : null;
      upsertIssueStageSnapshot(project.id, iid, {
        cachedStage: 'dev',
        assigneeUsername: assignee ? (assignee.username || assignee.login || null) : null,
        assigneeName: assignee ? (assignee.name || assignee.username || assignee.login || null) : null,
        assigneeAvatar: assignee ? (assignee.avatar_url || null) : null,
        assigneeProvider: project.provider,
        assigneeGitUserId: assignee && assignee.id != null ? String(assignee.id) : null,
        issueTitle: issue.title || null,
      });
    } catch (e) { console.warn(`[Scanner] Failed to update cached_stage to dev for #${iid}:`, e); }
  }

  // 레이블 전환: IVE-S 제거, IVE-D 부착 (개발 시작)
  if (!isConflictTask) {
    try {
      await removeIssueLabels(project, iid, token, [project.labelSchedule || 'IVE-S']);
      await addIssueLabels(project, iid, token, [project.labelDev || 'IVE-D']);
    } catch (e) { console.warn(`[Scanner] Failed to switch labels on #${iid}:`, e); }
  }

  // 작업 등록 활동 로그
  if (!isConflictTask) {
    try {
      createActivityLog({
        userId: 'system',
        category: 'task',
        action: 'create_task',
        detail: `작업 등록 (이슈 #${iid}, ${project.name}, 에이전트: ${agent.name})`,
        targetType: 'execution',
        targetId: executionId,
      })
    } catch (e) {
      console.error('[Scanner] Failed to log task activity:', e)
    }
  }

  const isGitHub = project.provider === 'github';
  const conversationParts: string[] = []; // 이슈 노트용 대화 내용 수집
  const rawLogStream = fs.createWriteStream(logPath, { flags: 'a' });
  // 각 줄에 Unix timestamp(ms) 접두사를 붙여 기록 → LogViewer에서 사용자 타임존으로 변환 표시
  const logStream = {
    write(data: string) {
      const lines = data.split('\n');
      for (let i = 0; i < lines.length; i++) {
        const line = lines[i];
        if (i === lines.length - 1 && line === '') continue; // trailing newline
        rawLogStream.write(`${Date.now()}\t${line}\n`);
      }
    },
    end() { rawLogStream.end(); },
  };
  const log = (msg: string, type: 'info' | 'error' | 'warn' | 'system' = 'info') => {
    let colorCode = '';
    if (type === 'system') colorCode = '\x1b[1;32m'; // Bright Green
    if (type === 'error') colorCode = '\x1b[1;31m';  // Bright Red
    if (type === 'warn') colorCode = '\x1b[1;33m';   // Bright Yellow

    const coloredMsg = colorCode ? `${colorCode}${msg}\x1b[0m` : msg;
    logStream.write(`${coloredMsg}\n`);
    console.log(`[Task #${iid}] ${msg}`);
  };

  // 프로젝트 소유자의 사용자별 locale 설정 우선 (없으면 시스템 설정 > 기본값)
  const projectOwner = getUserById(project.userId);
  const locale = projectOwner?.locale || getSystemSetting('locale') || defaultLocale;
  const isKo = locale === 'ko';

  try {
    // 0-1. 이슈 정보 출력
    const ownerTz = projectOwner?.timezone || 'Asia/Seoul';
    const startDateStr = new Date().toLocaleString('ko-KR', {
      timeZone: ownerTz,
      year: 'numeric', month: '2-digit', day: '2-digit',
      hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false,
    });
    log(`\x1b[1;36m${'═'.repeat(30)}\x1b[0m`, 'info');
    log(`Started: ${startDateStr} (${ownerTz})`, 'system');
    log(`Issue #${iid}: ${issue.title}`, 'system');
    log(`Agent : ${agent.name}`, 'system');
    log(`Project: ${project.name}`, 'system');
    log(`\x1b[1;36m${'═'.repeat(30)}\x1b[0m`, 'info');

    // 1. 작업 디렉토리 준비
    log("작업 디렉토리 준비 중...", 'system');
    if (fs.existsSync(workspacePath)) {
      fs.rmSync(workspacePath, { recursive: true, force: true });
    }
    fs.mkdirSync(workspacePath, { recursive: true });

    // 2. Git 클론 및 준비
    let repoUrl: string;
    if (project.authType === 'basic') {
      repoUrl = project.repoUrl.replace('https://', `https://${encodeURIComponent(project.gitUsername)}:${encodeURIComponent(token)}@`);
    } else if (isGitHub) {
      repoUrl = project.repoUrl.replace('https://', `https://x-access-token:${token}@`);
    } else {
      repoUrl = project.repoUrl.replace('https://', `https://oauth2:${token}@`);
    }
    const branchName = `dev-${iid}`;

    log("저장소 클론 중...", 'system');
    await execFile('git', ['clone', repoUrl, '.'], { cwd: workspacePath });

    let baseBranch = 'staging';
    try {
      await execFile('git', ['fetch', 'origin', 'staging'], { cwd: workspacePath });
      await execFile('git', ['checkout', 'staging'], { cwd: workspacePath });
      await execFile('git', ['pull', 'origin', 'staging'], { cwd: workspacePath });
    } catch {
      // staging 브랜치 없으면 원격 기본 브랜치 감지
      try {
        await execFile('git', ['remote', 'set-head', 'origin', '--auto'], { cwd: workspacePath });
        const { stdout: headRef } = await execFile('git', ['symbolic-ref', 'refs/remotes/origin/HEAD'], { cwd: workspacePath });
        baseBranch = headRef.trim().replace('refs/remotes/origin/', '');
      } catch {
        baseBranch = 'main'; // fallback
      }
      await execFile('git', ['checkout', baseBranch], { cwd: workspacePath });
      await execFile('git', ['pull', 'origin', baseBranch], { cwd: workspacePath });
    }

    // 충돌 감지 작업은 기본 브랜치에서 분석만 수행 (별도 브랜치 생성 안 함)
    if (!isConflictTask) {
      await execFile('git', ['checkout', '-B', branchName], { cwd: workspacePath });
    }

    // 3. 이전 작업 이력 및 사용자 피드백 확인 (충돌 작업은 이슈 노트가 없으므로 건너뜀)
    let iterationCount = 1;
    let latestFeedback = "";
    let iterationContext = "";

    if (!isConflictTask) {
      const notes = project.provider === 'github'
        ? await fetchGitHubIssueNotes(project, iid, token)
        : await fetchGitLabIssueNotes(project, iid, token);
      const botCompletions = notes.filter((n: any) => n.body.includes("<!-- ive-bot -->") || n.body.includes("IVE(봇)"));
      iterationCount = botCompletions.length + 1;

      const userNotes = notes.filter((n: any) =>
        !n.system &&
        !n.body.includes("<!-- ive-bot -->") &&
        !n.body.includes("IVE(봇)")
      );

      if (botCompletions.length > 0) {
        const lastBotNoteId = botCompletions[botCompletions.length - 1].id;
        const feedbackNotes = userNotes.filter((n: any) => n.id > lastBotNoteId);
        if (feedbackNotes.length > 0) {
          latestFeedback = feedbackNotes.map((n: any) => `> **${n.author.name}**: ${n.body}`).join('\n\n');
        }
      }

      if (iterationCount > 1) {
        const conversationNotes = notes
          .filter((n: any) => !n.system)
          .map((n: any) => {
            let body = n.body || "";
            body = body.replace(/<details>[\s\S]*?<\/details>/gi, "[work log omitted]");
            if (body.length > 800) body = body.substring(0, 800) + "\n...(truncated)";
            const role = n.body.includes("<!-- ive-bot -->") || n.body.includes("IVE(봇)") ? "🤖 Bot" : `👤 ${n.author?.name || "User"}`;
            return `**${role}** (${n.created_at}):\n${body}`;
          });
        iterationContext = "\n## Issue Conversation History:\n" + conversationNotes.join('\n\n---\n\n');
      }

      log(`반복 횟수: ${iterationCount}차, 봇 완료 노트: ${botCompletions.length}건, 사용자 피드백: ${latestFeedback ? '있음' : '없음'}`, 'system');
    }

    // API 정보 구성
    const repoUrlParsed = new URL(project.repoUrl.replace(/\.git$/, ''));

    // 1차: 이슈 본문이 지시사항 / 2차+: 사용자 피드백만이 지시사항
    let prompt: string;
    const providerLabel = isGitHub ? 'GitHub' : 'GitLab';
    const langInstruction = isKo
      ? 'You MUST respond in the user\'s language: Korean (ko). 모든 출력 — 코멘트, 설명, 상태 업데이트, 작업 요약 — 반드시 한국어로 작성하세요. All output MUST be written in Korean.'
      : 'You MUST respond in the user\'s language: English (en). All output must be in English.';
    if (isConflictTask) {
      // 충돌 감지 작업: description에 프롬프트가 이미 구성되어 있음
      prompt = `${langInstruction}\n\n${issue.description}`;
    } else if (iterationCount === 1) {
      prompt = `Please resolve the following ${providerLabel} issue. ${langInstruction}

## Issue #${iid}: ${issue.title}
${issue.description || "No description"}`;
    } else {
      // 재작업: 사용자의 최신 피드백이 최우선 명령. 이슈 본문/이력은 참고용.
      const feedbackSection = latestFeedback
        ? `## 🚨 PRIMARY TASK — User Feedback (this is your ONLY instruction):
${latestFeedback}

**⚠️ IMPORTANT: Only perform the user request in the "PRIMARY TASK" section above. The original issue body has already been completed in previous iterations. The history and issue body below are for context only — do NOT re-implement the original request.**`
        : `## 🚨 PRIMARY TASK — Review and fix remaining issues:
The user has requested a re-run of this issue. Review the conversation history below and the previous work, then fix any remaining problems or incomplete parts.`;

      prompt = `This is follow-up iteration #${iterationCount} for issue #${iid} "${issue.title}". ${langInstruction}

${feedbackSection}
${iterationContext}

<details>
<summary>Reference: Original issue body (context only — do NOT re-implement)</summary>

${issue.description || "No description"}
</details>`;
    }

    if (isGitHub) {
      const ownerRepo = repoUrlParsed.pathname.startsWith('/') ? repoUrlParsed.pathname.slice(1) : repoUrlParsed.pathname;
      prompt += `

## GitHub Integration:
- GitHub API: https://api.github.com
- Repository: ${ownerRepo}
- Issue Number: ${iid}
- Auth: Use IVE_GITHUB_TOKEN env var (Authorization: Bearer header)

### Available GitHub API Examples:
\`\`\`bash
# Post a comment on the issue
curl -s -H "Authorization: Bearer $IVE_GITHUB_TOKEN" -H "Accept: application/vnd.github+json" -X POST "https://api.github.com/repos/${ownerRepo}/issues/${iid}/comments" -d '{"body":"Comment text"}'

# Get issue details
curl -s -H "Authorization: Bearer $IVE_GITHUB_TOKEN" -H "Accept: application/vnd.github+json" "https://api.github.com/repos/${ownerRepo}/issues/${iid}"

# List issue comments
curl -s -H "Authorization: Bearer $IVE_GITHUB_TOKEN" -H "Accept: application/vnd.github+json" "https://api.github.com/repos/${ownerRepo}/issues/${iid}/comments"
\`\`\``;
    } else {
      const gitlabBaseUrl = `${repoUrlParsed.protocol}//${repoUrlParsed.host}`;
      const projectPath = repoUrlParsed.pathname.startsWith('/') ? repoUrlParsed.pathname.slice(1) : repoUrlParsed.pathname;
      const encodedProjectPath = encodeURIComponent(projectPath);
      prompt += `

## GitLab Integration:
- GitLab API: ${gitlabBaseUrl}/api/v4
- Project: ${projectPath} (encoded: ${encodedProjectPath})
- Issue IID: ${iid}
- Auth: Use IVE_GITLAB_TOKEN env var (PRIVATE-TOKEN header)

### Available GitLab API Examples:
\`\`\`bash
# Post a comment on the issue
curl -s --header "PRIVATE-TOKEN: $IVE_GITLAB_TOKEN" -X POST "${gitlabBaseUrl}/api/v4/projects/${encodedProjectPath}/issues/${iid}/notes" --data-urlencode "body=Comment text"

# Get issue details
curl -s --header "PRIVATE-TOKEN: $IVE_GITLAB_TOKEN" "${gitlabBaseUrl}/api/v4/projects/${encodedProjectPath}/issues/${iid}"

# List issue comments
curl -s --header "PRIVATE-TOKEN: $IVE_GITLAB_TOKEN" "${gitlabBaseUrl}/api/v4/projects/${encodedProjectPath}/issues/${iid}/notes"
\`\`\``;
    }

    prompt += `

## Instructions:
- Understand the project structure and style, then modify the relevant code.
- After completing changes, stage them with git add.
- Do NOT git commit or push.
- If you find important discoveries or have questions during work, leave a comment on the issue.
- Leave a brief start comment on the issue when you begin work.
- Take your time and be thorough — resolve the problem precisely.
- Review repeatedly until there are zero reasons the intended functionality could fail.
- When designing UI, provide text-art mockups of the result where possible.
- IMPORTANT: ${langInstruction}`;

    // 5. 에이전트 CLI 실행 (에이전트 모델 우선, 없으면 시스템 설정 폴백)
    const systemCliPath = getSystemSetting(`cli.${agent.cliName}.path`);
    const systemCliModel = agent.modelName || getSystemSetting(`cli.${agent.cliName}.model`);
    let resolvedCliPath = systemCliPath || agent.cliPath;
    // CLI 경로가 존재하지 않으면 which로 자동 탐색
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

    const startTime = Date.now();
    const isOpenCode = agent.cliName === 'opencode';
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
        // max-turns, permissions, MCP는 OPENCODE_CONFIG_CONTENT 환경변수로 전달
        const opencodeConfig: any = {
          agent: { coder: { steps: agent.maxTurns || 200, permission: 'allow', ...(systemCliModel ? { model: systemCliModel } : {}) } },
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
          // GITLAB_TOKEN은 OpenCode가 GitLab AI provider로 자동 감지하므로 제외
          // 대신 IVE_GITLAB_TOKEN으로 전달 (프롬프트에서 이 변수명 사용)
          IVE_GITLAB_TOKEN: token,
          // GITHUB_TOKEN도 OpenCode가 GitHub Copilot으로 자동 감지하므로 제외
          IVE_GITHUB_TOKEN: token,
        };
      } else {
        // Claude Code: claude --dangerously-skip-permissions --output-format stream-json ...
        // MCP는 workspace .mcp.json 파일로 주입
        if (mcpServers) {
          // opencode 포맷 → Claude Code .mcp.json 포맷으로 변환
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
        detached: true,  // 새 프로세스 그룹 생성 → kill -pgid로 전체 종료 가능
      });

      // PID를 DB에 저장 (강제 종료 및 좀비 프로세스 정리용)
      if (child.pid) {
        updateExecutionPid(executionId, child.pid);
        log(`PID: ${child.pid} (PGID: -${child.pid})`, 'system');
      }

      // stream-json / opencode --format json 포맷을 파싱하여 사람이 읽을 수 있는 로그로 변환
      let stdoutBuffer = '';
      let totalInputTokens = 0;
      let totalOutputTokens = 0;
      let totalCostUsd = 0;
      let totalTurns = 0;
      let assistantTurnCount = 0;
      let detectedModel = '';

      const processEvent = (event: any) => {
        // 모델명 캡처 (어떤 이벤트든 model 필드가 있으면 저장)
        const eventModel = event.model ?? event.modelId ?? event.model_id
          ?? event.message?.model ?? event.session?.model ?? '';
        if (eventModel && !detectedModel) detectedModel = eventModel;

        if (isOpenCode) {
          // opencode 이벤트 처리
          const formatted = formatOpenCodeEvent(event, project.showToolUsage);
          if (formatted) logStream.write(formatted + '\n');
          const md = formatOpenCodeEventMarkdown(event);
          if (md) conversationParts.push(md);
          // 도구 활동 추적 (OpenCode 1.x: tool info is in event.part)
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
          // 토큰/비용 누적 (OpenCode 1.x: step_finish에 per-step 토큰 포함)
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
          // Legacy session.status 이벤트 처리 (구버전 호환)
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
            const iT = (u.input_tokens ?? 0) + (u.cache_creation_input_tokens ?? 0) + (u.cache_read_input_tokens ?? 0);
            const oT = u.output_tokens ?? event.output_tokens ?? event.outputTokens ?? 0;
            const cost = event.total_cost_usd ?? event.cost_usd ?? event.costUsd ?? event.cost ?? 0;
            const turns = event.num_turns ?? event.numTurns ?? 0;
            totalInputTokens += Number(iT);
            totalOutputTokens += Number(oT);
            totalCostUsd += Number(cost);
            totalTurns = Math.max(totalTurns, Number(turns));
          }
        }
      };

      child.stdout.on('data', (data: Buffer) => {
        stdoutBuffer += data.toString();
        const lines = stdoutBuffer.split('\n');
        stdoutBuffer = lines.pop() || ''; // 마지막 불완전한 줄 보관
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
        const text = data.toString().trim();
        if (text) log(text, 'warn');
      });

      child.on('close', (code, signal) => {
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
        // 토큰/비용/턴 DB 저장 (CLI가 cost를 제공하지 않으면 토큰 수로 환산)
        // result 이벤트에서 turns를 못 가져왔으면 assistant 이벤트 카운트를 사용
        const finalTurns = totalTurns > 0 ? totalTurns : assistantTurnCount;
        const finalModel = detectedModel || systemCliModel || undefined;
        if (totalInputTokens || totalOutputTokens || totalCostUsd || finalTurns) {
          const finalCost = totalCostUsd > 0
            ? totalCostUsd
            : calcCostFromDb(totalInputTokens, totalOutputTokens, finalModel);
          updateExecutionTokens(executionId, totalInputTokens, totalOutputTokens, finalCost, finalTurns, finalModel);
        } else if (finalModel) {
          // 토큰 데이터가 없어도 모델명은 저장
          updateExecutionTokens(executionId, 0, 0, 0, 0, finalModel);
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

    // 6. 충돌 감지 작업은 커밋/푸시/MR 생성 불필요 — 로그에서 결과 파싱 후 완료 처리
    if (isConflictTask) {
      // 실행 로그에서 CONFLICT_RESULT 파싱
      let conflictCount = 0;
      try {
        const logContent = fs.readFileSync(logPath, 'utf-8');
        const match = logContent.match(/CONFLICT_RESULT:\s*(\d+)/);
        if (match) conflictCount = parseInt(match[1], 10);
      } catch {}
      updateProjectConflictCount(project.id, conflictCount);
      log(`충돌 분석 완료. 충돌 수: ${conflictCount}`, 'system');
      updateExecutionStatus(executionId, 'success', new Date().toISOString());
      // 충돌 작업 완료 → finally 블록으로 이동
    } else {

    // 변경 사항 확인 및 커밋/푸시
    const { stdout: diffResult } = await execFile('git', ['diff', '--cached', '--name-only'], { cwd: workspacePath });
    if (diffResult.trim()) {
      log("변경사항 감지. 커밋 및 푸시 중...", 'system');
      await execFile('git', ['commit', '-m', `fix: resolve #${iid} - ${issue.title}`], { cwd: workspacePath });
      try {
        await execFile('git', ['push', '-f', 'origin', branchName], { cwd: workspacePath });
      } catch (pushErr: any) {
        const pushMsg = pushErr.message || String(pushErr);
        const isPermission = pushMsg.includes('403') || pushMsg.includes('denied') || pushMsg.includes('Permission') || pushMsg.includes('protected');
        log(`push 실패: ${pushMsg}`, 'error');
        // 이슈에 push 실패 사유 코멘트 (best-effort)
        const pushFailReason = isPermission ? 'No push permission' : `Push failed: ${pushMsg.substring(0, 100)}`;
        const pushFailNote = isPermission
          ? `<!-- ive-bot -->\n## ${agent.name} No Push Permission\n\nCode changes are complete, but cannot create a branch due to insufficient push permissions.\nPlease grant write access to the token account or use a fork-based workflow.\n\nDuration: ${durationStr}`
          : `<!-- ive-bot -->\n## ${agent.name} Push Failed\n\nCode changes are complete, but push failed: ${pushMsg}\n\nDuration: ${durationStr}`;
        // IVE-D 레이블 유지 → dev_fail로 자동 판정 (활성 실행 없으므로)
        try {
          if (isGitHub) {
            await addGitHubIssueComment(project, iid, token, pushFailNote);
          } else {
            await addGitLabIssueComment(project, iid, token, pushFailNote);
          }
        } catch (e) { console.warn(`[Scanner] Remote comment failed:`, e); }
        updateExecutionStatus(executionId, 'failed', new Date().toISOString());
        updateAgentStatus(agent.id, 'available');
        logStream.end();
        try { if (fs.existsSync(workspacePath)) fs.rmSync(workspacePath, { recursive: true, force: true }); } catch {}
        return;
      }

      // MR/PR 생성 또는 업데이트
      let mrUrl = "";
      if (isGitHub) {
        const existingPR = await getGitHubPR(project, token, branchName);
        if (existingPR) {
          mrUrl = existingPR.web_url;
          await addGitHubPRNote(project, token, existingPR.iid, `## Iteration #${iterationCount}\nApplied feedback and made additional changes.`);
        } else {
          const prResult = await createGitHubPR(project, token, {
            source_branch: branchName,
            target_branch: baseBranch,
            title: `fix: resolve #${iid} - ${issue.title}`,
            description: `Auto-generated PR to resolve issue #${iid}. (Iteration #${iterationCount})`,
          });
          mrUrl = prResult?.web_url || "";
        }
      } else {
        const existingMR = await getGitLabMR(project, token, branchName);
        if (existingMR) {
          mrUrl = existingMR.web_url;
          await addGitLabMRNote(project, token, existingMR.iid, `## Iteration #${iterationCount}\nApplied feedback and made additional changes.`);
        } else {
          const mrResult = await createGitLabMR(project, token, {
            source_branch: branchName,
            target_branch: baseBranch,
            title: `fix: resolve #${iid} - ${issue.title}`,
            description: `Auto-generated MR to resolve issue #${iid}. (Iteration #${iterationCount})`,
            remove_source_branch: false,
            squash: true
          });
          mrUrl = mrResult?.web_url || "";
        }
      }

      const mrLabel = isGitHub ? 'PR' : 'MR';
      // 대화 내용을 마크다운으로 정리 (최대 60000자)
      const conversationLog = conversationParts.join('\n\n').substring(0, 60000);
      const mrLine = mrUrl ? `${mrLabel}: ${mrUrl}` : `${mrLabel}: creation failed (insufficient permissions or API error)`;
      const completionNote = `<!-- ive-bot -->\n## ${agent.name} Development Complete\n\n${mrLine}\nDuration: ${durationStr}\n\nDevelopment is complete. Please review and merge.\n\n<details>\n<summary>🤖 AI Work Log (expand)</summary>\n\n${conversationLog}\n\n</details>`;
      if (isGitHub) {
        await addGitHubIssueComment(project, iid, token, completionNote);
      } else {
        await addGitLabIssueComment(project, iid, token, completionNote);
        await addGitLabSpentTime(project, iid, token, durationStr);
      }

      // 레이블 전환: IVE-D 제거, IVE-W 부착 (검증대기)
      try {
        await removeIssueLabels(project, iid, token, [project.labelDev || 'IVE-D']);
        await addIssueLabels(project, iid, token, [project.labelVerifyWait || 'IVE-W']);
      } catch (e) { console.warn(`[Scanner] Label switch failed:`, e); }
      log("작업 완료 → 검증대기 (IVE-W). 검증자가 검증시작을 클릭하면 검증이 시작됩니다.", 'system');
      updateExecutionStatus(executionId, 'success', new Date().toISOString());
    } else {
      log("코드 변경사항 없음. 작업 완료로 처리.", 'system');
      const noChangeLog = conversationParts.join('\n\n').substring(0, 60000);
      const noChangeNote = `<!-- ive-bot -->\n## ${agent.name} Development Complete\n\nTask completed without code changes.\nDuration: ${durationStr}\n\n<details>\n<summary>🤖 AI Work Log (expand)</summary>\n\n${noChangeLog}\n\n</details>`;
      try {
        if (isGitHub) {
          await addGitHubIssueComment(project, iid, token, noChangeNote);
        } else {
          await addGitLabIssueComment(project, iid, token, noChangeNote);
          await addGitLabSpentTime(project, iid, token, durationStr);
        }
      } catch (e) { console.warn(`[Scanner] Remote comment failed:`, e); }
      // 코드 변경 없음 → IVE-D 제거, IVE-W 부착 (검증대기)
      try {
        await removeIssueLabels(project, iid, token, [project.labelDev || 'IVE-D']);
        await addIssueLabels(project, iid, token, [project.labelVerifyWait || 'IVE-W']);
      } catch (e) { console.warn(`[Scanner] Label switch failed:`, e); }
      updateExecutionStatus(executionId, 'success', new Date().toISOString());
    }
    } // end of !isConflictTask

  } catch (err: any) {
    log(`오류 발생: ${err.message}`, 'error');
    const errorLog = conversationParts.join('\n\n').substring(0, 60000);
    const errorNote = `<!-- ive-bot -->\n## ${agent.name} Execution Error\nAn error occurred: ${err.message}\n\n<details>\n<summary>🤖 AI Work Log (expand)</summary>\n\n${errorLog}\n\n</details>`;
    if (isConflictTask) {
      updateProjectConflictCount(project.id, 0);  // 실패 시 충돌 수 초기화
    }
    // IVE-D 레이블 유지 → dev_fail로 자동 판정 (활성 실행 없으므로)
    if (!isConflictTask) {
      try {
        if (isGitHub) {
          await addGitHubIssueComment(project, iid, token, errorNote);
        } else {
          await addGitLabIssueComment(project, iid, token, errorNote);
        }
      } catch (e) { console.warn(`[Scanner] Remote comment failed:`, e); }
    }
    updateExecutionStatus(executionId, 'failed', new Date().toISOString());
  } finally {
    // 에이전트 상태를 'available'로 복원
    updateAgentStatus(agent.id, 'available');
    // 프로젝트 최종 활동 시각 갱신
    touchProjectActivity(project.id);

    logStream.end();
    try {
      if (fs.existsSync(workspacePath)) {
        fs.rmSync(workspacePath, { recursive: true, force: true });
      }
    } catch (e) { /* ignore */ }

    // 대기 이슈가 있으면 즉시 재스캔 → 빈 에이전트에 바로 배정
    // 동적 import로 순환 참조 방지 (execute.ts → index.ts → execute.ts)
    try {
      const freshProject = getProject(project.id);
      if (freshProject && (freshProject.lastScannedIssueCount ?? 0) > 0) {
        console.log(`[Scanner] Agent ${agent.name} freed — re-scanning ${freshProject.name} for waiting issues`);
        const { scanProject } = await import('./index');
        scanProject(freshProject, true);
      }
    } catch (e) { /* ignore */ }
  }
}

/**
 * 충돌 감지 작업 배정: done 상태 이슈가 2개 이상이면 에이전트를 배정하여 MR 충돌을 분석/해결합니다.
 * 기존 이슈 처리와 100% 동일한 관리 흐름 (executeTask 사용).
 * - 이미 충돌 작업이 진행 중이면 (issueIid=0) 추가 배정하지 않음
 */
export async function processConflictCheck(project: Project, decryptedToken: string) {
  // TODO: 충돌 감지는 레이블 기반으로 재구현 필요 (현재 비활성)
  const doneIids: number[] = [];

  if (doneIids.length < 2) {
    updateProjectConflictCount(project.id, 0);
    return;
  }

  // 이미 충돌 작업이 진행 중이면 추가 배정하지 않음 (issueIid=0은 충돌 작업 식별자)
  if (hasActiveExecution(project.id, 0)) {
    console.log(`[Scanner] [SKIP] Conflict check already running for ${project.name}`);
    return;
  }

  // 가용 에이전트 선택 (이슈 배정과 동일한 라운드로빈)
  const assignments = getProjectAssignments(project.id);
  let selectedAgent: Agent | null = null;
  let agentToken = decryptedToken;
  let oldestTime = Infinity;

  for (const pa of assignments) {
    const running = countActiveExecutionsByAgent(pa.agentId);
    if (running === 0) {
      const lastDone = getLastCompletedAt(pa.agentId);
      const t = lastDone ? new Date(lastDone).getTime() : 0;
      if (t < oldestTime) {
        oldestTime = t;
        selectedAgent = pa.agent;
        if (pa.accessToken) {
          try { agentToken = decrypt(pa.accessToken); } catch { agentToken = decryptedToken; }
        }
      }
    }
  }

  if (!selectedAgent) {
    console.log(`[Scanner] [SKIP] No available agent for conflict check on ${project.name}`);
    return;
  }

  console.log(`[Scanner] [ASSIGN-CONFLICT] Project: ${project.name}, Agent: ${selectedAgent.name}, Done issues: ${doneIids.length}`);

  // 충돌 감지를 가상 이슈로 취급하여 기존 executeTask 그대로 사용
  const conflictIssue = {
    iid: 0,
    title: `MR Conflict Check (${doneIids.length} branches: ${doneIids.map(i => `dev-${i}`).join(', ')})`,
    description: buildConflictPrompt(project, doneIids),
  };

  executeTask(project, conflictIssue, selectedAgent, agentToken)
    .then(() => {
      // 실행 완료 후 충돌 수는 에이전트의 커밋/결과 로그에서 확인
      // done 상태로 전환은 executeTask가 자동 처리
      console.log(`[Scanner] [DONE-CONFLICT] ${project.name} conflict check completed.`);
    })
    .catch(err => {
      console.error(`[Scanner] [FAILED-CONFLICT] ${project.name} error:`, err);
      // 충돌 작업은 레이블 없이 DB만 사용하므로 별도 정리 불필요
    });
}

/**
 * 충돌 감지 작업의 이슈 description (프롬프트)을 생성합니다.
 */
function buildConflictPrompt(project: Project, doneIids: number[]): string {
  const branches = doneIids.map(iid => `dev-${iid}`);
  return `## MR Conflict Analysis Task

There are ${branches.length} completed MR branches in this project that have not been merged yet.
When merging them sequentially, conflicts may occur between branches.

### Branches to analyze:
${branches.map(b => `- \`${b}\``).join('\n')}

### Instructions:
1. Fetch all the branches listed above from origin.
2. For each branch, try merging it into the base branch (staging or main) locally:
   - \`git checkout <base>\`
   - \`git merge --no-commit --no-ff origin/<branch>\`
   - Check if conflicts arise. Record which files conflict.
   - \`git merge --abort\` to reset after each test.
3. If merging branch A changes the base, test branch B against the updated base (simulate sequential merge).
4. After analysis, output a summary line in this EXACT format:
   \`CONFLICT_RESULT: <number of branches that would have conflicts>\`
5. If conflicts are found, describe which branches conflict and which files are affected.
6. Do NOT push any changes. This is an analysis task.
7. Leave a brief comment on the project about your findings.`;
}
