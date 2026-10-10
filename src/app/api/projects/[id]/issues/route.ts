import { NextRequest, NextResponse } from 'next/server';
import { getProject, getProjectAccess, getProjectAuthToken, getAssignModeMap, setAssignMode, setAssigneeAuto, setIssuePriority, normalizePriority, setPresetRoles, getPresetRoles, getActualRoleAssigneesMap, getAgent, hasActiveExecution, stageFromLabels, touchProjectActivity, getIssueIterationCountsMap, getActiveChatSessionsByProject, findIssueIidsByTitle, getIssueStageSinceMap, hasRole, markRolesInitialized, setStageWorkerNote, getStageWorkerNote, setIssueIntakeChannel, type RoleMode } from '@/lib/db';
import { autoAssignAllAgents, agentRoleAvailable } from '@/lib/role-assignment';
import { isChatAgentRunning } from '@/lib/chat-agent';
import { triggerScan } from '@/lib/scanner';
import { getCurrentUser } from '@/lib/auth';
import { logActivity } from '@/lib/activity';
import { checkLabelsExist, addIssueComment } from '@/lib/provider';
import { fetchAllProjectIssues, fetchClosedProjectIssuesPage, createIssue } from '@/lib/provider';
import { parseClosedPageOptions, parseIidSearch, isGitLabSearchable } from '@/lib/closed-issues';
import { withGitToken, friendlyGitError } from '@/lib/git-token';
import { prependIveAuthorMarker, stripIveAuthorMarker, stripIveDueMarker, resolveIveAuthorFromBody } from '@/lib/ive-author';
import { DEFAULT_LABELS } from '@/lib/labels';
import { isIveManaged } from '@/lib/stage-transitions';

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const { id: projectId } = await params;
  const project = getProject(projectId);
  if (!project) return NextResponse.json({ error: '프로젝트를 찾을 수 없습니다. 삭제되었을 수 있습니다 — 새로고침해 주세요.' }, { status: 404 });

  const listAccess = getProjectAccess(projectId, user.id);
  if (!listAccess) {
    return NextResponse.json({ error: '이 프로젝트에서 이 작업을 할 권한이 없습니다. 프로젝트 소유자에게 권한을 요청해 주세요.' }, { status: 403 });
  }

  const stateParam = req.nextUrl.searchParams.get('state');

  try {
    const token = getProjectAuthToken(projectId);
    // 닫힌 이슈(이력 탭)는 한 페이지만 — 전체를 받으면 이슈가 쌓일수록 수십 초가 걸린다.
    const closedOpts = stateParam === 'closed'
      ? { ...parseClosedPageOptions(req.nextUrl.searchParams), label: project.labelTarget, orLabel: project.labelEnd || DEFAULT_LABELS.end }
      : null;
    // GitLab 검색은 3글자 미만 단어를 무시한다 → 짧은 검색어는 IVE 가 기록한 제목으로 번호를 찾아 한정한다.
    if (closedOpts?.search && project.provider !== 'github'
      && parseIidSearch(closedOpts.search) == null && !isGitLabSearchable(closedOpts.search)) {
      closedOpts.iids = findIssueIidsByTitle(projectId, closedOpts.search);
    }
    const closedPage = closedOpts ? await fetchClosedProjectIssuesPage(project, token, closedOpts) : null;
    const issues = closedPage ? closedPage.issues : await fetchAllProjectIssues(project, token);

    // 배정 모드 맵 + 실제 수행자 맵 로드 (둘 다 batch 쿼리)
    const assignModeMap = getAssignModeMap(projectId);
    const actualRolesMap = getActualRoleAssigneesMap(projectId);
    const iterationMap = getIssueIterationCountsMap(projectId);
    // 지금 단계에 들어온 시각·대기 사유(사건 로그) — 카드 대기 목록의 「n시간째」·사유 표시용
    const stageSinceMap = stateParam === 'closed' ? null : getIssueStageSinceMap(projectId);
    // 진행 중인 AI 채팅(이슈별) — 카드 "대화중"/"생각중" 표시용
    const activeChatMap = new Map<number, string>();
    for (const s of getActiveChatSessionsByProject(projectId)) activeChatMap.set(s.issueIid, s.id);

    const isClosed = stateParam === 'closed';

    const mapped = issues
      // IVE 대상 라벨 또는 단계 라벨 필수 (없으면 IVE에서 관리하지 않는 이슈).
      // 닫힌 이슈는 Git 조회 단계에서 이미 IVE 레이블로 한정했으므로(페이지·건수 일치) 여기선 그대로 통과.
      .filter((issue: any) => isClosed || isIveManaged(issue.labels || [], project))
      .map((issue: any) => {
        // 레이블에서 stage 판정
        const issueLabels = issue.labels || [];
        const activeExec = hasActiveExecution(projectId, issue.iid);
        const stage = stageFromLabels(issueLabels, project, { hasActiveExec: activeExec })
          || (isClosed ? 'done' : 'none');

        // 배정 모드 + 선호 에이전트 정보 조회
        const assignInfo = assignModeMap.get(issue.iid) || { mode: 'auto' as const, agentId: null, assigneeAuto: false, priority: 0 as const };
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

        // 사건 로그의 마지막 단계가 지금 단계와 같을 때만 그 시각을 믿는다(라벨만 바뀌고 아직 기록 전이면 모름)
        const logged = stageSinceMap?.get(issue.iid);
        const stageLog = logged && (logged.stage ?? 'none') === stage ? logged : null;

        // 검증자/확인자 사전 배정 + 실제 수행자 (이슈 #271)
        const presetRoles = getPresetRoles(projectId, issue.iid);
        const actuals = { ...(actualRolesMap.get(issue.iid) || { processor: null, verifier: null, confirmer: null }) };

        // 자동배정/지정 결과 — 단계별 Git assignee 를 해당 역할의 실제 사람으로 fallback (그 역할을 에이전트가 맡았으면 제외)
        const firstAssignee = assignees[0];
        if (!actuals.verifier && firstAssignee && presetRoles.verifier.mode !== 'agent' && (stage === 'verify_waiting' || stage === 'verifying')) {
          actuals.verifier = {
            userId: String(firstAssignee.id),
            name: firstAssignee.name || firstAssignee.username,
            avatar: firstAssignee.avatarUrl || null,
          };
        }
        if (!actuals.confirmer && firstAssignee && presetRoles.confirmer.mode !== 'agent' && (stage === 'confirm_waiting' || stage === 'confirming')) {
          actuals.confirmer = {
            userId: String(firstAssignee.id),
            name: firstAssignee.name || firstAssignee.username,
            avatar: firstAssignee.avatarUrl || null,
          };
        }

        return {
          iid: issue.iid,
          title: issue.title,
          // 이력 목록은 본문을 쓰지 않는다 — 페이로드를 줄이려고 비워 보낸다(상세 화면이 따로 조회).
          description: isClosed ? '' : stripIveDueMarker(stripIveAuthorMarker(issue.description || '')),
          state: issue.state,
          stage,
          // 진행 중 AI 채팅 표시 — 세션 있으면 대화중, 에이전트가 돌고 있으면 생각중
          chatActive: activeChatMap.has(issue.iid),
          chatProcessing: activeChatMap.has(issue.iid) && isChatAgentRunning(activeChatMap.get(issue.iid)!),
          failReason: null, // 실패 사유는 이슈 코멘트에서 확인
          assignMode: assignInfo.mode,
          preferredAgentId,
          preferredAgentName,
          preferredAgentAvatar,
          preferredAgentCliName,
          assigneeAuto: assignInfo.assigneeAuto,
          priority: assignInfo.priority,
          // 우선순위는 편집 권한자(뷰어 제외) 누구나 — priority 라우트와 같은 기준
          canEditPriority: listAccess !== 'viewer',
          assignees,
          labels: issue.labels,
          createdAt: issue.created_at,
          updatedAt: issue.updated_at,
          closedAt: issue.closed_at ?? null,
          dueDate: issue.due_date ?? null,
          webUrl: issue.web_url,
          author,
          iveAuthorId: iveAuthor?.id ?? null,
          authorId: issue.author?.id ?? null,
          presetVerifier: presetRoles.verifier,
          presetConfirmer: presetRoles.confirmer,
          stageSince: stageLog?.since ?? null,
          waitReason: stageLog?.waitReason ?? null,
          stageWorkerNote: (stage === 'done' || issue.state === 'closed') ? null : getStageWorkerNote(projectId, issue.iid),
          actualProcessor: actuals.processor,
          actualVerifier: actuals.verifier,
          actualConfirmer: actuals.confirmer,
          // 회차 정보 — 처리 시도 횟수 + 되돌리기 합계 (카드 뱃지용)
          iterationCounts: (() => {
            const c = iterationMap.get(issue.iid);
            const fwd = c?.forward ?? { toProcess: 0, toVerify: 0, toConfirm: 0, toDone: 0 };
            return {
              processCount: fwd.toProcess,                                          // 처리 진입 횟수
              retryTotal: (c?.retry ?? []).reduce((n, m) => n + m.count, 0),      // 총 되돌리기 횟수
            };
          })(),
        };
      });

    if (closedPage && closedOpts) {
      return NextResponse.json({ items: mapped, total: closedPage.total, hasMore: closedPage.hasMore, page: closedOpts.page });
    }
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
  if (!project) return NextResponse.json({ error: '프로젝트를 찾을 수 없습니다. 삭제되었을 수 있습니다 — 새로고침해 주세요.' }, { status: 404 });

  const access = getProjectAccess(projectId, user.id);
  if (!access) {
    return NextResponse.json({ error: '작업 생성 권한이 없습니다.' }, { status: 403 });
  }

  const { title, description, asDev, preferredAgentId, assignMode: reqAssignMode, assigneeIds, assigneeUsernames, assigneeAuto, verifierMode, verifierUserId, verifierUsername, verifierAgentId, confirmerMode, confirmerUserId, confirmerUsername, confirmerAgentId, autoAllAgents, rolesExplicit, dueDate, notify, priority } = await req.json();
  if (!title?.trim()) return NextResponse.json({ error: '제목을 입력하세요.' }, { status: 400 });
  // 에이전트 검증자·확인자는 역할 명부에서 그 역할을 가진 것만, 처리자 ≠ 검증자. (「모든 단계 자동배정」이어도 같은 검사)
  {
    if (verifierMode === 'agent' && !agentRoleAvailable('verify')) {
      return NextResponse.json({ error: '검증 에이전트 작업자는 아직 없어 검증자를 에이전트로 지정할 수 없습니다.' }, { status: 400 });
    }
    if (verifierMode === 'agent' && !(verifierAgentId && hasRole(projectId, 'verify', 'agent', verifierAgentId))) {
      return NextResponse.json({ error: '검증 역할로 명부에 있는 에이전트만 검증자로 지정할 수 있습니다.' }, { status: 400 });
    }
    if (confirmerMode === 'agent' && !(confirmerAgentId && hasRole(projectId, 'confirm', 'agent', confirmerAgentId))) {
      return NextResponse.json({ error: '확인 역할로 명부에 있는 에이전트만 확인자로 지정할 수 있습니다.' }, { status: 400 });
    }
    if (preferredAgentId && verifierMode === 'agent' && verifierAgentId === preferredAgentId) {
      return NextResponse.json({ error: '처리자와 검증자를 같은 에이전트로 지정할 수 없습니다.' }, { status: 400 });
    }
  }
  // dueDate 검증 (선택). YYYY-MM-DD 외 값은 무시.
  const dueDateNormalized: string | null = (typeof dueDate === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(dueDate)) ? dueDate : null;

  try {
    // 붙일 단계 라벨 — 스케줄 대상이면 단계 라벨(IVE-S)만, 아니면 등록 표시(IVE)만. 단계 라벨이 곧 IVE 관리 표시라 둘을 함께 달지 않는다.
    const stageLabel = asDev ? (project.labelSchedule || DEFAULT_LABELS.schedule) : project.labelTarget;

    // 레이블 존재 확인 (asDev일 때만) — 프로젝트 레벨 설정 점검이라 프로젝트 토큰 고정.
    // 접속자 OAuth 토큰은 조직/private repo 접근 권한이 없을 수 있고, checkLabelsExist는 API 실패를
    // "모두 없음"으로 묻기 때문에 접속자 토큰으로 하면 오탐(모달 오동작) 발생.
    if (asDev) {
      const projectToken = getProjectAuthToken(projectId);
      const labelCheck = await checkLabelsExist(project, projectToken);
      const devLabel = labelCheck.find(l => l.label === stageLabel);
      if (devLabel && !devLabel.exists) {
        return NextResponse.json({
          error: `레이블 "${stageLabel}"이 Git에 없습니다. 프로젝트 설정에서 레이블을 생성해주세요.`,
          labelMissing: true,
        }, { status: 400 });
      }
    }

    const isAssigneeMode = reqAssignMode === 'assignee';
    const labels = [stageLabel];
    // 완료 알림 선택 시 알림 트리거 레이블(IVE-N) 부착 → 완료/실패 시 담당자에게 Slack 알림
    if (notify) labels.push(project.labelNotify || DEFAULT_LABELS.notify);
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
      // 우선순위 — 보통(0)이 기본이라 높음·긴급일 때만 남긴다
      const pr = normalizePriority(priority);
      if (pr > 0) setIssuePriority(projectId, issue.iid, pr);
      // 검증자/확인자 사전 배정 — 'creator' / 'auto' / 'specific' / 'agent'
      if (verifierMode || confirmerMode) {
        setPresetRoles(projectId, issue.iid, {
          verifier: {
            mode: (verifierMode as RoleMode) || 'creator',
            userId: verifierMode === 'specific' ? (verifierUserId ?? null) : null,
            username: verifierMode === 'specific' ? (verifierUsername ?? null) : null,
            agentId: verifierMode === 'agent' ? (verifierAgentId ?? null) : null,
          },
          confirmer: {
            mode: (confirmerMode as RoleMode) || 'creator',
            userId: confirmerMode === 'specific' ? (confirmerUserId ?? null) : null,
            username: confirmerMode === 'specific' ? (confirmerUsername ?? null) : null,
            agentId: confirmerMode === 'agent' ? (confirmerAgentId ?? null) : null,
          },
        });
      }
      // 「모든 단계 자동배정」 — 세 역할을 명부의 가장 한가한 에이전트로 한꺼번에 (위의 개별 선택보다 우선)
      if (autoAllAgents) {
        const out = autoAssignAllAgents(projectId, issue.iid, { isKo: user.locale !== 'en' });
        if (out.warnings.length) setStageWorkerNote(projectId, issue.iid, out.warnings.join(' / '));
      }
      // 등록 폼에서 역할을 직접 정했으면 프로젝트 기본 배정을 덮어쓰지 않는다
      if (autoAllAgents || rolesExplicit) markRolesInitialized(projectId, issue.iid);
    }
    // 들어온 경로 — IVE 등록 폼 (경로별 기본 배정)
    if (issue.iid) { try { setIssueIntakeChannel(projectId, issue.iid, 'ive') } catch { /* 기록 실패는 기본 배정만 접수 쪽으로 간다 */ } }

    // assignee 모드: 가이드 노트 작성 (담당자에게 레이블 변경 안내)
    if (issue.iid && isAssigneeMode) {
      try {
        const labelS = project.labelSchedule || DEFAULT_LABELS.schedule;
        const labelD = project.labelDev || DEFAULT_LABELS.dev;
        const labelW = project.labelVerifyWait || DEFAULT_LABELS.verifyWait;
        const labelV = project.labelVerify || DEFAULT_LABELS.verify;
        const labelE = project.labelEnd || DEFAULT_LABELS.end;
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
