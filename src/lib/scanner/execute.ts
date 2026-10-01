/**
 * 에이전트 실행 오케스트레이터.
 * 실제 작업은 git-ops, cli-runner, mr-creator 서브모듈에 위임합니다.
 */
import { getLogger } from "../logger";
const slog = getLogger("Scanner");
import {
  getProject,
  createExecution,
  updateExecutionStatus,
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
  upsertIssueStageSnapshot,
  getAvailableAgentsByUser,
} from "../db";
import { addIssueLabels, removeIssueLabels } from "../provider";
import { fetchGitLabIssueNotes } from "../gitlab";
import { fetchGitHubIssueNotes } from "../github";
import { Project, Agent } from "@/types";
import { defaultLocale } from "@/i18n/config";
import fs from "fs";
import path from "path";
import { setupWorkspace, preserveWorkspaceChanges } from "./git-ops";
import { getMaxRunMinutes, resolveCliPath, runCliProcess } from "./cli-runner";
import { downloadIssueImages } from "./issue-images";
import { commitPushAndCreateMR, postErrorNote } from "./mr-creator";
import { buildPrompt, buildConflictPrompt } from "./prompt-builder";
import { runStageWorker, type StageKindSpec } from "./stage-worker";
import { resolveEditable } from "../role-prompts";

interface DevPrep {
  baseBranch: string;
  branchName: string;
  iterationCount: number;
  latestFeedback: string;
  iterationContext: string;
  issueImageTexts: string[];
}

/**
 * 처리(D) 단계 작업자 — 기존 executeTask 동작 그대로(라벨 S→D, 반복 피드백, MR 생성).
 * 공용 틀(에이전트 점유·로그·CLI·오류 보존·정리)은 stage-worker 가 맡는다.
 */
function devStageSpec(waitingSince?: string | null): StageKindSpec<DevPrep> {
  return {
    kind: 'dev',
    label: '처리',

    register(ctx) {
      const { project, iid, issue, agent, executionId, logPath } = ctx;
      const isConflictTask = iid === 0; // iid=0: 충돌 감지 작업

      // 0. DB에 실행 시작 기록 — 트랜잭션으로 중복 배정 방지
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
        slog.info(`[SKIP] Issue #${iid} already has active execution (race condition prevented in executeTask)`);
        return false;
      }
      if (isConflictTask) {
        createExecution(execution);
      }
      return true;
    },

    async prepare(ctx) {
      const { project, iid, issue, agent, token, executionId, workspacePath, log, isGitHub } = ctx;
      const isConflictTask = iid === 0;

      // 배정 즉시 cached_stage를 'dev'로 업데이트
      if (!isConflictTask) {
        try {
          // 담당자가 없으면 이슈 작성자를 담당자로 간주
          const assignee = (issue.assignees && issue.assignees.length > 0) ? issue.assignees[0] : (issue.author || null);
          upsertIssueStageSnapshot(project.id, iid, {
            cachedStage: 'dev',
            assigneeUsername: assignee ? (assignee.username || assignee.login || null) : null,
            assigneeName: assignee ? (assignee.name || assignee.username || assignee.login || null) : null,
            assigneeAvatar: assignee ? (assignee.avatar_url || null) : null,
            assigneeProvider: project.provider,
            assigneeGitUserId: assignee && assignee.id != null ? String(assignee.id) : null,
            issueTitle: issue.title || null,
          });
        } catch (e) { slog.warn({ err: e }, `Failed to update cached_stage to dev for #${iid}:`); }

        // 레이블 전환: IVE-S 제거, IVE-D 부착 (개발 시작)
        try {
          await removeIssueLabels(project, iid, token, [project.labelSchedule || 'IVE-S']);
          await addIssueLabels(project, iid, token, [project.labelDev || 'IVE-D']);
        } catch (e) { slog.warn({ err: e }, `Failed to switch labels on #${iid}:`); }

        // 작업 등록 활동 로그
        try {
          createActivityLog({
            userId: project.userId,
            category: 'task',
            action: 'create_task',
            detail: `작업 등록 (이슈 #${iid}, ${project.name}, 에이전트: ${agent.name})`,
            targetType: 'execution',
            targetId: executionId,
          })
        } catch (e) {
          slog.error({ err: e }, 'Failed to log task activity:')
        }
      }

      // 1-2. Git 클론 및 브랜치 생성
      const { baseBranch, branchName } = await setupWorkspace(project, workspacePath, iid, token, isConflictTask, log);

      // 3. 이전 작업 이력 및 사용자 피드백 확인
      let iterationCount = 1;
      let latestFeedback = "";
      let iterationContext = "";
      // 이슈 본문 + (사용자) 코멘트의 첨부 이미지를 모아 에이전트에게 분석시킬 텍스트
      const issueImageTexts: string[] = [issue.description || issue.body || ""];

      if (!isConflictTask) {
        const notes = isGitHub
          ? await fetchGitHubIssueNotes(project, iid, token)
          : await fetchGitLabIssueNotes(project, iid, token);
        const botCompletions = notes.filter((n: any) => n.body.includes("<!-- ive-bot -->") || n.body.includes("IVE(봇)"));
        iterationCount = botCompletions.length + 1;

        const userNotes = notes.filter((n: any) =>
          !n.system &&
          !n.body.includes("<!-- ive-bot -->") &&
          !n.body.includes("IVE(봇)")
        );
        // 사용자 코멘트의 첨부 이미지도 분석 대상에 포함 (봇/시스템 노트 제외)
        issueImageTexts.push(...userNotes.map((n: any) => n.body || ""));

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
        if (latestFeedback) {
          log('=== 사용자 피드백 ===', 'system');
          log(latestFeedback, 'info');
          log('=== 피드백 끝 ===', 'system');
        }
      }

      return { baseBranch, branchName, iterationCount, latestFeedback, iterationContext, issueImageTexts };
    },

    async buildPrompt(ctx, prep) {
      const { project, iid, issue, agent, token, workspacePath, log, isGitHub, isKo } = ctx;
      const isConflictTask = iid === 0;
      // 역할 프롬프트 「처리」 덮어쓰기 (없으면 기존 문자열 그대로)
      const { editable, version } = isConflictTask
        ? { editable: null, version: 'dev:conflict' }
        : resolveEditable(project.id, 'dev');

      // 4. 프롬프트 구성
      // 프로젝트가 OAuth 토큰을 쓰는 경우 에이전트에게 Bearer 헤더를 쓰도록 지시.
      // PAT 기반이면 PRIVATE-TOKEN 유지. 잘못된 헤더는 401 → 에이전트가 "토큰 만료"로 오해함.
      const prompt = buildPrompt(project, issue, iid, isConflictTask, isGitHub, isKo, prep.iterationCount, prep.latestFeedback, prep.iterationContext, !!project.usesOAuthToken, agent.id, getMaxRunMinutes(), editable);

      // 4-1. 첨부 이미지 다운로드 → 워크스페이스 저장 → 프롬프트에 경로 안내 (에이전트가 분석)
      const issueImagePaths = await downloadIssueImages(
        project, token, prep.issueImageTexts, path.join(workspacePath, '.issue-attachments'), log,
      ).catch(() => [] as string[]);
      let finalPrompt = prompt;
      if (issueImagePaths.length > 0) {
        // 다운로드한 첨부는 참고용 — MR/커밋에 섞이지 않도록 git 로컬 exclude 처리
        try {
          const excludePath = path.join(workspacePath, '.git', 'info', 'exclude');
          const cur = fs.existsSync(excludePath) ? fs.readFileSync(excludePath, 'utf8') : '';
          if (!cur.includes('.issue-attachments')) fs.appendFileSync(excludePath, '\n.issue-attachments/\n');
        } catch { /* ignore */ }
        const rels = issueImagePaths.map(p => `- ${path.relative(workspacePath, p)}`).join('\n');
        finalPrompt += isKo
          ? `\n\n## 첨부 이미지\n이 이슈(본문/코멘트)에 다음 이미지가 첨부되어 있습니다(현재 작업 디렉토리 기준 경로). 작업과 관련하여 반드시 확인하세요. 단, 이 파일들은 참고용이므로 커밋/스테이징하지 마세요:\n${rels}`
          : `\n\n## Attached images\nThis issue has the following attached image(s) (paths relative to the current working directory). You MUST review them as relevant to the task. Do NOT commit or stage these files — they are reference only:\n${rels}`;
      }
      return { prompt: finalPrompt, promptVersion: version, imagePaths: issueImagePaths };
    },

    async onResult(ctx, prep, cli) {
      const { project, iid, issue, agent, token, executionId, workspacePath, logPath, logStream, log } = ctx;
      const isConflictTask = iid === 0;
      const conversationParts = cli.conversationParts;
      const durationStr = `${Math.max(1, Math.floor(cli.durationSeconds / 60))}m`;

      // 6. 충돌 감지 작업 완료 처리
      if (isConflictTask) {
        let conflictCount = 0;
        try {
          const logContent = fs.readFileSync(logPath, 'utf-8');
          const match = logContent.match(/CONFLICT_RESULT:\s*(\d+)/);
          if (match) conflictCount = parseInt(match[1], 10);
        } catch {}
        updateProjectConflictCount(project.id, conflictCount);
        log(`충돌 분석 완료. 충돌 수: ${conflictCount}`, 'system');
        updateExecutionStatus(executionId, 'success', new Date().toISOString());
      } else {
        // 7. 커밋, 푸시, MR/PR 생성
        await commitPushAndCreateMR({
          executionId, project, agent, iid,
          issueTitle: issue.title,
          token, workspacePath, baseBranch: prep.baseBranch, branchName: prep.branchName,
          iterationCount: prep.iterationCount, conversationParts, durationStr,
          logStream, log,
        });
      }
    },

    async onError(ctx, _prep, err) {
      const { project, iid, agent, token, executionId, workspacePath, logDir, log, isGitHub } = ctx;
      const isConflictTask = iid === 0;
      if (isConflictTask) {
        updateProjectConflictCount(project.id, 0);
      } else {
        // 중지·시간 상한·오류로 끝나도 그때까지 한 수정은 남긴다 — 작업 디렉토리는 finally 에서 지워진다.
        const preserved = await preserveWorkspaceChanges(workspacePath, logDir, executionId);
        if (preserved) log(`변경 보존: ${preserved.patchPath}\n${preserved.stat}`, 'system');
        await postErrorNote(project, agent, iid, token, err.message, isGitHub, preserved);
      }
    },
  };
}

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
  await runStageWorker(devStageSpec(waitingSince), { project, issue, agent, token, executionId, workspacePath });
}

/**
 * 충돌 감지 작업 배정: done 상태 이슈가 2개 이상이면 에이전트를 배정하여 MR 충돌을 분석/해결합니다.
 */
export async function processConflictCheck(project: Project, decryptedToken: string) {
  // TODO: 충돌 감지는 레이블 기반으로 재구현 필요 (현재 비활성)
  const doneIids: number[] = [];

  if (doneIids.length < 2) {
    updateProjectConflictCount(project.id, 0);
    return;
  }

  if (hasActiveExecution(project.id, 0)) {
    slog.info(`[SKIP] Conflict check already running for ${project.name}`);
    return;
  }

  // 충돌 감지는 프로젝트 단위 작업 → 프로젝트 오너의 에이전트 풀 사용 (사용중지 제외)
  const ownerAgents = getAvailableAgentsByUser(project.userId);
  let selectedAgent: Agent | null = null;
  const agentToken = decryptedToken;
  let oldestTime = Infinity;

  for (const a of ownerAgents) {
    const running = countActiveExecutionsByAgent(a.id);
    if (running === 0) {
      const lastDone = getLastCompletedAt(a.id);
      const t = lastDone ? new Date(lastDone).getTime() : 0;
      if (t < oldestTime) {
        oldestTime = t;
        selectedAgent = a;
      }
    }
  }

  if (!selectedAgent) {
    slog.info(`[SKIP] No available agent for conflict check on ${project.name}`);
    return;
  }

  slog.info(`[ASSIGN-CONFLICT] Project: ${project.name}, Agent: ${selectedAgent.name}, Done issues: ${doneIids.length}`);

  const conflictIssue = {
    iid: 0,
    title: `MR Conflict Check (${doneIids.length} branches: ${doneIids.map(i => `dev-${i}`).join(', ')})`,
    description: buildConflictPrompt(project, doneIids),
  };

  executeTask(project, conflictIssue, selectedAgent, agentToken)
    .then(() => {
      slog.info(`[DONE-CONFLICT] ${project.name} conflict check completed.`);
    })
    .catch(err => {
      slog.error({ err: err }, `[FAILED-CONFLICT] ${project.name} error:`);
    });
}
