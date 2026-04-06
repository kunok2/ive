import { NextResponse } from 'next/server'
import { getProject, markIssueVerified, touchProjectActivity } from '@/lib/db'
import { getCurrentUser } from '@/lib/auth'
import { decrypt } from '@/lib/crypto'
import { fetchMRByBranch, mergeMR, closeMR, fetchSingleIssue, addIssueLabels, removeIssueLabels } from '@/lib/provider'
import { logActivity } from '@/lib/activity'

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
    return NextResponse.json({ mr: null })
  }

  return NextResponse.json({
    mr: {
      iid: mr.iid,
      title: mr.title,
      state: mr.state,
      source_branch: mr.source_branch,
      target_branch: mr.target_branch,
      merge_status: mr.merge_status,
      has_conflicts: mr.has_conflicts,
      web_url: mr.web_url,
      changes_count: mr.changes_count,
      user_notes_count: mr.user_notes_count,
      created_at: mr.created_at,
      merged_at: mr.merged_at,
      merged_by: mr.merged_by,
      diff_refs: mr.diff_refs,
      projectName: project.name,
    },
  })
}

export async function POST(req: Request, { params }: { params: Promise<{ id: string; iid: string }> }) {
  const user = await getCurrentUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { id, iid } = await params
  const project = getProject(id)
  if (!project || project.userId !== user.id) {
    return NextResponse.json({ error: 'Not found' }, { status: 404 })
  }

  const body = await req.json()

  if (body.action === 'merge') {
    const decryptedToken = decrypt(project.accessToken)
    const sourceBranch = `dev-${iid}`
    const mr = await fetchMRByBranch(project, decryptedToken, sourceBranch)
    if (!mr) {
      return NextResponse.json({ error: 'MR not found' }, { status: 404 })
    }

    try {
      const result = await mergeMR(project, decryptedToken, mr.iid)

      // 머지 성공 시 IVE-V → IVE-E 레이블 자동 전환
      try {
        const labelV = project.labelVerify || 'IVE-V'
        const labelE = project.labelEnd || 'IVE-E'
        const issue = await fetchSingleIssue(project, Number(iid), decryptedToken)
        if (issue) {
          const labels: string[] = issue.labels || []
          if (labels.includes(labelV) && !labels.includes(labelE)) {
            await removeIssueLabels(project, Number(iid), decryptedToken, [labelV])
            await addIssueLabels(project, Number(iid), decryptedToken, [labelE])
            markIssueVerified(id, Number(iid))
            touchProjectActivity(id)
            logActivity({
              userId: user.id,
              category: 'task',
              action: 'task_complete',
              detail: `머지 완료 → 자동 전환 (이슈 #${iid}, ${project.name})`,
              targetType: 'issue',
              targetId: `${id}:${iid}`,
            })
          }
        }
      } catch (labelErr) {
        console.error(`[MR] 이슈 #${iid} 레이블 전환 실패:`, labelErr)
      }

      return NextResponse.json({ success: true, mr: result })
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      return NextResponse.json({ error: msg }, { status: 400 })
    }
  }

  if (body.action === 'close') {
    const decryptedToken = decrypt(project.accessToken)
    const sourceBranch = `dev-${iid}`
    const mr = await fetchMRByBranch(project, decryptedToken, sourceBranch)
    if (!mr) {
      return NextResponse.json({ error: 'MR not found' }, { status: 404 })
    }
    if (mr.state !== 'opened') {
      return NextResponse.json({ error: 'MR is not open' }, { status: 400 })
    }

    try {
      const result = await closeMR(project, decryptedToken, mr.iid)
      return NextResponse.json({ success: true, mr: result })
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      return NextResponse.json({ error: msg }, { status: 400 })
    }
  }

  return NextResponse.json({ error: 'Invalid action' }, { status: 400 })
}
