import { NextRequest, NextResponse } from 'next/server';
import { getProject } from '@/lib/db';
import { decrypt } from '@/lib/crypto';
import { fetchIssueNotes, addIssueComment } from '@/lib/provider';

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string; iid: string }> }
) {
  const { id: projectId, iid } = await params;
  const project = getProject(projectId);
  if (!project) return NextResponse.json({ error: 'Project not found' }, { status: 404 });

  try {
    const decryptedToken = decrypt(project.accessToken);
    const notes = await fetchIssueNotes(project, Number(iid), decryptedToken);

    const mapped = (notes as any[]).map((n: any) => ({
      id: n.id,
      body: n.body,
      author: n.author?.name,
      avatarUrl: n.author?.avatar_url || '',
      system: n.system,
      createdAt: n.created_at,
    }));

    return NextResponse.json(mapped);
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : '노트 조회 실패' }, { status: 500 });
  }
}

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string; iid: string }> }
) {
  const { id: projectId, iid } = await params;
  const project = getProject(projectId);
  if (!project) return NextResponse.json({ error: 'Project not found' }, { status: 404 });

  const { body } = await req.json();
  if (!body?.trim()) return NextResponse.json({ error: '내용을 입력하세요.' }, { status: 400 });

  try {
    const decryptedToken = decrypt(project.accessToken);
    await addIssueComment(project, Number(iid), decryptedToken, body.trim());
    return NextResponse.json({ success: true });
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : '코멘트 추가 실패' }, { status: 500 });
  }
}
