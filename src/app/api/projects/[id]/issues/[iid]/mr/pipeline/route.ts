import { NextResponse } from 'next/server'
import { getProject } from '@/lib/db'
import { getCurrentUser } from '@/lib/auth'
import { decrypt } from '@/lib/crypto'
import { fetchMRByBranch, fetchMRPipelines } from '@/lib/provider'

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

  const pipelines = await fetchMRPipelines(project, decryptedToken, mr.iid)

  if (!pipelines || pipelines.length === 0) {
    return NextResponse.json({ pipeline: null })
  }

  // 최신 파이프라인 반환
  const latest = pipelines[0]
  return NextResponse.json({
    pipeline: {
      id: latest.id,
      status: latest.status,
      web_url: latest.web_url,
      created_at: latest.created_at,
      finished_at: latest.finished_at || null,
    },
  })
}
