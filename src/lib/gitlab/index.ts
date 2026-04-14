// Common: URL parsing, auth headers, API helpers
export { getProjectPath, refreshGitLabToken, getApiBaseUrl, getAuthHeaders, apiUrl } from './common';

// Labels: CRUD operations
export { ensureGitLabLabels, addGitLabIssueLabels, removeGitLabIssueLabels, checkGitLabLabelsExist } from './labels';

// Issues: fetching, creation, updating, commenting/notes
export {
  fetchGitLabIssues,
  addGitLabIssueComment,
  fetchGitLabIssueNotes,
  deleteGitLabIssueNote,
  addGitLabSpentTime,
  fetchAllIveIssues,
  fetchAllProjectIssues,
  fetchClosedProjectIssues,
  closeGitLabIssue,
  reopenGitLabIssue,
  updateGitLabIssue,
  createGitLabIssue,
  fetchGitLabProjectMembers,
} from './issues';

// MR: lifecycle (create, update, merge, close, diff, pipelines)
export {
  createGitLabMR,
  getGitLabMR,
  addGitLabMRNote,
  fetchGitLabMRByBranch,
  fetchGitLabMRChanges,
  mergeGitLabMR,
  closeGitLabMR,
  fetchOpenGitLabMRs,
  fetchGitLabMRPipelines,
  fetchGitLabBranchPipelines,
} from './mr';

// Repository: branches, file read/write, uploads
export {
  createGitLabBranch,
  getGitLabDefaultBranch,
  readGitLabRepoFile,
  upsertGitLabRepoFile,
  uploadGitLabFile,
} from './repository';
