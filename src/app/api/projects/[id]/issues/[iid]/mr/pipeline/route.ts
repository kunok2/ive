import { NextResponse } from 'next/server'
import { getProject } from '@/lib/db'
import { getCurrentUser } from '@/lib/auth'
import { decrypt } from '@/lib/crypto'
import { fetchMRByBranch, fetchBranchPipelines } from '@/lib/provider'

export async function GET(_req: Request, { params }: { params: Promise<{ id: string; iid: string }> }) {
  const user = await getCurrentUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { id, iid } = await params
  const project = getProject(id)
  if (!project || project.userId !== user.id) {
    return NextResponse.json({ error: 'Not found' }, { status: 404 })
  }

  const decryptedToken = decrypt(project.accessToken)
  const sourceBranch = `dev-${iid}`
  const mr = await fetchMRByBranch(project, decryptedToken, sourceBranch)

  if (!mr) {
    return NextResponse.json({ pipeline: null })
  }

  // 머지된 MR → merge_commit_sha로 해당 머지의 파이프라인만 특정
  const mergeSha = mr.merge_commit_sha
  const targetBranch = mr.target_branch || 'main'
  const pipelines = await fetchBranchPipelines(project, decryptedToken, targetBranch)

  if (!pipelines || pipelines.length === 0) {
    return NextResponse.json({ pipeline: null })
  }

  // merge_commit_sha가 있으면 해당 SHA의 파이프라인만 매칭
  const matched = mergeSha
    ? pipelines.find((p: any) => p.sha === mergeSha)
    : pipelines[0]

  if (!matched) {
    return NextResponse.json({ pipeline: null })
  }

  return NextResponse.json({
    pipeline: {
      id: matched.id,
      status: matched.status,
      web_url: matched.web_url,
      created_at: matched.created_at,
      finished_at: matched.finished_at || null,
    },
  })
}
