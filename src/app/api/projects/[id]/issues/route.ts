import { NextRequest, NextResponse } from 'next/server';
import { getProject, getProjectAccess, getProjectAuthToken, getAssignModeMap, setAssignMode, getAgent, hasActiveExecution, hasAnyExecution, stageFromLabels, touchProjectActivity, getUserOAuthTokenRaw } from '@/lib/db';
import { triggerScan } from '@/lib/scanner';
import { getCurrentUser } from '@/lib/auth';
import { decrypt } from '@/lib/crypto';
import { checkLabelsExist, addIssueComment } from '@/lib/provider';
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
    const token = getProjectAuthToken(projectId);
    const issues = stateParam === 'closed'
      ? await fetchClosedProjectIssues(project, token)
      : await fetchAllProjectIssues(project, token);

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
          author: { name: issue.author?.name, avatarUrl: issue.author?.avatar_url },
        };
      });

    return NextResponse.json(mapped);
  } catch (err) {
    console.error('[issues GET] failed:', err)
    return NextResponse.json({ error: '이슈 조회 실패' }, { status: 500 });
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
  if (!access) {
    return NextResponse.json({ error: '작업 생성 권한이 없습니다.' }, { status: 403 });
  }

  const { title, description, asDev, preferredAgentId, assignMode: reqAssignMode, assigneeIds, assigneeUsernames } = await req.json();
  if (!title?.trim()) return NextResponse.json({ error: '제목을 입력하세요.' }, { status: 400 });

  try {
    const projectToken = getProjectAuthToken(projectId);

    // 현재 사용자의 OAuth 토큰을 우선 사용, 없으면 프로젝트 토큰
    let userToken: string | null = null;
    const userOAuth = getUserOAuthTokenRaw(user.id);
    if (userOAuth?.encrypted) {
      try { userToken = decrypt(userOAuth.encrypted); } catch { /* ignore */ }
    }

    const token = userToken || projectToken;

    // 레이블 존재 확인 (asDev일 때만).
    // 프로젝트 공식 토큰으로 조회 — 사용자 OAuth 토큰은 조직/private repo 접근 권한이 없을 수 있고,
    // checkLabelsExist는 API 실패를 "모두 없음"으로 묻기 때문에 오탐(모달 오동작)이 발생함.
    if (asDev) {
      const labelCheck = await checkLabelsExist(project, projectToken);
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

    // 사용자 토큰으로 시도, 실패하면 프로젝트 토큰으로 재시도
    let issue: any;
    try {
      issue = await createIssue(project, token, title.trim(), description?.trim() ?? '', labels, assignees);
    } catch (e) {
      if (userToken && token !== projectToken) {
        console.warn(`[Issues] User token failed, retrying with project token:`, e);
        issue = await createIssue(project, projectToken, title.trim(), description?.trim() ?? '', labels, assignees);
      } else {
        throw e;
      }
    }

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
        const guideNote = `<!-- ive-bot -->\n## 📋 담당자 작업 안내\n\n| 레이블 | 단계 | 설명 |\n|:---:|---|---|\n| \`${labelS}\` | 대기 | 현재 단계 |\n| \`${labelD}\` | 개발 | 개발 진행 중 (브랜치 자동 생성) |\n| \`${labelW}\` | 검증 대기 | 개발 완료 |\n| \`${labelV}\` | 검증 중 | 검증 진행 중 |\n| \`${labelE}\` | 완료 | 모든 작업 완료 |`;
        await addIssueComment(project, issue.iid, token, guideNote);
      } catch (e) {
        console.warn(`[Issues] Failed to add guide note on #${issue.iid}:`, e);
      }
    }

    touchProjectActivity(projectId);

    // 즉시 스캔 트리거
    try {
      triggerScan(projectId);
    } catch (e) {
      console.warn(`[Issues] Failed to trigger scanner:`, e);
    }

    return NextResponse.json(issue);
  } catch (err) {
    console.error('[issues POST] failed:', err)
    return NextResponse.json({ error: '이슈 생성 실패' }, { status: 500 });
  }
}
