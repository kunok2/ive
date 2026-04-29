import { NextRequest, NextResponse } from 'next/server';
import { getProject, getProjectAccess, getProjectAuthToken, setAssigneeAuto } from '@/lib/db';
import { getCurrentUser } from '@/lib/auth';
import { updateIssue } from '@/lib/provider';

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

  const { assigneeIds, assigneeUsernames, assigneeAuto } = await req.json();
  const issueIid = Number(iid);

  try {
    const token = getProjectAuthToken(projectId);
    // 자동배정 모드면 Git 상의 assignee 는 비움 (마무리 시점에 시스템이 채움)
    await updateIssue(project, issueIid, token, {
      assigneeIds: assigneeAuto ? [] : (assigneeIds || []),
      assignees: assigneeAuto ? [] : (assigneeUsernames || []),
    });
    setAssigneeAuto(projectId, issueIid, !!assigneeAuto);
    return NextResponse.json({ success: true });
  } catch (err) {
    console.error('[assignees] failed:', err)
    return NextResponse.json({ error: '담당자 변경 실패' }, { status: 500 });
  }
}
