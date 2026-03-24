import { NextResponse } from 'next/server';
import { killExecution } from '@/lib/db';
import { getCurrentUser } from '@/lib/auth';
import { logActivity } from '@/lib/activity';

export async function POST(
  _req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const { id } = await params;
  const ok = killExecution(id);
  if (!ok) return NextResponse.json({ error: 'Execution not found' }, { status: 404 });

  logActivity({ userId: user.id, category: 'execution', action: 'kill_execution', detail: `실행 강제 종료: ${id}`, targetType: 'execution', targetId: id, req: _req });
  return NextResponse.json({ success: true });
}
