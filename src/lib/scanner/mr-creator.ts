/**
 * MR/PR 생성, 푸시, 완료 노트, 레이블 전환
 */
import fs from "fs";
import { promisify } from "util";
import { Project, Agent } from "@/types";
import { updateExecutionStatus, updateAgentStatus } from "../db";
import { addIssueLabels, removeIssueLabels } from "../provider";
import {
  addGitLabIssueComment,
  addGitLabSpentTime,
  createGitLabMR,
  getGitLabMR,
  addGitLabMRNote,
} from "../gitlab";
import {
  addGitHubIssueComment,
  createGitHubPR,
  getGitHubPR,
  addGitHubPRNote,
} from "../github";

const execFile = promisify(require('child_process').execFile);

/**
 * 변경사항을 커밋, 푸시하고 MR/PR을 생성합니다.
 * 변경사항이 없으면 완료 노트만 남깁니다.
 * @returns true if handled successfully (success or no-change), false는 없음 (에러는 throw)
 */
export async function commitPushAndCreateMR(params: {
  executionId: string;
  project: Project;
  agent: Agent;
  iid: number;
  issueTitle: string;
  token: string;
  workspacePath: string;
  baseBranch: string;
  branchName: string;
  iterationCount: number;
  conversationParts: string[];
  durationStr: string;
  logStream: { write(data: string): void; end(): void };
  log: (msg: string, type?: 'info' | 'error' | 'warn' | 'system') => void;
}): Promise<void> {
  const {
    executionId, project, agent, iid, issueTitle, token,
    workspacePath, baseBranch, branchName, iterationCount,
    conversationParts, durationStr, logStream, log,
  } = params;
  const isGitHub = project.provider === 'github';
  const mrLabel = isGitHub ? 'PR' : 'MR';

  // 변경 사항 확인
  const { stdout: diffResult } = await execFile('git', ['diff', '--cached', '--name-only'], { cwd: workspacePath });

  if (diffResult.trim()) {
    log("변경사항 감지. 브랜치 생성 후 커밋 및 푸시 중...", 'system');
    await execFile('git', ['checkout', '-B', branchName], { cwd: workspacePath });
    await execFile('git', ['commit', '-m', `fix: resolve #${iid} - ${issueTitle}`], { cwd: workspacePath });

    // 푸시
    try {
      await execFile('git', ['push', '-f', 'origin', branchName], { cwd: workspacePath });
    } catch (pushErr: any) {
      await handlePushFailure(executionId, project, agent, iid, token, pushErr, durationStr, isGitHub, logStream, log, workspacePath);
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
          title: `fix: resolve #${iid} - ${issueTitle}`,
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
          title: `fix: resolve #${iid} - ${issueTitle}`,
          description: `Auto-generated MR to resolve issue #${iid}. (Iteration #${iterationCount})`,
          remove_source_branch: false,
          squash: true,
        });
        mrUrl = mrResult?.web_url || "";
      }
    }

    // 완료 노트
    const mrLine = mrUrl ? `- **${mrLabel}:** ${mrUrl}` : `- **${mrLabel}:** 생성 실패 (권한 부족 또는 API 오류)`;
    const iterLine = iterationCount > 1 ? `\n- **반복 횟수:** ${iterationCount}회` : '';
    const workSummary = conversationParts.length > 0
      ? `\n\n### 📝 수행 작업\n${conversationParts.filter(p => p.trim()).join('\n')}`
      : '';
    const completionNote = `<!-- ive-bot -->\n<!-- ive-agent:${agent.id} -->\n## ✅ 개발 완료 — ${agent.name}\n\n${mrLine}\n- **소요 시간:** ${durationStr}${iterLine}${workSummary}`;
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
    // 코드 변경사항 없음
    log("코드 변경사항 없음. 작업 완료로 처리.", 'system');
    const iterLine = iterationCount > 1 ? `\n- **반복 횟수:** ${iterationCount}회` : '';
    const workSummary = conversationParts.length > 0
      ? `\n\n### 📝 수행 작업\n${conversationParts.filter(p => p.trim()).join('\n')}`
      : '';
    const noChangeNote = `<!-- ive-bot -->\n<!-- ive-agent:${agent.id} -->\n## ✅ 개발 완료 — ${agent.name}\n\n코드 변경사항 없이 완료되었습니다.\n- **소요 시간:** ${durationStr}${iterLine}${workSummary}`;
    try {
      if (isGitHub) {
        await addGitHubIssueComment(project, iid, token, noChangeNote);
      } else {
        await addGitLabIssueComment(project, iid, token, noChangeNote);
        await addGitLabSpentTime(project, iid, token, durationStr);
      }
    } catch (e) { console.warn(`[Scanner] Remote comment failed:`, e); }
    // 레이블 전환: IVE-D 제거, IVE-W 부착 (검증대기)
    try {
      await removeIssueLabels(project, iid, token, [project.labelDev || 'IVE-D']);
      await addIssueLabels(project, iid, token, [project.labelVerifyWait || 'IVE-W']);
    } catch (e) { console.warn(`[Scanner] Label switch failed:`, e); }
    updateExecutionStatus(executionId, 'success', new Date().toISOString());
  }
}

/**
 * 에러 발생 시 이슈에 에러 노트를 남깁니다.
 */
export async function postErrorNote(
  project: Project,
  agent: Agent,
  iid: number,
  token: string,
  errMessage: string,
  isGitHub: boolean,
): Promise<void> {
  const errorNote = `<!-- ive-bot -->\n<!-- ive-agent:${agent.id} -->\n## ❌ 실행 오류 — ${agent.name}\n\n- **오류:** ${errMessage}`;
  try {
    if (isGitHub) {
      await addGitHubIssueComment(project, iid, token, errorNote);
    } else {
      await addGitLabIssueComment(project, iid, token, errorNote);
    }
  } catch (e) { console.warn(`[Scanner] Remote comment failed:`, e); }
}

/**
 * push 실패 처리
 */
async function handlePushFailure(
  executionId: string,
  project: Project,
  agent: Agent,
  iid: number,
  token: string,
  pushErr: any,
  durationStr: string,
  isGitHub: boolean,
  logStream: { write(data: string): void; end(): void },
  log: (msg: string, type?: 'info' | 'error' | 'warn' | 'system') => void,
  workspacePath: string,
): Promise<void> {
  const pushMsg = pushErr.message || String(pushErr);
  const isPermission = pushMsg.includes('403') || pushMsg.includes('denied') || pushMsg.includes('Permission') || pushMsg.includes('protected');
  log(`push 실패: ${pushMsg}`, 'error');
  const pushFailNote = isPermission
    ? `<!-- ive-bot -->\n<!-- ive-agent:${agent.id} -->\n## ⚠️ 푸시 권한 없음 — ${agent.name}\n\n코드 변경은 완료되었으나 저장소에 푸시할 권한이 없습니다.\n토큰 계정에 쓰기 권한을 부여해주세요.\n- **소요 시간:** ${durationStr}`
    : `<!-- ive-bot -->\n<!-- ive-agent:${agent.id} -->\n## ⚠️ 푸시 실패 — ${agent.name}\n\n- **오류:** ${pushMsg}\n- **소요 시간:** ${durationStr}`;
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
}
