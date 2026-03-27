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

export function createIssue(project: Project, token: string, title: string, description: string, labels: string[]) {
  return project.provider === 'github'
    ? github.createGitHubIssue(project, token, title, description, labels)
    : gitlab.createGitLabIssue(project, token, title, description, labels);
}

export function updateIssue(project: Project, iid: number, token: string, updates: { title?: string; description?: string }) {
  return project.provider === 'github'
    ? github.updateGitHubIssue(project, iid, token, updates)
    : gitlab.updateGitLabIssue(project, iid, token, updates);
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


export function fetchIssueNotes(project: Project, iid: number, token: string) {
  return project.provider === 'github'
    ? github.fetchGitHubIssueNotes(project, iid, token)
    : gitlab.fetchGitLabIssueNotes(project, iid, token);
}

export function addIssueComment(project: Project, iid: number, token: string, body: string) {
  return project.provider === 'github'
    ? github.addGitHubIssueComment(project, iid, token, body)
    : gitlab.addGitLabIssueComment(project, iid, token, body);
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

// Fetch issues by label
export function fetchIssuesByLabel(project: Project, token: string, label: string) {
  return project.provider === 'github'
    ? github.fetchGitHubIssues(project, token, label)
    : gitlab.fetchGitLabIssues(project, token, label);
}
