import { NextRequest, NextResponse } from 'next/server';
import { getProject, getProjectAccess, hasActiveExecution, stageFromLabels, markIssueVerified, touchProjectActivity, type IssueStage } from '@/lib/db';
import { getCurrentUser } from '@/lib/auth';
import { decrypt } from '@/lib/crypto';
import { reopenIssue, fetchSingleIssue, addIssueLabels, removeIssueLabels } from '@/lib/provider';
import { logActivity } from '@/lib/activity';

// 허용되는 stage 전환 (레이블 기반)
// IVE-S: 스케줄 → IVE-D: 개발 → IVE-V: 검증 → IVE-E: 완료
const TRANSITIONS: Record<string, { action: string; description: string; removeLabels: (p: any) => string[]; addLabels: (p: any) => string[] }[]> = {
  none: [
    {
      action: 'schedule',
      description: '스케줄 등록',
      removeLabels: () => [],
      addLabels: (p) => [p.labelSchedule || 'IVE-S'],
    },
  ],
  waiting: [],
  dev: [
    {
      action: 'cancel',
      description: '작업 취소 → 스케줄',
      removeLabels: (p) => [p.labelDev || 'IVE-D'],
      addLabels: (p) => [p.labelSchedule || 'IVE-S'],
    },
    {
      action: 'complete',
      description: '머지 완료 → 완료',
      removeLabels: (p) => [p.labelDev || 'IVE-D', p.labelVerify || 'IVE-V'],
      addLabels: (p) => [p.labelEnd || 'IVE-E'],
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

    // 검증 완료 시 실행 기록에 verified_at 기록
    if (action === 'approve' || action === 'complete') {
      markIssueVerified(projectId, Number(iid));
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
