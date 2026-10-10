import { NextRequest, NextResponse } from 'next/server';
import { getLatestExecutionsByProject, getProjectAccess } from '@/lib/db';
import { getCurrentUser } from '@/lib/auth';

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const { id: projectId } = await params;

  if (!getProjectAccess(projectId, user.id)) {
    return NextResponse.json({ error: '이 프로젝트에서 이 작업을 할 권한이 없습니다. 프로젝트 소유자에게 권한을 요청해 주세요.' }, { status: 403 });
  }

  try {
    const executions = getLatestExecutionsByProject(projectId);
    return NextResponse.json(executions);
  } catch (err) {
    return NextResponse.json({ error: 'Failed' }, { status: 500 });
  }
}
