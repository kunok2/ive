import { NextRequest, NextResponse } from 'next/server'
import { getProject, getProjectAccess, getProjectAuthToken, hasActiveExecutionForStage, stageFromLabels, getPresetRoles, getAssigneeAuto, getAssignMode, getActualRoleAssignees, getIssueStageTimes, getIssueRetryCounts, getIssueForwardCounts, getStageWorkerNote, getDevFailReason, getDeployState, getRunningAgentWork, wasCompletedByMergeClose } from '@/lib/db'
import { getCurrentUser } from '@/lib/auth'
import { execKind } from '@/lib/active-work'
import { logActivity } from '@/lib/activity'
import { updateIssue, fetchSingleIssue } from '@/lib/provider'
import { resolveIveAuthorFromBody, stripIveAuthorMarker, stripIveDueMarker, extractIveAuthorId, prependIveAuthorMarker } from '@/lib/ive-author'
import { DEFAULT_LABELS } from '@/lib/labels'
import { followGitAssignee } from '@/lib/stage-person'

export async function PUT(
  req: NextRequest,
  { params }: { params: Promise<{ id: string; iid: string }> }
) {
  const user = await getCurrentUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { id: projectId, iid } = await params
  const project = getProject(projectId)
  if (!project) return NextResponse.json({ error: '프로젝트를 찾을 수 없습니다. 삭제되었을 수 있습니다 — 새로고침해 주세요.' }, { status: 404 })

  const access = getProjectAccess(projectId, user.id)
  if (!access || access === 'viewer') {
    return NextResponse.json({ error: '이 프로젝트에서 이 작업을 할 권한이 없습니다. 프로젝트 소유자에게 권한을 요청해 주세요.' }, { status: 403 })
  }

  try {
    const body = await req.json()
    const { title, description, dueDate } = body as {
      title?: string
      description?: string
      dueDate?: string | null
    }

    // 마감일 단독 수정 모드: title/description 없이 dueDate만 들어오면 마감일만 변경.
    // 작성자(또는 관리자)만 마감일 수정 가능. 다른 작업자가 임의로 일정 바꾸면 안 됨.
    const isDueOnlyEdit = dueDate !== undefined && title === undefined && description === undefined
    if (isDueOnlyEdit) {
      const token = getProjectAuthToken(projectId)
      const current = await fetchSingleIssue(project, Number(iid), token)
      if (!current) return NextResponse.json({ error: '이슈를 찾을 수 없습니다' }, { status: 404 })
      const iveAuthor = resolveIveAuthorFromBody(current.description)
      const isCreator = (iveAuthor && iveAuthor.id === user.id)
        || (current.author?.id != null && user.oauthUserId && String(current.author.id) === String(user.oauthUserId))
      if (!user.isAdmin && !isCreator) {
        return NextResponse.json({ error: '작성자만 마감일을 변경할 수 있습니다' }, { status: 403 })
      }
      // 완료된 작업은 마감일 변경 금지.
      const labelEnd = project.labelEnd || DEFAULT_LABELS.end
      if (current.state === 'closed' || (current.labels || []).includes(labelEnd)) {
        return NextResponse.json({ error: '완료된 작업은 마감일을 변경할 수 없습니다' }, { status: 409 })
      }
      // YYYY-MM-DD 검증 (null/'' 은 해제)
      const normalized: string | null = dueDate
        ? (/^\d{4}-\d{2}-\d{2}$/.test(dueDate) ? dueDate : null)
        : null
      if (dueDate && !normalized) {
        return NextResponse.json({ error: '마감일 형식이 올바르지 않습니다 (YYYY-MM-DD)' }, { status: 400 })
      }
      const updated: any = await updateIssue(project, Number(iid), token, { dueDate: normalized })
      logActivity({
        userId: user.id,
        category: 'task',
        action: 'update_issue_due',
        detail: `이슈 마감일 변경: ${project.name} #${iid} → ${normalized || '해제'}`,
        targetType: 'issue',
        targetId: `${projectId}:${iid}`,
        req,
      })
      return NextResponse.json({
        iid: updated.iid,
        dueDate: updated.due_date ?? normalized,
      })
    }

    if (!title?.trim()) {
      return NextResponse.json({ error: '제목은 필수입니다' }, { status: 400 })
    }
    const token = getProjectAuthToken(projectId)
    // description 편집 시 본문에 들어 있던 IVE 마커들을 보존해야 한다 —
    // 갈아치우면 마커가 사라져 Git 저자(프로젝트 토큰 소유자/봇) 가 IVE UI 에 작성자로 노출됨.
    //   - ive-due:    GitHub 마감일 저장용 마커 (provider 측 setIveDueMarker 가 dueDate 인자 기준 재주입)
    //   - ive-author: 원작성자 식별 마커 (여기서 직접 보존해 prepend)
    const current = await fetchSingleIssue(project, Number(iid), token)
    const existingDue: string | null = current?.due_date ?? null
    const existingAuthorId = extractIveAuthorId(current?.description || '')
    const newDescription = existingAuthorId
      ? prependIveAuthorMarker(existingAuthorId, description ?? '')
      : (description ?? '')
    const updated = await updateIssue(project, Number(iid), token, {
      title: title.trim(),
      description: newDescription,
      dueDate: existingDue,
    })
    logActivity({
      userId: user.id,
      category: 'task',
      action: 'update_issue',
      detail: `이슈 수정: ${project.name} #${iid} "${title.trim()}"`,
      targetType: 'issue',
      targetId: `${projectId}:${iid}`,
      req,
    })
    return NextResponse.json({
      iid: updated.iid,
      title: updated.title,
      description: updated.description,
    })
  } catch (err) {
    return NextResponse.json(
      { error: '이슈 수정 실패' },
      { status: 500 }
    )
  }
}

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string; iid: string }> }
) {
  const user = await getCurrentUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { id: projectId, iid } = await params
  const project = getProject(projectId)
  if (!project) return NextResponse.json({ error: '프로젝트를 찾을 수 없습니다. 삭제되었을 수 있습니다 — 새로고침해 주세요.' }, { status: 404 })

  if (!getProjectAccess(projectId, user.id)) {
    return NextResponse.json({ error: '이 프로젝트에서 이 작업을 할 권한이 없습니다. 프로젝트 소유자에게 권한을 요청해 주세요.' }, { status: 403 })
  }

  try {
    const token = getProjectAuthToken(projectId)

    const issue = await fetchSingleIssue(project, Number(iid), token)
    if (!issue) return NextResponse.json({ error: '이슈를 찾을 수 없습니다' }, { status: 404 })

    // 레이블에서 stage 판정
    const issueLabels = issue.labels || []
    const activeExec = hasActiveExecutionForStage(projectId, Number(iid), { ignoreChat: true }) // 대화를 열어도 처리 실패가 「처리 중」으로 보이지 않게
    const stage = stageFromLabels(issueLabels, project, { hasActiveExec: activeExec })

    const assignees = (issue.assignees || []).map((a: any) => ({
      id: a.id,
      username: a.username || a.login,
      name: a.name || a.login || a.username,
      avatarUrl: a.avatar_url,
    }))

    // ive-author 마커가 있으면 실제 IVE 사용자로 작성자 정보 덮어쓰기.
    // Git UI 에는 토큰 소유자가 저자로 남지만 IVE UI 에서는 실제 작성자가 표시되도록.
    //
    // 권한 판정을 위해 두 가지 식별자를 함께 돌려준다:
    //   - authorId      : Git user id (OAuth 사용자 매칭용)
    //   - iveAuthorId   : IVE user id (로컬 계정 포함 모든 IVE 사용자 매칭용)
    // 클라이언트는 둘 중 하나만 일치해도 자기 이슈로 판정 가능.
    const iveAuthor = resolveIveAuthorFromBody(issue.description)
    const author = iveAuthor ? iveAuthor.name : issue.author?.name
    const authorId = iveAuthor
      ? (iveAuthor.oauthUserId != null ? Number(iveAuthor.oauthUserId) : (issue.author?.id ?? null))
      : (issue.author?.id ?? null)
    const iveAuthorId = iveAuthor ? iveAuthor.id : null
    const authorAvatarUrl = iveAuthor ? null : (issue.author?.avatar_url ?? null)
    const iveAuthorAvatar = iveAuthor
      ? (iveAuthor.avatar === 'photo' ? `/api/auth/avatar/image?id=${iveAuthor.id}` : iveAuthor.avatar)
      : null

    // 검증자/확인자 사전 배정 + 실제 수행자 (이슈 #271)
    const presetRoles = getPresetRoles(projectId, Number(iid))
    const assigneeAuto = getAssigneeAuto(projectId, Number(iid))
    // Git 에서 담당자를 바꾼 검증 중·확인 중 작업 — 스캔을 기다리지 않고 지금 맞춰 화면에 바로 보이게 한다
    try { followGitAssignee(project.provider as 'github' | 'gitlab', projectId, Number(iid), stage, issue.assignees) }
    catch (e) { console.warn(`[Issue] followGitAssignee failed for #${iid}:`, e) }
    const actuals = getActualRoleAssignees(projectId, Number(iid))

    // 자동배정/지정 결과 — 단계별 Git assignee 를 해당 역할의 실제 사람으로 fallback (그 역할을 에이전트가 맡았으면 제외)
    //   verify_waiting/verifying: Git assignee = 검증자 (auto-assign 또는 수동 지정 결과)
    //   confirm_waiting/confirming: Git assignee = 확인자
    const firstAssignee = assignees[0]
    if (!actuals.verifier && firstAssignee && presetRoles.verifier.mode !== 'agent' && (stage === 'verify_waiting' || stage === 'verifying')) {
      actuals.verifier = {
        userId: String(firstAssignee.id),
        name: firstAssignee.name || firstAssignee.username,
        avatar: firstAssignee.avatarUrl || null,
      }
    }
    if (!actuals.confirmer && firstAssignee && presetRoles.confirmer.mode !== 'agent' && (stage === 'confirm_waiting' || stage === 'confirming')) {
      actuals.confirmer = {
        userId: String(firstAssignee.id),
        name: firstAssignee.name || firstAssignee.username,
        avatar: firstAssignee.avatarUrl || null,
      }
    }

    const stageTimes = getIssueStageTimes(projectId, Number(iid))
    const retryCounts = getIssueRetryCounts(projectId, Number(iid))
    const forwardCounts = getIssueForwardCounts(projectId, Number(iid))

    return NextResponse.json({
      iid: issue.iid,
      title: issue.title,
      description: stripIveDueMarker(stripIveAuthorMarker(issue.description || '')),
      state: issue.state,
      stage: stage || 'none',
      assignees,
      labels: issue.labels,
      createdAt: issue.created_at,
      updatedAt: issue.updated_at,
      closedAt: issue.closed_at ?? null,
      dueDate: issue.due_date ?? null,
      stageTimes,
      // 확인 없이 머지로 닫혀 완료가 된 작업 — 화면이 열 때 다시 열지 묻는다
      completedByMerge: stage === 'done' && wasCompletedByMergeClose(projectId, Number(iid)),
      // 검증·확인 도중에 닫힌 작업 — 같은 팝업으로 다시 연다(단계는 그대로)
      closedMidway: issue.state === 'closed' && ['verify_waiting', 'verifying', 'confirm_waiting', 'confirming'].includes(stage as string),
      retryCounts,
      forwardCounts,
      webUrl: issue.web_url,
      author,
      authorId,
      iveAuthorId,    // IVE 사용자 id (ive-author 마커 기반). 로컬 계정 담당자 판정용.
      authorAvatarUrl,
      iveAuthorAvatar,
      assigneeAuto,
      priority: getAssignMode(projectId, Number(iid)).priority,
      // 우선순위는 편집 권한자(뷰어 제외) 누구나 — priority 라우트와 같은 기준
      canEditBody: (() => { const a = getProjectAccess(projectId, user.id); return !!a && a !== 'viewer' })(),
      canEditPriority: (() => { const a = getProjectAccess(projectId, user.id); return !!a && a !== 'viewer' })(),
      presetVerifier: presetRoles.verifier,
      presetConfirmer: presetRoles.confirmer,
      failReason: stage === 'dev_fail' ? getDevFailReason(projectId, Number(iid)) : null,
      stageWorkerNote: (stage === 'done' || issue.state === 'closed') ? null : getStageWorkerNote(projectId, Number(iid)),
          // 확인대기·확인 중인 작업의 배포 상태(스캐너가 구해 둔 값) — 머지 뒤 배포가 끝났는지
          deployState: (stage === 'confirm_waiting' || stage === 'confirming') && issue.state !== 'closed' ? getDeployState(projectId, Number(iid)) : null,
      // 지금 돌고 있는 에이전트 작업 — 있는 동안 화면은 단계 버튼을 막는다(서버도 막는다)
      agentWork: (() => { const w = getRunningAgentWork(projectId, Number(iid)); return w ? { ...w, kind: execKind(w.executionId) } : null })(),
      actualProcessor: actuals.processor,
      actualVerifier: actuals.verifier,
      actualConfirmer: actuals.confirmer,
    })
  } catch (err) {
    return NextResponse.json(
      { error: '이슈 조회 실패' },
      { status: 500 }
    )
  }
}
