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

  const configured = (project.baseBranch || '').trim();
  let baseBranch = configured;

  if (configured) {
    try {
      await execFile('git', ['fetch', 'origin', configured], { cwd: workspacePath });
      await execFile('git', ['checkout', configured], { cwd: workspacePath });
      await execFile('git', ['pull', 'origin', configured], { cwd: workspacePath });
    } catch {
      log(`설정된 베이스 브랜치 '${configured}' 체크아웃 실패. 원격 기본 브랜치로 폴백.`, 'warn');
      baseBranch = await detectAndCheckoutDefault(workspacePath);
    }
  } else {
    baseBranch = await detectAndCheckoutDefault(workspacePath);
  }

  // 브랜치는 CLI 실행 후 변경사항이 있을 때 mr-creator에서 생성
  // 여기서는 기본 브랜치에서 작업

  return { workspacePath, baseBranch, branchName };
}

async function detectAndCheckoutDefault(workspacePath: string): Promise<string> {
  let baseBranch = 'main';
  try {
    await execFile('git', ['remote', 'set-head', 'origin', '--auto'], { cwd: workspacePath });
    const { stdout: headRef } = await execFile('git', ['symbolic-ref', 'refs/remotes/origin/HEAD'], { cwd: workspacePath });
    baseBranch = headRef.trim().replace('refs/remotes/origin/', '');
  } catch {
    baseBranch = 'main';
  }
  await execFile('git', ['checkout', baseBranch], { cwd: workspacePath });
  await execFile('git', ['pull', 'origin', baseBranch], { cwd: workspacePath });
  return baseBranch;
}

export interface PreservedChanges {
  patchPath: string;
  stat: string;
  patch: string;
}

/**
 * 실패·중지된 실행의 작업 디렉토리 변경을 패치 파일로 보존합니다(작업 디렉토리는 곧 지워진다).
 * 추적·미추적 파일 모두 담는다(.git/info/exclude 의 첨부 이미지는 제외). 변경이 없거나 git 이 아니면 null.
 */
export async function preserveWorkspaceChanges(
  workspacePath: string,
  outDir: string,
  executionId: string,
): Promise<PreservedChanges | null> {
  if (!fs.existsSync(`${workspacePath}/.git`)) return null;
  const git = (args: string[]) =>
    execFile('git', args, { cwd: workspacePath, maxBuffer: 64 * 1024 * 1024 }).then((r: { stdout: string }) => String(r.stdout));
  try {
    await git(['add', '-A']);
    const patch = await git(['diff', '--cached', '--binary', 'HEAD']);
    if (!patch.trim()) return null;
    const stat = (await git(['diff', '--cached', '--stat', 'HEAD'])).trim();
    const patchPath = `${outDir}/${executionId}.patch`;
    fs.writeFileSync(patchPath, patch);
    return { patchPath, stat, patch };
  } catch {
    return null;
  }
}
