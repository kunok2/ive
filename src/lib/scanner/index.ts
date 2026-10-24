import { stageChangedSince, stageChangeKey } from "../stage-inflight";
import { getLogger } from "../logger";
const slog = getLogger("Scanner");
import {
  getAllProjects,
  getProject,
  updateProjectLastChecked,
  updateProjectError,
  getAgentsByUser,
  getAgent,
  hasRole,
  getRolesInitializedAt,
  markRolesInitialized,
  getPresetRoles,
  setStageWorkerNote,
  getStageWorkerNote,
  createExecution,
  updateExecutionStatus,
  updateExecutionTokens,
  updateExecutionWorkSec,
  resetStuckExecutions,
  hasActiveExecution,
  hasAnyExecution,
  countActiveExecutionsByAgent,
  getLastCompletedAt,
  stageFromLabels,
  getAssignModeMap,
  byPriorityThenOldest,
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
  markIssueConfirmStarted,
  resetIssueCycleMarkers,
  markIssueConfirmed,
  getIssueAssigneeUsername,
  getUserByGitUsername,
  getProjectWithUserOAuth,
  updateUserOAuthTokens,
  getOAuthProviderRaw,
  completeMergedIssue,
  recordStageEvent, recordWaitIfChanged, recordIssueLink, SYSTEM_ACTOR, markHumanStageEnd, getReworkStreak,
} from "../db";
import { gitActor } from "../event-actor";
import { recordScannedStageChange } from "./stage-events";
import { fetchProjectMembers } from "../provider";
import { decrypt, encrypt } from "../crypto";
import { removeIssueLabels, swapIssueLabels, addIssueComment, createBranch, getDefaultBranch, closeIssue, fetchSingleIssue, fetchMRByBranch, fetchIssueNotes, isIssueClosedByGit } from "../provider";
import {
  fetchGitLabIssues,
  refreshGitLabToken,
} from "../gitlab";
import {
  fetchGitHubIssues,
} from "../github";
import { Project, Agent, isAgentAvailableNow } from "@/types";
import { resolveIssueRequesterAsync, resolveStageActorAsync } from "../ive-author";
import { fetchIssueLabelEvents } from "../provider";
import { isGitBotUser } from "../git-bot";
import { markersForStageChange, stageLabelFor, allStageLabels } from "../stage-transitions";
import { requeueRestartInterrupted, RESTART_GAVE_UP_NOTE } from "./restart-requeue";
import { openStageExecution, closeStageExecutions, hasOpenStageExecution, pickStageMeta, type StageKind } from "./stage-records";
import { startStatsCollector } from "../stats-collector";
import { startReportScheduler } from "../report-scheduler";
import { startChatSessionReaper } from "../chat-agent";
import fs from "fs";
import path from "path";
import { parseIveMetaSessions, parseIveMetaFixes } from "./formatters";
import { dispatchStageWorkers, type StageIssue } from "./stage-dispatch";
import { handOffLegacyBundleQueue, reopenIfClosedBeforeConfirm } from "./auto-merge";
import { applyDefaultRoles } from "../role-assignment";
import { isAgentEligibleForProject } from "../project-permissions";
import { executeTask } from "./execute";
import { DEFAULT_LABELS } from "@/lib/labels";

// Re-export for external consumers
export { executeTask } from "./execute";
export {
  parseIveMeta,
  parseIveMetaSessions,
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

/** 명부에서 고른 처리 에이전트의 주인이 편집 권한을 잃었을 때 이슈에 남기는 안내 (처리 시작·재지정 시 지운다) */
const PROCESSOR_INELIGIBLE_NOTE = '처리자로 지정한 에이전트의 주인이 이 프로젝트 편집 권한을 잃어 처리를 시작하지 못했습니다 — 처리자를 다시 지정해 주세요';

/**
 * 반려 고리 상한 — 검증·확인에서 이만큼 연달아 반려된 이슈는 처리자를 다시 붙이지 않고 검증대기로 넘겨 사람이 판단한다.
 * 같은 사유로 반려가 되풀이되면 처리자는 같은 자리에서 멈추고(예: 처리 환경에 없는 화면 검수) 토큰만 쓴다.
 * limits.maxAutoCycles(stage-dispatch)와 겹치지 않는다 — 그쪽은 IVE 검증·확인 «에이전트» 의 실패 횟수로 그 작업자만 멈추고,
 * 이쪽은 처리자를 띄우는 자리에서 «누가» 반려했든(사람·스킬 세션·에이전트) 연속 반려를 센다.
 */
export const MAX_REWORK_STREAK = 2;

/** 반려 고리를 끊는다 — 스케줄 → 검증대기 + 사람 판단 요청 노트. 노트·라벨 실패는 다음 스캔이 다시 시도한다. */
async function holdReworkLoop(project: Project, iid: number, token: string, streak: number): Promise<void> {
  const s = project.labelSchedule || DEFAULT_LABELS.schedule;
  const w = project.labelVerifyWait || DEFAULT_LABELS.verifyWait;
  const body = `<!-- ive-bot -->
## 🔁 반려 반복 — 사람 판단 필요

검증·확인에서 **${streak}회 연달아 반려**되어, 에이전트에게 다시 맡기지 않고 검증대기(\`${w}\`)로 옮겼습니다.
같은 이유로 계속 반려되면 다시 맡겨도 같은 곳에서 막힙니다.

지난 반려 코멘트를 보고 아래 중 하나를 골라 주세요.
- **남은 것이 에이전트가 직접 해 볼 수 없는 검수**(화면·실제 DB·운영 접근)뿐이면 → MR 을 머지하고, 그 항목을 확인자가 볼 수 있게 코멘트로 남겨 주세요.
- **구현이 정말 모자라면** → 무엇을 어느 파일에서 어떻게 고칠지 한 번에 적은 뒤 단계를 대기(\`${s}\`)로 되돌려 주세요(반려 횟수는 이때부터 새로 셉니다).
- **요건부터 정해야 하면** → 작업을 요청한 사람에게 물어봐 주세요.`;
  await swapIssueLabels(project, iid, token, [w], [s]);
  recordStageEvent({
    projectId: project.id, issueIid: iid, fromStage: 'waiting', toStage: 'verify_waiting', action: 'rework_loop',
    actor: SYSTEM_ACTOR, source: 'scanner', detail: { streak },
  });
  try { await addIssueComment(project, iid, token, body); } catch (e) { slog.warn({ err: e }, `rework-loop note failed #${iid}`); }
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
  // 비정상 종료로 남은 확인 작업자 비밀값 파일(평문) 정리 — 정상 종료 때는 작업자가 지운다
  try {
    const logDir = path.join(process.cwd(), 'data', 'logs');
    if (fs.existsSync(logDir)) {
      for (const f of fs.readdirSync(logDir)) if (f.endsWith('.secrets.env')) fs.rmSync(path.join(logDir, f), { force: true });
    }
  } catch (e) { slog.warn(`secrets file cleanup failed: ${(e as Error).message}`); }

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

/**
 * 스캔을 멈춘 채로 fn 을 실행한다 — 진행 중인 스캔이 끝나기를 기다렸다가 스캔 잠금(isScanning)을 잡고,
 * 끝나면 finishScan 으로 풀어 그사이 큐잉된 트리거도 이어서 돌린다.
 * 레이블 이름 변경처럼 저장소와 프로젝트 설정이 잠깐 어긋나는 작업에 쓴다 — 그 사이 스캔이 돌면
 * 열린 이슈를 「사라진 이슈」로 보고 정리(실행 실패·완료 표시)해 버린다.
 */
export async function runWhileScannerHeld<T>(fn: () => Promise<T>, waitMs = 120_000): Promise<T> {
  const deadline = Date.now() + waitMs;
  while (global.isScanning) {
    if (Date.now() > deadline) throw new Error('스캔이 끝나지 않아 기다리다 멈췄습니다 — 잠시 뒤 다시 시도하세요.');
    await new Promise(r => setTimeout(r, 500));
  }
  global.isScanning = true;
  try {
    return await fn();
  } finally {
    finishScan();
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
    // 스캐너 일시정지 — 주기 스캔뿐 아니라 이벤트 트리거(force) 스캔도 건너뛴다.
    // 정지는 토큰 소진 등 장애 시 비상 정지 수단이라 어떤 경로로도 새 작업이 시작되면 안 된다.
    if (project.scannerActive === false) {
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
    const scanStartedAt = Date.now(); // 이슈를 읽기 전 — 이 뒤에 끝난 단계 변경은 읽은 레이블에 반영돼 있지 않을 수 있다

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

    // 대상 라벨(ive)과 모든 단계 라벨로 이슈를 조회해 합칩니다.
    // 단계 라벨이 붙으면 ive 는 뗀다 — 단계 라벨만 있는 이슈도 IVE 관리 이슈다(예전 이슈는 둘 다 붙어 있을 수 있다).
    const fetchIssues = project.provider === 'github' ? fetchGitHubIssues : fetchGitLabIssues;
    const labelTarget = project.labelTarget;
    const labelS = project.labelSchedule || DEFAULT_LABELS.schedule;
    const labelD = project.labelDev || DEFAULT_LABELS.dev;
    const labelW = project.labelVerifyWait || DEFAULT_LABELS.verifyWait;
    const labelV = project.labelVerify || DEFAULT_LABELS.verify;
    const labelE = project.labelEnd || DEFAULT_LABELS.end;

    const fetched = await Promise.all(
      [labelTarget, ...allStageLabels(project)].map(label => fetchIssues(project, decryptedToken, label)),
    );

    // 이슈를 Map으로 병합 (iid → issue), closed 제외
    const issueMap = new Map<number, any>();
    for (const issue of fetched.flat()) {
      if (issue.state === 'closed') continue;
      issueMap.set(issue.iid, issue);
    }

    // 중복 단계 레이블 정리
    for (const [iid, issue] of issueMap) {
      const labels: string[] = issue.labels || [];

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
    const stageIssues: StageIssue[] = []
    // 이번 스캔에서 본 열린 이슈의 단계 — 예전 묶음 대기열을 바로 머지로 넘길 때 지금 단계를 본다
    const scanStages = new Map<number, string | null>()
    const processedIids = new Set<number>()
    const assignModes = getAssignModeMap(project.id)
    for (const [iid, issue] of issueMap) {
      processedIids.add(iid)
      const labels: string[] = issue.labels || []
      const activeExec = hasActiveExecution(project.id, iid);
      const stage = stageFromLabels(labels, project, { hasActiveExec: activeExec });

      // ── 이전 stage와 비교해 Git UI/CLI 에서 수동으로 단계를 전환했는지 감지 ──
      // 에이전트가 검증·확인을 맡으면 IVE 화면 버튼이 아니라 glab/gh 로 라벨을 옮긴다.
      // 그 경우에도 verify_started_at / verified_at / rejected_at / confirm_started_at /
      // confirmed_at 이 남아야 보고서 검증·확인 통계가 맞는다.
      // 전이 → 마커 판정은 markersForStageChange(순수 함수, 테스트 대상)에 있다.
      const prevStage = getCachedStage(project.id, iid);
      // 완료됐던 이슈가 다시 열려 활성 단계로 돌아옴 → 새 사이클. 이전 사이클의 확인 마커를
      // 아래 마커 기록보다 먼저 비워야 이번 사이클의 확인 시작/완료가 제대로 남는다.
      if (prevStage === 'done' && stage && stage !== 'done') {
        try { resetIssueCycleMarkers(project.id, iid); }
        catch (e) { slog.warn(`resetIssueCycleMarkers failed (#${iid}):`, (e as Error).message); }
      }
      // 마커 처리에서 이미 조회한 라벨 부착자 — 사건 로그가 같은 조회를 되풀이하지 않게 넘긴다
      let stageActorKnown: Awaited<ReturnType<typeof resolveStageActorAsync>> | undefined = undefined;
      try {
        const markers = markersForStageChange(prevStage, stage);
        // 담당자(assignee) = 라벨을 옮긴 주체로 간주 (CLI 경로에서는 이것이 유일한 단서).
        // 확인자 비용/집계는 IVE 사용자 기준이라 git username → IVE 계정까지 역매핑한다.
        const anyMarker = markers.verifyStarted || markers.verified || markers.rejected
          || markers.confirmStarted || markers.confirmed;
        const assigneeInfo = anyMarker ? getIssueAssigneeUsername(project.id, iid) : null;
        const assigneeUser = assigneeInfo?.username
          ? getUserByGitUsername(project.provider === 'github' ? 'github' : 'gitlab', assigneeInfo.username)
          : null;

        // 행위자 판정: "이 단계 라벨을 실제로 부착한 사람" 이 1순위, 담당자(assignee)가 2순위.
        // 에이전트가 CLI 로 검증·확인을 진행하면 담당자와 실제 수행자가 다를 수 있다.
        // (IVE 화면 버튼 경로는 프로젝트 토큰=봇이 라벨을 달아 resolveStageActorAsync 가 null →
        //  종전대로 assignee 로 떨어진다.)
        const stageLabelNow = anyMarker ? stageLabelFor(project, stage) : null;
        const labelActor = stageLabelNow
          ? await resolveStageActorAsync(project, stageLabelNow, () => fetchIssueLabelEvents(project, iid, decryptedToken))
          : null;
        if (anyMarker) stageActorKnown = labelActor;
        const actorName = labelActor?.user?.name || labelActor?.username || assigneeInfo?.name || null;
        const actorAvatar = labelActor?.user?.avatar || (labelActor ? null : assigneeInfo?.avatar ?? null);
        const actorUsername = labelActor?.username || assigneeInfo?.username || null;
        const actor = (markers.verified || markers.rejected || markers.confirmed)
          ? { name: actorName, avatar: actorAvatar, username: actorUsername }
          : null;
        const actorUser = labelActor?.user ?? assigneeUser;

        if (markers.verifyStarted) {
          markIssueVerifyStarted(project.id, iid);
          // 화면 버튼 없이 라벨만 옮긴 경우에도 "검증 중" 실행 기록을 남긴다
          // (없으면 검증이 보고서에서 통째로 빠진다). 이미 열려 있으면 그대로 둔다.
          openStageExecution(project.id, iid, 'verify', {
            issueTitle: issue.title ?? null,
            issueCreatedAt: issue.created_at ?? null,
            userId: actorUser?.id ?? null,
            userName: actorName,
            userAvatar: actorAvatar,
          });
        }
        if (markers.verified) {
          markIssueVerified(project.id, iid, {
            name: actor?.name || '',
            avatar: actor?.avatar || undefined,
            username: actor?.username,
            userId: actorUser?.id ?? null,
          });
        }
        if (markers.rejected) {
          markIssueVerifyRejected(project.id, iid, {
            name: actor?.name,
            avatar: actor?.avatar,
            username: actor?.username,
            userId: actorUser?.id ?? null,
          });
        }
        if (markers.confirmStarted) {
          markIssueConfirmStarted(project.id, iid);
          openStageExecution(project.id, iid, 'confirm', {
            issueTitle: issue.title ?? null,
            issueCreatedAt: issue.created_at ?? null,
            userId: actorUser?.id ?? null,
            userName: actorName,
            userAvatar: actorAvatar,
          });
        }
        if (markers.confirmed) {
          markIssueConfirmed(project.id, iid, {
            name: actor?.name || null,
            avatar: actor?.avatar || null,
            userId: actorUser?.id ?? null,
          });
        }

        // 단계 종료 시 그 단계의 실행 기록을 닫는다.
        // 에이전트가 수행했다면 코멘트의 ive-meta(stage: verify|confirm) 를 읽어 토큰·구간을 채운다
        // → 그 행은 AI 가 한 것으로 계산된다(사람 시간 0, AI 비용은 토큰).
        if (markers.verified || markers.rejected || markers.confirmed) {
          const kind: StageKind = markers.confirmed ? 'confirm' : 'verify';
          let meta = null as ReturnType<typeof pickStageMeta>;
          if (hasOpenStageExecution(project.id, iid, kind)) {
            try {
              const notes = await fetchIssueNotes(project, iid, decryptedToken, { silent: true });
              meta = pickStageMeta(notes as Array<{ body?: string | null }>, kind);
            } catch (e) {
              slog.warn(`stage ive-meta lookup failed (#${iid}):`, (e as Error).message);
            }
          }
          closeStageExecutions(project.id, iid, kind, markers.rejected ? 'failed' : 'success', meta);
        }
        // 확인 반려: 확인 중 → 완료가 아닌 단계(라벨로 되돌림). 열린 확인 기록을 반려로 닫는다
        // (닫지 않으면 아래 USER-COMPLETE 가 성공으로 닫아 반려가 통과로 남는다)
        if (prevStage === 'confirming' && stage !== 'confirming' && stage !== 'done' && hasOpenStageExecution(project.id, iid, 'confirm')) {
          closeStageExecutions(project.id, iid, 'confirm', 'failed');
        }

      } catch (e) {
        slog.warn(`verify marker update failed (#${iid}):`, (e as Error).message);
      }

      // 사건 로그 — 라벨 변화로 감지한 단계 전이. 마커 처리와 따로 감싸 한쪽 실패가 다른 쪽을 막지 않게 한다
      try {
        await recordScannedStageChange({
          project, iid, prevStage, stage,
          knownActor: stageActorKnown,
          resolveActor: async () => {
            const lbl = stageLabelFor(project, stage);
            return lbl ? resolveStageActorAsync(project, lbl, () => fetchIssueLabelEvents(project, iid, decryptedToken)) : null;
          },
          assigneeUsername: () => getIssueAssigneeUsername(project.id, iid)?.username ?? null,
          author: issue.author ? { username: issue.author.username || issue.author.login || null, gitUserId: issue.author.id ?? null } : null,
        });
      } catch (e) {
        slog.warn(`stage event record failed (#${iid}):`, (e as Error).message);
      }

      // 검증자별 부하 집계용 스냅샷 — Git assignee + 현재 stage 저장
      try {
        // 담당자가 없으면 이슈 작성자를 담당자로 간주
        const assignee = (issue.assignees && issue.assignees.length > 0) ? issue.assignees[0] : (issue.author || null);
        upsertIssueStageSnapshot(project.id, iid, {
          // 담당자 모드의 「처리 레이블만 있고 실행 없음」은 처리 실패가 아니다 — 아래에서 곧 사람 실행을 만든다(화면 판정과 같은 기준: hasActiveExecutionForStage)
          cachedStage: stage === 'dev_fail' && assignModes.get(iid)?.mode === 'assignee' ? 'dev' : stage,
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

      // 사건 로그 — 후속 이슈 연결. ive-meta 의 `fixes: #N` 은 "이 작업이 이전 이슈 #N 을 고친다"는 뜻이다
      try {
        for (const ref of parseIveMetaFixes(issue.description || '')) {
          if (ref === iid) continue;
          const author = issue.author || {};
          recordIssueLink(project.id, iid, project.id, ref, {
            kind: 'fixes', source: 'external',
            actor: gitActor(project, { username: author.username || author.login || null, gitUserId: author.id ?? null }),
          });
        }
      } catch (e) {
        slog.warn(`issue link record failed (#${iid}):`, (e as Error).message);
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
          // ive-meta 세션(블록)마다 execution 행을 생성한다. 다일 작업이면 세션이 여러 개라
          // 날짜(주)별로 행이 쪼개져 보고서가 각 주에 그 주의 수행분을 집계한다.
          const isComplete = stage === 'done' || stage === 'verify_waiting';
          const { created } = syncExternalToolSessions(project, issue as ExternalIssueLike, stage);

          if (created > 0) {
            touchProjectActivity(project.id);
            try {
              createActivityLog({
                userId: project.userId, category: 'task', action: 'detect_external_task',
                detail: `IVE 밖에서 처리한 작업을 기록했습니다: #${iid} "${issue.title}" (${project.name}, ${isComplete ? '완료' : '진행 중'}, 작업 기록 ${created}건)`,
                targetType: 'execution', targetId: `${project.id}:${iid}`,
              });
            } catch (e) { slog.error({ err: e }, 'Failed to log external task activity:'); }
            slog.info(`[EXTERNAL] Project: ${project.name}, Issue: #${iid}, Status: ${isComplete ? 'success' : 'running'}, Sessions: ${created}`);
          }

          // 완료된 외부 도구 이슈의 닫기는 아래 "재조정 블록"이 담당한다.
          // (닫기를 한 곳으로 일원화해, API 실패로 열린 채 남은 이슈를 다음 스캔에 재시도 닫기)
        }
      }

      // ── 외부 도구 이슈 재조정 + 완료 이슈 닫기 ──
      // 위 "외부 도구 이슈 인식" 블록은 !hasAnyExecution 조건이라 이슈당 한 번만 동작한다.
      // 그 이후의 후속 상황(본문 ive-meta 사후 수정)과, 완료(IVE-E) 단계인데 열린 채 남은 이슈
      // (외부 도구·IVE 처리 불문, 닫기 실패 재시도 포함)를 reconcileExternalIssue 가 멱등하게 처리한다.
      // 활성 실행이 남아 있으면 이번 스캔은 건너뛰고(아래 USER-COMPLETE 가 정리) 다음 스캔에 닫는다.
      // (로직/근거는 함수 doc 참고)
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
      // 처리를 건너뛰고 검증·확인으로 레이블만 옮긴 경우(Git 에서 직접) — 끝나지 않은 사람 처리 실행이 남아
      // 보드에 처리 칸과 검증 칸 양쪽에 보인다. 처리는 이미 끝난 일이므로 그 처리 실행만 닫는다.
      // 검증·확인 실행(ex-verify-/ex-confirm-)과 AI 채팅은 그 단계의 진행 기록이라 건드리지 않는다.
      if (activeExec && (stage === 'verifying' || stage === 'confirm_waiting' || stage === 'confirming')) {
        const lingeringDev = getDb().prepare(
          "SELECT id FROM task_executions WHERE project_id = ? AND issue_iid = ? AND status IN ('running', 'assigned') AND assignee_type = 'user' " +
          "AND id NOT LIKE 'ex-verify-%' AND id NOT LIKE 'ex-confirm-%' AND id NOT LIKE 'exec-chat-%'"
        ).all(project.id, iid) as { id: string }[];
        for (const ex of lingeringDev) {
          updateExecutionStatus(ex.id, 'success', new Date().toISOString());
        }
        if (lingeringDev.length > 0) {
          slog.info(`[USER-COMPLETE] Issue #${iid} — 처리 건너뛰고 ${stage} 로 이동 감지, 남은 처리 execution ${lingeringDev.length}건 완료 처리`);
        }
      }
      // 사람 작업 실패 감지: IVE-D가 제거되어 dev_fail, waiting, 또는 레이블 없음(null) 상태가 된 경우
      // ※ verifying 단계는 검증 중이므로 실패 처리하지 않음
      // ※ 화면에서 단계를 옮기는 중이거나 이 스캔이 이슈를 읽은 뒤에 끝난 변경이면 건너뛴다 — 실행은 레이블보다 먼저 만들어져,
      //   읽어 온 옛 레이블(대기)과 방금 만든 실행이 「레이블 되돌림」으로 보여 시작하는 실행을 실패로 닫았다(처리 시작 때 잠깐 처리 실패).
      if (activeExec && stage !== 'verifying' && (stage === 'dev_fail' || stage === 'waiting' || stage === null)
        && !stageChangedSince(stageChangeKey(project.id, iid), scanStartedAt)) {
        const userExec = getAssignedUserExecution(project.id, iid);
        if (userExec) {
          updateExecutionStatus(userExec.id, 'failed', new Date().toISOString());
          markHumanStageEnd(userExec.id, 'fail'); // 검증·확인 기록이면 반려(라벨을 되돌림)
          slog.info(`[USER-FAIL] Issue #${iid} — 레이블 변경 감지 (stage: ${stage}), 작업 실패 처리`);
        }
      }

      // 재기동 재처리: 서버 재기동으로 끊겨 처리 실패로 남은 처리(dev)를 대기로 되돌린다 (restart-requeue.ts)
      if (stage === 'dev_fail' && !activeExec && getAssignModeMap(project.id).get(iid)?.mode !== 'assignee') {
        if (await requeueRestartInterrupted(project, iid, decryptedToken) === 'requeued') continue;
      }

      // 담당자 모드: 담당자가 Git에서 IVE-D를 직접 부여한 경우 → 브랜치 생성 + execution 생성
      // dev_fail = IVE-D 있지만 활성 execution 없음 → assignee 모드이면 execution 생성
      if (stage === 'dev_fail' && !activeExec) {
        const assignModeMap = getAssignModeMap(project.id);
        const assignInfo = assignModeMap.get(iid);
        if (assignInfo?.mode === 'assignee') {
          // Git 담당자가 비어 있으면 작성자를 담당자로 본다 — 화면(위 스냅샷)이 이미 그렇게 보여주므로 같은 기준.
          // 이걸 안 하면 Git 에 직접 등록한 이슈(담당자 없음)는 「처리」가 IVE-D 만 붙이고 시작을 못 해 처리 실패↔대기를 오간다(운영 메타샵 2111·2281).
          const issueAssignees = (issue.assignees && issue.assignees.length > 0) ? issue.assignees : (issue.author ? [issue.author] : []);
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
                const hasScheduleLabel = labels.includes(project.labelSchedule || DEFAULT_LABELS.schedule);
                if (hasScheduleLabel) {
                  await removeIssueLabels(project, iid, decryptedToken, [project.labelSchedule || DEFAULT_LABELS.schedule]);
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
        // 프로젝트 기본 배정(「모든 단계 자동배정」 포함)을 처음 보는 스케줄 이슈에 한 번 적용.
        // 기본 배정이 없는 프로젝트는 아무것도 하지 않는다(종전 동작).
        // 이미 실행 이력이 있는 이슈(반려·재시도로 돌아온 이슈, 이 기능 이전 이슈)는 사람이 정한 배정을 존중해 건드리지 않는다.
        try {
          const initializedAt = getRolesInitializedAt(project.id, iid);
          if (!initializedAt && hasAnyExecution(project.id, iid)) markRolesInitialized(project.id, iid);
          else if (applyDefaultRoles(project, iid, initializedAt)) {
            slog.info(`[ROLES] Issue #${iid} — 프로젝트 기본 배정 적용`);
          }
        } catch (e) { slog.warn(`applyDefaultRoles failed (#${iid}):`, (e as Error).message); }
        waitingIssues.push(issue);
      } else if (stage === 'verify_waiting') {
        // 검증대기 이슈는 별도 카운터로 추적 (처리대기와 구분)
        verifyWaitingCount++;
      }
      scanStages.set(iid, stage);
      if (stage === 'verify_waiting' || stage === 'verifying' || stage === 'confirm_waiting' || stage === 'confirming') stageIssues.push({ issue, stage });
      // 처리 대기를 벗어났으면(사람이 라벨로 옮긴 경우 등) 「지정 처리 에이전트를 쓸 수 없음」 안내는 더 이상 맞지 않다
      if (stage !== 'waiting') {
        try { if (getStageWorkerNote(project.id, iid) === PROCESSOR_INELIGIBLE_NOTE) setStageWorkerNote(project.id, iid, null); } catch { /* ignore */ }
      }
      if (stage !== 'dev_fail') {
        try { if (getStageWorkerNote(project.id, iid) === RESTART_GAVE_UP_NOTE) setStageWorkerNote(project.id, iid, null); } catch { /* ignore */ }
      }
    }

    if (waitingIssues.length > 0) {
      // 우선순위(긴급 → 높음 → 보통) 높은 것부터, 같으면 먼저 생성된 이슈부터 배정 — 우선순위는 IVE DB 값(issue_stages.priority)
      const priorityMap = getAssignModeMap(project.id);
      const ordered = byPriorityThenOldest(waitingIssues, iid => priorityMap.get(iid)?.priority ?? 0);
      waitingIssues.splice(0, waitingIssues.length, ...ordered);
      slog.info(`Found ${waitingIssues.length} waiting issues for ${project.name}`);
      const { waiting } = await processIssues(project, waitingIssues, decryptedToken);
      issueCount += waiting;
    }

    // 단계 작업자(③ 검증 · ④ 확인) — 그 단계 배정이 에이전트인 이슈만. 사람 배정은 종전대로 기다린다.
    try {
      await dispatchStageWorkers(project, stageIssues, decryptedToken);
    } catch (e) { slog.warn(`dispatchStageWorkers failed (${project.name}):`, (e as Error).message); }
    // 예전 묶음 배포 대기열에 남은 이슈 — 한 번 바로 머지로 넘긴다(묶음 배포는 없앴다. 남은 줄이 없으면 아무것도 하지 않는다)
    try {
      await handOffLegacyBundleQueue(project, decryptedToken, scanStages);
    } catch (e) { slog.warn(`handOffLegacyBundleQueue failed (${project.name}):`, (e as Error).message); }

    // 이번 스캔에서 발견되지 않은 기존 이슈(좀비) 정리
    const staleRows = getDb().prepare(`
      SELECT issue_iid, cached_stage FROM issue_stages
      WHERE project_id = ? AND cached_stage IS NOT NULL AND cached_stage NOT IN ('done', 'none')
    `).all(project.id) as { issue_iid: number, cached_stage: string }[]

    for (const row of staleRows) {
      if (!processedIids.has(row.issue_iid)) {
        const iid = row.issue_iid
        // 완료 단계에 닿기 전에 Git 이 닫기 키워드로 닫은 이슈(MR 머지로 닫힘)는 완료로 바꾸지 않고 지금 단계를 그대로 둔다.
        // 완료로 바꾸면 확인을 거치지 않았다는 흔적이 사라져 다시 열 길이 없다. 확인(④) 단계면 다시 열고,
        // 그 밖의 단계는 사람이 작업 상세에서 이어 간다. 사람이 직접 닫았거나 여는 데 실패한 경우만 아래 정리로 간다.
        // (이번 스캔 목록을 받은 뒤 다시 열렸을 수도 있으니 한 건 조회해 열려 있으면 그대로 둔다)
        let closedCur: any = null
        try {
          const cur = await fetchSingleIssue(project, iid, decryptedToken)
          if (cur && cur.state !== 'closed') continue
          closedCur = cur
          if (cur) {
            if (await reopenIfClosedBeforeConfirm(project, decryptedToken, iid, cur)) continue
            if ((await isIssueClosedByGit(project, iid, decryptedToken)) === true) {
              slog.info(`${project.name} #${iid} — Git 이 닫았으나 완료 단계 전(${row.cached_stage}), 완료로 바꾸지 않고 그대로 둠`)
              continue
            }
          }
        } catch (e) { slog.warn(`closed-before-done check failed (#${iid}):`, (e as Error).message) }
        // 이번 스캔 결과(Open 이슈)에 없음 -> Closed 되었거나 IVE 레이블이 제거됨.
        // 단순 실패로 마감하기 전에 "메인 브랜치 머지로 닫힌 완료 작업"인지 먼저 판정한다. (#467)
        let mergeComplete = false
        try {
          const r = await reconcileClosedIssue(project, iid, {
            fetchIssue: () => fetchSingleIssue(project, iid, decryptedToken),
            fetchDevMR: () => fetchMRByBranch(project, decryptedToken, `dev-${iid}`),
          })
          mergeComplete = r.outcome === 'merged_complete'
          if (mergeComplete) {
            slog.info(`[MERGE-COMPLETE] Issue #${iid} — 메인 브랜치 머지로 닫힘, 완료 처리 (잔류 exec ${r.closedExecs}건 success, mergedAt: ${r.mergedAt ?? 'now'})`)
          }
        } catch (e) {
          slog.warn(`reconcileClosedIssue failed (#${iid}):`, (e as Error).message)
        }

        // 종료 레이블(IVE-E)을 붙여 닫은 이슈는 버려진 것이 아니라 사람이 끝낸 것이다 — MR 머지 없이 로컬 브랜치 등으로 직접 처리한 작업.
        // 열린 채 종료 레이블이 붙은 이슈는 스캔에서 확인 완료로 잡히지만, 레이블을 붙이자마자 닫으면 이 정리 경로로 온다(운영 메타샵 2297).
        const endLabelDone = !mergeComplete && Array.isArray(closedCur?.labels)
          && closedCur.labels.some((l: any) => (typeof l === 'string' ? l : l?.name) === (project.labelEnd || DEFAULT_LABELS.end))
        const completed = mergeComplete || endLabelDone

        slog.info(`Cleaning stale issue #${iid} in project ${project.name} (last stage: ${row.cached_stage}, ${mergeComplete ? 'merged-complete' : endLabelDone ? 'end-label-done' : 'abandoned'})`)
        upsertIssueStageSnapshot(project.id, iid, {
          cachedStage: 'done',
          assigneeUsername: null,
          assigneeName: null,
          assigneeAvatar: null,
          assigneeProvider: project.provider,
          assigneeGitUserId: null,
          issueTitle: null,
        })
        // 사건 로그 — 스냅샷은 두 경우 모두 'done' 이지만, 머지 없이 닫힌(버려진) 이슈를 완료로 세지 않도록 구분해 남긴다
        recordStageEvent({
          projectId: project.id, issueIid: iid, fromStage: row.cached_stage,
          toStage: completed ? 'done' : 'closed', action: mergeComplete ? 'merged' : endLabelDone ? null : 'abandoned',
          actor: SYSTEM_ACTOR, source: 'scanner',
        })

        if (mergeComplete) {
          // 닫힌 이슈에 종료 레이블(IVE-E)을 붙인다 — 단계 레이블만 남은 채 닫히면 이력 탭(대상·종료 레이블로 거른다)에 안 나와
          // DB 에선 완료인데 어디서도 조회되지 않는다(운영 2115). 실패해도 완료 처리는 그대로 둔다.
          try {
            const labelE = project.labelEnd || DEFAULT_LABELS.end
            await swapIssueLabels(project, iid, decryptedToken, [labelE], allStageLabels(project).filter(l => l !== labelE))
          } catch (e) { slog.warn(`종료 레이블 부착 실패 (#${iid}):`, (e as Error).message) }
          // completeMergedIssue 가 이미 잔류 활성 execution 을 success 로 마감함.
          try {
            createActivityLog({
              userId: project.userId, category: 'task', action: 'detect_merge_complete',
              detail: `기준 브랜치에 머지된 것을 확인해 완료로 옮겼습니다: #${iid} (${project.name})`,
              targetType: 'issue', targetId: `${project.id}-${iid}`,
            })
          } catch (e) { slog.error({ err: e }, 'Failed to log merge-complete activity:') }
        } else if (endLabelDone) {
          // 종료 레이블이 이미 붙어 있다 — 남은 활성 실행만 성공으로 마감한다
          for (const ex of getDb().prepare(
            "SELECT id FROM task_executions WHERE project_id = ? AND issue_iid = ? AND status IN ('running', 'assigned')"
          ).all(project.id, iid) as { id: string }[]) updateExecutionStatus(ex.id, 'success', new Date().toISOString())
        } else {
          // 머지 흔적 없음(수동 닫기/라벨 제거) -> 잔류 활성 execution 을 failed 로 마감 (기존 동작)
          const lingeringExecs = getDb().prepare(
            "SELECT id FROM task_executions WHERE project_id = ? AND issue_iid = ? AND status IN ('running', 'assigned')"
          ).all(project.id, iid) as { id: string }[]
          for (const ex of lingeringExecs) {
            updateExecutionStatus(ex.id, 'failed', new Date().toISOString())
            // 열려 있던 검증·확인 기록은 반려가 아니라 버려진 것 — 보고서가 사람의 반려로 세지 않게 표시한다
            markHumanStageEnd(ex.id, 'abandoned')
          }
          if (lingeringExecs.length > 0) {
            slog.info(`Cleaned ${lingeringExecs.length} lingering execution(s) for stale issue #${iid}`)
          }
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
      recordWaitIfChanged(project.id, issue.iid, 'assignee_mode');
      continue;
    }

    // ── 반려 고리 끊기 ── 검증·확인에서 연달아 반려된 이슈는 처리자를 다시 붙이지 않는다(사람 판단).
    const reworkStreak = getReworkStreak(project.id, issue.iid);
    if (reworkStreak >= MAX_REWORK_STREAK) {
      slog.info(`[HOLD] Issue #${issue.iid} — 반려 ${reworkStreak}회 연속, 검증대기로 넘겨 사람 판단`);
      try { await holdReworkLoop(project, issue.iid, decryptedToken, reworkStreak); } catch (e) { slog.warn({ err: e }, `rework-loop hold failed #${issue.iid}`); }
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
      recordWaitIfChanged(project.id, issue.iid, 'requester_unknown');
      waitingCount++;
      continue;
    }
    // 의뢰자가 에이전트를 **하나도 보유하지 않으면** 그 이슈는 영원히 배정되지 못하고
    // 매 스캔마다 [SKIP] 으로 대기만 한다. 프로젝트를 공유받아 쓰지만 자기 에이전트를
    // 만들지 않은 사용자가 이슈를 의뢰(또는 로그인 상태로 접수)하면 바로 이 상황이 된다.
    // 처리가 멈추지 않도록 "보유 0개" 일 때만 프로젝트 오너 풀로 되돌린다.
    // (보유하고 있는데 바쁨/휴가라서 못 쓰는 경우는 종전대로 대기 — 사용자의 의도를 존중.)
    let userAgents = getAgentsByUser(requester.user.id);
    if (userAgents.length === 0 && requester.user.id !== project.userId) {
      const ownerAgents = getAgentsByUser(project.userId);
      if (ownerAgents.length > 0) {
        slog.info(`[POOL] Issue #${issue.iid} — 의뢰자(${requester.user.name}) 보유 에이전트 0개 → 프로젝트 오너 풀로 처리`);
        userAgents = ownerAgents;
      }
    }

    // ── 에이전트 선택: 지정 에이전트 우선, 없으면 라운드로빈 ──
    let availableAgent: Agent | null = null;
    const agentToken = decryptedToken; // 프로젝트 토큰 사용 (per-user OAuth 토큰은 후속 작업)
    let useRoundRobin = true;
    const preferredAgentId = assignInfo.mode === 'agent' ? assignInfo.agentId : null;

    const now = Date.now();

    if (preferredAgentId) {
      // 의뢰자 풀 밖이어도 이 프로젝트 역할 명부에 처리 역할로 올라 있는 에이전트면 쓴다
      // (명부는 소유자·editor 의 에이전트를 프로젝트에 내어 준 것 — 의뢰자가 달라도 지정대로 처리).
      const a = userAgents.find(a => a.id === preferredAgentId)
        ?? ((): Agent | undefined => {
          // 명부의 처리 에이전트라도 소유자가 지금 이 프로젝트의 소유자·editor 일 때만
          if (!hasRole(project.id, 'process', 'agent', preferredAgentId)) return undefined;
          const ag = getAgent(preferredAgentId);
          return ag && isAgentEligibleForProject(project, ag) ? ag : undefined;
        })();
      if (!a) {
        // 지정 에이전트가 의뢰자 풀에 없음 → 다른 에이전트로 자동 전환 금지
        // 사용자가 직접 작업자를 지정했으므로 그 의도를 존중한다.
        slog.info(`[WAIT] Issue #${issue.iid} — 지정 작업자(${preferredAgentId})가 의뢰자(${requester.user.name}) 풀에 없음, 대기`);
        // 명부에서 고른 남의 에이전트인데 그 주인이 이 프로젝트 편집 권한을 잃은 경우만 화면에 알린다
        // (의뢰자 풀에도 없으니 다시 지정하지 않으면 영영 처리되지 않는다). 에이전트를 안 쓰는 프로젝트엔 생기지 않는 경우.
        const designated = getAgent(preferredAgentId);
        if (designated && designated.userId !== requester.user.id && !isAgentEligibleForProject(project, designated)) {
          try { setStageWorkerNote(project.id, issue.iid, PROCESSOR_INELIGIBLE_NOTE); } catch { /* ignore */ }
        }
        recordWaitIfChanged(project.id, issue.iid, 'preferred_not_in_pool', { detail: { agentId: preferredAgentId } });
        continue;
      } else if (!isAgentAvailableNow(a, now)) {
        // 지정 에이전트가 휴가/사용중지 상태 → 다른 에이전트로 자동 전환 금지, 복귀까지 대기
        slog.info(`[WAIT] Issue #${issue.iid} — 지정 작업자 '${a.name}' 휴가/사용중지(${a.enabled === false ? '무기한' : `~${a.pausedUntil}`}), 대기`);
        recordWaitIfChanged(project.id, issue.iid, 'preferred_paused', { detail: { agentId: a.id } });
        continue;
      } else if (busyAgentIds.has(a.id) || countActiveExecutionsByAgent(a.id) > 0) {
        // 지정 에이전트가 바쁨 → 이번 스캔 스킵, 다음 스캔에서 재시도
        slog.info(`[WAIT] Issue #${issue.iid} — 지정 작업자 '${a.name}' 작업 중, 대기`);
        recordWaitIfChanged(project.id, issue.iid, 'preferred_busy', { detail: { agentId: a.id } });
        continue;
      } else {
        availableAgent = a;
        useRoundRobin = false;
      }
    }

    // 선호 에이전트가 없거나 리셋된 경우: 라운드로빈 (가장 최근 완료가 오래된 에이전트 우선)
    if (useRoundRobin && !availableAgent) {
      let oldestTime = Infinity;
      // 이 이슈의 검증자로 지정된 에이전트는 처리자로 고르지 않는다(자기 작업을 자기가 검수하지 않는다)
      const verifierPreset = getPresetRoles(project.id, issue.iid).verifier;
      const verifierAgentId = verifierPreset.mode === 'agent' ? verifierPreset.agentId : null;
      for (const a of userAgents) {
        if (!isAgentAvailableNow(a, now)) continue; // 휴가/사용중지 에이전트는 자동 배정 제외
        if (verifierAgentId && a.id === verifierAgentId) continue;
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
      // 처리가 시작되면 「지정 처리 에이전트를 쓸 수 없음」 안내는 더 이상 맞지 않으므로 지운다(다른 안내는 그대로)
      try { if (getStageWorkerNote(project.id, issue.iid) === PROCESSOR_INELIGIBLE_NOTE) setStageWorkerNote(project.id, issue.iid, null); } catch { /* ignore */ }
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
      recordWaitIfChanged(project.id, issue.iid, 'no_agent', { detail: { poolSize: userAgents.length } });
    }
  }
  slog.info(`processIssues result: assigned=${assignedCount}, waiting=${waitingCount}, busyAgents=[${[...busyAgentIds].join(',')}]`);
  return { assigned: assignedCount, waiting: waitingCount };
}

/**
 * 외부 도구 execution 행(에이전트/담당자 모드 아님) 식별 조건.
 * 라벨 전이로 생긴 검증·확인 기록(ex-verify-/ex-confirm-)도 agent_id 빈값 + user_id NULL 일 수
 * 있으므로(행위자 미매칭) id 접두사로 명시 제외한다 — 안 그러면 외부 도구 이슈로 오인된다.
 */
const EXTERNAL_EXEC_WHERE =
  "COALESCE(assignee_type, '') = 'user' AND COALESCE(agent_id, '') = '' AND user_id IS NULL"
  + " AND id NOT LIKE 'ex-verify-%' AND id NOT LIKE 'ex-confirm-%'";

type ExternalIssueLike = {
  iid: number;
  description?: string | null;
  title?: string | null;
  created_at?: string;
  author?: { name?: string; username?: string; login?: string; avatar_url?: string } | null;
  time_stats?: { total_time_spent?: number } | null;
};

/**
 * 외부 도구 이슈의 ive-meta 세션(블록)들을 task_executions 행 집합으로 멱등 동기화한다.
 *
 * 한 이슈를 여러 날에 걸쳐 처리하면 본문에 <!-- ive-meta --> 블록이 작업 세션마다 하나씩
 * 쌓인다. 각 세션 = execution 행 1개(그 세션의 start/end·토큰/비용·work_sec). 보고서는 행의
 * started_at 으로 날짜(주)별 통계를 분배하므로, 주 경계를 넘는 작업이 각 주 보고서에 그 주의
 * 수행분만큼 집계된다. (단일 블록 본문은 길이 1 → 기존과 동일 동작, 하위호환)
 *
 * 멱등성: 세션 매칭 키 = effStart(= started_at, 없으면 issue.created_at). 본문을 몇 번 읽어도
 * 같은 세션 집합 → 신규만 INSERT, 변경분만 UPDATE, 중복집계 없음. 기존 단일행 이슈는 그 행의
 * started_at 이 세션[0] 과 일치하므로 새 행을 만들지 않고 제자리 갱신된다.
 *
 * 대상 행: 외부 도구 execution(EXTERNAL_EXEC_WHERE) 한정. 에이전트/담당자 실행은 건드리지 않는다.
 */
function syncExternalToolSessions(
  project: Project,
  issue: ExternalIssueLike,
  stage: string | null,
): { created: number; updated: number } {
  const iid = issue.iid;
  // 툴 직접개발(stage: dev) 블록만 대상. 검증/확인(stage: verify|confirm) 블록은
  // 그 단계의 실행 기록(ex-verify/ex-confirm)으로 따로 반영된다 — 여기서 개발분으로
  // 잡으면 같은 작업이 두 번 집계된다.
  const sessions = parseIveMetaSessions(issue.description || '').filter(s => s.stage === 'dev');
  // 토큰/모델/시각이 전혀 없는 빈 세션은 무시 → 기존 값을 지우지 않는다.
  const meaningful = sessions.filter(s =>
    s.inputTokens || s.outputTokens || s.costUsd || s.turns || s.model || s.startedAt || s.endedAt
  );
  if (meaningful.length === 0) return { created: 0, updated: 0 };

  const isComplete = stage === 'done' || stage === 'verify_waiting';
  const nowIso = new Date().toISOString();
  const createdAt = issue.created_at || nowIso;
  const author = issue.author || {};
  const timeStatsSec = (typeof issue.time_stats?.total_time_spent === 'number' && issue.time_stats.total_time_spent > 0)
    ? Math.round(issue.time_stats.total_time_spent) : 0;

  const existing = getDb().prepare(
    `SELECT id, started_at, ended_at, input_tokens, output_tokens, cost_usd, turns, model_name, work_sec, status
       FROM task_executions
      WHERE project_id = ? AND issue_iid = ? AND ${EXTERNAL_EXEC_WHERE}`
  ).all(project.id, iid) as Array<{
    id: string; started_at: string; ended_at: string | null;
    input_tokens: number; output_tokens: number; cost_usd: number; turns: number;
    model_name: string | null; work_sec: number; status: string;
  }>;
  // 세션↔행 매칭: 타임스탬프 있는 세션은 started_at 정확매칭(같은 날 작업의 제자리 갱신),
  // 타임스탬프 없는(레거시 단일블록 등) 세션은 남은 행에 순서대로 폴백 매칭한다.
  // 이로써 ① 기존 단일행 이슈는 새 행을 만들지 않고 갱신되고 ② 새 날 세션은 새 행으로 INSERT.
  const usedRowIds = new Set<string>();
  const takeExactRow = (startISO: string) => {
    const r = existing.find(x => !usedRowIds.has(x.id) && x.started_at === startISO);
    if (r) usedRowIds.add(r.id);
    return r || null;
  };
  const takeNextFreeRow = () => {
    const r = existing.find(x => !usedRowIds.has(x.id));
    if (r) usedRowIds.add(r.id);
    return r || null;
  };

  let created = 0, updated = 0;
  const applySession = (s: (typeof meaningful)[number], i: number, row: (typeof existing)[number] | null) => {
    // work_sec(세션 작업시간): ive-meta(started→ended). 단일 세션에 한해 GitLab /spend fallback 허용
    // (다세션이면 total_time_spent 는 이슈 전체라 세션별로 쪼갤 수 없어 중복집계 방지차 미적용).
    const workSec = (s.startedAt && s.endedAt)
      ? Math.max(0, Math.round((new Date(s.endedAt).getTime() - new Date(s.startedAt).getTime()) / 1000))
      : (meaningful.length === 1 && timeStatsSec > 0 ? timeStatsSec : 0);
    const hasTokens = !!(s.inputTokens || s.outputTokens || s.costUsd || s.turns || s.model);

    if (!row) {
      const effStart = s.startedAt || createdAt;
      const execId = `ex-ext-${project.id}-${iid}-${i}-${effStart}`;
      createExecution({
        id: execId,
        projectId: project.id,
        agentId: '',
        issueIid: iid,
        issueTitle: issue.title ?? null,
        status: isComplete ? 'success' : 'running',
        startedAt: effStart,
        endedAt: isComplete ? (s.endedAt || nowIso) : (s.endedAt || undefined),
        logPath: '',
        inputTokens: 0, outputTokens: 0, costUsd: 0, turns: 0,
        issueCreatedAt: createdAt,
        assigneeType: 'user',
        userId: null,
        userName: author.name || author.username || author.login || null,
        userAvatar: author.avatar_url || null,
      } as Parameters<typeof createExecution>[0]);
      if (hasTokens) updateExecutionTokens(execId, s.inputTokens, s.outputTokens, s.costUsd, s.turns, s.model || undefined, 0, 0);
      if (workSec > 0) updateExecutionWorkSec(execId, workSec);
      created++;
      return;
    }
    // 기존 세션 행 — 변경분만 제자리 갱신 (started_at 은 보존: 타임리스 세션이 날짜를 옮기지 않게)
    const tokensChanged = hasTokens && (
      s.inputTokens !== row.input_tokens || s.outputTokens !== row.output_tokens ||
      s.costUsd !== row.cost_usd || s.turns !== row.turns || (s.model || null) !== (row.model_name || null)
    );
    if (tokensChanged) updateExecutionTokens(row.id, s.inputTokens, s.outputTokens, s.costUsd, s.turns, s.model || undefined, 0, 0);
    const newStart = s.startedAt && s.startedAt !== row.started_at ? s.startedAt : null;
    const newEnd = s.endedAt && s.endedAt !== row.ended_at ? s.endedAt : null;
    if (newStart || newEnd) {
      getDb().prepare('UPDATE task_executions SET started_at = COALESCE(?, started_at), ended_at = COALESCE(?, ended_at) WHERE id = ?')
        .run(newStart, newEnd, row.id);
    }
    const workChanged = workSec > 0 && workSec !== row.work_sec;
    if (workChanged) updateExecutionWorkSec(row.id, workSec);
    if (tokensChanged || newStart || newEnd || workChanged) updated++;
  };

  // 1) 타임스탬프 세션: started_at 정확매칭 우선
  meaningful.forEach((s, i) => { if (s.startedAt) applySession(s, i, takeExactRow(s.startedAt)); });
  // 2) 타임리스 세션: 남은 행에 순서대로 폴백 (레거시 단일블록 호환)
  meaningful.forEach((s, i) => { if (!s.startedAt) applySession(s, i, takeNextFreeRow()); });

  return { created, updated };
}

/**
 * 외부 도구 이슈 재조정.
 *
 * "외부 도구 이슈 인식" 블록은 !hasAnyExecution 조건이라 이슈당 한 번만 동작한다.
 * 그 이후에 발생하는 두 가지 후속 상황을 이 함수가 멱등하게 처리한다:
 *   (a) 본문 ive-meta 세션(블록)이 바뀜 — 사후 수정 또는 다른 날 작업 세션 블록 추가
 *       → syncExternalToolSessions 로 세션 집합을 행 집합에 멱등 동기화한다. 새 세션(=새 날
 *         작업)은 새 행으로 INSERT 되어 그 날짜(주) 보고서에 집계되고, 기존 세션의 값 변경은
 *         제자리 UPDATE. 몇 번을 읽어도 같은 집합 → 중복집계 없음. 빈 세션은 무시.
 *   (b) 완료 단계인데 이슈가 열린 채 남음 → closeFn 으로 닫는다(닫기 실패 시 다음 스캔에 재시도).
 *       닫히면 다음 스캔부터 조회 대상에서 빠지므로 자동으로 멈춘다.
 *       - IVE-E(done): 외부 도구 이슈든 IVE 가 직접 처리한 이슈든 **모두** 닫는다. (#487)
 *         종전엔 외부 행이 있는 이슈만 닫아, IVE 화면(확인 → 완료)이나 CLI 라벨 이동으로 완료된
 *         일반 IVE 작업은 누군가 닫기 버튼을 누를 때까지 IVE-E 인 채 열려 있었다.
 *       - IVE-W(verify_waiting): 외부 도구가 끝냈다는 뜻일 때만 완료 → 외부 행만 있는 이슈 한정.
 *
 * 재동기화 대상은 "외부 도구 execution"(EXTERNAL_EXEC_WHERE) 한정.
 *   에이전트 실행(agent_id 존재)·담당자 모드 실행(user_id 존재)은 실제 실행 기록이므로 절대 건드리지 않는다.
 *
 * @returns 무엇을 했는지 (테스트/관측용). resynced=DB 갱신 발생, closed=닫기 시도 성공.
 */
export async function reconcileExternalIssue(
  project: Project,
  issue: ExternalIssueLike,
  stage: string | null,
  closeFn: (project: Project, iid: number) => Promise<unknown>,
): Promise<{ resynced: boolean; closed: boolean }> {
  const iid = issue.iid;
  let resynced = false;
  let closed = false;

  // 재동기화는 이미 인식된 외부 도구 이슈만 한다 (행이 하나도 없으면 인식 블록 담당).
  const hasExternalRow = !!getDb().prepare(
    `SELECT 1 FROM task_executions WHERE project_id = ? AND issue_iid = ? AND ${EXTERNAL_EXEC_WHERE} LIMIT 1`
  ).get(project.id, iid);

  // (a) ive-meta 세션 재동기화 — 세션마다 행을 멱등 upsert (신규 세션=새 날 작업은 새 행)
  const { created, updated } = hasExternalRow
    ? syncExternalToolSessions(project, issue, stage)
    : { created: 0, updated: 0 };
  if (created > 0 || updated > 0) {
    resynced = true;
    slog.info(`[RESYNC] Project: ${project.name}, Issue: #${iid} — ive-meta 세션 재동기화 (created=${created}, updated=${updated})`);
    try {
      createActivityLog({
        userId: project.userId, category: 'task', action: 'resync_ive_meta',
        detail: `이슈에 적힌 작업 기록을 다시 읽어 반영했습니다: #${iid} "${issue.title}" (${project.name}, 새로 ${created}건 · 고침 ${updated}건)`,
        targetType: 'execution', targetId: `${project.id}:${iid}`,
      });
    } catch (e) { slog.error({ err: e }, 'Failed to log resync activity:'); }
  }

  // (b) 완료 상태인데 아직 열려 있으면 닫는다 (멱등, 실패 시 다음 스캔에 재시도)
  //  IVE-E 는 누가 처리했든 완료다 — 외부 행 유무와 무관하게 닫는다. (#487)
  //  IVE-W 는 "외부 도구가 끝냈다"는 뜻일 때만 완료다. 외부 등록 뒤 재태깅돼 IVE 가 직접
  //  실행(에이전트·담당자·검증/확인)을 돌린 이슈라면 IVE-W 는 진짜 검증대기이므로 닫지 않는다.
  //  (종전엔 과거 외부 행만 보고 닫아, 다시 열어도 스캔마다 또 닫혀 대기 목록·통계에서 사라졌다)
  const iveDriven = stage === 'verify_waiting' && hasExternalRow && !!getDb().prepare(
    `SELECT 1 FROM task_executions WHERE project_id = ? AND issue_iid = ? AND NOT (${EXTERNAL_EXEC_WHERE}) LIMIT 1`
  ).get(project.id, iid);
  if (stage === 'done' || (stage === 'verify_waiting' && hasExternalRow && !iveDriven)) {
    try {
      await closeFn(project, iid);
      closed = true;
      slog.info(`[CLOSE-DONE] Closed issue #${iid} (${stage}${hasExternalRow ? ', external' : ''})`);
    } catch (e) { slog.warn({ err: e }, `Failed to close completed issue #${iid}:`); }
  }

  return { resynced, closed };
}

/**
 * 스캔에서 사라진(stale) 이슈가 "메인 브랜치 머지로 닫힌 완료 작업"인지 판정한다. (#467)
 *
 * 검증/확인 단계의 작업이 MR/PR 머지로 자동 닫히면(Closes #iid + source branch 삭제)
 * 이슈가 IVE-E(완료) 단계를 거치지 않고 스캔에서 빠진다. 이 경우 단순 좀비(실패)로
 * 마감하면 안 되고, "완료(success)"로 처리해야 한다.
 *
 * 판정 기준:
 *   - 이슈가 closed 상태이고
 *   - 작업 브랜치(dev-{iid})의 MR/PR 이 merged 이면 → 머지 완료('merged_complete')
 *   그 외(여전히 열림=라벨만 제거, 수동 닫기로 머지 없음 등)는 'abandoned'.
 *
 * merged_complete 면 completeMergedIssue 로 잔류 활성 execution 을 success 로 마감하고
 * (검증 진행 중이었으면 verified_at 기록), 'abandoned' 면 호출측이 기존 실패 처리를 한다.
 *
 * 네트워크 호출(fetchIssue/fetchDevMR)은 주입받아 테스트 가능하게 한다.
 * 조회 실패 시 보수적으로 'abandoned' 로 떨어진다 (잘못된 완료 처리 방지).
 */
export async function reconcileClosedIssue(
  project: Project,
  iid: number,
  deps: {
    fetchIssue: () => Promise<{ state?: string } | null>,
    fetchDevMR: () => Promise<{ state?: string; merged_at?: string | null } | null>,
  },
): Promise<{ outcome: 'merged_complete' | 'abandoned'; mergedAt: string | null; closedExecs: number }> {
  let issue: { state?: string } | null = null;
  try {
    issue = await deps.fetchIssue();
  } catch (e) {
    slog.warn(`reconcileClosedIssue: fetchIssue failed (#${iid}):`, (e as Error).message);
    return { outcome: 'abandoned', mergedAt: null, closedExecs: 0 };
  }

  // 이슈가 여전히 열려 있으면(IVE 라벨만 제거 등) 머지 완료가 아니다.
  if (!issue || issue.state !== 'closed') {
    return { outcome: 'abandoned', mergedAt: null, closedExecs: 0 };
  }

  let mr: { state?: string; merged_at?: string | null } | null = null;
  try {
    mr = await deps.fetchDevMR();
  } catch (e) {
    slog.warn(`reconcileClosedIssue: fetchDevMR failed (#${iid}):`, (e as Error).message);
  }

  // GitLab은 state='merged', GitHub은 normalizePR 이 merged_at 있으면 state='merged' 로 정규화.
  if (mr && mr.state === 'merged') {
    const mergedAt = mr.merged_at || null;
    const closedExecs = completeMergedIssue(project.id, iid, mergedAt);
    return { outcome: 'merged_complete', mergedAt, closedExecs };
  }

  return { outcome: 'abandoned', mergedAt: null, closedExecs: 0 };
}
