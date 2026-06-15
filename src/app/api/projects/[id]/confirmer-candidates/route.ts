import { NextRequest, NextResponse } from 'next/server';
import { getProject, getProjectAccess, getIveConfirmerCandidates } from '@/lib/db';
import { getCurrentUser } from '@/lib/auth';

/**
 * 확인자(확인 단계) 후보 목록.
 *
 * 검증자/담당자 picker 가 쓰는 /members(= git 프로젝트 멤버)와 달리,
 * 확인자는 프로젝트 멤버일 필요 없이 IVE 사용자이기만 하면 된다.
 * → 프로젝트의 provider(gitlab/github)로 식별 가능한 모든 IVE 사용자를 반환한다.
 * 응답 형태는 git member(/members)와 동일({ id, username, name, avatarUrl })하여
 * 기존 confirmer picker 가 그대로 소비할 수 있다.
 */
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
    return NextResponse.json(getIveConfirmerCandidates(project.provider));
  } catch {
    return NextResponse.json([]);
  }
}
