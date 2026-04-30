import { NextRequest, NextResponse } from 'next/server'
import { getProject, getProjectAccess, getProjectAuthToken, hasActiveExecution, stageFromLabels, getPresetRoles, getAssigneeAuto, getActualRoleAssignees, getIssueStageTimes, getIssueRetryCounts, getIssueForwardCounts } from '@/lib/db'
import { getCurrentUser } from '@/lib/auth'
import { updateIssue, fetchSingleIssue } from '@/lib/provider'
import { resolveIveAuthorFromBody, stripIveAuthorMarker } from '@/lib/ive-author'

export async function PUT(
  req: NextRequest,
  { params }: { params: Promise<{ id: string; iid: string }> }
) {
  const user = await getCurrentUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { id: projectId, iid } = await params
  const project = getProject(projectId)
  if (!project) return NextResponse.json({ error: 'Project not found' }, { status: 404 })

  const access = getProjectAccess(projectId, user.id)
  if (!access || access === 'viewer') {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  try {
    const { title, description } = await req.json()
    if (!title?.trim()) {
      return NextResponse.json({ error: '제목은 필수입니다' }, { status: 400 })
    }
    const token = getProjectAuthToken(projectId)
    const updated = await updateIssue(project, Number(iid), token, {
      title: title.trim(),
      description: description ?? '',
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
  if (!project) return NextResponse.json({ error: 'Project not found' }, { status: 404 })

  if (!getProjectAccess(projectId, user.id)) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  try {
    const token = getProjectAuthToken(projectId)

    const issue = await fetchSingleIssue(project, Number(iid), token)
    if (!issue) return NextResponse.json({ error: '이슈를 찾을 수 없습니다' }, { status: 404 })

    // 레이블에서 stage 판정
    const issueLabels = issue.labels || []
    const activeExec = hasActiveExecution(projectId, Number(iid))
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
    const actuals = getActualRoleAssignees(projectId, Number(iid))

    // 자동배정/지정 결과 — 단계별 Git assignee 를 해당 역할의 실제 사람으로 fallback
    //   verify_waiting/verifying: Git assignee = 검증자 (auto-assign 또는 수동 지정 결과)
    //   confirm_waiting/confirming: Git assignee = 확인자
    const firstAssignee = assignees[0]
    if (!actuals.verifier && firstAssignee && (stage === 'verify_waiting' || stage === 'verifying')) {
      actuals.verifier = {
        userId: String(firstAssignee.id),
        name: firstAssignee.name || firstAssignee.username,
        avatar: firstAssignee.avatarUrl || null,
      }
    }
    if (!actuals.confirmer && firstAssignee && (stage === 'confirm_waiting' || stage === 'confirming')) {
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
      description: stripIveAuthorMarker(issue.description || ''),
      state: issue.state,
      stage: stage || 'none',
      assignees,
      labels: issue.labels,
      createdAt: issue.created_at,
      updatedAt: issue.updated_at,
      closedAt: issue.closed_at ?? null,
      stageTimes,
      retryCounts,
      forwardCounts,
      webUrl: issue.web_url,
      author,
      authorId,
      iveAuthorId,    // IVE 사용자 id (ive-author 마커 기반). 로컬 계정 담당자 판정용.
      authorAvatarUrl,
      iveAuthorAvatar,
      assigneeAuto,
      presetVerifier: presetRoles.verifier,
      presetConfirmer: presetRoles.confirmer,
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
