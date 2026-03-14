import { NextRequest, NextResponse } from 'next/server';
import { getProject } from '@/lib/db';
import { decrypt } from '@/lib/crypto';
import { createGitLabIssue } from '@/lib/gitlab';

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id: projectId } = await params;
  const project = getProject(projectId);
  if (!project) return NextResponse.json({ error: 'Project not found' }, { status: 404 });

  const { title, description, asDev } = await req.json();
  if (!title?.trim()) return NextResponse.json({ error: '제목을 입력하세요.' }, { status: 400 });

  try {
    const decryptedToken = decrypt(project.accessToken);
    const labels = asDev ? [project.labelTarget] : [];
    const issue = await createGitLabIssue(project, decryptedToken, title.trim(), description?.trim() ?? '', labels);
    return NextResponse.json(issue);
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : '이슈 생성 실패' }, { status: 500 });
  }
}
