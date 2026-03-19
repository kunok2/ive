import { NextRequest, NextResponse } from 'next/server'
import { getProject, getIssueStage, setIssueStage } from '@/lib/db'
import { decrypt } from '@/lib/crypto'
import { updateIssue, fetchSingleIssue } from '@/lib/provider'

export async function PUT(
  req: NextRequest,
  { params }: { params: Promise<{ id: string; iid: string }> }
) {
  const { id: projectId, iid } = await params
  const project = getProject(projectId)
  if (!project) return NextResponse.json({ error: 'Project not found' }, { status: 404 })

  try {
    const { title, description } = await req.json()
    if (!title?.trim()) {
      return NextResponse.json({ error: '제목은 필수입니다' }, { status: 400 })
    }
    const decryptedToken = decrypt(project.accessToken)
    const updated = await updateIssue(project, Number(iid), decryptedToken, {
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
      { error: err instanceof Error ? err.message : '이슈 수정 실패' },
      { status: 500 }
    )
  }
}

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string; iid: string }> }
) {
  const { id: projectId, iid } = await params
  const project = getProject(projectId)
  if (!project) return NextResponse.json({ error: 'Project not found' }, { status: 404 })

  try {
    const decryptedToken = decrypt(project.accessToken)

    const issue = await fetchSingleIssue(project, Number(iid), decryptedToken)
    if (!issue) return NextResponse.json({ error: '이슈를 찾을 수 없습니다' }, { status: 404 })

    // 로컬 DB에서 stage 조회 (상태는 로컬 DB로만 관리)
    let stage = getIssueStage(projectId, Number(iid))
    if (!stage) {
      const issueLabels = issue.labels || []
      if (issueLabels.includes(project.labelTarget)) {
        stage = 'waiting'
        setIssueStage(projectId, Number(iid), 'waiting')
      }
    }

    return NextResponse.json({
      iid: issue.iid,
      title: issue.title,
      description: issue.description,
      state: issue.state,
      stage,
      labels: issue.labels,
      createdAt: issue.created_at,
      updatedAt: issue.updated_at,
      webUrl: issue.web_url,
      author: issue.author?.name,
    })
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : '이슈 조회 실패' },
      { status: 500 }
    )
  }
}
