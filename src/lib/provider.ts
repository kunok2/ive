/**
 * Provider dispatch — GitLab/GitHub 함수를 프로젝트 provider에 따라 선택합니다.
 */
import { Project, PipelineFilter } from "@/types";
import * as gitlab from "./gitlab";
import * as github from "./github";
import type { ClosedIssuePageOptions } from "./closed-issues";
import { withTargetLabelSwap } from "./stage-transitions";
import { DEFAULT_LABELS } from "./labels";

// Issues
export function fetchAllProjectIssues(project: Project, token: string) {
  return project.provider === 'github'
    ? github.fetchAllProjectIssues(project, token)
    : gitlab.fetchAllProjectIssues(project, token);
}

export function fetchClosedProjectIssuesPage(project: Project, token: string, opts: ClosedIssuePageOptions) {
  return project.provider === 'github'
    ? github.fetchClosedProjectIssuesPage(project, token, opts)
    : gitlab.fetchClosedProjectIssuesPage(project, token, opts);
}

export function createIssue(project: Project, token: string, title: string, description: string, labels: string[], assignees?: { ids?: number[]; usernames?: string[] }, options?: { isOAuth?: boolean; dueDate?: string | null }) {
  return project.provider === 'github'
    ? github.createGitHubIssue(project, token, title, description, labels, assignees?.usernames, { dueDate: options?.dueDate })
    : gitlab.createGitLabIssue(project, token, title, description, labels, assignees?.ids, options);
}

export function fetchProjectMembers(project: Project, token: string) {
  return project.provider === 'github'
    ? github.fetchGitHubCollaborators(project, token)
    : gitlab.fetchGitLabProjectMembers(project, token);
}

export function updateIssue(project: Project, iid: number, token: string, updates: { title?: string; description?: string; assigneeIds?: number[]; assignees?: string[]; dueDate?: string | null }) {
  return project.provider === 'github'
    ? github.updateGitHubIssue(project, iid, token, { title: updates.title, description: updates.description, assignees: updates.assignees, dueDate: updates.dueDate })
    : gitlab.updateGitLabIssue(project, iid, token, { title: updates.title, description: updates.description, assigneeIds: updates.assigneeIds, dueDate: updates.dueDate });
}

export function closeIssue(project: Project, iid: number, token: string) {
  return project.provider === 'github'
    ? github.closeGitHubIssue(project, iid, token)
    : gitlab.closeGitLabIssue(project, iid, token);
}

export function reopenIssue(project: Project, iid: number, token: string) {
  return project.provider === 'github'
    ? github.reopenGitHubIssue(project, iid, token)
    : gitlab.reopenGitLabIssue(project, iid, token);
}

/** 이슈가 마지막으로 닫힌 것이 커밋·MR(닫기 키워드) 때문인가 — 사람이 닫았으면 false, 모르면 null */
export function isIssueClosedByGit(project: Project, iid: number, token: string): Promise<boolean | null> {
  return project.provider === 'github'
    ? github.isGitHubIssueClosedByGit(project, iid, token)
    : gitlab.isGitLabIssueClosedByGit(project, iid, token);
}


export function fetchIssueNotes(project: Project, iid: number, token: string, options?: { isOAuth?: boolean; silent?: boolean }) {
  return project.provider === 'github'
    ? github.fetchGitHubIssueNotes(project, iid, token)
    : gitlab.fetchGitLabIssueNotes(project, iid, token, options);
}

export async function addIssueComment(project: Project, iid: number, token: string, body: string, options?: { isOAuth?: boolean; silent?: boolean }) {
  if (project.provider === 'github') {
    return await github.addGitHubIssueComment(project, iid, token, body);
  }
  return await gitlab.addGitLabIssueComment(project, iid, token, body, options);
}

export async function deleteIssueComment(project: Project, iid: number, noteId: number, token: string, options?: { isOAuth?: boolean }) {
  if (project.provider === 'github') {
    return await github.deleteGitHubIssueComment(project, iid, noteId, token);
  }
  return await gitlab.deleteGitLabIssueNote(project, iid, noteId, token, options);
}

/** 이슈/코멘트 본문에 첨부할 파일(주로 이미지)을 업로드하고 마크다운 스니펫을 돌려줍니다. */
export function uploadIssueAttachment(
  project: Project,
  token: string,
  filename: string,
  buffer: Buffer,
  mimeType: string,
) {
  return project.provider === 'github'
    ? github.uploadGitHubFile(project, token, filename, buffer, mimeType)
    : gitlab.uploadGitLabFile(project, token, filename, buffer, mimeType);
}

/**
 * 업로드된 첨부(uploadIssueAttachment 가 돌려준 url)를 인증 토큰으로 다운로드한다.
 * 채팅/스캐너에서 첨부 이미지를 워크스페이스에 저장해 에이전트에게 넘길 때 사용.
 */
export function downloadProjectUpload(project: Project, token: string, url: string) {
  return project.provider === 'github'
    ? github.downloadGitHubFile(project, token, url)
    : gitlab.downloadGitLabUpload(project, token, url);
}

// MR / PR
export function fetchMRByBranch(project: Project, token: string, branch: string, options?: { isOAuth?: boolean }) {
  return project.provider === 'github'
    ? github.fetchGitHubPRByBranch(project, token, branch)
    : gitlab.fetchGitLabMRByBranch(project, token, branch, options);
}

export function fetchMRChanges(project: Project, token: string, mrIid: number) {
  return project.provider === 'github'
    ? github.fetchGitHubPRChanges(project, token, mrIid)
    : gitlab.fetchGitLabMRChanges(project, token, mrIid);
}

/** options.sha — 주면 MR 머리 커밋이 그 커밋일 때만 머지한다(검증한 뒤 새 커밋이 올라왔으면 거절) */
export function mergeMR(project: Project, token: string, mrIid: number, options?: { isOAuth?: boolean; sha?: string }) {
  return project.provider === 'github'
    ? github.mergeGitHubPR(project, token, mrIid, { sha: options?.sha })
    : gitlab.mergeGitLabMR(project, token, mrIid, options);
}

export function closeMR(project: Project, token: string, mrIid: number, options?: { isOAuth?: boolean }) {
  return project.provider === 'github'
    ? github.closeGitHubPR(project, token, mrIid)
    : gitlab.closeGitLabMR(project, token, mrIid, options);
}

// Open MRs (충돌 감지용)
export function fetchOpenMRs(project: Project, token: string) {
  return project.provider === 'github'
    ? github.fetchOpenGitHubPRs(project, token)
    : gitlab.fetchOpenGitLabMRs(project, token);
}

// Pipeline / Check Runs
export function fetchMRPipelines(project: Project, token: string, mrIid: number) {
  return project.provider === 'github'
    ? github.fetchGitHubPRCheckRuns(project, token, mrIid)
    : gitlab.fetchGitLabMRPipelines(project, token, mrIid);
}

export function fetchBranchPipelines(project: Project, token: string, ref: string, filter?: PipelineFilter) {
  return project.provider === 'github'
    ? github.fetchGitHubBranchCheckRuns(project, token, ref, filter)
    : gitlab.fetchGitLabBranchPipelines(project, token, ref, filter);
}

/** 파이프라인 잡 목록 (GitLab 만 — GitHub 는 null) */
export async function fetchPipelineJobs(project: Project, token: string, pipelineId: number): Promise<{ name: string; stage: string; status: string }[] | null> {
  return project.provider === 'github' ? null : gitlab.fetchGitLabPipelineJobs(project, token, pipelineId);
}

// Single issue fetch (for GET /issues/[iid])
export async function fetchSingleIssue(project: Project, iid: number, token: string) {
  if (project.provider === 'github') {
    return github.fetchGitHubIssue(project, iid, token);
  }
  // GitLab: 직접 API 호출
  const base = gitlab.getApiBaseUrl(project.repoUrl);
  const projectPath = gitlab.getProjectPath(project.repoUrl);
  const headers = gitlab.getAuthHeaders(project, token);
  const res = await fetch(`${base}/projects/${projectPath}/issues/${iid}`, { headers });
  if (!res.ok) {
    if (res.status === 404) return null;
    throw new Error(`GitLab API 오류: ${res.statusText}`);
  }
  return await res.json();
}

// Labels
export function ensureLabels(project: Project, token: string) {
  return project.provider === 'github'
    ? github.ensureGitHubLabels(project, token)
    : gitlab.ensureGitLabLabels(project, token);
}

/** 저장소 레이블 이름 변경 — renamed · already(이미 새 이름) · absent(둘 다 없음). 둘 다 있으면 예외 */
export function renameLabel(project: Project, token: string, from: string, to: string) {
  return project.provider === 'github'
    ? github.renameGitHubLabel(project, token, from, to)
    : gitlab.renameGitLabLabel(project, token, from, to);
}

export function checkLabelsExist(project: Project, token: string) {
  return project.provider === 'github'
    ? github.checkGitHubLabelsExist(project, token)
    : gitlab.checkGitLabLabelsExist(project, token);
}

export async function addIssueLabels(project: Project, iid: number, token: string, labels: string[]) {
  return project.provider === 'github'
    ? github.addGitHubIssueLabels(project, iid, token, labels)
    : gitlab.addGitLabIssueLabels(project, iid, token, labels);
}

/**
 * 단계 라벨 바꾸기 — 떼고 붙이는 사이에 단계 라벨이 하나도 없는 순간이 생기면, 그때 이슈를 읽은 스캐너가
 * 「단계 없음(유입)」으로 이동했다고 기록한다(진행 막대에 없던 되돌림이 그려진다). 그래서
 *  - GitLab: 붙이기·떼기를 한 번의 요청으로
 *  - GitHub: 붙이기 먼저, 떼기 나중(잠깐 두 라벨이 함께 있을 뿐 단계가 비지 않는다)
 * 붙일 라벨은 뗄 목록에서 뺀다.
 * 단계 라벨을 붙이면 대상 라벨(ive)은 뗀다 — 단계 라벨이 곧 IVE 관리 표시(withTargetLabelSwap).
 */
export async function swapIssueLabels(project: Project, iid: number, token: string, addLabels: string[], removeLabels: string[]) {
  const { add, remove } = withTargetLabelSwap(project, addLabels, removeLabels);
  const rm = remove.filter(l => !add.includes(l));
  if (project.provider === 'github') {
    if (add.length) await github.addGitHubIssueLabels(project, iid, token, add);
    if (rm.length) await Promise.allSettled(rm.map(label => github.removeGitHubIssueLabels(project, iid, token, label)));
  } else if (add.length || rm.length) {
    await gitlab.swapGitLabIssueLabels(project, iid, token, add, rm);
  }
}

export async function removeIssueLabels(project: Project, iid: number, token: string, labels: string[]) {
  if (project.provider === 'github') {
    await Promise.allSettled(labels.map(label => github.removeGitHubIssueLabels(project, iid, token, label)));
  } else {
    await gitlab.removeGitLabIssueLabels(project, iid, token, labels);
  }
}

// Issue label events (누가 어떤 레이블을 언제 달았는지)
export function fetchIssueLabelEvents(project: Project, iid: number, token: string) {
  return project.provider === 'github'
    ? github.fetchGitHubIssueLabelEvents(project, iid, token)
    : gitlab.fetchGitLabIssueLabelEvents(project, iid, token);
}

// Fetch issues by label
export function fetchIssuesByLabel(project: Project, token: string, label: string) {
  return project.provider === 'github'
    ? github.fetchGitHubIssues(project, token, label)
    : gitlab.fetchGitLabIssues(project, token, label);
}

/**
 * 이슈의 기록 작업시간(GitLab /spend, 초) 조회. GitHub은 native 시간추적이 없어 0.
 * ⚠️ work_sec 1회 백필 전용. 보고서 런타임에서 호출 금지(이슈마다 호출 = 느림).
 */
export function fetchIssueTimeSpentSec(project: Project, token: string, issueIid: number): Promise<number> {
  return project.provider === 'github'
    ? Promise.resolve(0)
    : gitlab.fetchGitLabIssueTimeSpentSec(project, issueIid, token);
}

// Branch
export function createBranch(project: Project, token: string, branchName: string, ref: string) {
  return project.provider === 'github'
    ? github.createGitHubBranch(project, token, branchName, ref)
    : gitlab.createGitLabBranch(project, token, branchName, ref);
}

/** IVE 가 만든 MR/PR 에 다는 표시 레이블 — 단계 없이 프로젝트의 대상 레이블(기본 ive) 하나. */
export function iveMrLabel(project: Project): string {
  return project.labelTarget || DEFAULT_LABELS.target;
}

// 생성 시 IVE 표시 레이블을 함께 단다 (GitLab 은 생성 payload, GitHub 은 생성 직후 이슈 API)
export function createMR(project: Project, token: string, payload: { source_branch: string; target_branch: string; title: string; description?: string }) {
  const label = iveMrLabel(project);
  return project.provider === 'github'
    ? github.createGitHubPR(project, token, { ...payload, labels: [label] })
    : gitlab.createGitLabMR(project, token, { ...payload, labels: label });
}

// 이미 있는 MR/PR(재처리로 갱신되는 것, 레이블 도입 전에 만든 것)에도 표시 레이블을 단다
export function markMRAsIve(project: Project, token: string, mrIid: number) {
  const label = iveMrLabel(project);
  return project.provider === 'github'
    ? github.addGitHubPRLabels(project, token, mrIid, [label])
    : gitlab.addGitLabMRLabels(project, token, mrIid, [label]);
}

export function getDefaultBranch(project: Project, token: string) {
  return project.provider === 'github'
    ? github.getGitHubDefaultBranch(project, token)
    : gitlab.getGitLabDefaultBranch(project, token);
}

// Repository File (텍스트 파일 읽기/쓰기)
export function readRepoFile(project: Project, token: string, filePath: string, branch?: string) {
  return project.provider === 'github'
    ? github.readGitHubRepoFile(project, token, filePath, branch)
    : gitlab.readGitLabRepoFile(project, token, filePath, branch);
}

export function upsertRepoFile(project: Project, token: string, filePath: string, content: string, commitMessage: string, branch?: string) {
  return project.provider === 'github'
    ? github.upsertGitHubRepoFile(project, token, filePath, content, commitMessage, branch)
    : gitlab.upsertGitLabRepoFile(project, token, filePath, content, commitMessage, branch);
}

/** ancestor 커밋이 descendant 커밋에 포함되는가 (`git merge-base --is-ancestor`). 판정 불가면 null */
export function isAncestorCommit(project: Project, token: string, ancestor: string, descendant: string) {
  return project.provider === 'github'
    ? github.isGitHubAncestorCommit(project, token, ancestor, descendant)
    : gitlab.isGitLabAncestorCommit(project, token, ancestor, descendant);
}
