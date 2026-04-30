import { NextRequest, NextResponse } from 'next/server';
import { getProject, getProjectAccess, getProjectAuthToken } from '@/lib/db';
import { getCurrentUser } from '@/lib/auth';
import { logActivity } from '@/lib/activity';
import { uploadIssueAttachment } from '@/lib/provider';

// 이슈 본문/코멘트에 붙여 넣을 이미지(또는 파일)를 업로드합니다.
// multipart/form-data 로 `file` 필드를 전송하면 Git 제공자에 업로드한 뒤
// { markdown, url } 형태로 삽입용 마크다운 스니펫을 돌려줍니다.
const MAX_BYTES = 25 * 1024 * 1024; // 25MB

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const { id: projectId } = await params;
  const project = getProject(projectId);
  if (!project) return NextResponse.json({ error: 'Project not found' }, { status: 404 });

  if (!getProjectAccess(projectId, user.id)) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  let formData: FormData;
  try {
    formData = await req.formData();
  } catch {
    return NextResponse.json({ error: 'multipart/form-data 요청이 아닙니다.' }, { status: 400 });
  }

  const file = formData.get('file');
  if (!file || typeof file === 'string') {
    return NextResponse.json({ error: '파일이 포함되지 않았습니다.' }, { status: 400 });
  }

  const blob = file as File;
  if (blob.size === 0) {
    return NextResponse.json({ error: '빈 파일입니다.' }, { status: 400 });
  }
  if (blob.size > MAX_BYTES) {
    return NextResponse.json({ error: `파일이 너무 큽니다. (최대 ${Math.floor(MAX_BYTES / 1024 / 1024)}MB)` }, { status: 413 });
  }

  try {
    const arrayBuffer = await blob.arrayBuffer();
    const buffer = Buffer.from(arrayBuffer);
    const token = getProjectAuthToken(projectId);
    const filename = blob.name || `paste-${Date.now()}`;
    const mime = blob.type || 'application/octet-stream';
    const result = await uploadIssueAttachment(project, token, filename, buffer, mime);
    logActivity({
      userId: user.id,
      category: 'project',
      action: 'upload_attachment',
      detail: `첨부 업로드: ${project.name} ${filename} (${(blob.size / 1024).toFixed(1)}KB)`,
      targetType: 'project',
      targetId: projectId,
      req,
    });
    return NextResponse.json(result);
  } catch (err) {
    const msg = err instanceof Error ? err.message : '파일 업로드 실패';
    console.error('[Uploads] failed:', msg);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
