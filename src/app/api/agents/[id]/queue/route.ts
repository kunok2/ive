import { NextRequest, NextResponse } from 'next/server';
import { countPreferredIssuesByAgent, getPreferredIssuesByAgent } from '@/lib/db';
import { getCurrentUser } from '@/lib/auth';

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const { id: agentId } = await params;
  const count = countPreferredIssuesByAgent(agentId);
  const issues = getPreferredIssuesByAgent(agentId);

  return NextResponse.json({ count, issues });
}
