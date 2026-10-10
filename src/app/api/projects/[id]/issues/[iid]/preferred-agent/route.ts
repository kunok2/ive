import { NextRequest, NextResponse } from 'next/server';
import { getProject, getProjectAuthToken, getProjectAccess, isIssueAssignee, isIssueAuthor, getAssignMode, setAssignMode, getAgent, getAgentsByUser, hasActiveExecution, stageFromLabels, hasRole, getPresetRoles, markRolesInitialized, setStageWorkerNote } from '@/lib/db';
import { violatesSelfReview } from '@/lib/role-assignment';
import { getCurrentUser } from '@/lib/auth';
import { logActivity } from '@/lib/activity';
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
  if (!project) return NextResponse.json({ error: '프로젝트를 찾을 수 없습니다. 삭제되었을 수 있습니다 — 새로고침해 주세요.' }, { status: 404 });

  const access = getProjectAccess(projectId, user.id);
  if (!access) {
    return NextResponse.json({ error: '이 프로젝트에서 이 작업을 할 권한이 없습니다. 프로젝트 소유자에게 권한을 요청해 주세요.' }, { status: 403 });
  }
  // 실행 중(dev)인 이슈는 작업자 변경 불가 + 담당자 권한 확인
  const token = getProjectAuthToken(projectId);

  // 작업자 변경은 관리자 / Git 담당자 / 이슈 작성자(ive-author 마커 포함)
  if (!user.isAdmin
    && !(await isIssueAssignee(project, Number(iid), token, user))
    && !(await isIssueAuthor(project, Number(iid), token, user))
  ) {
    return NextResponse.json(
      { error: '이 이슈의 담당자/작성자 또는 관리자만 작업자를 변경할 수 있습니다' },
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
    return NextResponse.json({ error: '작업자 지정 방식이 올바르지 않습니다. 새로고침한 뒤 다시 시도해 주세요.' }, { status: 400 });
  }

  // agentId가 있으면 의뢰자 본인의 에이전트 풀에 속하는지 검증
  // #272: 프로젝트별 배정 폐기. 이슈 의뢰자의 에이전트만 지정 가능.
  if (mode === 'agent' && agentId) {
    let issueForRequester: any = null;
    try { issueForRequester = await fetchSingleIssue(project, Number(iid), token); } catch { /* ignore */ }
    const requester = issueForRequester ? resolveIssueRequester(project, issueForRequester) : null;
    const ownerId = requester?.user.id ?? project.userId;
    const pool = getAgentsByUser(ownerId);
    // 프로젝트 역할 명부에 처리 역할로 올라 있는 에이전트도 지정할 수 있다(소유자·editor 가 내어 준 에이전트).
    if (!pool.find(a => a.id === agentId) && !hasRole(projectId, 'process', 'agent', agentId)) {
      return NextResponse.json({ error: '의뢰자 본인의 에이전트 또는 역할 명부의 처리 에이전트만 지정할 수 있습니다.' }, { status: 400 });
    }
    // 자기 작업을 자기가 검수하지 않는다 — 검증자로 지정된 에이전트는 처리자가 될 수 없다.
    if (violatesSelfReview(agentId, getPresetRoles(projectId, Number(iid)).verifier)) {
      return NextResponse.json({ error: '이 에이전트는 이 이슈의 검증자라 처리자로 지정할 수 없습니다.' }, { status: 400 });
    }
  }

  setAssignMode(projectId, Number(iid), mode, agentId || null);
  // 사람이 직접 정한 처리자 — 프로젝트 기본 배정이 덮어쓰지 않게
  markRolesInitialized(projectId, Number(iid));
  setStageWorkerNote(projectId, Number(iid), null);   // 처리자를 다시 정했으니 이전 안내는 지운다

  const agent = (mode === 'agent' && agentId) ? getAgent(agentId) : null;
  logActivity({
    userId: user.id,
    category: 'task',
    action: 'update_assign_mode',
    detail: `배정 모드 변경: ${project.name} #${iid} → ${mode}${agent ? ` (${agent.name})` : ''}`,
    targetType: 'issue',
    targetId: `${projectId}:${iid}`,
    req,
  });
  return NextResponse.json({
    assignMode: mode,
    preferredAgentId: (mode === 'agent' ? agentId : null) || null,
    preferredAgentName: agent?.name || null,
    preferredAgentAvatar: agent?.avatar || null,
    preferredAgentCliName: agent?.cliName || null,
  });
}
