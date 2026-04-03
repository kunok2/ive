import { NextRequest, NextResponse } from 'next/server';
import { getProject, getProjectAccess } from '@/lib/db';
import { getCurrentUser } from '@/lib/auth';
import { decrypt } from '@/lib/crypto';
import { fetchProjectMembers } from '@/lib/provider';

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const { id: projectId } = await params;
  const project = getProject(projectId);
  if (!project) return NextResponse.json({ error: 'Project not found' }, { status: 404 });

  if (!getProjectAccess(projectId, user.id)) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  try {
    const token = decrypt(project.accessToken);
    const members = await fetchProjectMembers(project, token);
    return NextResponse.json(members);
  } catch {
    return NextResponse.json([]);
  }
}
