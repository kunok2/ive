import { NextRequest, NextResponse } from 'next/server';
import { getProject, getProjectAccess } from '@/lib/db';
import { getCurrentUser } from '@/lib/auth';
import { scanProject } from '@/lib/scanner';

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const { id: projectId } = await params;
  const project = getProject(projectId);

  if (!project) {
    return NextResponse.json({ error: 'Project not found' }, { status: 404 });
  }

  const access = getProjectAccess(projectId, user.id);
  if (!access || access === 'viewer') {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  try {
    // 비동기로 실행하고 즉시 응답할지, 아니면 완료를 기다릴지 결정
    // 수동 실행은 대개 결과를 빨리 알고 싶어 하므로 await 하되, 
    // 실제 이슈 해결(executeTask)은 어차피 내부에서 비동기로 돌기 때문에 
    // 이슈 수집 및 배정까지만 기다립니다.
    await scanProject(project, true);
    
    return NextResponse.json({ success: true, message: 'Scan started' });
  } catch (err) {
    console.error('[Manual Scan Error]', err);
    return NextResponse.json({ error: 'Failed to start scan' }, { status: 500 });
  }
}
