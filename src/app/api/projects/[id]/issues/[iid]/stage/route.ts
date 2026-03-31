import { NextRequest, NextResponse } from 'next/server';
import { getProject, getProjectAccess, setIssueStage, type IssueStage } from '@/lib/db';
import { getCurrentUser } from '@/lib/auth';
import { decrypt } from '@/lib/crypto';
import { reopenIssue, fetchSingleIssue } from '@/lib/provider';
import { logActivity } from '@/lib/activity';

// 허용되는 stage 전환
const TRANSITIONS: Record<string, { action: string; toStage: IssueStage }[]> = {
  waiting: [],
  dev: [
    { action: 'cancel', toStage: 'waiting' },
  ],
  dev_fail: [
    { action: 'retry', toStage: 'waiting' },
  ],
  done: [
    { action: 'reopen', toStage: 'waiting' },
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

  // 대기로 되돌릴 때 닫힌 이슈는 다시 열기
  if (transition.toStage === 'waiting') {
    try {
      const token = decrypt(project.accessToken);
      const issue = await fetchSingleIssue(project, Number(iid), token);
      const issueState = issue?.state;
      if (issueState === 'closed') {
        await reopenIssue(project, Number(iid), token);
      }
    } catch (err) {
      console.error(`[Stage] 이슈 #${iid} 다시 열기 실패:`, err);
    }
  }

  // 로컬 DB에 stage 업데이트
  setIssueStage(projectId, Number(iid), transition.toStage);

  // 활동 로그 기록
  const actionLabels: Record<string, string> = {
    retry: '재시도 요청',
    cancel: '작업 취소',
    reopen: '작업 재오픈',
  }
  logActivity({
    userId: user.id,
    category: 'task',
    action: `task_${action}`,
    detail: `${actionLabels[action] || action} (이슈 #${iid}, ${project.name})`,
    targetType: 'issue',
    targetId: `${projectId}:${iid}`,
    req,
  })

  return NextResponse.json({ success: true, stage: transition.toStage });
}
