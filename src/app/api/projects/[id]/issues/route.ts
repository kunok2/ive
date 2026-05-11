import { NextRequest, NextResponse } from 'next/server';
import { getProject, getProjectAccess, getProjectAuthToken, getAssignModeMap, setAssignMode, setAssigneeAuto, setPresetRoles, getPresetRoles, getActualRoleAssigneesMap, getAgent, hasActiveExecution, hasAnyExecution, stageFromLabels, touchProjectActivity, getIssueIterationCountsMap } from '@/lib/db';
import { triggerScan } from '@/lib/scanner';
import { getCurrentUser } from '@/lib/auth';
import { logActivity } from '@/lib/activity';
import { checkLabelsExist, addIssueComment } from '@/lib/provider';
import { fetchAllProjectIssues, fetchClosedProjectIssues, createIssue } from '@/lib/provider';
import { withGitToken, friendlyGitError } from '@/lib/git-token';
import { prependIveAuthorMarker, stripIveAuthorMarker, stripIveDueMarker, resolveIveAuthorFromBody } from '@/lib/ive-author';

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

    // 배정 모드 맵 + 실제 수행자 맵 로드 (둘 다 batch 쿼리)
    const assignModeMap = getAssignModeMap(projectId);
    const actualRolesMap = getActualRoleAssigneesMap(projectId);
    const iterationMap = getIssueIterationCountsMap(projectId);

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
        const assignInfo = assignModeMap.get(issue.iid) || { mode: 'auto' as const, agentId: null, assigneeAuto: false };
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

        // ive-author 마커가 본문에 있으면 실제 IVE 사용자로 author 덮어쓰기.
        // Git UI에는 토큰 소유자가 저자로 남지만 IVE UI에서는 실제 작성자로 보이도록.
        // avatar 는 AgentAvatar 가 해석 가능한 값을 반환: URL | 'photo' | 'av-XX'
        const iveAuthor = resolveIveAuthorFromBody(issue.description);
        const author = iveAuthor
          ? {
              name: iveAuthor.name,
              avatar: iveAuthor.avatar === 'photo'
                ? `/api/auth/avatar/image?id=${iveAuthor.id}`
                : (iveAuthor.avatar || 'av-01'),
              // 하위 호환용 — 기존에 author.avatarUrl 만 쓰던 UI 가 photo URL 은 그대로 표시 가능
              avatarUrl: iveAuthor.avatar === 'photo' ? `/api/auth/avatar/image?id=${iveAuthor.id}` : null,
            }
          : {
              name: issue.author?.name,
              avatar: issue.author?.avatar_url || 'av-01',
              avatarUrl: issue.author?.avatar_url ?? null,
            };

        // 검증자/확인자 사전 배정 + 실제 수행자 (이슈 #271)
        const presetRoles = getPresetRoles(projectId, issue.iid);
        const actuals = { ...(actualRolesMap.get(issue.iid) || { processor: null, verifier: null, confirmer: null }) };

        // 자동배정/지정 결과 — 단계별 Git assignee 를 해당 역할의 실제 사람으로 fallback
        const firstAssignee = assignees[0];
        if (!actuals.verifier && firstAssignee && (stage === 'verify_waiting' || stage === 'verifying')) {
          actuals.verifier = {
            userId: String(firstAssignee.id),
            name: firstAssignee.name || firstAssignee.username,
            avatar: firstAssignee.avatarUrl || null,
          };
        }
        if (!actuals.confirmer && firstAssignee && (stage === 'confirm_waiting' || stage === 'confirming')) {
          actuals.confirmer = {
            userId: String(firstAssignee.id),
            name: firstAssignee.name || firstAssignee.username,
            avatar: firstAssignee.avatarUrl || null,
          };
        }

        return {
          iid: issue.iid,
          title: issue.title,
          description: stripIveDueMarker(stripIveAuthorMarker(issue.description || '')),
          state: issue.state,
          stage,
          failReason: null, // 실패 사유는 이슈 코멘트에서 확인
          assignMode: assignInfo.mode,
          preferredAgentId,
          preferredAgentName,
          preferredAgentAvatar,
          preferredAgentCliName,
          assigneeAuto: assignInfo.assigneeAuto,
          assignees,
          labels: issue.labels,
          createdAt: issue.created_at,
          updatedAt: issue.updated_at,
          dueDate: issue.due_date ?? null,
          webUrl: issue.web_url,
          author,
          iveAuthorId: iveAuthor?.id ?? null,
          authorId: issue.author?.id ?? null,
          presetVerifier: presetRoles.verifier,
          presetConfirmer: presetRoles.confirmer,
          actualProcessor: actuals.processor,
          actualVerifier: actuals.verifier,
          actualConfirmer: actuals.confirmer,
          // 회차 정보 — 처리 시도 횟수 + 되돌리기 합계 (카드 뱃지용)
          iterationCounts: (() => {
            const c = iterationMap.get(issue.iid);
            const fwd = c?.forward ?? { toProcess: 0, toVerify: 0, toConfirm: 0, toDone: 0 };
            const ret = c?.retry ?? { fromVerify: 0, fromVerifyToInflow: 0, fromConfirm: 0, fromDone: 0 };
            return {
              processCount: fwd.toProcess,                                          // 처리 진입 횟수
              retryTotal: ret.fromVerify + ret.fromVerifyToInflow + ret.fromConfirm + ret.fromDone,  // 총 되돌리기 횟수
            };
          })(),
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

  const { title, description, asDev, preferredAgentId, assignMode: reqAssignMode, assigneeIds, assigneeUsernames, assigneeAuto, verifierMode, verifierUserId, verifierUsername, confirmerMode, confirmerUserId, confirmerUsername, dueDate } = await req.json();
  if (!title?.trim()) return NextResponse.json({ error: '제목을 입력하세요.' }, { status: 400 });
  // dueDate 검증 (선택). YYYY-MM-DD 외 값은 무시.
  const dueDateNormalized: string | null = (typeof dueDate === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(dueDate)) ? dueDate : null;

  try {
    // 레이블 존재 확인 (asDev일 때만) — 프로젝트 레벨 설정 점검이라 프로젝트 토큰 고정.
    // 접속자 OAuth 토큰은 조직/private repo 접근 권한이 없을 수 있고, checkLabelsExist는 API 실패를
    // "모두 없음"으로 묻기 때문에 접속자 토큰으로 하면 오탐(모달 오동작) 발생.
    if (asDev) {
      const projectToken = getProjectAuthToken(projectId);
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
    // assignee 결정 — 모델: "처리전에는 생성자, 처리때는 처리자 또는 생성자"
    //   1) 자동배정 모드: 비움 (스캐너가 처리 마무리 시 가장 한가한 멤버 선택)
    //   2) 명시적 지정: 그대로 사용
    //   3) 그 외: 생성자(=현재 OAuth 사용자)를 기본 assignee 로
    //      (로컬 계정 사용자는 Git user id 가 없어 비움 — Git 측에서 unassigned)
    let assignees: { ids?: number[]; usernames?: string[] } | undefined;
    if (assigneeAuto) {
      assignees = undefined;
    } else if (assigneeIds?.length || assigneeUsernames?.length) {
      assignees = { ids: assigneeIds, usernames: assigneeUsernames };
    } else if (user.oauthUserId) {
      assignees = { ids: [Number(user.oauthUserId)] };
    } else {
      assignees = undefined;
    }

    // 본문 맨 앞에 ive-author 마커 주입 — 프로젝트 토큰으로 fallback되어 Git 저자가
    // 프로젝트 소유자로 표시되는 경우에도 IVE UI에서는 실제 작성자로 복원할 수 있게 함.
    // 마커는 HTML 주석이라 GitLab/GitHub 웹 UI에서는 사용자에게 보이지 않음.
    const bodyWithMarker = prependIveAuthorMarker(user.id, description?.trim() ?? '');

    // 대원칙 적용: 접속자 OAuth 토큰 우선 → 실패 시 프로젝트 토큰 fallback.
    // withGitToken 이 TokenContext 를 넘겨주므로 ctx.isOAuth 만 그대로 API 함수에 전달.
    const issue: any = await withGitToken(user, project, (ctx) =>
      createIssue(project, ctx.token, title.trim(), bodyWithMarker, labels, assignees, { isOAuth: ctx.isOAuth, dueDate: dueDateNormalized })
    );

    // 배정 모드 지정
    if (issue.iid) {
      if (isAssigneeMode) {
        setAssignMode(projectId, issue.iid, 'assignee');
      } else if (preferredAgentId) {
        setAssignMode(projectId, issue.iid, 'agent', preferredAgentId);
      }
      if (assigneeAuto) {
        setAssigneeAuto(projectId, issue.iid, true);
      }
      // 검증자/확인자 사전 배정 — 'creator' / 'auto' / 'specific'
      if (verifierMode || confirmerMode) {
        setPresetRoles(projectId, issue.iid, {
          verifier: {
            mode: (verifierMode as 'creator' | 'auto' | 'specific') || 'creator',
            userId: verifierMode === 'specific' ? (verifierUserId ?? null) : null,
            username: verifierMode === 'specific' ? (verifierUsername ?? null) : null,
          },
          confirmer: {
            mode: (confirmerMode as 'creator' | 'auto' | 'specific') || 'creator',
            userId: confirmerMode === 'specific' ? (confirmerUserId ?? null) : null,
            username: confirmerMode === 'specific' ? (confirmerUsername ?? null) : null,
          },
        });
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
        await withGitToken(user, project, (ctx) =>
          addIssueComment(project, issue.iid, ctx.token, guideNote, { isOAuth: ctx.isOAuth })
        );
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

    logActivity({
      userId: user.id,
      category: 'task',
      action: 'create_issue',
      detail: `이슈 생성: ${project.name} #${issue.iid} "${title.trim()}"${asDev ? ' (개발 등록)' : ''}`,
      targetType: 'issue',
      targetId: `${projectId}:${issue.iid}`,
      req,
    });

    return NextResponse.json(issue);
  } catch (err) {
    console.error('[issues POST] failed:', err)
    return NextResponse.json({ error: friendlyGitError(err, '이슈 생성') }, { status: 500 });
  }
}
