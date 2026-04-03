import { NextRequest, NextResponse } from 'next/server';
import { getProject, getProjectAccess, getPreferredAgentId, setPreferredAgent, getProjectAssignments, getAgent, hasActiveExecution, stageFromLabels } from '@/lib/db';
import { getCurrentUser } from '@/lib/auth';
import { decrypt } from '@/lib/crypto';
import { fetchSingleIssue } from '@/lib/provider';

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string; iid: string }> }
) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const { id: projectId, iid } = await params;
  const agentId = getPreferredAgentId(projectId, Number(iid));
  if (!agentId) return NextResponse.json({ preferredAgentId: null });

  const agent = getAgent(agentId);
  return NextResponse.json({
    preferredAgentId: agentId,
    preferredAgentName: agent?.name || null,
    preferredAgentAvatar: agent?.avatar || null,
    preferredAgentCliName: agent?.cliName || null,
  });
}

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string; iid: string }> }
) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const { id: projectId, iid } = await params;
  const project = getProject(projectId);
  if (!project) return NextResponse.json({ error: 'Project not found' }, { status: 404 });

  const access = getProjectAccess(projectId, user.id);
  if (!access || access === 'viewer') {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  // 실행 중(dev)인 이슈는 작업자 변경 불가
  try {
    const decryptedToken = decrypt(project.accessToken);
    const issue = await fetchSingleIssue(project, Number(iid), decryptedToken);
    if (issue) {
      const labels = issue.labels || [];
      const activeExec = hasActiveExecution(projectId, Number(iid));
      const stage = stageFromLabels(labels, project, { hasActiveExec: activeExec });
      if (stage === 'dev') {
        return NextResponse.json({ error: '실행 중인 이슈는 작업자를 변경할 수 없습니다.' }, { status: 400 });
      }
    }
  } catch { /* 조회 실패 시 허용 */ }

  const { agentId } = await req.json();

  // agentId가 있으면 프로젝트에 배정된 에이전트인지 검증
  if (agentId) {
    const assignments = getProjectAssignments(projectId);
    if (!assignments.find(a => a.agentId === agentId)) {
      return NextResponse.json({ error: '이 프로젝트에 배정되지 않은 개발자입니다.' }, { status: 400 });
    }
  }

  setPreferredAgent(projectId, Number(iid), agentId || null);

  const agent = agentId ? getAgent(agentId) : null;
  return NextResponse.json({
    preferredAgentId: agentId || null,
    preferredAgentName: agent?.name || null,
    preferredAgentAvatar: agent?.avatar || null,
    preferredAgentCliName: agent?.cliName || null,
  });
}
