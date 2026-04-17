/**
 * Git 작업: 클론, 브랜치 생성, 작업 디렉토리 준비
 */
import fs from "fs";
import { promisify } from "util";
import { Project } from "@/types";

const execFile = promisify(require('child_process').execFile);

export interface GitSetupResult {
  workspacePath: string;
  baseBranch: string;
  branchName: string;
}

/**
 * 작업 디렉토리를 준비하고 Git 클론 + 브랜치를 생성합니다.
 */
export async function setupWorkspace(
  project: Project,
  workspacePath: string,
  iid: number,
  token: string,
  isConflictTask: boolean,
  log: (msg: string, type?: 'info' | 'error' | 'warn' | 'system') => void,
): Promise<GitSetupResult> {
  const isGitHub = project.provider === 'github';

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

  // 브랜치는 CLI 실행 후 변경사항이 있을 때 mr-creator에서 생성
  // 여기서는 기본 브랜치에서 작업

  return { workspacePath, baseBranch, branchName };
}
