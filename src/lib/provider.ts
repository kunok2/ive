/**
 * Provider dispatch — GitLab/GitHub 함수를 프로젝트 provider에 따라 선택합니다.
 */
import { Project } from "@/types";
import * as gitlab from "./gitlab";
import * as github from "./github";

// Issues
export function fetchAllProjectIssues(project: Project, token: string) {
  return project.provider === 'github'
    ? github.fetchAllProjectIssues(project, token)
    : gitlab.fetchAllProjectIssues(project, token);
}

export function fetchClosedProjectIssues(project: Project, token: string) {
  return project.provider === 'github'
    ? github.fetchClosedProjectIssues(project, token)
    : gitlab.fetchClosedProjectIssues(project, token);
}

export function createIssue(project: Project, token: string, title: string, description: string, labels: string[], assignees?: { ids?: number[]; usernames?: string[] }, options?: { isOAuth?: boolean }) {
  return project.provider === 'github'
    ? github.createGitHubIssue(project, token, title, description, labels, assignees?.usernames)
    : gitlab.createGitLabIssue(project, token, title, description, labels, assignees?.ids, options);
}

export function fetchProjectMembers(project: Project, token: string) {
  return project.provider === 'github'
    ? github.fetchGitHubCollaborators(project, token)
    : gitlab.fetchGitLabProjectMembers(project, token);
}

export function updateIssue(project: Project, iid: number, token: string, updates: { title?: string; description?: string; assigneeIds?: number[]; assignees?: string[] }) {
  return project.provider === 'github'
    ? github.updateGitHubIssue(project, iid, token, { title: updates.title, description: updates.description, assignees: updates.assignees })
    : gitlab.updateGitLabIssue(project, iid, token, { title: updates.title, description: updates.description, assigneeIds: updates.assigneeIds });
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

// MR / PR
export function fetchMRByBranch(project: Project, token: string, branch: string) {
  return project.provider === 'github'
    ? github.fetchGitHubPRByBranch(project, token, branch)
    : gitlab.fetchGitLabMRByBranch(project, token, branch);
}

export function fetchMRChanges(project: Project, token: string, mrIid: number) {
  return project.provider === 'github'
    ? github.fetchGitHubPRChanges(project, token, mrIid)
    : gitlab.fetchGitLabMRChanges(project, token, mrIid);
}

export function mergeMR(project: Project, token: string, mrIid: number) {
  return project.provider === 'github'
    ? github.mergeGitHubPR(project, token, mrIid)
    : gitlab.mergeGitLabMR(project, token, mrIid);
}

export function closeMR(project: Project, token: string, mrIid: number) {
  return project.provider === 'github'
    ? github.closeGitHubPR(project, token, mrIid)
    : gitlab.closeGitLabMR(project, token, mrIid);
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

export function fetchBranchPipelines(project: Project, token: string, ref: string) {
  return project.provider === 'github'
    ? github.fetchGitHubBranchCheckRuns(project, token, ref)
    : gitlab.fetchGitLabBranchPipelines(project, token, ref);
}

// Single issue fetch (for GET /issues/[iid])
export async function fetchSingleIssue(project: Project, iid: number, token: string) {
  if (project.provider === 'github') {
    return github.fetchGitHubIssue(project, iid, token);
  }
  // GitLab: 직접 API 호출
  const { getApiBaseUrl, getProjectPath, getAuthHeaders } = await import('./gitlab');
  const base = getApiBaseUrl(project.repoUrl);
  const projectPath = getProjectPath(project.repoUrl);
  const headers = getAuthHeaders(project, token);
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

export async function removeIssueLabels(project: Project, iid: number, token: string, labels: string[]) {
  if (project.provider === 'github') {
    for (const label of labels) await github.removeGitHubIssueLabels(project, iid, token, label);
  } else {
    await gitlab.removeGitLabIssueLabels(project, iid, token, labels);
  }
}

// Fetch issues by label
export function fetchIssuesByLabel(project: Project, token: string, label: string) {
  return project.provider === 'github'
    ? github.fetchGitHubIssues(project, token, label)
    : gitlab.fetchGitLabIssues(project, token, label);
}

// Branch
export function createBranch(project: Project, token: string, branchName: string, ref: string) {
  return project.provider === 'github'
    ? github.createGitHubBranch(project, token, branchName, ref)
    : gitlab.createGitLabBranch(project, token, branchName, ref);
}

export function createMR(project: Project, token: string, payload: { source_branch: string; target_branch: string; title: string; description?: string }) {
  return project.provider === 'github'
    ? github.createGitHubPR(project, token, payload)
    : gitlab.createGitLabMR(project, token, payload);
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
