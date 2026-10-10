import { NextRequest, NextResponse } from 'next/server';
import { getProject, getProjectAccess, getProjectAuthToken, isIssueAssignee, isIssueAuthor } from '@/lib/db';
import { getCurrentUser } from '@/lib/auth';
import { logActivity } from '@/lib/activity';
import { closeIssue } from '@/lib/provider';

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string; iid: string }> }
) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const { id: projectId, iid } = await params;
  const project = getProject(projectId);
  if (!project) return NextResponse.json({ error: '프로젝트를 찾을 수 없습니다. 삭제되었을 수 있습니다 — 새로고침해 주세요.' }, { status: 404 });

  const access = getProjectAccess(projectId, user.id);
  if (!access) {
    return NextResponse.json({ error: '이 프로젝트에서 이 작업을 할 권한이 없습니다. 프로젝트 소유자에게 권한을 요청해 주세요.' }, { status: 403 });
  }

  const token = getProjectAuthToken(projectId);

  // 권한: 관리자 / 프로젝트 소유자 / 이슈 Git assignee / 이슈 작성자(author) 중 하나면 닫기 허용.
  // (작성자 본인은 자기가 만든 이슈를 닫을 수 있어야 함 — 흔한 오픈소스 관행)
  const isOwner = project.userId === user.id;
  if (!user.isAdmin && !isOwner) {
    const [assignee, author] = await Promise.all([
      isIssueAssignee(project, Number(iid), token, user),
      isIssueAuthor(project, Number(iid), token, user),
    ]);
    if (!assignee && !author) {
      return NextResponse.json(
        { error: '이 이슈의 작성자/담당자/프로젝트 소유자/관리자만 이슈를 닫을 수 있습니다' },
        { status: 403 }
      );
    }
  }

  try {
    await closeIssue(project, Number(iid), token);
    logActivity({
      userId: user.id,
      category: 'task',
      action: 'close_issue',
      detail: `이슈 닫기: ${project.name} #${iid}`,
      targetType: 'issue',
      targetId: `${projectId}:${iid}`,
      req,
    });
    return NextResponse.json({ success: true });
  } catch (err) {
    console.error('[close] failed:', err)
    return NextResponse.json({ error: '이슈 닫기 실패' }, { status: 500 });
  }
}
