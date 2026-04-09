import { NextRequest, NextResponse } from 'next/server';
import { getProject, getProjectAccess, getAssignModeMap, setAssignMode, getAgent, hasActiveExecution, hasAnyExecution, stageFromLabels, touchProjectActivity } from '@/lib/db';
import { checkLabelsExist, addIssueComment } from '@/lib/provider';
import { getCurrentUser } from '@/lib/auth';
import { decrypt } from '@/lib/crypto';
import { fetchAllProjectIssues, fetchClosedProjectIssues, createIssue } from '@/lib/provider';

export async function GET(
  req: NextRequest,
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

  const stateParam = req.nextUrl.searchParams.get('state');

  try {
    const decryptedToken = decrypt(project.accessToken);
    const issues = stateParam === 'closed'
      ? await fetchClosedProjectIssues(project, decryptedToken)
      : await fetchAllProjectIssues(project, decryptedToken);

    // 배정 모드 맵 로드
    const assignModeMap = getAssignModeMap(projectId);

    const isClosed = stateParam === 'closed';

    const mapped = issues
      .filter((issue: any) => {
        const issueLabels = issue.labels || [];
        const hasIveLabel = issueLabels.includes(project.labelTarget);
        if (isClosed) {
          // 닫힌 이슈: IVE 레이블이 있거나 실행 이력이 있는 이슈만 표시
          return hasIveLabel || hasAnyExecution(projectId, issue.iid);
        }
        // 열린 이슈: IVE 레이블 필수 (없으면 IVE에서 관리하지 않는 이슈)
        return hasIveLabel;
      })
      .map((issue: any) => {
        // 레이블에서 stage 판정
        const issueLabels = issue.labels || [];
        const activeExec = hasActiveExecution(projectId, issue.iid);
        const stage = stageFromLabels(issueLabels, project, { hasActiveExec: activeExec })
          || (isClosed ? 'done' : 'none');

        // 배정 모드 + 선호 에이전트 정보 조회
        const assignInfo = assignModeMap.get(issue.iid) || { mode: 'auto' as const, agentId: null };
        let preferredAgentId = assignInfo.mode === 'agent' ? assignInfo.agentId : null;
        let preferredAgentName: string | null = null;
        let preferredAgentAvatar: string | null = null;
        let preferredAgentCliName: string | null = null;
        if (preferredAgentId) {
          const agent = getAgent(preferredAgentId);
          if (agent) {
            preferredAgentName = agent.name;
            preferredAgentAvatar = agent.avatar;
            preferredAgentCliName = agent.cliName;
          } else {
            preferredAgentId = null;
          }
        }

        // assignees 매핑 (GitLab: assignees[], GitHub: assignees[])
        const assignees = (issue.assignees || []).map((a: any) => ({
          id: a.id,
          username: a.username || a.login,
          name: a.name || a.login || a.username,
          avatarUrl: a.avatar_url,
        }));

        return {
          iid: issue.iid,
          title: issue.title,
          description: issue.description,
          state: issue.state,
          stage,
          failReason: null, // 실패 사유는 이슈 코멘트에서 확인
          assignMode: assignInfo.mode,
          preferredAgentId,
          preferredAgentName,
          preferredAgentAvatar,
          preferredAgentCliName,
          assignees,
          labels: issue.labels,
          createdAt: issue.created_at,
          updatedAt: issue.updated_at,
          webUrl: issue.web_url,
          author: issue.author?.name,
        };
      });

    return NextResponse.json(mapped);
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : '이슈 조회 실패' }, { status: 500 });
  }
}

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const { id: projectId } = await params;
  const project = getProject(projectId);
  if (!project) return NextResponse.json({ error: 'Project not found' }, { status: 404 });

  const access = getProjectAccess(projectId, user.id);
  if (!access || access === 'viewer') {
    return NextResponse.json({ error: '작업 생성 권한이 없습니다.' }, { status: 403 });
  }

  const { title, description, asDev, preferredAgentId, assignMode: reqAssignMode, assigneeIds, assigneeUsernames } = await req.json();
  if (!title?.trim()) return NextResponse.json({ error: '제목을 입력하세요.' }, { status: 400 });

  try {
    const decryptedToken = decrypt(project.accessToken);

    // 레이블 존재 확인 (asDev일 때만)
    if (asDev) {
      const labelCheck = await checkLabelsExist(project, decryptedToken);
      const devLabel = labelCheck.find(l => l.label === project.labelTarget);
      if (devLabel && !devLabel.exists) {
        return NextResponse.json({
          error: `레이블 "${project.labelTarget}"이 Git에 없습니다. 프로젝트 설정에서 레이블을 생성해주세요.`,
          labelMissing: true,
        }, { status: 400 });
      }
    }

    // IVE 레이블 항상 부착 + asDev면 IVE-S(스케줄 대상)도 부착
    const isAssigneeMode = reqAssignMode === 'assignee';
    const labels = asDev
      ? [project.labelTarget, project.labelSchedule || 'IVE-S']
      : [project.labelTarget];
    const assignees = (assigneeIds?.length || assigneeUsernames?.length)
      ? { ids: assigneeIds, usernames: assigneeUsernames } : undefined;
    const issue = await createIssue(project, decryptedToken, title.trim(), description?.trim() ?? '', labels, assignees);

    // 배정 모드 지정
    if (issue.iid) {
      if (isAssigneeMode) {
        setAssignMode(projectId, issue.iid, 'assignee');
      } else if (preferredAgentId) {
        setAssignMode(projectId, issue.iid, 'agent', preferredAgentId);
      }
    }

    // assignee 모드: 가이드 노트 작성 (담당자에게 레이블 변경 안내)
    if (issue.iid && isAssigneeMode) {
      try {
        const labelS = project.labelSchedule || 'IVE-S';
        const labelD = project.labelDev || 'IVE-D';
        const labelW = project.labelVerifyWait || 'IVE-W';
        const labelV = project.labelVerify || 'IVE-V';
        const labelE = project.labelEnd || 'IVE-E';
        const guideNote = `<!-- ive-bot -->\n## 🔖 작업 진행 가이드\n\n이 이슈는 **담당자가 직접 처리**하는 작업입니다.\n레이블을 변경하여 단계를 진행해주세요. (현재: \`${labelS}\` 대기 중)\n\n| 순서 | 레이블 | 단계 | 설명 |\n|:---:|:---:|---|---|\n| ✅ | \`${labelS}\` | 대기 | 현재 단계 — 개발 대기 중 |\n| 2 | \`${labelD}\` | 개발 | 개발 진행 중 (브랜치 자동 생성) |\n| 3 | \`${labelW}\` | 검증대기 | 개발 완료, 검증 대기 |\n| 4 | \`${labelV}\` | 검증 | 검증 진행 중 |\n| 5 | \`${labelE}\` | 완료 | 모든 작업 완료 |\n\n### 진행 방법\n1. 개발을 시작하려면 **\`${labelS}\`** → **\`${labelD}\`** 로 변경하세요 (작업 브랜치가 자동 생성됩니다)\n2. 개발이 완료되면 **\`${labelD}\`** → **\`${labelW}\`** 로 변경하세요\n3. 검증을 시작하면 **\`${labelW}\`** → **\`${labelV}\`** 로 변경하세요\n4. 모든 작업이 끝나면 **\`${labelV}\`** → **\`${labelE}\`** 로 변경하세요`;
        await addIssueComment(project, issue.iid, decryptedToken, guideNote);
      } catch (e) {
        console.warn(`[Issues] Failed to add guide note on #${issue.iid}:`, e);
      }
    }

    touchProjectActivity(projectId);
    return NextResponse.json(issue);
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : '이슈 생성 실패' }, { status: 500 });
  }
}
