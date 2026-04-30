import { NextRequest, NextResponse } from 'next/server';
import { getProject, getProjectAccess } from '@/lib/db';
import { getCurrentUser } from '@/lib/auth';
import { logActivity } from '@/lib/activity';
import { triggerScan } from '@/lib/scanner';

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
    // 스캔은 전용 루프에서만 실행 — 직접 호출 금지.
    // triggerScan: 스캔 중이면 pending 큐에 등록, 아니면 즉시 실행.
    triggerScan(project.id);

    logActivity({
      userId: user.id,
      category: 'project',
      action: 'manual_scan',
      detail: `수동 스캔 트리거: ${project.name}`,
      targetType: 'project',
      targetId: projectId,
      req,
    })

    return NextResponse.json({ success: true, message: 'Scan started' });
  } catch (err) {
    console.error('[Manual Scan Error]', err);
    return NextResponse.json({ error: 'Failed to start scan' }, { status: 500 });
  }
}
