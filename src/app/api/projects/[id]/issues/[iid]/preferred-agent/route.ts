import { NextRequest, NextResponse } from 'next/server';
import { getProject, getProjectAuthToken, getProjectAccess, isIssueAssignee, getAssignMode, setAssignMode, getAgent, getAgentsByUser, hasActiveExecution, stageFromLabels } from '@/lib/db';
import { getCurrentUser } from '@/lib/auth';
import { fetchSingleIssue } from '@/lib/provider';
import { resolveIssueRequester } from '@/lib/ive-author';

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string; iid: string }> }
) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const { id: projectId, iid } = await params;
  const { mode, agentId } = getAssignMode(projectId, Number(iid));

  const agent = agentId ? getAgent(agentId) : null;
  return NextResponse.json({
    assignMode: mode,
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
  if (!access) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }
  // 실행 중(dev)인 이슈는 작업자 변경 불가 + 담당자 권한 확인
  const token = getProjectAuthToken(projectId);

  // 작업자 변경은 담당자 또는 관리자만 (viewer도 assignee면 허용)
  if (!user.isAdmin && !(await isIssueAssignee(project, Number(iid), token, user))) {
    return NextResponse.json(
      { error: '이 이슈의 담당자 또는 관리자만 작업자를 변경할 수 있습니다' },
      { status: 403 }
    );
  }

  try {
    const issue = await fetchSingleIssue(project, Number(iid), token);
    if (issue) {
      const labels = issue.labels || [];
      const activeExec = hasActiveExecution(projectId, Number(iid));
      const stage = stageFromLabels(labels, project, { hasActiveExec: activeExec });
      if (stage === 'dev') {
        return NextResponse.json({ error: '실행 중인 이슈는 작업자를 변경할 수 없습니다.' }, { status: 400 });
      }
    }
  } catch { /* 조회 실패 시 허용 */ }

  const { assignMode, agentId } = await req.json();

  // assignMode 유효성 검사
  const mode = assignMode || (agentId ? 'agent' : 'auto');
  if (!['auto', 'assignee', 'agent'].includes(mode)) {
    return NextResponse.json({ error: 'Invalid assign mode' }, { status: 400 });
  }

  // agentId가 있으면 의뢰자 본인의 에이전트 풀에 속하는지 검증
  // #272: 프로젝트별 배정 폐기. 이슈 의뢰자의 에이전트만 지정 가능.
  if (mode === 'agent' && agentId) {
    let issueForRequester: any = null;
    try { issueForRequester = await fetchSingleIssue(project, Number(iid), token); } catch { /* ignore */ }
    const requester = issueForRequester ? resolveIssueRequester(project, issueForRequester) : null;
    const ownerId = requester?.user.id ?? project.userId;
    const pool = getAgentsByUser(ownerId);
    if (!pool.find(a => a.id === agentId)) {
      return NextResponse.json({ error: '의뢰자 본인의 에이전트만 지정할 수 있습니다.' }, { status: 400 });
    }
  }

  setAssignMode(projectId, Number(iid), mode, agentId || null);

  const agent = (mode === 'agent' && agentId) ? getAgent(agentId) : null;
  return NextResponse.json({
    assignMode: mode,
    preferredAgentId: (mode === 'agent' ? agentId : null) || null,
    preferredAgentName: agent?.name || null,
    preferredAgentAvatar: agent?.avatar || null,
    preferredAgentCliName: agent?.cliName || null,
  });
}
