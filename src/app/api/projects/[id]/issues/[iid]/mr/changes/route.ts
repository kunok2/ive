import { NextResponse } from 'next/server'
import { getProject } from '@/lib/db'
import { getCurrentUser } from '@/lib/auth'
import { decrypt } from '@/lib/crypto'
import { fetchGitLabMRByBranch, fetchGitLabMRChanges } from '@/lib/gitlab'

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
  const mr = await fetchGitLabMRByBranch(project, decryptedToken, sourceBranch)

  if (!mr) {
    return NextResponse.json({ error: 'MR not found' }, { status: 404 })
  }

  const changes = await fetchGitLabMRChanges(project, decryptedToken, mr.iid)
  if (!changes) {
    return NextResponse.json({ error: 'Failed to fetch changes' }, { status: 500 })
  }

  return NextResponse.json({
    mr: {
      iid: mr.iid,
      title: mr.title,
      state: mr.state,
      source_branch: mr.source_branch,
      target_branch: mr.target_branch,
      has_conflicts: mr.has_conflicts,
      web_url: mr.web_url,
    },
    changes: (changes.changes || []).map((c: any) => ({
      old_path: c.old_path,
      new_path: c.new_path,
      new_file: c.new_file,
      renamed_file: c.renamed_file,
      deleted_file: c.deleted_file,
      diff: c.diff,
    })),
  })
}
