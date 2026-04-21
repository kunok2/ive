import { NextRequest, NextResponse } from 'next/server';
import { getProject, getProjectAccess, getProjectAuthToken, isIssueAssignee } from '@/lib/db';
import { getCurrentUser } from '@/lib/auth';
import { closeIssue } from '@/lib/provider';

export async function POST(
  _req: NextRequest,
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

  const token = getProjectAuthToken(projectId);

  // 권한: 관리자이거나 해당 이슈의 Git assignee만 닫을 수 있음 (viewer도 assignee면 허용)
  if (!user.isAdmin) {
    if (!(await isIssueAssignee(project, Number(iid), token, user))) {
      return NextResponse.json(
        { error: '이 이슈의 담당자(Git assignee) 또는 관리자만 이슈를 닫을 수 있습니다' },
        { status: 403 }
      );
    }
  }

  try {
    await closeIssue(project, Number(iid), token);
    return NextResponse.json({ success: true });
  } catch (err) {
    console.error('[close] failed:', err)
    return NextResponse.json({ error: '이슈 닫기 실패' }, { status: 500 });
  }
}
