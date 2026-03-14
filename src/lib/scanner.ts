import { 
  getAllProjects, 
  updateProjectLastChecked, 
  getRolesByProject, 
  getRoleAssignments, 
  updateAgentStatus,
  createExecution,
  updateExecutionStatus
} from "./db";
import { decrypt } from "./crypto";
import { 
  ensureGitLabLabels, 
  fetchGitLabIssues, 
  updateGitLabIssueLabels, 
  addGitLabIssueComment, 
  fetchGitLabIssueNotes, 
  addGitLabSpentTime, 
  createGitLabMR, 
  getGitLabMR, 
  addGitLabMRNote 
} from "./gitlab";
import { Project, Agent } from "@/types";
import { spawn } from "child_process";
import fs from "fs";
import path from "path";
import { promisify } from "util";

const exec = promisify(require('child_process').exec);

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
  // 1분마다 전체 프로젝트 체크 (각 프로젝트의 checkInterval에 따라 실제 작업 수행 결정)
  global.scanInterval = setInterval(runScan, 60 * 1000);
  
  // 첫 실행은 약간의 지연 후 실행 (서버 초기화 완료 대기)
  setTimeout(runScan, 5000);
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
    const now = new Date();

    for (const project of projects) {
    try {
      // 스캐너 활성화 여부 확인
      if (project.scannerActive === false) {
        continue;
      }

      // 체크 주기 확인
      if (project.lastCheckedAt) {
        const lastChecked = new Date(project.lastCheckedAt);
        const diffMinutes = (now.getTime() - lastChecked.getTime()) / (1000 * 60);
        if (diffMinutes < project.checkInterval) {
          continue; // 아직 체크할 시간이 아님
        }
      }

      console.log(`[Scanner] Running scan for project: ${project.name} (Interval: ${project.checkInterval}m)`);
      
      const decryptedToken = decrypt(project.accessToken);
      
      let issueCount = 0;
      if (project.provider === 'gitlab') {
        // 1. 필수 레이블 확인 및 생성
        await ensureGitLabLabels(project, decryptedToken);
        
        // 2. 관리 대상(labelTarget) 이슈 조회
        const issues = await fetchGitLabIssues(project, decryptedToken, project.labelTarget);
        issueCount = issues.length;
        
        if (issues.length > 0) {
          console.log(`[Scanner] Found ${issues.length} target issues for ${project.name}`);
          // 3. 이슈 처리 (에이전트 배정 등)
          await processIssues(project, issues, decryptedToken);
        }
      } else if (project.provider === 'github') {
        // GitHub 구현 예정
      }

      // 마지막 체크 시간 및 이슈 수 업데이트
      updateProjectLastChecked(project.id, now.toISOString(), issueCount);
      
    } catch (err) {
      console.error(`[Scanner] Error scanning project ${project.name}:`, err);
    }
    }
  } catch (err) {
    console.error(`[Scanner] Core runScan error:`, err);
  } finally {
    global.isScanning = false;
  }
}

async function processIssues(project: Project, issues: any[], decryptedToken: string) {
  // 프로젝트에 할당된 가용 역할들을 가져옴
  const roles = getRolesByProject(project.id).filter(r => r.status === 'active');
  
  for (const issue of issues) {
    // 이미 누군가가 처리 중인지 레이블로 한 번 더 체크 (fetch 시점에 걸러지지만 작업 시작 전 안전장치)
    if (issue.labels.includes(project.labelInProgress) || issue.labels.includes(project.labelValidation)) {
      continue;
    }

    let assigned = false;
    
    // 이 이슈의 성격(개발/검증)에 맞는 역할을 찾음
    // 여기서는 간단히 카테고리가 '개발'인 경우와 '검증'인 경우를 나눔
    // 실제로는 이슈의 레이블이나 다른 정보를 통해 더 정밀하게 분류 가능
    const targetCategory = issue.labels.includes('validation') ? '검증' : '개발';
    const targetRoles = roles.filter(r => r.category === targetCategory);

    for (const role of targetRoles) {
      const assignments = getRoleAssignments(role.id);
      const availableAgent = assignments.find(a => a.agent.status === 'available');
      
      if (availableAgent) {
        console.log(`[Scanner] [ASSIGN] Project: ${project.name}, Issue: #${issue.iid}, Agent: ${availableAgent.agent.name}`);
        
        // 1. 에이전트 바쁨 상태로 전환
        updateAgentStatus(availableAgent.agentId, 'busy');

        // 2. 레이블 변경 (InProgress 등)
        const inProgressLabel = role.category === '개발' ? project.labelInProgress : project.labelValidation;
        await updateGitLabIssueLabels(
          project, 
          issue.iid, 
          decryptedToken, 
          [inProgressLabel], 
          [project.labelTarget]
        );
        
        // 3. 비동기로 태스크 실행 (병렬 처리 위해 await 하지 않음)
        executeTask(project, issue, availableAgent.agent, decryptedToken, inProgressLabel, role.category === '개발')
          .then(() => {
            console.log(`[Scanner] [DONE] Issue #${issue.iid} processed.`);
          })
          .catch(err => {
            console.error(`[Scanner] [FAILED] Issue #${issue.iid} error:`, err);
          })
          .finally(() => {
            // 태스크 완료 후 에이전트 복귀
            updateAgentStatus(availableAgent.agentId, 'available');
          });

        assigned = true;
        break; 
      }
    }
    
    if (!assigned) {
      console.log(`[Scanner] [SKIP] No available agent for Issue #${issue.iid} (Category: ${targetCategory}). Will retry in next scan.`);
    }
  }
}

/**
 * 에이전트를 사용하여 실제 작업을 수행합니다. (Git 클론, 브랜칭, CLI 실행, MR 생성 등)
 */
async function executeTask(
  project: Project, 
  issue: any, 
  agent: Agent, 
  token: string, 
  currentLabel: string, 
  isDevelop: boolean
) {
  const iid = issue.iid;
  const executionId = `ex-${Date.now()}-${Math.floor(Math.random() * 1000)}`;
  const workspacePath = path.join(process.cwd(), 'workspaces', project.id, `issue-${iid}`);
  const logDir = path.join(process.cwd(), 'data', 'logs');
  const logPath = path.join(logDir, `${executionId}.log`);
  
  if (!fs.existsSync(logDir)) fs.mkdirSync(logDir, { recursive: true });

  // 0. DB에 실행 시작 기록
  createExecution({
    id: executionId,
    projectId: project.id,
    agentId: agent.id,
    issueIid: iid,
    status: 'running',
    startedAt: new Date().toISOString(),
    logPath: logPath
  });

  const logStream = fs.createWriteStream(logPath, { flags: 'a' });
  const log = (msg: string, type: 'info' | 'error' | 'warn' | 'system' = 'info') => {
    const timestamp = new Date().toISOString();
    let colorCode = '';
    if (type === 'system') colorCode = '\x1b[1;32m'; // Bright Green
    if (type === 'error') colorCode = '\x1b[1;31m';  // Bright Red
    if (type === 'warn') colorCode = '\x1b[1;33m';   // Bright Yellow
    
    const coloredMsg = colorCode ? `${colorCode}${msg}\x1b[0m` : msg;
    logStream.write(`[${timestamp}] ${coloredMsg}\n`);
    console.log(`[Task #${iid}] ${msg}`);
  };

  try {
    // 1. 작업 디렉토리 준비
    log("Preparing workspace...", 'system');
    if (fs.existsSync(workspacePath)) {
      fs.rmSync(workspacePath, { recursive: true, force: true });
    }
    fs.mkdirSync(workspacePath, { recursive: true });

    // 2. Git 클론 및 준비
    const repoUrl = project.repoUrl.replace('https://', `https://oauth2:${token}@`);
    const branchName = isDevelop ? `dev-${iid}` : `val-${iid}`;
    
    log("Cloning repository...", 'system');
    await exec(`git clone ${repoUrl} .`, { cwd: workspacePath });
    
    let baseBranch = 'staging';
    try {
      await exec(`git fetch origin staging`, { cwd: workspacePath });
      await exec(`git checkout staging`, { cwd: workspacePath });
      await exec(`git pull origin staging`, { cwd: workspacePath });
    } catch {
      baseBranch = 'main';
      await exec(`git checkout main`, { cwd: workspacePath });
      await exec(`git pull origin main`, { cwd: workspacePath });
    }
    
    await exec(`git checkout -B ${branchName}`, { cwd: workspacePath });

    // 3. 이전 작업 이력 확인
    const notes = await fetchGitLabIssueNotes(project, iid, token);
    const iterationCount = notes.filter((n: any) => n.body.includes("IVE(봇) 이슈 해결")).length + 1;
    let iterationContext = "";
    if (iterationCount > 1) {
      const recentNotes = notes.filter((n: any) => !n.system).slice(-5);
      iterationContext = "\n## 이전 작업 이력 및 피드백:\n" + 
        recentNotes.map((n: any) => `### ${n.author.name} (${n.created_at})\n${n.body.substring(0, 500)}`).join('\n');
    }

    const prompt = `다음 GitLab 이슈를 해결해주세요. 한국어로만 보고하세요.

## 이슈 #${iid}: ${issue.title}
${issue.description || "설명 없음"}
${iterationContext}

## 지시사항:
- 프로젝트 구조와 스타일을 파악하고 관련 코드를 수정하세요.
- 수정 완료 후 git add로 변경 사항을 스테이징하세요.
- git commit/push는 하지 마세요. curl 등으로 외부 API를 직접 부르지 마세요.`;

    // 5. 에이전트 CLI 실행
    log(`Starting Agent CLI: ${agent.cliName}...`, 'system');
    const startTime = Date.now();
    
    await new Promise<void>((resolve, reject) => {
      const cliParts = agent.cliPath.split(' ');
      const mainCmd = cliParts[0];
      const args = [...cliParts.slice(1), '-p', prompt];
      
      const child = spawn(mainCmd, args, { 
        cwd: workspacePath,
        env: { ...process.env, GITLAB_API_TOKEN: token }
      });

      child.stdout.on('data', (data) => logStream.write(data));
      child.stderr.on('data', (data) => logStream.write(data));

      child.on('close', (code) => {
        if (code === 0) resolve();
        else reject(new Error(`Agent CLI exited with code ${code}`));
      });
      child.on('error', reject);
    });

    const durationSeconds = Math.floor((Date.now() - startTime) / 1000);
    const durationStr = `${Math.max(1, Math.floor(durationSeconds/60))}m`;

    // 6. 변경 사항 확인 및 커밋/푸시
    const { stdout: diffResult } = await exec(`git diff --cached --name-only`, { cwd: workspacePath });
    if (diffResult.trim()) {
      log("Changes detected. Committing and pushing...", 'system');
      await exec(`git commit -m "fix: resolve #${iid} - ${issue.title}"`, { cwd: workspacePath });
      await exec(`git push -f origin ${branchName}`, { cwd: workspacePath });

      const existingMR = await getGitLabMR(project, token, branchName);
      let mrUrl = "";
      if (existingMR) {
        mrUrl = existingMR.web_url;
        await addGitLabMRNote(project, token, existingMR.iid, `## 반복 수정 (${iterationCount}차)\n피드백을 반영하여 추가 수정했습니다.`);
      } else {
        const mrResult = await createGitLabMR(project, token, {
          source_branch: branchName,
          target_branch: baseBranch,
          title: `fix: resolve #${iid} - ${issue.title}`,
          description: `이슈 #${iid} 해결을 위한 자동 MR입니다. (${iterationCount}차 작업)`,
          remove_source_branch: false,
          squash: true
        });
        mrUrl = mrResult?.web_url || "";
      }

      await addGitLabIssueComment(project, iid, token, `## IVE(봇) ${isDevelop ? '개발' : '검증'} 완료\n\nMR: ${mrUrl}\n소요 시간: ${durationStr}\n\n${isDevelop ? '개발이 완료되었습니다. 검증 단계로 전환합니다.' : '검증이 완료되었습니다. 리뷰 후 머지해주세요.'}`);
      await addGitLabSpentTime(project, iid, token, durationStr);
      
      if (isDevelop) {
        await updateGitLabIssueLabels(project, iid, token, [project.labelTarget, 'validation'], [currentLabel]);
      } else {
        await updateGitLabIssueLabels(project, iid, token, [project.labelDone], [currentLabel, 'validation']);
      }
      log("Task successfully completed.", 'system');
      updateExecutionStatus(executionId, 'success', new Date().toISOString());
    } else {
      log("No changes generated.", 'warn');
      await addGitLabIssueComment(project, iid, token, `## IVE(봇) 작업 보고\n적용할 코드가 감지되지 않았습니다. 상세 분석 결과가 필요합니다.`);
      await updateGitLabIssueLabels(project, iid, token, [isDevelop ? project.labelFailDev : project.labelFailVal], [currentLabel]);
      updateExecutionStatus(executionId, 'success', new Date().toISOString());
    }

  } catch (err: any) {
    log(`Error occurred: ${err.message}`, 'error');
    await addGitLabIssueComment(project, iid, token, `## IVE(봇) 실행 오류\n오류가 발생했습니다: ${err.message}`);
    await updateGitLabIssueLabels(project, iid, token, [isDevelop ? project.labelFailDev : project.labelFailVal], [currentLabel]);
    updateExecutionStatus(executionId, 'failed', new Date().toISOString());
  } finally {
    logStream.end();
    try {
      if (fs.existsSync(workspacePath)) {
        fs.rmSync(workspacePath, { recursive: true, force: true });
      }
    } catch (e) { /* ignore */ }
  }
}
