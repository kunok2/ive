import { NextRequest, NextResponse } from 'next/server';
import { getProject, getProjectAccess, getIveConfirmerCandidates, getProjectAuthToken } from '@/lib/db';
import { getCurrentUser } from '@/lib/auth';
import { fetchProjectMembers } from '@/lib/provider';

/**
 * 확인자(확인 단계) 후보 목록.
 *
 * 검증자/담당자 picker 가 쓰는 /members(= git 프로젝트 멤버)와 달리,
 * 확인자는 프로젝트 멤버일 필요 없이 IVE 사용자이기만 하면 된다.
 * → 프로젝트의 provider(gitlab/github)로 식별 가능한 모든 IVE 사용자 + 프로젝트 Git 멤버(IVE 를 쓰지 않는 사람 포함)를 반환한다.
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
  if (!project) return NextResponse.json({ error: '프로젝트를 찾을 수 없습니다. 삭제되었을 수 있습니다 — 새로고침해 주세요.' }, { status: 404 });

  if (!getProjectAccess(projectId, user.id)) {
    return NextResponse.json({ error: '이 프로젝트에서 이 작업을 할 권한이 없습니다. 프로젝트 소유자에게 권한을 요청해 주세요.' }, { status: 403 });
  }

  let iveUsers: { id: number; username: string; name: string; avatarUrl: string }[] = [];
  try { iveUsers = getIveConfirmerCandidates(project.provider); } catch { /* 없음 */ }
  const gitMembers = await fetchProjectMembers(project, getProjectAuthToken(projectId)).catch(() => []);
  // Git 멤버를 먼저, 같은 사람(Git id)은 한 번만
  const seen = new Set<number>();
  const merged = [...gitMembers, ...iveUsers].filter(m => !seen.has(m.id) && (seen.add(m.id), true));
  return NextResponse.json(merged);
}
