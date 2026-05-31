import { getLogger } from "../logger";
const slog = getLogger("Scanner");
import {
  getAllProjects,
  getProject,
  updateProjectLastChecked,
  updateProjectError,
  getAgentsByUser,
  createExecution,
  updateExecutionStatus,
  updateExecutionTokens,
  resetStuckExecutions,
  hasActiveExecution,
  hasAnyExecution,
  countActiveExecutionsByAgent,
  updateAgentStatus,
  getLastCompletedAt,
  getSystemSetting,
  stageFromLabels,
  updateProjectConflictCount,
  getAssignModeMap,
  getUserById,
  assignIssueAtomically,
  createActivityLog,
  touchProjectActivity,
  recordIssueScheduledAt,
  getIssueScheduledAt,
  getAssignedUserExecution,
  upsertIssueStageSnapshot,
  replaceProjectMembers,
  getDb,
  getCachedStage,
  markIssueVerifyStarted,
  markIssueVerified,
  markIssueVerifyRejected,
  getIssueAssigneeUsername,
  getProjectWithUserOAuth,
  updateUserOAuthTokens,
  getOAuthProviderRaw,
} from "../db";
import { fetchProjectMembers } from "../provider";
import { decrypt, encrypt } from "../crypto";
import { defaultLocale } from "@/i18n/config";
import { addIssueLabels, removeIssueLabels, addIssueComment, createBranch, getDefaultBranch, closeIssue } from "../provider";
import {
  ensureGitLabLabels,
  fetchGitLabIssues,
  addGitLabIssueComment,
  fetchGitLabIssueNotes,
  addGitLabSpentTime,
  createGitLabMR,
  getGitLabMR,
  addGitLabMRNote,
  refreshGitLabToken,
} from "../gitlab";
import {
  ensureGitHubLabels,
  fetchGitHubIssues,
  addGitHubIssueComment,
  fetchGitHubIssueNotes,
  createGitHubPR,
  getGitHubPR,
  addGitHubPRNote,
} from "../github";
import { Project, Agent } from "@/types";
import { resolveIssueRequesterAsync } from "../ive-author";
import { fetchIssueLabelEvents } from "../provider";
import { isGitBotUser } from "../git-bot";
import { startStatsCollector } from "../stats-collector";
import { startReportScheduler } from "../report-scheduler";
import { startChatSessionReaper } from "../chat-agent";
import fs from "fs";
import path from "path";
import { parseIveMeta } from "./formatters";
import { executeTask } from "./execute";

// Re-export for external consumers
export { executeTask } from "./execute";
export {
  parseIveMeta,
  formatOpenCodeEvent,
  formatOpenCodeEventMarkdown,
  extractMeta,
  formatStreamEvent,
  formatStreamEventMarkdown,
  formatToolInputMarkdown,
  formatToolInput,
} from "./formatters";

// 프로젝트별 멤버 캐시 갱신 시각 (30분 throttle)
const memberSyncAt = new Map<string, number>();

declare global {
  var scanInterval: NodeJS.Timeout | undefined;
  var isScanning: boolean;
  var pendingScanProjectId: string | null | undefined; // 스캔 중 트리거된 프로젝트 ID (undefined = 없음, null = 전체)
}

export function startScanner() {
  if (global.scanInterval) {
    slog.info("Scanner already running. (V2)");
    return;
  }

  global.isScanning = false;
  slog.info("Starting background scanner... (V2)");

  // 서버 재시작으로 고착된 실행 복구
  resetStuckExecutions();

  // 30초마다 전체 프로젝트 체크 (각 프로젝트의 checkInterval에 따라 실제 작업 수행 결정)
  // 1분 주기 프로젝트를 안정적으로 잡기 위해 폴링 주기를 30초로 설정
  global.scanInterval = setInterval(runScan, 30 * 1000);

  // 첫 실행은 약간의 지연 후 실행 (서버 초기화 완료 대기)
  setTimeout(runScan, 5000);

  // 통계 수집기 시작
  startStatsCollector();

  // 보고서 자동 발송 스케줄러 시작
  startReportScheduler();

  // 채팅 세션 idle 리퍼 시작 (페이지 이탈로 방치된 세션 정리)
  startChatSessionReaper();

}

export function triggerScan(projectId?: string) {
  slog.info(`Triggered scan${projectId ? ` for project ${projectId}` : ' (all projects)'}`);

  if (global.isScanning) {
    // 스캔 중이면 pending에 기록해두고 현재 스캔이 끝난 뒤 실행
    // undefined(없음) → 해당 projectId로 설정
    // 이미 pending이 있으면 null(전체)로 확장
    if (global.pendingScanProjectId === undefined) {
      global.pendingScanProjectId = projectId ?? null
    } else if (global.pendingScanProjectId !== null && global.pendingScanProjectId !== projectId) {
      global.pendingScanProjectId = null // 다른 프로젝트 → 전체 스캔으로 확장
    }
    slog.info(`Scan in progress, queued for after: projectId=${global.pendingScanProjectId ?? 'all'}`)
    return
  }

  runScanImmediate(projectId);
}

async function runScanImmediate(projectId?: string) {
  if (global.isScanning) return;

  global.isScanning = true;
  global.pendingScanProjectId = undefined;
  slog.info(`Running immediate scan${projectId ? ` for project ${projectId}` : ''}...`);

  try {
    if (projectId) {
      const project = getProject(projectId);
      if (project) {
        await scanProject(project, true);
      }
    } else {
      const projects = getAllProjects();
      for (const project of projects) {
        await scanProject(project, true);
      }
    }
  } catch (err) {
    slog.error({ err: err }, `Immediate scan error:`);
  } finally {
    finishScan();
  }
}

/**
 * 스캔 종료 공통 처리. 백그라운드 루프(runScan)와 즉시 스캔(runScanImmediate)이
 * 모두 이 함수로 끝나야 한다. isScanning을 해제하고, 스캔 중 들어와 큐잉된
 * 수동/이벤트 트리거(pendingScanProjectId)가 있으면 이어서 실행한다.
 *
 * ※ 과거에는 드레인 로직이 runScanImmediate에만 있어, 백그라운드 스캔이 진행 중일 때
 *   들어온 triggerScan이 pending에 쌓이기만 하고 영영 실행되지 않는 버그가 있었다.
 */
function finishScan() {
  global.isScanning = false;

  const pending = global.pendingScanProjectId;
  if (pending !== undefined) {
    global.pendingScanProjectId = undefined;
    slog.info(`Running pending scan${pending ? ` for project ${pending}` : ''}...`);
    runScanImmediate(pending ?? undefined);
  }
}

export function stopScanner() {
  if (global.scanInterval) {
    clearInterval(global.scanInterval);
    global.scanInterval = undefined;
    global.isScanning = false;
    slog.info("Stopped background scanner.");
  }
}

async function runScan() {
  if (global.isScanning) {
    slog.info("Skip: Previous scan still in progress...");
    return;
  }

  global.isScanning = true;
  slog.info(`Core Tick: ${new Date().toISOString()}`);

  try {
    const projects = getAllProjects();
    for (const project of projects) {
      await scanProject(project, false);
    }
  } catch (err) {
    slog.error({ err: err }, `Core runScan error:`);
  } finally {
    finishScan();
  }
}

/**
 * 특정 프로젝트의 스캔을 수행합니다.
 * @param force true인 경우 checkInterval을 무시하고 즉시 스캔합니다.
 */
async function scanProject(project: Project, force: boolean = false) {
  try {
    // 스캐너 활성화 여부 확인 (수동 실행 시에도 비활성 상태면 건너뜀)
    if (!force && project.scannerActive === false) {
      return;
    }

    const now = new Date();

    // 체크 주기 확인 (10초 여유를 두어 setInterval 타이밍 오차 방지)
    if (!force && project.lastCheckedAt) {
      const lastChecked = new Date(project.lastCheckedAt);
      const diffMs = now.getTime() - lastChecked.getTime();
      const thresholdMs = project.checkInterval * 60 * 1000 - 10000;
      if (diffMs < thresholdMs) {
        return; // 아직 체크할 시간이 아님
      }
    }

    slog.info(`${force ? 'FORCED ' : ''}Scanning project: ${project.name}`);

    let decryptedToken = decrypt(project.accessToken);

    // OAuth 토큰 처리
    if (project.usesOAuthToken) {
      try {
        const full = getProjectWithUserOAuth(project.id);
        if (full?.oauth_access_token) {
          decryptedToken = decrypt(full.oauth_access_token);

          // 만료 시간 체크 (현재로부터 10분 이내면 갱신)
          const expiresAt = full.oauth_token_expires_at ? new Date(full.oauth_token_expires_at).getTime() : 0;
          const nowMs = Date.now();

          if (expiresAt < nowMs + 10 * 60 * 1000) {
            slog.info(`OAuth token expiring soon for ${project.name}, refreshing...`);
            const providerRaw = full.oauth_provider_id ? getOAuthProviderRaw(full.oauth_provider_id) : null;
            if (providerRaw && full.oauth_refresh_token) {
              const refreshPlain = decrypt(full.oauth_refresh_token);
              const clientSecretPlain = providerRaw.client_secret ? decrypt(providerRaw.client_secret) : '';

              const refreshed = await refreshGitLabToken(project.repoUrl, providerRaw.client_id, clientSecretPlain, refreshPlain);
              if (refreshed.access_token) {
                decryptedToken = refreshed.access_token;
                const newExpiry = new Date(Date.now() + (refreshed.expires_in || 7200) * 1000).toISOString();

                // DB 업데이트
                updateUserOAuthTokens(project.userId, {
                  accessTokenEncrypted: encrypt(refreshed.access_token),
                  refreshTokenEncrypted: encrypt(refreshed.refresh_token || refreshPlain),
                  tokenExpiresAt: newExpiry
                });
                slog.info(`OAuth token refreshed for ${project.name}`);
              }
            } else {
              slog.warn(`Cannot refresh OAuth token for ${project.name}: missing provider or refresh_token`);
            }
          }
        }
      } catch (e) {
        slog.error({ err: e }, `OAuth handling failed for ${project.name}:`);
        // 실패 시 에러만 남기고 기존 토큰으로 시도 (혹시 모르니)
      }
    }

    // 프로젝트 멤버 캐시 갱신 (30분 간격 throttle) — 검증자 후보 풀에 사용
    const lastMemberSyncMs = memberSyncAt.get(project.id) || 0;
    if (force || (Date.now() - lastMemberSyncMs) > 30 * 60 * 1000) {
      try {
        const members = await fetchProjectMembers(project, decryptedToken);
        // gitlab.ts/github.ts는 { id, username, name, avatarUrl } (camelCase) 반환.
        // 과거 형식 대비해 snake_case(avatar_url)도 fallback으로 받음.
        const mapped = (members || []).map((m: { id?: number | string; username?: string; login?: string; name?: string; avatarUrl?: string; avatar_url?: string }) => ({
          username: m.username || m.login || '',
          name: m.name || m.username || m.login || '',
          avatarUrl: m.avatarUrl || m.avatar_url || '',
          provider: project.provider,
          // GitLab: members[].id (numeric), GitHub: collaborators[].id — 문자열화
          gitUserId: m.id != null ? String(m.id) : null,
        })).filter((m: { username: string }) => m.username);
        replaceProjectMembers(project.id, mapped);
        memberSyncAt.set(project.id, Date.now());
        slog.info(`Cached ${mapped.length} members for project ${project.name}`);
      } catch (e) {
        slog.warn(`fetchProjectMembers failed for ${project.name}:`, (e as Error).message);
      }
    }
    let issueCount = 0;           // 처리 대기 (waiting) 이슈 수
    let verifyWaitingCount = 0;   // 검증 대기 이슈 수

    // 레이블 동기화는 프로젝트 설정에서 수동으로 수행
    // (스캐너에서 자동 생성하지 않음 — 권한 없을 수 있음)

    // 모든 상태 레이블로 이슈를 조회합니다.
    // IVE 레이블이 없으면 IVE에서 관리하지 않는 이슈이므로 무시합니다.
    const fetchIssues = project.provider === 'github' ? fetchGitHubIssues : fetchGitLabIssues;
    const labelTarget = project.labelTarget;
    const labelS = project.labelSchedule || 'IVE-S';
    const labelD = project.labelDev || 'IVE-D';
    const labelW = project.labelVerifyWait || 'IVE-W';
    const labelV = project.labelVerify || 'IVE-V';
    const labelE = project.labelEnd || 'IVE-E';

    // IVE 레이블이 있는 이슈를 기본으로 조회 (모든 IVE 관리 이슈)
    // + 상태 레이블 이슈도 병합 (IVE 없이 상태 레이블만 남은 경우 정리용)
    const [targetIssues, sIssues, dIssues, wIssues, vIssues, eIssues] = await Promise.all([
      fetchIssues(project, decryptedToken, labelTarget),
      fetchIssues(project, decryptedToken, labelS),
      fetchIssues(project, decryptedToken, labelD),
      fetchIssues(project, decryptedToken, labelW),
      fetchIssues(project, decryptedToken, labelV),
      fetchIssues(project, decryptedToken, labelE),
    ]);

    // 이슈를 Map으로 병합 (iid → issue), closed 제외
    const issueMap = new Map<number, any>();
    for (const issue of [...targetIssues, ...sIssues, ...dIssues, ...wIssues, ...vIssues, ...eIssues]) {
      if (issue.state === 'closed') continue;
      issueMap.set(issue.iid, issue);
    }

    // 레이블 정리: IVE 없이 상태 레이블만 있는 이슈 → 상태 레이블 제거 (고아 정리)
    // 고아 레이블 정리 및 중복 레이블 정리
    for (const [iid, issue] of issueMap) {
      const labels: string[] = issue.labels || [];
      const hasTarget = labels.includes(labelTarget);

      if (!hasTarget) {
        // IVE 레이블 없음 — 고아 상태 레이블 정리
        const orphanLabels = [labelS, labelD, labelW, labelV, labelE].filter(l => labels.includes(l));
        if (orphanLabels.length > 0) {
          try { await removeIssueLabels(project, iid, decryptedToken, orphanLabels); } catch { /* ignore */ }
          slog.info(`Issue #${iid} — orphan labels removed (no ${labelTarget}): ${orphanLabels.join(', ')}`);
        }
        issueMap.delete(iid);
        continue;
      }

      // IVE-E가 있으면서 이전 단계 레이블 잔류 → 정리
      if (labels.includes(labelE)) {
        const staleLabels = [labelS, labelD, labelW, labelV].filter(l => labels.includes(l));
        if (staleLabels.length > 0) {
          try { await removeIssueLabels(project, iid, decryptedToken, staleLabels); } catch { /* ignore */ }
          slog.info(`Issue #${iid} — cleaned stale labels (has ${labelE}): ${staleLabels.join(', ')}`);
        }
      }
    }

    // 레이블로 상태 판정 후, waiting 이슈를 processIssues로 전달
    const waitingIssues: any[] = []
    const processedIids = new Set<number>()
    for (const [iid, issue] of issueMap) {
      processedIids.add(iid)
      const labels: string[] = issue.labels || []
      const activeExec = hasActiveExecution(project.id, iid);
      const stage = stageFromLabels(labels, project, { hasActiveExec: activeExec });

      // ── 이전 stage와 비교해 Git UI에서 수동으로 검증 단계를 전환했는지 감지 ──
      // 사용자가 Git UI에서 레이블을 직접 바꾼 경우에도 verify_started_at / verified_at / rejected_at이
      // 정확히 기록되어야 보고서 검증 통계가 맞는다.
      const prevStage = getCachedStage(project.id, iid);
      try {
        // 검증 시작 감지: 임의 단계 → verifying
        if (stage === 'verifying' && prevStage !== 'verifying') {
          markIssueVerifyStarted(project.id, iid);
        }
        // 검증 승인 감지: verifying → done (또는 verifying → verify_waiting 건너뛰고 done로)
        if (stage === 'done' && prevStage === 'verifying') {
          const verifierInfo = getIssueAssigneeUsername(project.id, iid);
          markIssueVerified(project.id, iid, {
            name: verifierInfo.name || '',
            avatar: verifierInfo.avatar || undefined,
            username: verifierInfo.username,
          });
        }
        // 검증 반려 감지: verifying → 그 외(승인=done만 제외)
        // null(IVE 레이블 전체 제거)도 포함 — 사용자가 검증을 포기한 경우로 간주
        if (prevStage === 'verifying' && stage !== 'verifying' && stage !== 'done') {
          const verifierInfo = getIssueAssigneeUsername(project.id, iid);
          markIssueVerifyRejected(project.id, iid, {
            name: verifierInfo.name,
            avatar: verifierInfo.avatar,
            username: verifierInfo.username,
          });
        }
      } catch (e) {
        slog.warn(`verify marker update failed (#${iid}):`, (e as Error).message);
      }

      // 검증자별 부하 집계용 스냅샷 — Git assignee + 현재 stage 저장
      try {
        // 담당자가 없으면 이슈 작성자를 담당자로 간주
        const assignee = (issue.assignees && issue.assignees.length > 0) ? issue.assignees[0] : (issue.author || null);
        upsertIssueStageSnapshot(project.id, iid, {
          cachedStage: stage,
          assigneeUsername: assignee ? (assignee.username || assignee.login || null) : null,
          assigneeName: assignee ? (assignee.name || assignee.username || assignee.login || null) : null,
          assigneeAvatar: assignee ? (assignee.avatar_url || null) : null,
          assigneeProvider: project.provider,
          // GitLab은 assignee.id (숫자), GitHub도 assignees[].id (숫자). 문자열화해 저장.
          assigneeGitUserId: assignee && assignee.id != null ? String(assignee.id) : null,
          issueTitle: issue.title || null,
        });
      } catch (e) {
        slog.warn(`upsertIssueStageSnapshot failed (#${iid}):`, (e as Error).message);
      }

      // ── 외부 도구 이슈 인식 ──
      // 외부 도구(Claude Code 등)가 Git에 직접 이슈를 생성하고 IVE 레이블을 부착한 경우:
      // IVE-D 또는 IVE-W가 있지만 task_execution이 전혀 없으면
      // 이슈 본문의 <!-- ive-meta --> 에서 토큰/비용 정보를 추출하여 execution을 자동 생성한다.
      // 이 로직은 DB 상태(hasAnyExecution)만으로 판단하며, 이슈 본문의 특정 문자열에 의존하지 않는다.
      if (!activeExec && !hasAnyExecution(project.id, iid) && (stage === 'done' || stage === 'verify_waiting' || stage === 'dev_fail')) {
        // assignee 모드 이슈는 기존 로직(아래 블록)에서 처리하므로 여기서 제외
        const assignModeMap = getAssignModeMap(project.id);
        const assignInfo = assignModeMap.get(iid);
        if (assignInfo?.mode !== 'assignee' && !isGitBotUser(issue.author)) {
          const meta = parseIveMeta(issue.description || '');
          const executionId = `ex-${Date.now()}-${Math.floor(Math.random() * 1000)}`;
          const author = issue.author || {};
          const isComplete = stage === 'done' || stage === 'verify_waiting';
          const nowIso = new Date().toISOString();

          const execution: Parameters<typeof createExecution>[0] = {
            id: executionId,
            projectId: project.id,
            agentId: '',
            issueIid: iid,
            issueTitle: issue.title,
            status: isComplete ? 'success' : 'running',
            startedAt: meta.startedAt || issue.created_at || nowIso,
            endedAt: isComplete ? (meta.endedAt || nowIso) : undefined,
            logPath: '',
            inputTokens: 0, outputTokens: 0, costUsd: 0, turns: 0,
            issueCreatedAt: issue.created_at || nowIso,
            assigneeType: 'user',
            userId: null,
            userName: author.name || author.username || author.login || null,
            userAvatar: author.avatar_url || null,
          };
          createExecution(execution);

          // 토큰/비용 반영 (ive-meta에서 추출된 값이 있으면)
          if (meta.inputTokens || meta.outputTokens || meta.costUsd || meta.turns || meta.model) {
            updateExecutionTokens(executionId, meta.inputTokens, meta.outputTokens, meta.costUsd, meta.turns, meta.model || undefined, 0, 0);
          }

          touchProjectActivity(project.id);
          try {
            createActivityLog({
              userId: project.userId, category: 'task', action: 'detect_external_task',
              detail: `외부 도구 작업 인식: #${iid} "${issue.title}" (${project.name}, ${isComplete ? '완료' : '진행중'})`,
              targetType: 'execution', targetId: executionId,
            });
          } catch (e) { slog.error({ err: e }, 'Failed to log external task activity:'); }

          slog.info(`[EXTERNAL] Project: ${project.name}, Issue: #${iid}, Status: ${isComplete ? 'success' : 'running'}, Author: ${execution.userName}, Tokens: ${meta.inputTokens}/${meta.outputTokens}`);

          // 완료된 외부 도구 이슈의 닫기는 아래 "재조정 블록"이 담당한다.
          // (닫기를 한 곳으로 일원화해, API 실패로 열린 채 남은 이슈를 다음 스캔에 재시도 닫기)
        }
      }

      // ── 외부 도구 이슈 재조정 (이미 인식된 이슈) ──
      // 위 "외부 도구 이슈 인식" 블록은 !hasAnyExecution 조건이라 이슈당 한 번만 동작한다.
      // 그 이후의 후속 상황(본문 ive-meta 사후 수정, 닫기 실패로 열린 채 남음)을
      // reconcileExternalIssue 가 멱등하게 처리한다. (로직/근거는 함수 doc 참고)
      if (!activeExec && (stage === 'done' || stage === 'verify_waiting' || stage === 'dev_fail')) {
        await reconcileExternalIssue(project, issue, stage, (p, i) => closeIssue(p, i, decryptedToken));
      }

      // 사람 작업 완료 감지: 담당자가 Git에서 레이블을 IVE-W 또는 IVE-E로 변경한 경우
      // ※ verifying 단계는 검증 중이므로 절대 자동 완료 처리하지 않음 — 검증자가 승인/반려할 때만 완료됨
      if (activeExec && stage !== 'verifying' && (stage === 'verify_waiting' || stage === 'done')) {
        // 여러 개의 활성 execution이 남아 있을 수 있으므로 전부 닫는다 (예: dev exec + verify exec)
        const lingering = getDb().prepare(
          "SELECT id FROM task_executions WHERE project_id = ? AND issue_iid = ? AND status IN ('running', 'assigned') AND assignee_type = 'user'"
        ).all(project.id, iid) as { id: string }[];
        for (const ex of lingering) {
          updateExecutionStatus(ex.id, 'success', new Date().toISOString());
        }
        if (lingering.length > 0) {
          slog.info(`[USER-COMPLETE] Issue #${iid} — 레이블 전환 감지, 활성 사용자 execution ${lingering.length}건 완료 처리 (${stage})`);
        }
      }
      // 사람 작업 실패 감지: IVE-D가 제거되어 dev_fail, waiting, 또는 레이블 없음(null) 상태가 된 경우
      // ※ verifying 단계는 검증 중이므로 실패 처리하지 않음
      if (activeExec && stage !== 'verifying' && (stage === 'dev_fail' || stage === 'waiting' || stage === null)) {
        const userExec = getAssignedUserExecution(project.id, iid);
        if (userExec) {
          updateExecutionStatus(userExec.id, 'failed', new Date().toISOString());
          slog.info(`[USER-FAIL] Issue #${iid} — 레이블 변경 감지 (stage: ${stage}), 작업 실패 처리`);
        }
      }

      // 담당자 모드: 담당자가 Git에서 IVE-D를 직접 부여한 경우 → 브랜치 생성 + execution 생성
      // dev_fail = IVE-D 있지만 활성 execution 없음 → assignee 모드이면 execution 생성
      if (stage === 'dev_fail' && !activeExec) {
        const assignModeMap = getAssignModeMap(project.id);
        const assignInfo = assignModeMap.get(iid);
        if (assignInfo?.mode === 'assignee') {
          const issueAssignees = issue.assignees || [];
          if (issueAssignees.length > 0) {
            const assignee = issueAssignees[0];
            const executionId = `ex-${Date.now()}-${Math.floor(Math.random() * 1000)}`;
            const logDir = path.join(process.cwd(), 'data', 'logs');
            if (!fs.existsSync(logDir)) fs.mkdirSync(logDir, { recursive: true });
            const logPath = path.join(logDir, `${executionId}.log`);
            fs.writeFileSync(logPath, '');

            const waitingSince = getIssueScheduledAt(project.id, iid) || new Date().toISOString();
            const execution: Parameters<typeof createExecution>[0] = {
              id: executionId,
              projectId: project.id,
              agentId: '',
              issueIid: iid,
              issueTitle: issue.title,
              status: 'assigned',
              startedAt: new Date().toISOString(),
              logPath,
              inputTokens: 0, outputTokens: 0, costUsd: 0, turns: 0,
              issueCreatedAt: waitingSince,
              assigneeType: 'user',
              userId: String(assignee.id),
              userName: assignee.name || assignee.username || assignee.login,
              userAvatar: assignee.avatar_url,
            };

            if (assignIssueAtomically(project.id, iid, 'dev', execution)) {
              const branchName = `dev-${iid}`;

              // 브랜치 생성
              try {
                const defaultBranch = await getDefaultBranch(project, decryptedToken);
                const created = await createBranch(project, decryptedToken, branchName, defaultBranch);
                if (created) {
                  slog.info(`[BRANCH] Created branch '${branchName}' for assignee issue #${iid}`);
                }
              } catch (e) { slog.warn({ err: e }, `Failed to create branch for #${iid}:`); }

              // IVE-S 잔류 레이블 정리 (담당자가 IVE-S를 안 지웠을 수 있음)
              try {
                const hasScheduleLabel = labels.includes(project.labelSchedule || 'IVE-S');
                if (hasScheduleLabel) {
                  await removeIssueLabels(project, iid, decryptedToken, [project.labelSchedule || 'IVE-S']);
                }
              } catch (e) { slog.warn({ err: e }, `Failed to clean IVE-S on #${iid}:`); }

              // 브랜치 안내 코멘트 (담당자 모드 — 에이전트가 아닌 사람 담당자라 ive-agent 마커 없음)
              try {
                const commentBody = `<!-- ive-bot -->\n## 🌿 작업 브랜치 생성됨\n\n- **브랜치:** \`${branchName}\`\n- **담당자:** ${execution.userName}`;
                await addIssueComment(project, iid, decryptedToken, commentBody);
              } catch (e) { slog.warn({ err: e }, `Failed to add branch comment on #${iid}:`); }

              try {
                createActivityLog({
                  userId: project.userId,
                  category: 'task',
                  action: 'create_task',
                  detail: `작업 배정 (이슈 #${iid}, ${project.name}, 담당자: ${execution.userName}, 브랜치: ${branchName})`,
                  targetType: 'execution',
                  targetId: executionId,
                });
              } catch (e) { slog.error({ err: e }, 'Failed to log task activity:'); }

              slog.info(`[ASSIGN-USER] Project: ${project.name}, Issue: #${iid}, Assignee: ${execution.userName}, Branch: ${branchName}`);
            }
          } else {
            slog.info(`[SKIP] Issue #${iid} — assignee 모드 IVE-D 감지, 담당자 미지정`);
          }
        }
      }

      if (stage === 'waiting') {
        // IVE-S 최초 감지 시각 기록 (이미 기록된 경우 보존 — 대기시간 계산 기준)
        try {
          recordIssueScheduledAt(project.id, iid, now.toISOString());
        } catch (e) { slog.error({ err: e }, 'Failed to record scheduled_at:'); }

        // 신규 이슈 감지 로그 (처음 발견된 이슈만)
        if (!hasAnyExecution(project.id, iid)) {
          try {
            createActivityLog({
              userId: project.userId, category: 'task', action: 'detect_issue',
              detail: `이슈 감지: #${iid} "${issue.title}" (${project.name})`,
              targetType: 'issue', targetId: `${project.id}-${iid}`,
            });
          } catch (e) { slog.error({ err: e }, 'Failed to log detect_issue activity:'); }
        }
        waitingIssues.push(issue);
      } else if (stage === 'verify_waiting') {
        // 검증대기 이슈는 별도 카운터로 추적 (처리대기와 구분)
        verifyWaitingCount++;
      }
    }

    if (waitingIssues.length > 0) {
      // 먼저 생성된 이슈부터 배정 (created_at 오름차순)
      waitingIssues.sort((a, b) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime());
      slog.info(`Found ${waitingIssues.length} waiting issues for ${project.name}`);
      const { assigned, waiting } = await processIssues(project, waitingIssues, decryptedToken);
      issueCount += waiting;
    }

    // 이번 스캔에서 발견되지 않은 기존 이슈(좀비) 정리
    const staleRows = getDb().prepare(`
      SELECT issue_iid, cached_stage FROM issue_stages
      WHERE project_id = ? AND cached_stage IS NOT NULL AND cached_stage NOT IN ('done', 'none')
    `).all(project.id) as { issue_iid: number, cached_stage: string }[]

    for (const row of staleRows) {
      if (!processedIids.has(row.issue_iid)) {
        // 이번 스캔 결과(Open 이슈)에 없음 -> Closed 되었거나 IVE 레이블이 제거됨
        slog.info(`Cleaning stale issue #${row.issue_iid} in project ${project.name} (last stage: ${row.cached_stage})`)
        upsertIssueStageSnapshot(project.id, row.issue_iid, {
          cachedStage: 'done',
          assigneeUsername: null,
          assigneeName: null,
          assigneeAvatar: null,
          assigneeProvider: project.provider,
          assigneeGitUserId: null,
          issueTitle: null,
        })
        // 잔류 활성 execution 정리 (검증자 execution 포함)
        const lingeringExecs = getDb().prepare(
          "SELECT id FROM task_executions WHERE project_id = ? AND issue_iid = ? AND status IN ('running', 'assigned')"
        ).all(project.id, row.issue_iid) as { id: string }[]
        for (const ex of lingeringExecs) {
          updateExecutionStatus(ex.id, 'failed', new Date().toISOString())
        }
        if (lingeringExecs.length > 0) {
          slog.info(`Cleaned ${lingeringExecs.length} lingering execution(s) for stale issue #${row.issue_iid}`)
        }
      }
    }

    // 마지막 체크 시간 및 대기 이슈 수 업데이트 (처리대기와 검증대기 분리 저장)
    updateProjectLastChecked(project.id, now.toISOString(), issueCount, verifyWaitingCount);

    // 충돌 감지 작업 배정: done 상태 이슈가 2개 이상이면 MR 충돌 가능성 있음
    // TODO: processConflictCheck not yet implemented
    // try {
    //   await processConflictCheck(project, decryptedToken);
    // } catch (e) {
    //   slog.warn({ err: e }, `Conflict check failed for ${project.name}:`);
    // }

  } catch (err) {
    let msg = err instanceof Error ? err.message : String(err);
    // 인증 관련 에러에 조치 안내 추가
    if (msg.includes('인증 정보가 유효하지 않거나 만료') || msg.includes('인증 실패')) {
      msg = `Git 액세스 토큰 인증 실패 — 프로젝트 설정에서 토큰을 확인하거나 새로 발급하여 교체해주세요.`;
    }
    slog.warn(`Error scanning project ${project.name}: ${msg}`);
    updateProjectError(project.id, msg);
  }
}

async function processIssues(project: Project, issues: any[], decryptedToken: string): Promise<{ assigned: number; waiting: number }> {
  let assignedCount = 0;
  let waitingCount = 0;
  const busyAgentIds = new Set<string>();
  // assign_mode + preferred_agent_id를 한 번에 조회 (이슈별 개별 쿼리 방지)
  const assignModeMap = getAssignModeMap(project.id);

  slog.info(`processIssues: ${issues.length} issues`);
  for (const issue of issues) {
    // 이미 진행 중인 실행이 있으면 무조건 스킵 (running + assigned 모두)
    if (hasActiveExecution(project.id, issue.iid)) {
      slog.info(`[SKIP] Issue #${issue.iid} (activeExec: true)`);
      continue;
    }

    // 레이블로 상태 판정 — waiting만 processIssues에 들어오므로 여기선 추가 검증
    const labels: string[] = issue.labels || [];
    const stage = stageFromLabels(labels, project, { hasActiveExec: false });
    if (stage !== 'waiting') {
      slog.info(`[SKIP] Issue #${issue.iid} (stage: ${stage})`);
      continue;
    }

    const assignInfo = assignModeMap.get(issue.iid) || { mode: 'auto' as const, agentId: null };

    // ── 담당자가 처리 (assignee 모드) ──
    // assignee 모드는 자동 배정하지 않음. 담당자가 Git에서 IVE-D를 직접 부여하면 처리됨.
    // 이 상태는 "사람이 직접 처리 중"이므로 진짜 대기가 아님
    if (assignInfo.mode === 'assignee') {
      slog.info(`[WAIT] Issue #${issue.iid} — assignee 모드, 담당자가 IVE-D 레이블 부여 대기`);
      continue;
    }

    // ── 의뢰자(requester) 판정 → 그 사람의 에이전트 풀 사용 ──
    // #272: 프로젝트별 배정 폐기. 이슈를 의뢰한 사용자의 에이전트로만 처리.
    // 의뢰자 = "Schedule 레이블(IVE-S) 을 부착한 사람" 이 기본.
    // 우선순위: 마커 > IVE-S 부착자 > 이슈 작성자 > 프로젝트 오너(fallback)
    const requester = await resolveIssueRequesterAsync(
      project,
      issue,
      () => fetchIssueLabelEvents(project, issue.iid, decryptedToken),
    );
    if (!requester) {
      slog.info(`[SKIP] Issue #${issue.iid} — 의뢰자 판정 실패 (오너 정보 없음)`);
      waitingCount++;
      continue;
    }
    const userAgents = getAgentsByUser(requester.user.id);

    // ── 에이전트 선택: 지정 에이전트 우선, 없으면 라운드로빈 ──
    let availableAgent: Agent | null = null;
    const agentToken = decryptedToken; // 프로젝트 토큰 사용 (per-user OAuth 토큰은 후속 작업)
    let useRoundRobin = true;
    const preferredAgentId = assignInfo.mode === 'agent' ? assignInfo.agentId : null;

    if (preferredAgentId) {
      const a = userAgents.find(a => a.id === preferredAgentId);
      if (!a) {
        // 지정 에이전트가 의뢰자 풀에 없음 → 다른 에이전트로 자동 전환 금지
        // 사용자가 직접 작업자를 지정했으므로 그 의도를 존중한다.
        slog.info(`[WAIT] Issue #${issue.iid} — 지정 작업자(${preferredAgentId})가 의뢰자(${requester.user.name}) 풀에 없음, 대기`);
        continue;
      } else if (busyAgentIds.has(a.id) || countActiveExecutionsByAgent(a.id) > 0) {
        // 지정 에이전트가 바쁨 → 이번 스캔 스킵, 다음 스캔에서 재시도
        slog.info(`[WAIT] Issue #${issue.iid} — 지정 작업자 '${a.name}' 작업 중, 대기`);
        continue;
      } else {
        availableAgent = a;
        useRoundRobin = false;
      }
    }

    // 선호 에이전트가 없거나 리셋된 경우: 라운드로빈 (가장 최근 완료가 오래된 에이전트 우선)
    if (useRoundRobin && !availableAgent) {
      let oldestTime = Infinity;
      for (const a of userAgents) {
        if (busyAgentIds.has(a.id)) continue;
        const running = countActiveExecutionsByAgent(a.id);
        if (running === 0) {
          const lastDone = getLastCompletedAt(a.id);
          const t = lastDone ? new Date(lastDone).getTime() : 0;
          if (t < oldestTime) {
            oldestTime = t;
            availableAgent = a;
          }
        }
      }
    }

    if (availableAgent) {
      busyAgentIds.add(availableAgent.id);
      const assignType = preferredAgentId ? ' (지정 작업자)' : '';
      slog.info(`[ASSIGN] Project: ${project.name}, Issue: #${issue.iid}, Requester: ${requester.user.name}(${requester.source}), Agent: ${availableAgent.name}${assignType}`);

      // 대기시간 계산 기준: IVE-S 레이블 최초 감지 시각 (이슈 생성 시각이 아님)
      const waitingSince = getIssueScheduledAt(project.id, issue.iid) || new Date().toISOString();

      // 비동기로 태스크 실행 (개발자별 토큰 우선) — 트랜잭션은 executeTask 내에서 처리
      executeTask(project, issue, availableAgent, agentToken, waitingSince)
        .then(() => {
          slog.info(`[DONE] Issue #${issue.iid} processed.`);
        })
        .catch(err => {
          slog.error({ err: err }, `[FAILED] Issue #${issue.iid} error:`);
        });

      assignedCount++;
    } else {
      waitingCount++;
      slog.info(`[SKIP] No available agent for Issue #${issue.iid}. Will retry in next scan.`);
    }
  }
  slog.info(`processIssues result: assigned=${assignedCount}, waiting=${waitingCount}, busyAgents=[${[...busyAgentIds].join(',')}]`);
  return { assigned: assignedCount, waiting: waitingCount };
}

/**
 * 외부 도구 이슈 재조정.
 *
 * "외부 도구 이슈 인식" 블록은 !hasAnyExecution 조건이라 이슈당 한 번만 동작한다.
 * 그 이후에 발생하는 두 가지 후속 상황을 이 함수가 멱등하게 처리한다:
 *   (a) 본문 ive-meta 가 (사후 수정/추가 작업으로) 바뀜
 *       → DB 값을 본문 값으로 "덮어쓴다"(set, 누적 아님). 몇 번을 읽어도 결과가 같아 중복집계 위험 없음.
 *       빈 ive-meta(토큰/모델 전부 0·빈값)는 무시 → 기존 값을 지우지 않는다.
 *   (b) IVE-E/IVE-W(완료)인데 닫기 API 실패로 이슈가 열린 채 남음
 *       → closeFn 으로 닫기를 재시도한다. 닫히면 다음 스캔부터 조회 대상에서 빠지므로 자동으로 멈춘다.
 *
 * 대상은 "외부 도구 execution"(agent_id 빈값 + assignee_type='user' + user_id NULL) 한정.
 *   에이전트 실행(agent_id 존재)·담당자 모드 실행(user_id 존재)은 실제 실행 기록이므로 절대 건드리지 않는다.
 *
 * @returns 무엇을 했는지 (테스트/관측용). resynced=DB 갱신 발생, closed=닫기 시도 성공.
 */
export async function reconcileExternalIssue(
  project: Project,
  issue: { iid: number; description?: string | null; title?: string | null },
  stage: string | null,
  closeFn: (project: Project, iid: number) => Promise<unknown>,
): Promise<{ resynced: boolean; closed: boolean }> {
  const iid = issue.iid;
  let resynced = false;
  let closed = false;

  const extExec = getDb().prepare(
    `SELECT id, started_at, ended_at, input_tokens, output_tokens, cost_usd, turns, model_name
       FROM task_executions
      WHERE project_id = ? AND issue_iid = ? AND assignee_type = 'user'
        AND (agent_id IS NULL OR agent_id = '') AND user_id IS NULL
      ORDER BY started_at DESC LIMIT 1`
  ).get(project.id, iid) as {
    id: string; started_at: string; ended_at: string | null;
    input_tokens: number; output_tokens: number; cost_usd: number; turns: number; model_name: string | null;
  } | undefined;

  if (!extExec) return { resynced, closed };

  // (a) ive-meta 재동기화 — 본문 값과 다르면 덮어쓰기
  const meta = parseIveMeta(issue.description || '');
  const hasTokenMeta = !!(meta.inputTokens || meta.outputTokens || meta.costUsd || meta.turns || meta.model);
  const tokensChanged = hasTokenMeta && (
    meta.inputTokens !== extExec.input_tokens ||
    meta.outputTokens !== extExec.output_tokens ||
    meta.costUsd !== extExec.cost_usd ||
    meta.turns !== extExec.turns ||
    (meta.model || null) !== (extExec.model_name || null)
  );
  const newStart = meta.startedAt && meta.startedAt !== extExec.started_at ? meta.startedAt : null;
  const newEnd = meta.endedAt && meta.endedAt !== extExec.ended_at ? meta.endedAt : null;
  if (tokensChanged) {
    updateExecutionTokens(extExec.id, meta.inputTokens, meta.outputTokens, meta.costUsd, meta.turns, meta.model || undefined, 0, 0);
  }
  if (newStart || newEnd) {
    getDb().prepare('UPDATE task_executions SET started_at = COALESCE(?, started_at), ended_at = COALESCE(?, ended_at) WHERE id = ?')
      .run(newStart, newEnd, extExec.id);
  }
  if (tokensChanged || newStart || newEnd) {
    resynced = true;
    slog.info(`[RESYNC] Project: ${project.name}, Issue: #${iid}, Exec: ${extExec.id} — ive-meta 재동기화 (tokens=${tokensChanged}, times=${!!(newStart || newEnd)})`);
    try {
      createActivityLog({
        userId: project.userId, category: 'task', action: 'resync_ive_meta',
        detail: `ive-meta 재동기화: #${iid} "${issue.title}" (${project.name})`,
        targetType: 'execution', targetId: extExec.id,
      });
    } catch (e) { slog.error({ err: e }, 'Failed to log resync activity:'); }
  }

  // (b) 완료(IVE-E/IVE-W) 상태인데 아직 열려 있으면 닫기 재시도 (멱등)
  if (stage === 'done' || stage === 'verify_waiting') {
    try {
      await closeFn(project, iid);
      closed = true;
      slog.info(`[RECLOSE] Closed external issue #${iid} (${stage})`);
    } catch (e) { slog.warn({ err: e }, `Failed to (re)close external issue #${iid}:`); }
  }

  return { resynced, closed };
}
