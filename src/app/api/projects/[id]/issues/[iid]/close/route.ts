import { NextRequest, NextResponse } from 'next/server';
import { getProject } from '@/lib/db';
import { decrypt } from '@/lib/crypto';
import { closeGitLabIssue } from '@/lib/gitlab';

export async function POST(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string; iid: string }> }
) {
  const { id: projectId, iid } = await params;
  const project = getProject(projectId);
  if (!project) return NextResponse.json({ error: 'Project not found' }, { status: 404 });

  try {
    const decryptedToken = decrypt(project.accessToken);
    await closeGitLabIssue(project, Number(iid), decryptedToken);
    return NextResponse.json({ success: true });
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : '이슈 닫기 실패' }, { status: 500 });
  }
}
