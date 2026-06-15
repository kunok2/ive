import { NextResponse } from 'next/server'
import { getProject, getProjectAuthToken, getProjectAccess, isIssueAssignee } from '@/lib/db'
import { getCurrentUser } from '@/lib/auth'
import { getMergePipeline } from '@/lib/merge-pipeline'

export async function GET(_req: Request, { params }: { params: Promise<{ id: string; iid: string }> }) {
  const user = await getCurrentUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { id, iid } = await params
  const project = getProject(id)
  if (!project) return NextResponse.json({ error: 'Not found' }, { status: 404 })

  const access = getProjectAccess(id, user.id)
  if (!access) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const token = getProjectAuthToken(id)

  if (!user.isAdmin && !(await isIssueAssignee(project, Number(iid), token, user))) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }
  const pipeline = await getMergePipeline(project, token, Number(iid))
  return NextResponse.json({ pipeline })
}
