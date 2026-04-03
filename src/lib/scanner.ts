import {
  getAllProjects,
  getProject,
  updateProjectLastChecked,
  updateProjectError,
  getProjectAssignments,
  createExecution,
  updateExecutionStatus,
  updateExecutionPid,
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
  getPreferredAgentMap,
  getUserById,
  assignIssueAtomically,
  createActivityLog,
  setPreferredAgent,
  touchProjectActivity,
} from "./db";
import { decrypt } from "./crypto";
import { defaultLocale } from "@/i18n/config";
import { addIssueLabels, removeIssueLabels } from "./provider";
import {
  ensureGitLabLabels,
  fetchGitLabIssues,
  addGitLabIssueComment,
  fetchGitLabIssueNotes,
  addGitLabSpentTime,
  createGitLabMR,
  getGitLabMR,
  addGitLabMRNote
} from "./gitlab";
import {
  ensureGitHubLabels,
  fetchGitHubIssues,
  addGitHubIssueComment,
  fetchGitHubIssueNotes,
  createGitHubPR,
  getGitHubPR,
  addGitHubPRNote,
} from "./github";
import { Project, Agent } from "@/types";
import { startStatsCollector } from "./stats-collector";
import { startReportScheduler } from "./report-scheduler";
import { spawn } from "child_process";
import fs from "fs";
import path from "path";
import { promisify } from "util";
import { setToolActivity, setThinking, clearActivity } from "./tool-activity";
import { calcCostFromDb } from "./token-pricing";

const exec = promisify(require('child_process').exec);
const execFile = promisify(require('child_process').execFile);

/**
 * OpenCode run --format json 이벤트를 읽기 좋은 로그 텍스트로 변환
 */
function formatOpenCodeEvent(event: any, showToolUsage: boolean = false): string | null {
  switch (event.type) {
    case 'text': {
      // OpenCode 1.x: content is in event.part.text
      const content = event.part?.text ?? event.content ?? event.text ?? '';
      if (!content.trim()) return null;
      return content;
    }
    case 'tool_use': {
      if (!showToolUsage) return null;
      // OpenCode 1.x: tool name is in event.part.tool, input in event.part.state.input
      const toolName = event.part?.tool ?? event.tool ?? event.name ?? '';
      const input = event.part?.state?.input ?? event.input ?? event.args ?? {};
      const summary = formatToolInput(toolName, input);
      return `\x1b[1;34m[Tool] ${toolName}\x1b[0m ${summary}`;
    }
    case 'step_finish': {
      // OpenCode 1.x: completion is step_finish with reason='stop'
      if (event.part?.reason !== 'stop') return null;
      const tokens = event.part?.tokens ?? {};
      const inputT = tokens.input ?? 0;
      const outputT = tokens.output ?? 0;
      const cost = event.part?.cost ?? 0;
      const meta: string[] = [];
      if (inputT || outputT) meta.push(`입력 ${Number(inputT).toLocaleString()} + 출력 ${Number(outputT).toLocaleString()} 토큰`);
      if (cost) meta.push(`비용 $${Number(cost).toFixed(4)}`);
      const metaStr = meta.length > 0 ? `\x1b[90m(${meta.join(' | ')})\x1b[0m ` : '';
      return `\x1b[1;32m[완료]\x1b[0m ${metaStr}`;
    }
    case 'session.status': {
      // Legacy format fallback
      const meta: string[] = [];
      const inputT = event.inputTokens ?? event.input_tokens ?? event.tokens?.input ?? 0;
      const outputT = event.outputTokens ?? event.output_tokens ?? event.tokens?.output ?? 0;
      const cost = event.cost ?? event.costUsd ?? event.cost_usd ?? 0;
      if (inputT || outputT) meta.push(`입력 ${Number(inputT).toLocaleString()} + 출력 ${Number(outputT).toLocaleString()} 토큰`);
      if (cost) meta.push(`비용 $${Number(cost).toFixed(4)}`);
      const metaStr = meta.length > 0 ? `\x1b[90m(${meta.join(' | ')})\x1b[0m ` : '';
      return `\x1b[1;32m[완료]\x1b[0m ${metaStr}`;
    }
    case 'session.error': {
      const msg = event.error ?? event.message ?? '알 수 없는 오류';
      return `\x1b[1;31m[오류]\x1b[0m ${msg}`;
    }
    default:
      return null;
  }
}

function formatOpenCodeEventMarkdown(event: any): string | null {
  switch (event.type) {
    case 'text': {
      const content = event.part?.text ?? event.content ?? event.text ?? '';
      return content.trim() || null;
    }
    case 'tool_use': {
      const toolName = event.part?.tool ?? event.tool ?? event.name ?? '';
      const summary = formatToolInputMarkdown(toolName, event.part?.state?.input ?? event.input ?? event.args ?? {});
      return `> **🔧 ${toolName}** ${summary}`;
    }
    case 'step_finish': {
      if (event.part?.reason !== 'stop') return null;
      const tokens = event.part?.tokens ?? {};
      const inputT = tokens.input ?? 0;
      const outputT = tokens.output ?? 0;
      const cost = event.part?.cost ?? 0;
      const meta: string[] = [];
      if (cost) meta.push(`비용: $${Number(cost).toFixed(4)}`);
      if (inputT || outputT) meta.push(`토큰: ${(Number(inputT) + Number(outputT)).toLocaleString()}`);
      return `\n---\n**📊 실행 결과** ${meta.join(' | ')}`;
    }
    case 'session.status': {
      // Legacy format fallback
      const meta: string[] = [];
      const inputT = event.inputTokens ?? event.input_tokens ?? event.tokens?.input ?? 0;
      const outputT = event.outputTokens ?? event.output_tokens ?? event.tokens?.output ?? 0;
      const cost = event.cost ?? event.costUsd ?? event.cost_usd ?? 0;
      const model = event.model ?? event.modelId ?? event.model_id ?? '';
      if (model) meta.push(`모델: ${model}`);
      if (cost) meta.push(`비용: $${Number(cost).toFixed(4)}`);
      if (inputT || outputT) meta.push(`토큰: ${(Number(inputT) + Number(outputT)).toLocaleString()}`);
      return `\n---\n**📊 실행 결과** ${meta.join(' | ')}`;
    }
    default:
      return null;
  }
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
  switch (event.type) {
    case 'assistant': {
      const parts = event.message?.content || [];
      const lines: string[] = [];
      for (const part of parts) {
        if (part.type === 'text' && part.text?.trim()) {
          lines.push(part.text);
        } else if (part.type === 'tool_use' && showToolUsage) {
          const input = part.input || {};
          const summary = formatToolInput(part.name, input);
          lines.push(`\x1b[1;34m[Tool] ${part.name}\x1b[0m ${summary}`);
        }
      }
      if (lines.length === 0) return null;
      const usage = event.message?.usage || event.usage;
      const meta = extractMeta(event, usage);
      if (meta) lines.push(`\x1b[90m${meta}\x1b[0m`);
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
      return `\x1b[1;32m[완료]\x1b[0m ${metaStr}`;
    }
    case 'system': {
      // system 이벤트 중 의미 있는 메시지만 출력 (JSON 덤프 방지)
      if (event.subtype === 'init' || event.subtype === 'session') {
        const model = event.model ?? event.modelId ?? '';
        return `\x1b[1;36m[시작]\x1b[0m 세션 초기화${model ? ` \x1b[90m(${model})\x1b[0m` : ''}`;
      }
      // task_notification 등 내부 이벤트는 메타만 간략히
      if (event.subtype === 'task_notification') {
        const summary = event.summary || '';
        const tokens = event.usage?.total_tokens ? ` (${event.usage.total_tokens.toLocaleString()} tokens)` : '';
        return summary ? `\x1b[90m[내부작업] ${summary}${tokens}\x1b[0m` : null;
      }
      // 문자열 메시지가 있으면 표시, 아니면 무시
      if (typeof event.message === 'string' && event.message.trim()) {
        return `\x1b[1;36m[System]\x1b[0m ${event.message}`;
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
      const model = event.model ?? event.modelId ?? event.model_id ?? '';
      if (model) info.push(`모델: ${model}`);
      if (cost) info.push(`비용: $${Number(cost).toFixed(4)}`);
      if (duration) info.push(`소요: ${(Number(duration) / 1000).toFixed(1)}s`);
      if (tokens) info.push(`토큰: ${Number(tokens).toLocaleString()}`);
      else if (inputTokens || outputTokens) info.push(`토큰: ${(Number(inputTokens||0) + Number(outputTokens||0)).toLocaleString()}`);
      if (turns) info.push(`턴: ${turns}`);
      return `\n---\n**📊 실행 결과** ${info.join(' | ')}`;
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

  // 보고서 자동 발송 스케줄러 시작
  startReportScheduler();

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

    // 레이블 동기화는 프로젝트 설정에서 수동으로 수행
    // (스캐너에서 자동 생성하지 않음 — 권한 없을 수 있음)

    // 모든 상태 레이블로 이슈를 조회합니다.
    // IVE 레이블이 없으면 IVE에서 관리하지 않는 이슈이므로 무시합니다.
    const fetchIssues = project.provider === 'github' ? fetchGitHubIssues : fetchGitLabIssues;
    const labelTarget = project.labelTarget;
    const labelS = project.labelSchedule || 'IVE-S';
    const labelD = project.labelDev || 'IVE-D';
    const labelV = project.labelVerify || 'IVE-V';
    const labelE = project.labelEnd || 'IVE-E';

    // IVE 레이블이 있는 이슈를 기본으로 조회 (모든 IVE 관리 이슈)
    // + 상태 레이블 이슈도 병합 (IVE 없이 상태 레이블만 남은 경우 정리용)
    const [targetIssues, sIssues, dIssues, vIssues, eIssues] = await Promise.all([
      fetchIssues(project, decryptedToken, labelTarget),
      fetchIssues(project, decryptedToken, labelS),
      fetchIssues(project, decryptedToken, labelD),
      fetchIssues(project, decryptedToken, labelV),
      fetchIssues(project, decryptedToken, labelE),
    ]);

    // 이슈를 Map으로 병합 (iid → issue), closed 제외
    const issueMap = new Map<number, any>();
    for (const issue of [...targetIssues, ...sIssues, ...dIssues, ...vIssues, ...eIssues]) {
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
        const orphanLabels = [labelS, labelD, labelV, labelE].filter(l => labels.includes(l));
        if (orphanLabels.length > 0) {
          try { await removeIssueLabels(project, iid, decryptedToken, orphanLabels); } catch { /* ignore */ }
          console.log(`[Scanner] Issue #${iid} — orphan labels removed (no ${labelTarget}): ${orphanLabels.join(', ')}`);
        }
        issueMap.delete(iid);
        continue;
      }

      // IVE-E가 있으면서 이전 단계 레이블 잔류 → 정리
      if (labels.includes(labelE)) {
        const staleLabels = [labelS, labelD, labelV].filter(l => labels.includes(l));
        if (staleLabels.length > 0) {
          try { await removeIssueLabels(project, iid, decryptedToken, staleLabels); } catch { /* ignore */ }
          console.log(`[Scanner] Issue #${iid} — cleaned stale labels (has ${labelE}): ${staleLabels.join(', ')}`);
        }
      }
    }

    // 레이블로 상태 판정 후, waiting 이슈를 processIssues로 전달
    const waitingIssues: any[] = [];
    for (const [iid, issue] of issueMap) {
      const labels: string[] = issue.labels || [];
      const activeExec = hasActiveExecution(project.id, iid);
      const stage = stageFromLabels(labels, project, { hasActiveExec: activeExec });

      if (stage === 'waiting') {
        // 신규 이슈 감지 로그 (처음 발견된 이슈만)
        if (!hasAnyExecution(project.id, iid)) {
          try {
            createActivityLog({
              userId: 'system', category: 'task', action: 'detect_issue',
              detail: `이슈 감지: #${iid} "${issue.title}" (${project.name})`,
              targetType: 'issue', targetId: `${project.id}-${iid}`,
            });
          } catch (e) { console.error('[Scanner] Failed to log detect_issue activity:', e); }
        }
        waitingIssues.push(issue);
      }
    }

    if (waitingIssues.length > 0) {
      // 먼저 생성된 이슈부터 배정 (created_at 오름차순)
      waitingIssues.sort((a, b) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime());
      console.log(`[Scanner] Found ${waitingIssues.length} waiting issues for ${project.name}`);
      const { assigned, waiting } = await processIssues(project, waitingIssues, decryptedToken);
      issueCount += waiting;
    }

    // 마지막 체크 시간 및 대기 이슈 수 업데이트 (waiting만 카운트)
    updateProjectLastChecked(project.id, now.toISOString(), issueCount);

    // 충돌 감지 작업 배정: done 상태 이슈가 2개 이상이면 MR 충돌 가능성 있음
    // TODO: processConflictCheck not yet implemented
    // try {
    //   await processConflictCheck(project, decryptedToken);
    // } catch (e) {
    //   console.warn(`[Scanner] Conflict check failed for ${project.name}:`, e);
    // }

  } catch (err) {
    let msg = err instanceof Error ? err.message : String(err);
    // 인증 관련 에러에 조치 안내 추가
    if (msg.includes('인증 정보가 유효하지 않거나 만료') || msg.includes('인증 실패')) {
      msg = `Git 액세스 토큰 인증 실패 — 프로젝트 설정에서 토큰을 확인하거나 새로 발급하여 교체해주세요.`;
    }
    console.warn(`[Scanner] Error scanning project ${project.name}: ${msg}`);
    updateProjectError(project.id, msg);
  }
}

async function processIssues(project: Project, issues: any[], decryptedToken: string): Promise<{ assigned: number; waiting: number }> {
  const assignments = getProjectAssignments(project.id);
  let assignedCount = 0;
  let waitingCount = 0;
  const busyAgentIds = new Set<string>();
  // preferred_agent_id를 한 번에 조회 (이슈별 개별 쿼리 방지)
  const preferredAgentMap = getPreferredAgentMap(project.id);

  console.log(`[Scanner] processIssues: ${issues.length} issues, ${assignments.length} agents`);
  for (const issue of issues) {
    // 이미 진행 중인 실행이 있으면 무조건 스킵
    if (hasActiveExecution(project.id, issue.iid)) {
      console.log(`[Scanner] [SKIP] Issue #${issue.iid} (activeExec: true)`);
      continue;
    }

    // 레이블로 상태 판정 — waiting만 processIssues에 들어오므로 여기선 추가 검증
    const labels: string[] = issue.labels || [];
    const stage = stageFromLabels(labels, project, { hasActiveExec: false });
    if (stage !== 'waiting') {
      console.log(`[Scanner] [SKIP] Issue #${issue.iid} (stage: ${stage})`);
      continue;
    }

    // 에이전트 선택: 선호 에이전트 우선, 없으면 라운드로빈
    let availableAgent: Agent | null = null;
    let agentToken = decryptedToken; // 기본: 프로젝트 토큰
    let selectedPa: typeof assignments[0] | null = null;
    let useRoundRobin = true;
    const preferredAgentId = preferredAgentMap.get(issue.iid) || null;

    if (preferredAgentId) {
      const pa = assignments.find(a => a.agentId === preferredAgentId);
      if (!pa) {
        // 지정 에이전트가 프로젝트에서 배정 해제됨 → preferred 초기화, 라운드로빈 전환
        console.log(`[Scanner] [RESET] Issue #${issue.iid} — 지정 작업자가 프로젝트에서 해제됨, 자동 배정으로 전환`);
        setPreferredAgent(project.id, issue.iid, null);
      } else if (busyAgentIds.has(pa.agentId) || countActiveExecutionsByAgent(pa.agentId) > 0) {
        // 지정 에이전트가 바쁨 → 이번 스캔 스킵, 다음 스캔에서 재시도
        console.log(`[Scanner] [WAIT] Issue #${issue.iid} — 지정 작업자 '${pa.agent.name}' 작업 중, 대기`);
        waitingCount++;
        continue;
      } else {
        selectedPa = pa;
        useRoundRobin = false;
      }
    }

    // 선호 에이전트가 없거나 리셋된 경우: 라운드로빈
    if (useRoundRobin && !selectedPa) {
      let oldestTime = Infinity;
      for (const pa of assignments) {
        if (busyAgentIds.has(pa.agentId)) continue;
        const running = countActiveExecutionsByAgent(pa.agentId);
        if (running === 0) {
          const lastDone = getLastCompletedAt(pa.agentId);
          const t = lastDone ? new Date(lastDone).getTime() : 0;
          if (t < oldestTime) {
            oldestTime = t;
            selectedPa = pa;
          }
        }
      }
    }

    if (selectedPa) {
      availableAgent = selectedPa.agent;
      if (selectedPa.accessToken) {
        try { agentToken = decrypt(selectedPa.accessToken); } catch { agentToken = decryptedToken; }
      }
    }

    if (availableAgent) {
      busyAgentIds.add(availableAgent.id);
      const assignType = preferredAgentId ? ' (지정 작업자)' : '';
      console.log(`[Scanner] [ASSIGN] Project: ${project.name}, Issue: #${issue.iid}, Agent: ${availableAgent.name}${assignType}${agentToken !== decryptedToken ? ' (자체 토큰)' : ''}`);

      // 대기시간 계산 기준: 이슈 생성 시점
      const waitingSince = issue.created_at || new Date().toISOString();

      // 비동기로 태스크 실행 (개발자별 토큰 우선) — 트랜잭션은 executeTask 내에서 처리
      executeTask(project, issue, availableAgent, agentToken, waitingSince)
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
  // 대기시간 기준: 이슈가 대기 큐에 진입한 시점(issue_stages.updated_at)을 사용
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
    log(`\x1b[1;36m${'═'.repeat(50)}\x1b[0m`, 'info');
    log(`Started: ${startDateStr} (${ownerTz})`, 'system');
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

    // 5. 에이전트 CLI 실행 (시스템 설정의 CLI 경로 우선 사용)
    const systemCliPath = getSystemSetting(`cli.${agent.cliName}.path`);
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
          agent: { coder: { steps: agent.maxTurns || 200, permission: 'allow' } },
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
        const eventModel = event.model ?? event.modelId ?? event.model_id ?? '';
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
            const iT = event.input_tokens ?? event.inputTokens ?? event.usage?.input_tokens ?? 0;
            const oT = event.output_tokens ?? event.outputTokens ?? event.usage?.output_tokens ?? 0;
            const cost = event.cost_usd ?? event.costUsd ?? event.cost ?? 0;
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
        if (totalInputTokens || totalOutputTokens || totalCostUsd || finalTurns) {
          const finalCost = totalCostUsd > 0
            ? totalCostUsd
            : calcCostFromDb(agent.cliName, totalInputTokens, totalOutputTokens, detectedModel || undefined);
          updateExecutionTokens(executionId, totalInputTokens, totalOutputTokens, finalCost, finalTurns, detectedModel || undefined);
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

      // 레이블 전환: IVE-D 제거, IVE-V 부착 (검증 대기)
      try {
        await removeIssueLabels(project, iid, token, [project.labelDev || 'IVE-D']);
        await addIssueLabels(project, iid, token, [project.labelVerify || 'IVE-V']);
      } catch (e) { console.warn(`[Scanner] Label switch failed:`, e); }
      log("작업 완료 → 검증 대기 (IVE-V).", 'system');
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
      // 코드 변경 없음 → IVE-D 제거, IVE-V 부착 (검증 대기)
      try {
        await removeIssueLabels(project, iid, token, [project.labelDev || 'IVE-D']);
        await addIssueLabels(project, iid, token, [project.labelVerify || 'IVE-V']);
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
    try {
      const freshProject = getProject(project.id);
      if (freshProject && (freshProject.lastScannedIssueCount ?? 0) > 0) {
        console.log(`[Scanner] Agent ${agent.name} freed — re-scanning ${freshProject.name} for waiting issues`);
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
async function processConflictCheck(project: Project, decryptedToken: string) {
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
