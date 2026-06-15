import { NextRequest, NextResponse } from 'next/server';
import { getDb, getProject, getProjectAuthToken, getProjectAccess, hasActiveExecution, stageFromLabels, markIssueVerifyStarted, markIssueVerified, markIssueVerifyRejected, markIssueConfirmed, markIssueConfirmStarted, resetIssueScheduledAt, recordIssueScheduledAt, touchProjectActivity, assignIssueAtomically, getAssignModeMap, getIssueScheduledAt, isIssueAssignee, isIssueAuthor, upsertIssueStageSnapshot, updateExecutionStatus, getVerifyWaitingCount, updateProjectLastChecked, getPresetRoles } from '@/lib/db';
import { triggerScan } from '@/lib/scanner';
import { applyRoleAssignee } from '@/lib/role-assignee';
import { notifyStageTransition } from '@/lib/slack-notify';
import { notifyConfirmerOnApprove } from '@/lib/merge-watcher';
import type { TaskExecution } from '@/types';
import { getCurrentUser } from '@/lib/auth';
import { reopenIssue, fetchSingleIssue, addIssueLabels, removeIssueLabels, addIssueComment, createBranch, getDefaultBranch } from '@/lib/provider';
import { logActivity } from '@/lib/activity';
import { TRANSITIONS, staleStageLabelsToRemove } from '@/lib/stage-transitions';
import fs from 'fs';
import path from 'path';

// 단계 전이 표는 src/lib/stage-transitions.ts 로 분리됨 (테스트 가능).
// IVE-S 스케줄 → IVE-D 개발 → IVE-W 검증대기 → IVE-V 검증 → IVE-P 확인대기 → IVE-C 확인 → IVE-E 완료

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string; iid: string }> }
) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const { id: projectId, iid } = await params;
  const project = getProject(projectId);
  if (!project) return NextResponse.json({ error: 'Project not found' }, { status: 404 });

  // 프로젝트 접근 권한 체크 (viewer여도 허용 — 워크플로우 액션은 assignee 기반으로 판단)
  const access = getProjectAccess(projectId, user.id);
  if (!access) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  const { stage, action } = await req.json();
  if (!stage || !action) {
    return NextResponse.json({ error: 'stage와 action이 필요합니다.' }, { status: 400 });
  }

  const available = TRANSITIONS[stage];
  if (!available) {
    return NextResponse.json({ error: '알 수 없는 단계입니다.' }, { status: 400 });
  }

  const transition = available.find(t => t.action === action);
  if (!transition) {
    return NextResponse.json({ error: '허용되지 않는 액션입니다.' }, { status: 400 });
  }

  try {
    const token = getProjectAuthToken(projectId);

    // ── 서버측 stage 검증 ──
    // 클라이언트가 보낸 stage가 Git의 실제 레이블에서 계산한 stage와 일치하는지 확인.
    // 다중 사용자 환경에서 캐시된 오래된 stage로 액션이 들어오는 경우를 차단.
    const currentIssue = await fetchSingleIssue(project, Number(iid), token);

    // 권한: 관리자이거나 해당 이슈의 Git assignee(검증자/담당자) 또는 작성자(Git author / ive-author 마커)
    // 작성자도 자신이 만든 작업의 단계를 진행할 수 있음 (검증/확인 시작 등)
    if (!user.isAdmin
      && !(await isIssueAssignee(project, Number(iid), token, user))
      && !(await isIssueAuthor(project, Number(iid), token, user))
    ) {
      return NextResponse.json(
        { error: '이 이슈의 담당자(Git assignee) 또는 관리자만 단계를 변경할 수 있습니다' },
        { status: 403 }
      );
    }
    const currentLabels: string[] = currentIssue?.labels || [];
    const hasActive = hasActiveExecution(projectId, Number(iid));
    // stageFromLabels: IVE 라벨만 있고 단계 라벨이 없으면 null → 클라이언트의 'none' 으로 정규화.
    const actualStage = stageFromLabels(currentLabels, project, { hasActiveExec: hasActive }) ?? 'none';
    if (actualStage !== stage) {
      return NextResponse.json(
        {
          error: `이슈 상태가 이미 변경되었습니다. (요청: ${stage}, 현재: ${actualStage}) 화면을 새로고침한 후 다시 시도해주세요.`,
          actualStage,
        },
        { status: 409 }
      );
    }

    // 레이블 전환 수행 + 안전망: 전이 결과로 단계 라벨이 정확히 한 개만 남도록
    // 이전 단계의 라벨이 의도치 않게 잔류하면 stage 가 잘못 판정되므로 항상 정리.
    const explicitRemove = transition.removeLabels(project);
    const labelsToAdd = transition.addLabels(project);
    const keepLabel = labelsToAdd[0] || ''; // 전이 후 유지할 단일 단계 라벨
    const sanitizedRemove = keepLabel
      ? Array.from(new Set([...explicitRemove, ...staleStageLabelsToRemove(project, keepLabel)]))
      : explicitRemove;

    if (sanitizedRemove.length > 0) {
      await removeIssueLabels(project, Number(iid), token, sanitizedRemove);
    }
    if (labelsToAdd.length > 0) {
      await addIssueLabels(project, Number(iid), token, labelsToAdd);
    }

    // 종료 라벨(IVE-E) 외 단계로 되돌리는 액션은 닫힌 이슈를 다시 열어준다.
    //   - 스케줄(IVE-S)로 되돌리는 retry/cancel
    //   - done → 확인(IVE-C)으로 되돌리는 reopen (step-back)
    const labelEnd = project.labelEnd || 'IVE-E';
    const isLeavingDone = sanitizedRemove.includes(labelEnd) && !labelsToAdd.includes(labelEnd);
    const isBackToSchedule = labelsToAdd.some(l => l === (project.labelSchedule || 'IVE-S'));
    if (isBackToSchedule || isLeavingDone) {
      try {
        const issue = await fetchSingleIssue(project, Number(iid), token);
        if (issue?.state === 'closed') {
          await reopenIssue(project, Number(iid), token);
        }
      } catch (err) {
        console.error(`[Stage] 이슈 #${iid} 다시 열기 실패:`, err);
      }
    }

    // 담당자 모드 개발 시작: execution 생성 + 브랜치 생성
    if (action === 'start_dev') {
      const assignModeMap = getAssignModeMap(projectId);
      const assignInfo = assignModeMap.get(Number(iid));
      if (assignInfo?.mode === 'assignee') {
        const issue = await fetchSingleIssue(project, Number(iid), token);
        const assignees = issue?.assignees || [];
        const assignee = assignees[0];
        const executionId = `ex-${Date.now()}-${Math.floor(Math.random() * 1000)}`;
        const logDir = path.join(process.cwd(), 'data', 'logs');
        if (!fs.existsSync(logDir)) fs.mkdirSync(logDir, { recursive: true });
        const logPath = path.join(logDir, `${executionId}.log`);
        fs.writeFileSync(logPath, '');

        const waitingSince = getIssueScheduledAt(projectId, Number(iid)) || new Date().toISOString();
        const execution: TaskExecution = {
          id: executionId,
          projectId,
          agentId: '',
          issueIid: Number(iid),
          issueTitle: issue?.title || '',
          status: 'assigned',
          startedAt: new Date().toISOString(),
          logPath,
          inputTokens: 0, outputTokens: 0, costUsd: 0, turns: 0,
          issueCreatedAt: waitingSince,
          assigneeType: 'user',
          userId: assignee ? String(assignee.id) : user.id,
          userName: assignee ? (assignee.name || assignee.username || assignee.login) : user.name,
          userAvatar: assignee?.avatar_url || user.avatar,
        };

        assignIssueAtomically(projectId, Number(iid), 'dev', execution);

        // 브랜치 생성
        const branchName = `dev-${iid}`;
        try {
          const defaultBranch = await getDefaultBranch(project, token);
          await createBranch(project, token, branchName, defaultBranch);
        } catch (e) { console.warn(`[Stage] Failed to create branch for #${iid}:`, e); }

        // 브랜치 안내 코멘트
        try {
          const commentBody = `<!-- ive-bot -->\n## 🌿 작업 브랜치 생성됨\n\n- **브랜치:** \`${branchName}\`\n- **담당자:** ${execution.userName}`;
          await addIssueComment(project, Number(iid), token, commentBody);
        } catch (e) { console.warn(`[Stage] Failed to add branch comment on #${iid}:`, e); }
      }
    }

    // dev 단계 종료 시 사람 작업 execution 닫기 (여러 개 있을 수 있으므로 전부 처리)
    if (stage === 'dev' && (action === 'complete' || action === 'cancel' || action === 'retry')) {
      const db = getDb();
      const devExecs = db.prepare(
        "SELECT id FROM task_executions WHERE project_id = ? AND issue_iid = ? AND status IN ('running', 'assigned') AND assignee_type = 'user'"
      ).all(projectId, Number(iid)) as { id: string }[];
      const endStatus = action === 'complete' ? 'success' : 'failed';
      for (const ex of devExecs) {
        updateExecutionStatus(ex.id, endStatus, new Date().toISOString());
      }
    }

    // 검증 시작 시 verify_started_at 기록 + 검증자 execution 생성
    if (action === 'start_verification') {
      // 1. 아직 실행 중인 dev/기타 작업을 먼저 success로 닫음 (ended_at 찍힘)
      //    — 이 순서가 핵심: 방금 닫힌 execs도 아래 markIssueVerifyStarted 대상에 포함되어야 함
      const db = getDb();
      const allActiveExecs = db.prepare(
        "SELECT id FROM task_executions WHERE project_id = ? AND issue_iid = ? AND status IN ('running', 'assigned')"
      ).all(projectId, Number(iid)) as any[];
      for (const exec of allActiveExecs) {
        updateExecutionStatus(exec.id, 'success', new Date().toISOString());
      }

      // 2. 닫힌 dev exec에 verify_started_at 기록 (검증 타이머 시작점)
      markIssueVerifyStarted(projectId, Number(iid));

      // 검증자 execution 생성 (작업중 카운팅 + 모니터링 패널 표시)
      try {
        const verifyIssue = await fetchSingleIssue(project, Number(iid), token);
        const executionId = `ex-verify-${Date.now()}-${Math.floor(Math.random() * 1000)}`;
        const logDir = path.join(process.cwd(), 'data', 'logs');
        if (!fs.existsSync(logDir)) fs.mkdirSync(logDir, { recursive: true });
        const logPath = path.join(logDir, `${executionId}.log`);
        fs.writeFileSync(logPath, '');

        const verifyExecution: TaskExecution = {
          id: executionId,
          projectId,
          agentId: '',
          issueIid: Number(iid),
          issueTitle: verifyIssue?.title || '',
          status: 'assigned',
          startedAt: new Date().toISOString(),
          logPath,
          inputTokens: 0, outputTokens: 0, costUsd: 0, turns: 0,
          issueCreatedAt: new Date().toISOString(),
          assigneeType: 'user',
          userId: user.id,
          userName: user.name,
          userAvatar: user.avatar,
        };
        const created = assignIssueAtomically(projectId, Number(iid), 'verifying', verifyExecution);
        console.log(`[Stage] Verify execution created for #${iid}: ${created}, executionId: ${executionId}`);
        if (!created) {
          console.warn(`[Stage] Failed to create verify execution for #${iid}: race condition detected`);
        }
      } catch (e) {
        console.warn(`[Stage] Failed to create verify execution for #${iid}:`, e);
      }
    }

    // 검증 완료 시 실행 기록에 verified_at + 검증자 기록 (verifying 상태에서만)
    if (action === 'approve' || (action === 'complete' && stage === 'verifying')) {
      markIssueVerified(projectId, Number(iid), { name: user.name, avatar: user.avatar, userId: user.id });
    }

    // dev → verify_waiting (수동 'complete') 전이 시 검증자 preset 기반 assignee 교체
    if (stage === 'dev' && action === 'complete') {
      try {
        const preset = getPresetRoles(projectId, Number(iid)).verifier;
        await applyRoleAssignee(project, Number(iid), token, '검증자', preset, { currentUser: user });
      } catch (e) { console.warn(`[Stage] Verifier preset apply failed for #${iid}:`, e); }
      // 검증대기 진입 → 배정된 검증자(사람)에게 DM (fire-and-forget — 응답 지연 방지)
      void notifyStageTransition(project, Number(iid), token, 'verify');
    }

    // verifying → confirm_waiting (approve/complete) 전이 시 확인자 preset 기반 assignee 교체
    if (stage === 'verifying' && (action === 'approve' || action === 'complete')) {
      try {
        const preset = getPresetRoles(projectId, Number(iid)).confirmer;
        await applyRoleAssignee(project, Number(iid), token, '확인자', preset, { currentUser: user });
      } catch (e) { console.warn(`[Stage] Confirmer preset apply failed for #${iid}:`, e); }
      // 확인대기 진입 → 확인자에게 "이제 확인하세요" DM.
      // 단, 머지+CI 가 끝나 실제로 확인 가능한 시점에만 보낸다(merge-watcher 와 조율).
      // 머지 감시 중이면 CI 완료 때 감시자가, 이미 머지됐고 감시가 없으면 여기서 발송. (fire-and-forget)
      void notifyConfirmerOnApprove(project, Number(iid), token);
    }

    // 검증 반려 시 rejected_at 기록
    // (명시적 reject뿐 아니라 검증 단계에서 재실행/유입 초기화 클릭 시에도 반려로 집계 — 검증자가 "통과 못함" 판단)
    if (action === 'reject' || (stage === 'verifying' && (action === 'retry' || action === 'to_inflow'))) {
      markIssueVerifyRejected(projectId, Number(iid), { name: user.name, avatar: user.avatar, userId: user.id });
    }

    // verifying 단계 종료 시 검증자 execution 닫기 (여러 개 있을 수 있으므로 전부 처리)
    if (stage === 'verifying' && (action === 'approve' || action === 'complete' || action === 'reject' || action === 'retry' || action === 'to_inflow')) {
      const db = getDb();
      const verifyExecs = db.prepare(
        "SELECT id FROM task_executions WHERE project_id = ? AND issue_iid = ? AND status IN ('running', 'assigned') AND assignee_type = 'user'"
      ).all(projectId, Number(iid)) as { id: string }[];
      const endStatus = (action === 'approve' || action === 'complete') ? 'success' : 'failed';
      for (const ex of verifyExecs) {
        updateExecutionStatus(ex.id, endStatus, new Date().toISOString());
      }
    }

    // 확인 시작: confirm_started_at 기록 + 확인자 execution 생성 (verify 시작 패턴 거울 대칭)
    if (action === 'start_confirmation') {
      markIssueConfirmStarted(projectId, Number(iid));
      try {
        const confirmIssue = await fetchSingleIssue(project, Number(iid), token);
        const executionId = `ex-confirm-${Date.now()}-${Math.floor(Math.random() * 1000)}`;
        const logDir = path.join(process.cwd(), 'data', 'logs');
        if (!fs.existsSync(logDir)) fs.mkdirSync(logDir, { recursive: true });
        const logPath = path.join(logDir, `${executionId}.log`);
        fs.writeFileSync(logPath, '');

        const confirmExecution: TaskExecution = {
          id: executionId,
          projectId,
          agentId: '',
          issueIid: Number(iid),
          issueTitle: confirmIssue?.title || '',
          status: 'assigned',
          startedAt: new Date().toISOString(),
          logPath,
          inputTokens: 0, outputTokens: 0, costUsd: 0, turns: 0,
          issueCreatedAt: new Date().toISOString(),
          assigneeType: 'user',
          userId: user.id,
          userName: user.name,
          userAvatar: user.avatar,
        };
        const created = assignIssueAtomically(projectId, Number(iid), 'confirming', confirmExecution);
        console.log(`[Stage] Confirm execution created for #${iid}: ${created}, executionId: ${executionId}`);
      } catch (e) {
        console.warn(`[Stage] Failed to create confirm execution for #${iid}:`, e);
      }
    }

    // 확인 완료(accept): confirmer 정보 기록만 (이슈 close 는 별도 닫기 버튼으로만 수행)
    if (action === 'accept' && stage === 'confirming') {
      markIssueConfirmed(projectId, Number(iid), { name: user.name, avatar: user.avatar, userId: user.id });
      // 완료 진입 → 이슈 생성자(사람)에게 DM (fire-and-forget)
      void notifyStageTransition(project, Number(iid), token, 'done');
    }

    // confirming 단계 종료 시 확인자 execution 닫기 (verify 종료 패턴과 동일)
    if (stage === 'confirming' && (action === 'accept' || action === 'return_to_dev' || action === 'retry')) {
      const db = getDb();
      const confirmExecs = db.prepare(
        "SELECT id FROM task_executions WHERE project_id = ? AND issue_iid = ? AND status IN ('running', 'assigned') AND assignee_type = 'user'"
      ).all(projectId, Number(iid)) as { id: string }[];
      const endStatus = action === 'accept' ? 'success' : 'failed';
      for (const ex of confirmExecs) {
        updateExecutionStatus(ex.id, endStatus, new Date().toISOString());
      }
    }

    // 스케줄로 되돌아갈 때 scheduled_at 리셋 (재시도 execution의 대기시간 정확 계산)
    // 첫 schedule(none→waiting) 은 row 가 없을 수 있어 record 사용 (UPSERT, COALESCE 로 기존값 보존).
    if (isBackToSchedule) {
      if (stage === 'none' && action === 'schedule') {
        recordIssueScheduledAt(projectId, Number(iid), new Date().toISOString());
      } else {
        resetIssueScheduledAt(projectId, Number(iid));
      }
    }

    // 프로젝트 최종 활동 시각 갱신
    touchProjectActivity(projectId);

    // 전환 후 새로운 stage 판정
    const issue = await fetchSingleIssue(project, Number(iid), token);
    const newLabels = issue?.labels || [];
    const activeExec = hasActiveExecution(projectId, Number(iid));
    const newStage = stageFromLabels(newLabels, project, { hasActiveExec: activeExec }) ?? 'none';

    // DB 스냅샷 즉시 업데이트 (탑바/목록 즉시 동기화용)
    // verifying 단계라면 검증자 정보 사용, 아니면 Git assignee 사용
    let assigneeInfo = { username: null as string | null, name: null as string | null, avatar: null as string | null, gitUserId: null as string | null };
    if (newStage === 'verifying' || newStage === 'confirming') {
      // 검증/확인 단계: 현재 사용자(검증자/확인자) 정보 저장
      assigneeInfo = {
        username: user.email?.split('@')[0] || null,  // email에서 username 추출
        name: user.name || null,
        avatar: user.avatar || null,
        gitUserId: user.oauthUserId ? String(user.oauthUserId) : null,  // OAuth user id (Git provider의 numeric id)
      };
    } else {
      // 다른 단계: Git issue의 assignee 사용 (없으면 작성자를 담당자로 간주)
      const firstAssignee = issue?.assignees?.[0] || issue?.author;
      assigneeInfo = {
        username: firstAssignee?.username || null,
        name: firstAssignee?.name || (firstAssignee as any)?.login || null,
        avatar: firstAssignee?.avatar_url || null,
        gitUserId: firstAssignee?.id ? String(firstAssignee.id) : null,
      };
    }

    upsertIssueStageSnapshot(projectId, Number(iid), {
      cachedStage: newStage,
      assigneeUsername: assigneeInfo.username,
      assigneeName: assigneeInfo.name,
      assigneeAvatar: assigneeInfo.avatar,
      assigneeProvider: project.provider,
      assigneeGitUserId: assigneeInfo.gitUserId,
      issueTitle: issue?.title || null,
    });

    // 활동 로그 기록
    const actionLabels: Record<string, string> = {
      retry: '재시도 요청',
      cancel: '작업 취소',
      reopen: '작업 재오픈',
      approve: '검증 승인',
      complete: '머지 완료',
      reject: '검증 반려',
      start_verification: '검증 시작',
      start_confirmation: '확인 시작',
      accept: '확인 완료',
      return_to_dev: '재작업 요청',
      start_dev: '개발 시작',
      schedule: '스케줄 등록',
      to_inflow: '유입 전환',
    };
    logActivity({
      userId: user.id,
      category: 'task',
      action: `task_${action}`,
      detail: `${actionLabels[action] || action} (이슈 #${iid}, ${project.name})`,
      targetType: 'issue',
      targetId: `${projectId}:${iid}`,
      req,
    });

    // 검증 대기 수 즉시 갱신 (탑바 대기 건수 실시간 반영)
    try {
      const verifyWaitingCount = getVerifyWaitingCount(projectId);
      const waitingCount = Number(project.lastScannedIssueCount ?? 0);
      updateProjectLastChecked(projectId, new Date().toISOString(), waitingCount, verifyWaitingCount);
    } catch (e) {
      console.warn(`[Stage] Failed to update verify waiting count:`, e);
    }

    // 즉시 스캔 트리거 (다른 프로젝트의 assignment 재빠르게 반영)
    try {
      triggerScan(projectId);
    } catch (e) {
      console.warn(`[Stage] Failed to trigger scanner:`, e);
    }

    return NextResponse.json({ success: true, stage: newStage });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : '상태 전환 실패' },
      { status: 500 }
    );
  }
}
