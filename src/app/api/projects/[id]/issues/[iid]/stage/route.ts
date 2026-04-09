import { NextRequest, NextResponse } from 'next/server';
import { getProject, getProjectAccess, hasActiveExecution, stageFromLabels, markIssueVerifyStarted, markIssueVerified, touchProjectActivity, assignIssueAtomically, getAssignModeMap, getIssueScheduledAt, type IssueStage } from '@/lib/db';
import type { TaskExecution } from '@/types';
import { getCurrentUser } from '@/lib/auth';
import { decrypt } from '@/lib/crypto';
import { reopenIssue, fetchSingleIssue, addIssueLabels, removeIssueLabels, addIssueComment, createBranch, getDefaultBranch } from '@/lib/provider';
import { logActivity } from '@/lib/activity';
import fs from 'fs';
import path from 'path';

// 허용되는 stage 전환 (레이블 기반)
// IVE-S: 스케줄 → IVE-D: 개발 → IVE-W: 검증대기 → IVE-V: 검증 → IVE-E: 완료
const TRANSITIONS: Record<string, { action: string; description: string; removeLabels: (p: any) => string[]; addLabels: (p: any) => string[] }[]> = {
  none: [
    {
      action: 'schedule',
      description: '스케줄 등록',
      removeLabels: () => [],
      addLabels: (p) => [p.labelSchedule || 'IVE-S'],
    },
  ],
  waiting: [
    {
      action: 'start_dev',
      description: '개발 시작 → 개발 중',
      removeLabels: (p) => [p.labelSchedule || 'IVE-S'],
      addLabels: (p) => [p.labelDev || 'IVE-D'],
    },
  ],
  dev: [
    {
      action: 'cancel',
      description: '작업 취소 → 스케줄',
      removeLabels: (p) => [p.labelDev || 'IVE-D'],
      addLabels: (p) => [p.labelSchedule || 'IVE-S'],
    },
    {
      action: 'complete',
      description: '머지 완료 → 검증대기',
      removeLabels: (p) => [p.labelDev || 'IVE-D'],
      addLabels: (p) => [p.labelVerifyWait || 'IVE-W'],
    },
  ],
  dev_fail: [
    {
      action: 'retry',
      description: '재시도 → 스케줄',
      removeLabels: (p) => [p.labelDev || 'IVE-D'],
      addLabels: (p) => [p.labelSchedule || 'IVE-S'],
    },
  ],
  verify_waiting: [
    {
      action: 'start_verification',
      description: '검증시작 → 검증 중',
      removeLabels: (p) => [p.labelVerifyWait || 'IVE-W'],
      addLabels: (p) => [p.labelVerify || 'IVE-V'],
    },
    {
      action: 'cancel',
      description: '검증대기 취소 → 스케줄',
      removeLabels: (p) => [p.labelVerifyWait || 'IVE-W'],
      addLabels: (p) => [p.labelSchedule || 'IVE-S'],
    },
  ],
  verifying: [
    {
      action: 'approve',
      description: '검증 승인 → 완료',
      removeLabels: (p) => [p.labelVerify || 'IVE-V'],
      addLabels: (p) => [p.labelEnd || 'IVE-E'],
    },
    {
      action: 'complete',
      description: '머지 완료 → 완료',
      removeLabels: (p) => [p.labelVerify || 'IVE-V', p.labelDev || 'IVE-D'],
      addLabels: (p) => [p.labelEnd || 'IVE-E'],
    },
    {
      action: 'reject',
      description: '검증 반려 → 스케줄',
      removeLabels: (p) => [p.labelVerify || 'IVE-V'],
      addLabels: (p) => [p.labelSchedule || 'IVE-S'],
    },
  ],
  done: [
    {
      action: 'reopen',
      description: '재오픈 → 스케줄',
      removeLabels: (p) => [p.labelEnd || 'IVE-E'],
      addLabels: (p) => [p.labelSchedule || 'IVE-S'],
    },
  ],
  rejected: [
    {
      action: 'retry',
      description: '재시도 → 스케줄',
      removeLabels: () => [],
      addLabels: (p) => [p.labelSchedule || 'IVE-S'],
    },
  ],
};

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string; iid: string }> }
) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const { id: projectId, iid } = await params;
  const project = getProject(projectId);
  if (!project) return NextResponse.json({ error: 'Project not found' }, { status: 404 });

  const access = getProjectAccess(projectId, user.id);
  if (!access || access === 'viewer') {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  const { stage, action } = await req.json();
  if (!stage || !action) {
    return NextResponse.json({ error: 'stage와 action이 필요합니다.' }, { status: 400 });
  }

  const available = TRANSITIONS[stage];
  if (!available) {
    return NextResponse.json({ error: '알 수 없는 단계입니다.' }, { status: 400 });
  }

  const transition = available.find(t => t.action === action);
  if (!transition) {
    return NextResponse.json({ error: '허용되지 않는 액션입니다.' }, { status: 400 });
  }

  try {
    const token = decrypt(project.accessToken);

    // 레이블 전환 수행
    const labelsToRemove = transition.removeLabels(project);
    const labelsToAdd = transition.addLabels(project);

    if (labelsToRemove.length > 0) {
      await removeIssueLabels(project, Number(iid), token, labelsToRemove);
    }
    if (labelsToAdd.length > 0) {
      await addIssueLabels(project, Number(iid), token, labelsToAdd);
    }

    // 스케줄로 되돌릴 때 닫힌 이슈는 다시 열기
    const isBackToSchedule = labelsToAdd.some(l => l === (project.labelSchedule || 'IVE-S'));
    if (isBackToSchedule) {
      try {
        const issue = await fetchSingleIssue(project, Number(iid), token);
        if (issue?.state === 'closed') {
          await reopenIssue(project, Number(iid), token);
        }
      } catch (err) {
        console.error(`[Stage] 이슈 #${iid} 다시 열기 실패:`, err);
      }
    }

    // 담당자 모드 개발 시작: execution 생성 + 브랜치 생성
    if (action === 'start_dev') {
      const assignModeMap = getAssignModeMap(projectId);
      const assignInfo = assignModeMap.get(Number(iid));
      if (assignInfo?.mode === 'assignee') {
        const issue = await fetchSingleIssue(project, Number(iid), token);
        const assignees = issue?.assignees || [];
        const assignee = assignees[0];
        const executionId = `ex-${Date.now()}-${Math.floor(Math.random() * 1000)}`;
        const logDir = path.join(process.cwd(), 'data', 'logs');
        if (!fs.existsSync(logDir)) fs.mkdirSync(logDir, { recursive: true });
        const logPath = path.join(logDir, `${executionId}.log`);
        fs.writeFileSync(logPath, '');

        const waitingSince = getIssueScheduledAt(projectId, Number(iid)) || new Date().toISOString();
        const execution: TaskExecution = {
          id: executionId,
          projectId,
          agentId: '',
          issueIid: Number(iid),
          issueTitle: issue?.title || '',
          status: 'assigned',
          startedAt: new Date().toISOString(),
          logPath,
          inputTokens: 0, outputTokens: 0, costUsd: 0, turns: 0,
          issueCreatedAt: waitingSince,
          assigneeType: 'user',
          userId: assignee ? String(assignee.id) : user.id,
          userName: assignee ? (assignee.name || assignee.username || assignee.login) : user.name,
          userAvatar: assignee?.avatar_url || user.avatar,
        };

        assignIssueAtomically(projectId, Number(iid), 'dev', execution);

        // 브랜치 생성
        const branchName = `dev-${iid}`;
        try {
          const defaultBranch = await getDefaultBranch(project, token);
          await createBranch(project, token, branchName, defaultBranch);
        } catch (e) { console.warn(`[Stage] Failed to create branch for #${iid}:`, e); }

        // 브랜치 안내 코멘트
        try {
          const commentBody = `<!-- ive-bot -->\n**작업 브랜치가 생성되었습니다.**\n\n브랜치: \`${branchName}\`\n담당자: ${execution.userName}\n\n**작업 방법:**\n1. \`${branchName}\` 브랜치에서 작업\n2. MR/PR 생성 시 제목에 \`resolve #${iid}\` 포함 (머지 시 이슈 자동 닫힘)\n3. 작업 완료 후 레이블을 \`${project.labelDev || 'IVE-D'}\` → \`${project.labelVerifyWait || 'IVE-W'}\`로 변경`;
          await addIssueComment(project, Number(iid), token, commentBody);
        } catch (e) { console.warn(`[Stage] Failed to add branch comment on #${iid}:`, e); }
      }
    }

    // 검증 시작 시 verify_started_at 기록
    if (action === 'start_verification') {
      markIssueVerifyStarted(projectId, Number(iid));
    }

    // 검증 완료 시 실행 기록에 verified_at + 검증자 기록 (verifying 상태에서만)
    if (action === 'approve' || (action === 'complete' && stage === 'verifying')) {
      markIssueVerified(projectId, Number(iid), { name: user.name, avatar: user.avatar });
    }

    // 프로젝트 최종 활동 시각 갱신
    touchProjectActivity(projectId);

    // 전환 후 새로운 stage 판정
    const issue = await fetchSingleIssue(project, Number(iid), token);
    const newLabels = issue?.labels || [];
    const activeExec = hasActiveExecution(projectId, Number(iid));
    const newStage = stageFromLabels(newLabels, project, { hasActiveExec: activeExec }) || 'waiting';

    // 활동 로그 기록
    const actionLabels: Record<string, string> = {
      retry: '재시도 요청',
      cancel: '작업 취소',
      reopen: '작업 재오픈',
      approve: '검증 승인',
      complete: '머지 완료',
      reject: '검증 반려',
      start_verification: '검증 시작',
      start_dev: '개발 시작',
      schedule: '스케줄 등록',
    };
    logActivity({
      userId: user.id,
      category: 'task',
      action: `task_${action}`,
      detail: `${actionLabels[action] || action} (이슈 #${iid}, ${project.name})`,
      targetType: 'issue',
      targetId: `${projectId}:${iid}`,
      req,
    });

    return NextResponse.json({ success: true, stage: newStage });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : '상태 전환 실패' },
      { status: 500 }
    );
  }
}
