import { NextRequest, NextResponse } from 'next/server';
import { getProject, getProjectAccess, getProjectAuthToken, setAssigneeAuto, isIssueAuthor } from '@/lib/db';
import { getCurrentUser } from '@/lib/auth';
import { logActivity } from '@/lib/activity';
import { updateIssue, fetchSingleIssue } from '@/lib/provider';

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string; iid: string }> }
) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const { id: projectId, iid } = await params;
  const project = getProject(projectId);
  if (!project) return NextResponse.json({ error: 'Project not found' }, { status: 404 });

  const access = getProjectAccess(projectId, user.id);
  if (!access) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  const issueIid = Number(iid);
  const token = getProjectAuthToken(projectId);

  // 담당자 변경은 관리자 또는 이슈 작성자만
  if (!user.isAdmin && !(await isIssueAuthor(project, issueIid, token, user))) {
    return NextResponse.json(
      { error: '이 이슈의 작성자 또는 관리자만 담당자를 변경할 수 있습니다' },
      { status: 403 }
    );
  }

  // 완료된 작업(닫힘 또는 IVE-E 레이블)은 담당자 변경 금지 — 통계/보고서 일관성 보호.
  const current = await fetchSingleIssue(project, issueIid, token);
  if (current) {
    const isClosed = current.state === 'closed';
    const labelEnd = project.labelEnd || 'IVE-E';
    const isDone = (current.labels || []).includes(labelEnd);
    if (isClosed || isDone) {
      return NextResponse.json(
        { error: '완료된 작업은 담당자를 변경할 수 없습니다' },
        { status: 409 }
      );
    }
  }

  const { assigneeIds, assigneeUsernames, assigneeAuto } = await req.json();

  try {
    // 자동배정 모드면 Git 상의 assignee 는 비움 (마무리 시점에 시스템이 채움)
    await updateIssue(project, issueIid, token, {
      assigneeIds: assigneeAuto ? [] : (assigneeIds || []),
      assignees: assigneeAuto ? [] : (assigneeUsernames || []),
    });
    setAssigneeAuto(projectId, issueIid, !!assigneeAuto);
    logActivity({
      userId: user.id,
      category: 'task',
      action: 'update_assignees',
      detail: `이슈 담당자 변경: ${project.name} #${iid}${assigneeAuto ? ' (자동배정)' : ` (${(assigneeUsernames || assigneeIds || []).join(', ') || '없음'})`}`,
      targetType: 'issue',
      targetId: `${projectId}:${iid}`,
      req,
    });
    return NextResponse.json({ success: true });
  } catch (err) {
    console.error('[assignees] failed:', err)
    return NextResponse.json({ error: '담당자 변경 실패' }, { status: 500 });
  }
}
