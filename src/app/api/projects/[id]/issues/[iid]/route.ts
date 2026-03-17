import { NextRequest, NextResponse } from 'next/server'
import { getProject } from '@/lib/db'
import { decrypt } from '@/lib/crypto'

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string; iid: string }> }
) {
  const { id: projectId, iid } = await params
  const project = getProject(projectId)
  if (!project) return NextResponse.json({ error: 'Project not found' }, { status: 404 })

  try {
    const decryptedToken = decrypt(project.accessToken)

    // GitLab API에서 단일 이슈 직접 조회 (열린/닫힌 이슈 모두)
    const { getApiBaseUrl, getProjectPath, getAuthHeaders } = await import('@/lib/gitlab')
    const base = getApiBaseUrl(project.repoUrl)
    const projectPath = getProjectPath(project.repoUrl)
    const headers = getAuthHeaders(project, decryptedToken)

    const res = await fetch(`${base}/projects/${projectPath}/issues/${iid}`, { headers })
    if (!res.ok) {
      if (res.status === 404) return NextResponse.json({ error: '이슈를 찾을 수 없습니다' }, { status: 404 })
      throw new Error(`GitLab API 오류: ${res.statusText}`)
    }

    const issue = await res.json()

    // stage 정보 부여
    const stageMap: Record<string, string> = {
      [project.labelTarget]: 'waiting',
      [project.labelInProgress]: 'dev',
      [project.labelFailDev]: 'dev_fail',
      [project.labelDone]: 'done',
    }
    const iveLabels = [project.labelTarget, project.labelInProgress, project.labelFailDev, project.labelDone]

    let stage = 'unknown'
    const issueLabels = issue.labels || []
    for (const label of issueLabels) {
      if (stageMap[label]) {
        stage = stageMap[label]
        break
      }
    }
    if (stage === 'unknown') {
      const hasIveLabel = issueLabels.some((l: string) => iveLabels.includes(l))
      if (!hasIveLabel) stage = 'waiting'
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
