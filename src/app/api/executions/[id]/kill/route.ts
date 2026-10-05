import { NextResponse } from 'next/server';
import { killExecution, getExecution, getProjectAccess, getAgent } from '@/lib/db';
import { getCurrentUser } from '@/lib/auth';
import { logActivity } from '@/lib/activity';

export async function POST(
  _req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const { id } = await params;
  const exec = getExecution(id);
  if (!exec) return NextResponse.json({ error: 'Execution not found' }, { status: 404 });

  // 중지는 그 프로젝트를 편집할 수 있는 사람(뷰어 제외)·그 에이전트 주인·관리자만 — 트레이스·작업 상세·보드 카드 어디서 눌러도 같다
  const access = exec.projectId ? getProjectAccess(exec.projectId, user.id) : null;
  const ownsAgent = !!exec.agentId && getAgent(exec.agentId)?.userId === user.id;
  if (!user.isAdmin && !ownsAgent && (!access || access === 'viewer')) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  killExecution(id);

  logActivity({ userId: user.id, category: 'execution', action: 'kill_execution', detail: `실행 강제 종료: ${id}`, targetType: 'execution', targetId: id, req: _req });
  return NextResponse.json({ success: true });
}
