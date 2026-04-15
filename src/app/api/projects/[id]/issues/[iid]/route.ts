import { NextRequest, NextResponse } from 'next/server'
import { getProject, getProjectAccess, getProjectAuthToken, hasActiveExecution, stageFromLabels } from '@/lib/db'
import { getCurrentUser } from '@/lib/auth'
import { updateIssue, fetchSingleIssue } from '@/lib/provider'

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

    return NextResponse.json({
      iid: issue.iid,
      title: issue.title,
      description: issue.description,
      state: issue.state,
      stage: stage || 'none',
      assignees,
      labels: issue.labels,
      createdAt: issue.created_at,
      updatedAt: issue.updated_at,
      webUrl: issue.web_url,
      author: issue.author?.name,
    })
  } catch (err) {
    return NextResponse.json(
      { error: '이슈 조회 실패' },
      { status: 500 }
    )
  }
}
