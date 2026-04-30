import { NextRequest, NextResponse } from 'next/server';
import { getProject, getProjectAuthToken, getProjectAccess } from '@/lib/db';
import { getCurrentUser } from '@/lib/auth';
import { logActivity } from '@/lib/activity';
import { checkLabelsExist, ensureLabels } from '@/lib/provider';

// 레이블 존재 확인
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
    const token = getProjectAuthToken(projectId);
    const results = await checkLabelsExist(project, token);
    return NextResponse.json(results);
  } catch {
    return NextResponse.json([]);
  }
}

// 레이블 생성 시도
export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const { id: projectId } = await params;
  const project = getProject(projectId);
  if (!project) return NextResponse.json({ error: 'Project not found' }, { status: 404 });

  const access = getProjectAccess(projectId, user.id);
  if (!access || access === 'viewer') {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  try {
    const token = getProjectAuthToken(projectId);
    await ensureLabels(project, token);
    const results = await checkLabelsExist(project, token);
    const allExist = results.every(r => r.exists);
    const missing = results.filter(r => !r.exists).map(r => r.label);
    logActivity({
      userId: user.id,
      category: 'project',
      action: 'ensure_labels',
      detail: `레이블 생성 시도: ${project.name}${missing.length > 0 ? ` (누락 ${missing.length}개)` : ' (전체 존재)'}`,
      targetType: 'project',
      targetId: projectId,
      req,
    });
    return NextResponse.json({
      success: allExist,
      results,
      message: allExist ? null : `레이블 생성 권한이 없습니다. Git에서 직접 생성해주세요: ${missing.join(', ')}`,
    });
  } catch (err) {
    return NextResponse.json({
      success: false,
      message: err instanceof Error ? err.message : '레이블 생성 실패',
    }, { status: 500 });
  }
}
