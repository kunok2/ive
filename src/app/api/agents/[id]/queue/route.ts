import { NextRequest, NextResponse } from 'next/server';
import { countPreferredIssuesByAgent, getPreferredIssuesByAgent } from '@/lib/db';
import { getCurrentUser } from '@/lib/auth';
import { parseProjectsParam } from '@/lib/project-filter-param';

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const { id: agentId } = await params;
  const projectIds = parseProjectsParam(req.url); // 개발자 탭 프로젝트 필터
  const count = countPreferredIssuesByAgent(agentId, projectIds);
  const issues = getPreferredIssuesByAgent(agentId, projectIds);

  return NextResponse.json({ count, issues });
}
