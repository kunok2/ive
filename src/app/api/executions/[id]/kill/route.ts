import { NextResponse } from 'next/server';
import { killExecution } from '@/lib/db';
import { getCurrentUser } from '@/lib/auth';

export async function POST(
  _req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const { id } = await params;
  const ok = killExecution(id);
  if (!ok) return NextResponse.json({ error: 'Execution not found' }, { status: 404 });

  return NextResponse.json({ success: true });
}
