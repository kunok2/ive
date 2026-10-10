import { NextRequest, NextResponse } from 'next/server';
import { getProject, getProjectAuthToken, getProjectAccess } from '@/lib/db';
import { getCurrentUser } from '@/lib/auth';
import { fetchProjectMembers } from '@/lib/provider';

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const { id: projectId } = await params;
  const project = getProject(projectId);
  if (!project) return NextResponse.json({ error: '프로젝트를 찾을 수 없습니다. 삭제되었을 수 있습니다 — 새로고침해 주세요.' }, { status: 404 });

  if (!getProjectAccess(projectId, user.id)) {
    return NextResponse.json({ error: '이 프로젝트에서 이 작업을 할 권한이 없습니다. 프로젝트 소유자에게 권한을 요청해 주세요.' }, { status: 403 });
  }

  try {
    const token = getProjectAuthToken(projectId);
    const members = await fetchProjectMembers(project, token);
    return NextResponse.json(members);
  } catch {
    return NextResponse.json([]);
  }
}
