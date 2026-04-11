import { NextRequest, NextResponse } from 'next/server';
import { getProject, getProjectAccess, isIssueAssignee } from '@/lib/db';
import { getCurrentUser } from '@/lib/auth';
import { decrypt } from '@/lib/crypto';
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

  // 권한: 관리자이거나 해당 이슈의 Git assignee만 닫을 수 있음 (viewer도 assignee면 허용)
  if (!user.isAdmin) {
    if (!isIssueAssignee(projectId, Number(iid), user)) {
      return NextResponse.json(
        { error: '이 이슈의 담당자(Git assignee) 또는 관리자만 이슈를 닫을 수 있습니다' },
        { status: 403 }
      );
    }
  }

  try {
    const decryptedToken = decrypt(project.accessToken);
    await closeIssue(project, Number(iid), decryptedToken);
    return NextResponse.json({ success: true });
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : '이슈 닫기 실패' }, { status: 500 });
  }
}
