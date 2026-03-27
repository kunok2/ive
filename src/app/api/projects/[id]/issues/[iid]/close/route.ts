import { NextRequest, NextResponse } from 'next/server';
import { getProject, getProjectAccess } from '@/lib/db';
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
  if (!access || access === 'viewer') {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  try {
    const decryptedToken = decrypt(project.accessToken);
    await closeIssue(project, Number(iid), decryptedToken);
    return NextResponse.json({ success: true });
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : '이슈 닫기 실패' }, { status: 500 });
  }
}
