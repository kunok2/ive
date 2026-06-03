/**
 * MR/PR 생성, 푸시, 완료 노트, 레이블 전환
 */
import { getLogger } from "../logger";
const slog = getLogger("Scanner");
import fs from "fs";
import { promisify } from "util";
import { Project, Agent } from "@/types";
import { updateExecutionStatus, updateAgentStatus, getAssigneeAuto, getPresetRoles } from "../db";
import { addIssueLabels, removeIssueLabels } from "../provider";
import { notifyIssueDone } from "../slack-notify";
import { runAutoAssign } from "./auto-assign";
import { applyRoleAssignee } from "../role-assignee";
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

// 수행 작업 로그(conversationParts)에 파일 수정 도구 사용 흔적이 있는지 판정.
// "에이전트가 고쳤다고 말은 하는데 실제 diff는 빈" 케이스를 무변경 처리에서 구분하기 위함.
const EDIT_TOOL_RE = /🔧\s*\**\s*(edit|write|multiedit|str[_-]?replace|apply[_-]?patch|patch|create_file|update_file|file_change|notebookedit)\b/i;
function agentAttemptedEdits(conversationParts: string[]): boolean {
  return conversationParts.some((p) => EDIT_TOOL_RE.test(p));
}

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
  //  - CLI 에이전트가 git add를 빠뜨릴 수 있으므로 모든 변경을 스테이징(add -A)한 뒤 판정
  //  - 일부 에이전트(opencode 등)는 "commit 금지" 지시를 무시하고 스스로 커밋해버림.
  //    이 경우 staged diff는 비지만 origin/<base> 대비로는 변경이 존재하므로, base 대비로도 판정해야
  //    "수정했는데 MR이 안 생기는" 케이스를 막을 수 있다.
  await execFile('git', ['add', '-A'], { cwd: workspacePath });
  const { stdout: uncommittedDiff } = await execFile('git', ['diff', '--cached', '--name-only'], { cwd: workspacePath });
  let vsBaseDiff = '';
  try {
    const { stdout } = await execFile('git', ['diff', `origin/${baseBranch}`, '--name-only'], { cwd: workspacePath });
    vsBaseDiff = stdout;
  } catch (e) { slog.warn({ err: e }, `git diff origin/${baseBranch} failed:`); }
  const hasUncommitted = !!uncommittedDiff.trim();
  const hasChanges = hasUncommitted || !!vsBaseDiff.trim();

  if (hasChanges) {
    log("변경사항 감지. 브랜치 생성 후 커밋 및 푸시 중...", 'system');
    // 에이전트가 직접 커밋한 내용은 -B로 그대로 끌고 와서 보존하고,
    // 스테이징만 된(미커밋) 변경이 있을 때만 추가 커밋한다 (변경 없는데 commit하면 실패).
    await execFile('git', ['checkout', '-B', branchName], { cwd: workspacePath });
    if (hasUncommitted) {
      await execFile('git', ['commit', '-m', `fix: resolve #${iid} - ${issueTitle}`], { cwd: workspacePath });
    }

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
    } catch (e) { slog.warn({ err: e }, `Label switch failed:`); }
    log("작업 완료 → 검증대기 (IVE-W). 검증자가 검증시작을 클릭하면 검증이 시작됩니다.", 'system');
    updateExecutionStatus(executionId, 'success', new Date().toISOString());
    await notifyIssueDone({ project, iid, token, status: 'success', agentName: agent.name, durationStr, mrUrl, issueTitle });
    await maybeAutoAssign(project, iid, token, log);
  } else {
    // 코드 변경사항 없음
    const attemptedEdits = agentAttemptedEdits(conversationParts);
    if (attemptedEdits) {
      log("⚠️ 에이전트가 파일 수정 도구를 사용했으나 실제 변경사항이 없습니다 (미반영·되돌림·잘못된 경로 의심).", 'warn');
    } else {
      log("코드 변경사항 없음. 작업 완료로 처리.", 'system');
    }
    const iterLine = iterationCount > 1 ? `\n- **반복 횟수:** ${iterationCount}회` : '';
    const workSummary = conversationParts.length > 0
      ? `\n\n### 📝 수행 작업\n${conversationParts.filter(p => p.trim()).join('\n')}`
      : '';
    // 수정 흔적이 있는데 diff가 비면 "확인 필요"로 표면화한다. 깔끔한 "완료"로 덮지 않는다.
    const noChangeHeading = attemptedEdits
      ? `## ⚠️ 변경사항 없음 — 확인 필요 — ${agent.name}\n\n에이전트가 파일 수정 도구를 사용했으나 저장소에 남은 변경이 없습니다. (변경 미반영·되돌림 또는 잘못된 경로 수정 의심)`
      : `## ✅ 개발 완료 — ${agent.name}\n\n코드 변경사항 없이 완료되었습니다.`;
    const noChangeNote = `<!-- ive-bot -->\n<!-- ive-agent:${agent.id} -->\n${noChangeHeading}\n- **소요 시간:** ${durationStr}${iterLine}${workSummary}`;
    try {
      if (isGitHub) {
        await addGitHubIssueComment(project, iid, token, noChangeNote);
      } else {
        await addGitLabIssueComment(project, iid, token, noChangeNote);
        await addGitLabSpentTime(project, iid, token, durationStr);
      }
    } catch (e) { slog.warn({ err: e }, `Remote comment failed:`); }
    // 레이블 전환: IVE-D 제거, IVE-W 부착 (검증대기)
    try {
      await removeIssueLabels(project, iid, token, [project.labelDev || 'IVE-D']);
      await addIssueLabels(project, iid, token, [project.labelVerifyWait || 'IVE-W']);
    } catch (e) { slog.warn({ err: e }, `Label switch failed:`); }
    updateExecutionStatus(executionId, 'success', new Date().toISOString());
    await notifyIssueDone({ project, iid, token, status: 'success', agentName: agent.name, durationStr, issueTitle });
    await maybeAutoAssign(project, iid, token, log);
  }
}

async function maybeAutoAssign(
  project: Project,
  iid: number,
  token: string,
  log: (msg: string, type?: 'info' | 'error' | 'warn' | 'system') => void,
): Promise<void> {
  // 레거시 assigneeAuto flag (구 폼에서 자동배정 토글) — 하위 호환 유지
  if (getAssigneeAuto(project.id, iid)) {
    try {
      const result = await runAutoAssign(project, iid, token);
      if (result) {
        log(`자동배정 완료 → ${result.name} (@${result.username}, 현재 배정 ${result.count}건)`, 'system');
      } else {
        log("자동배정 스킵 — 후보 멤버가 없습니다.", 'warn');
      }
    } catch (e) {
      log(`자동배정 실패: ${(e as Error).message || e}`, 'warn');
    }
    return;
  }

  // 신규 path — D→W 전이 시 검증자 preset 적용 (이슈 #271)
  // creator: 작성자 / auto: 가장 한가한 멤버 / specific: 사전 지정 사용자
  try {
    const preset = getPresetRoles(project.id, iid).verifier;
    const r = await applyRoleAssignee(project, iid, token, '검증자', preset);
    if (r.success) {
      const modeLabel = preset.mode === 'creator' ? '생성자' : preset.mode === 'auto' ? '자동' : '지정';
      log(`검증자 배정 완료(${modeLabel}) → ${r.username ? '@' + r.username : '(미지정)'}`, 'system');
    }
  } catch (e) {
    log(`검증자 preset 적용 실패: ${(e as Error).message || e}`, 'warn');
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
  const formatted = errMessage.includes('\n')
    ? `\n\n\`\`\`\n${errMessage}\n\`\`\``
    : ` ${errMessage}`;
  const errorNote = `<!-- ive-bot -->\n<!-- ive-agent:${agent.id} -->\n## ❌ 실행 오류 — ${agent.name}\n\n- **오류:**${formatted}`;
  try {
    if (isGitHub) {
      await addGitHubIssueComment(project, iid, token, errorNote);
    } else {
      await addGitLabIssueComment(project, iid, token, errorNote);
    }
  } catch (e) { slog.warn({ err: e }, `Remote comment failed:`); }
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
  } catch (e) { slog.warn({ err: e }, `Remote comment failed:`); }
  updateExecutionStatus(executionId, 'failed', new Date().toISOString());
  await notifyIssueDone({ project, iid, token, status: 'failed', agentName: agent.name, durationStr });
  updateAgentStatus(agent.id, 'available');
  logStream.end();
  try { if (fs.existsSync(workspacePath)) fs.rmSync(workspacePath, { recursive: true, force: true }); } catch {}
}
