/**
 * MR/PR 생성, 푸시, 완료 노트, 레이블 전환
 */
import { getLogger } from "../logger";
const slog = getLogger("Scanner");
import fs from "fs";
import { promisify } from "util";
import { Project, Agent } from "@/types";
import { updateExecutionStatus, updateAgentStatus, getAssigneeAuto, getPresetRoles, getProjectAutomation, recordStageEvent } from "../db";
import { agentActor, executionPromptVersion } from "../event-actor";
import { addIssueLabels, removeIssueLabels } from "../provider";
import { notifyStageTransition } from "../slack-notify";
import { runAutoAssign } from "./auto-assign";
import type { PreservedChanges } from "./git-ops";
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

// 이슈 노트에 실을 「수행 작업」 요약을 만든다.
// ⛔ 도구 호출 줄(`> **🔧 Bash** `$ grep …``)은 싣지 않는다 — 사람이 읽을 것이 못 되고,
//    수백 줄이 붙어 정작 무엇을 왜 고쳤는지가 묻힌다(사용자 지적 2026-09-02).
//    판정에 쓰는 원본(conversationParts)은 그대로 두고, **노트에 실을 때만** 걷어낸다.
const TOOL_LINE_RE = /^\s*>\s*\*\*🔧/;
export function buildWorkSummary(conversationParts: string[]): string {
  const kept: string[] = [];
  // 여러 줄짜리 명령(heredoc·python3 -c "…")은 첫 줄만 🔧 로 시작하고 나머지 줄은 맨몸으로 따라온다.
  // 그 꼬리까지 걷어내려고, 백틱이 닫히지 않은 도구 줄을 만나면 닫힐 때까지 계속 버린다.
  let skipping = false;
  for (const line of conversationParts.flatMap((p) => p.split('\n'))) {
    if (skipping) {
      if (line.trimEnd().endsWith('`')) skipping = false;
      continue;
    }
    if (TOOL_LINE_RE.test(line)) {
      if (!line.trimEnd().endsWith('`')) skipping = true;
      continue;
    }
    // 도구 줄 사이에 남는 빈 인용줄(`>`)도 버린다.
    if (line.trim() && !/^\s*>\s*$/.test(line)) kept.push(line);
  }
  const prose = kept.join('\n').trim();
  return prose ? `\n\n### 📝 수행 작업\n${prose}` : '';
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

  // 커밋·MR 문구 — 프로젝트 설정 「MR 머지로 이슈 자동 닫기」(기본 켬 = 종전 문구)
  //   켬 : 「fix: resolve #N - 제목」 Git 닫기 키워드 — 기본 브랜치에 머지되면 Git 이 이슈를 닫는다(종전 동작)
  //   끔 : 「fix(#N): 제목」 — 이슈는 확인을 거쳐 완료(E)가 될 때 IVE 가 닫는다(단계 자동화·묶음 배포를 쓰는 프로젝트)
  const closeOnMerge = getProjectAutomation(project.id).closeIssueOnMerge
  const commitTitle = closeOnMerge ? `fix: resolve #${iid} - ${issueTitle}` : `fix(#${iid}): ${issueTitle}`
  const mrDescription = (kind: 'MR' | 'PR') => closeOnMerge
    ? `Auto-generated ${kind} to resolve issue #${iid}. (Iteration #${iterationCount})`
    : `Auto-generated ${kind} for issue #${iid}. (Iteration #${iterationCount})`
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
      await execFile('git', ['commit', '-m', commitTitle], { cwd: workspacePath });
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
          title: commitTitle,
          description: mrDescription('PR'),
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
          title: commitTitle,
          description: mrDescription('MR'),
          remove_source_branch: false,
          squash: true,
        });
        mrUrl = mrResult?.web_url || "";
      }
    }

    // 완료 노트
    const mrLine = mrUrl ? `- **${mrLabel}:** ${mrUrl}` : `- **${mrLabel}:** 생성 실패 (권한 부족 또는 API 오류)`;
    const iterLine = iterationCount > 1 ? `\n- **반복 횟수:** ${iterationCount}회` : '';
    const workSummary = buildWorkSummary(conversationParts);
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
      // 사건 로그 — 에이전트 처리 완료(처리 → 검증대기). 다음 스캔이 같은 전이를 감지해도 중복 기록하지 않는다
      recordStageEvent({
        projectId: project.id, issueIid: iid, fromStage: 'dev', toStage: 'verify_waiting', action: 'complete',
        actor: agentActor(agent, executionId), source: 'worker', executionId,
        promptVersion: executionPromptVersion(executionId),
        detail: { changes: true },
      });
    } catch (e) { slog.warn({ err: e }, `Label switch failed:`); }
    log("작업 완료 → 검증대기 (IVE-W). 검증자가 검증시작을 클릭하면 검증이 시작됩니다.", 'system');
    updateExecutionStatus(executionId, 'success', new Date().toISOString());
    await maybeAutoAssign(project, iid, token, log);
    // 검증대기 진입 → 배정된 검증자(사람)에게 DM (maybeAutoAssign 으로 검증자 배정된 뒤)
    await notifyStageTransition(project, iid, token, 'verify');
  } else {
    // 코드 변경사항 없음
    const attemptedEdits = agentAttemptedEdits(conversationParts);
    if (attemptedEdits) {
      log("⚠️ 에이전트가 파일 수정 도구를 사용했으나 실제 변경사항이 없습니다 (미반영·되돌림·잘못된 경로 의심).", 'warn');
    } else {
      log("코드 변경사항 없음. 작업 완료로 처리.", 'system');
    }
    const iterLine = iterationCount > 1 ? `\n- **반복 횟수:** ${iterationCount}회` : '';
    const workSummary = buildWorkSummary(conversationParts);
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
      // 사건 로그 — 에이전트 처리 완료(처리 → 검증대기). 다음 스캔이 같은 전이를 감지해도 중복 기록하지 않는다
      recordStageEvent({
        projectId: project.id, issueIid: iid, fromStage: 'dev', toStage: 'verify_waiting', action: 'complete',
        actor: agentActor(agent, executionId), source: 'worker', executionId,
        promptVersion: executionPromptVersion(executionId),
        detail: { changes: false },
      });
    } catch (e) { slog.warn({ err: e }, `Label switch failed:`); }
    updateExecutionStatus(executionId, 'success', new Date().toISOString());
    await maybeAutoAssign(project, iid, token, log);
    // 검증대기 진입 → 배정된 검증자(사람)에게 DM
    await notifyStageTransition(project, iid, token, 'verify');
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
  preserved?: PreservedChanges | null,
): Promise<void> {
  const formatted = errMessage.includes('\n')
    ? `\n\n\`\`\`\n${errMessage}\n\`\`\``
    : ` ${errMessage}`;
  let errorNote = `<!-- ive-bot -->\n<!-- ive-agent:${agent.id} -->\n## ❌ 실행 오류 — ${agent.name}\n\n- **오류:**${formatted}`;
  if (preserved) {
    // 패치 본문은 코멘트 한도를 넘지 않게 작은 것만 싣는다. 큰 것은 서버 파일 경로만 남긴다.
    const PATCH_INLINE_MAX = 40000;
    const fileName = preserved.patchPath.split('/').pop();
    errorNote += `\n\n### 중단 시점까지의 변경 (보존됨)\n\n서버 \`data/logs/${fileName}\` 에 패치로 저장했습니다. \`git apply\` 로 되살릴 수 있습니다.\n\n\`\`\`\n${preserved.stat}\n\`\`\``;
    if (preserved.patch.length <= PATCH_INLINE_MAX && !preserved.patch.includes('GIT binary patch')) {
      errorNote += `\n\n<details>\n<summary>패치 전문</summary>\n\n\`\`\`diff\n${preserved.patch}\n\`\`\`\n</details>`;
    }
  }
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
  updateAgentStatus(agent.id, 'available');
  logStream.end();
  try { if (fs.existsSync(workspacePath)) fs.rmSync(workspacePath, { recursive: true, force: true }); } catch {}
}
