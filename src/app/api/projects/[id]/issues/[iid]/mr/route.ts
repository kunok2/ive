import { NextResponse } from 'next/server'
import { getProject, getProjectAuthToken, markIssueVerified, touchProjectActivity, getProjectAccess, isIssueAssignee, getDb, updateExecutionStatus } from '@/lib/db'
import { getCurrentUser } from '@/lib/auth'
import { fetchMRByBranch, mergeMR, closeMR, fetchSingleIssue, addIssueLabels, removeIssueLabels } from '@/lib/provider'
import { logActivity } from '@/lib/activity'
import type { Project, User } from '@/types'

async function syncLabelsToDone(project: Project, iid: number, token: string, user: any, projectId: string) {
  const labelD = project.labelDev || 'IVE-D'
  const labelW = project.labelVerifyWait || 'IVE-W'
  const labelV = project.labelVerify || 'IVE-V'
  const labelE = project.labelEnd || 'IVE-E'

  const issue = await fetchSingleIssue(project, iid, token)
  if (issue) {
    const labels: string[] = issue.labels || []
    if (!labels.includes(labelE)) {
      const labelsToRemove = [labelD, labelW, labelV].filter(l => labels.includes(l))
      if (labelsToRemove.length > 0) {
        await removeIssueLabels(project, iid, token, labelsToRemove)
      }
      await addIssueLabels(project, iid, token, [labelE])
      markIssueVerified(projectId, iid, { name: user.name, avatar: user.avatar, userId: user.id })

      // 이 이슈에 남아 있는 활성(running/assigned) execution 모두 success로 닫기
      // (검증자 execution, 담당자 dev execution 등 — 머지 완료 = 검증 승인과 동일)
      const db = getDb()
      const activeExecs = db.prepare(
        "SELECT id FROM task_executions WHERE project_id = ? AND issue_iid = ? AND status IN ('running', 'assigned')"
      ).all(projectId, iid) as { id: string }[]
      for (const ex of activeExecs) {
        updateExecutionStatus(ex.id, 'success', new Date().toISOString())
      }

      touchProjectActivity(projectId)
      logActivity({
        userId: user.id,
        category: 'task',
        action: 'task_complete',
        detail: `머지 완료 → 자동 완료 전환 (이슈 #${iid}, ${project.name})`,
        targetType: 'issue',
        targetId: `${projectId}:${iid}`,
      })
    }
  }
}

export async function GET(_req: Request, { params }: { params: Promise<{ id: string; iid: string }> }) {
  const user = await getCurrentUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { id, iid } = await params
  const project = getProject(id)
  if (!project) return NextResponse.json({ error: 'Not found' }, { status: 404 })

  // MR 조회도 담당자/관리자만 (머지 영역 UI 표시 권한과 동일)
  const access = getProjectAccess(id, user.id)
  if (!access) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  if (!user.isAdmin && !isIssueAssignee(id, Number(iid), user)) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  const token = getProjectAuthToken(id)
  const sourceBranch = `dev-${iid}`
  const mr = await fetchMRByBranch(project, token, sourceBranch)

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
  if (!project) return NextResponse.json({ error: 'Not found' }, { status: 404 })

  // 머지/MR 액션은 관리자 또는 이슈 담당자만
  // (viewer 권한이어도 자기에게 할당된 이슈의 MR은 처리할 수 있어야 함)
  const access = getProjectAccess(id, user.id)
  if (!access) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  if (!user.isAdmin && !isIssueAssignee(id, Number(iid), user)) {
    return NextResponse.json(
      { error: '이 이슈의 담당자 또는 관리자만 MR을 머지/처리할 수 있습니다' },
      { status: 403 }
    )
  }

  const body = await req.json()

  if (body.action === 'merge') {
    const token = getProjectAuthToken(id)
    const sourceBranch = `dev-${iid}`
    const mr = await fetchMRByBranch(project, token, sourceBranch)
    if (!mr) {
      return NextResponse.json({ error: 'MR not found' }, { status: 404 })
    }

    // 이미 머지된 상태라면 성공으로 처리 (사용자가 Git에서 직접 머지한 경우 대응)
    if (mr.state === 'merged') {
      console.log(`[MR] Issue #${iid} already merged in Git. Syncing labels...`)
      try {
        await syncLabelsToDone(project, Number(iid), token, user, id)
      } catch (err) {
        console.warn(`[MR] Label sync failed for #${iid}:`, err)
      }
      return NextResponse.json({ success: true, mr, alreadyMerged: true })
    }

    try {
      const result = await mergeMR(project, token, mr.iid)

      // 머지 성공 시 현재 단계(IVE-D/IVE-W/IVE-V) → IVE-E 레이블 자동 전환
      await syncLabelsToDone(project, Number(iid), token, user, id)

      return NextResponse.json({ success: true, mr: result })
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      return NextResponse.json({ error: msg }, { status: 400 })
    }
  }

  if (body.action === 'close') {
    const token = getProjectAuthToken(id)
    const sourceBranch = `dev-${iid}`
    const mr = await fetchMRByBranch(project, token, sourceBranch)
    if (!mr) {
      return NextResponse.json({ error: 'MR not found' }, { status: 404 })
    }
    if (mr.state !== 'opened') {
      return NextResponse.json({ error: 'MR is not open' }, { status: 400 })
    }

    try {
      const result = await closeMR(project, token, mr.iid)
      return NextResponse.json({ success: true, mr: result })
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      return NextResponse.json({ error: msg }, { status: 400 })
    }
  }

  return NextResponse.json({ error: 'Invalid action' }, { status: 400 })
}
