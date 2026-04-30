import { NextResponse } from 'next/server'
import { getProject, markIssueVerified, touchProjectActivity, getProjectAccess, isIssueAssignee, getDb, updateExecutionStatus, getPresetRoles } from '@/lib/db'
import { triggerScan } from '@/lib/scanner'
import { applyRoleAssignee } from '@/lib/role-assignee'
import { getCurrentUser } from '@/lib/auth'
import { fetchMRByBranch, mergeMR, closeMR, fetchSingleIssue, addIssueLabels, removeIssueLabels } from '@/lib/provider'
import { logActivity } from '@/lib/activity'
import { getProjectTokenCtx, withGitToken, friendlyGitError, type GitTokenCtx } from '@/lib/git-token'
import type { Project, User } from '@/types'

/**
 * 머지 성공 후 현재 단계 레이블(IVE-D/W/V) → IVE-P (확인대기) 로 전환.
 * 머지 = "코드 합쳐짐" 의 의미이며 완료가 아님. 확인자 검수 단계가 남아있다.
 * 레이블 조작 자체도 사용자 권한이 부족하면 실패할 수 있어 withGitToken 사용 (사용자→프로젝트 fallback).
 */
async function syncLabelsToConfirmWait(project: Project, iid: number, user: User, projectId: string) {
  const labelD = project.labelDev || 'IVE-D'
  const labelW = project.labelVerifyWait || 'IVE-W'
  const labelV = project.labelVerify || 'IVE-V'
  const labelP = project.labelConfirmWait || 'IVE-P'
  const labelC = project.labelConfirm || 'IVE-C'
  const labelE = project.labelEnd || 'IVE-E'

  const issue = await withGitToken(user, project, (ctx) => fetchSingleIssue(project, iid, ctx.token))
  if (!issue) return
  const labels: string[] = issue.labels || []
  // 이미 done/confirming/confirm_waiting 이면 머지 동기화는 skip
  if (labels.includes(labelE) || labels.includes(labelC) || labels.includes(labelP)) return

  const labelsToRemove = [labelD, labelW, labelV].filter(l => labels.includes(l))
  if (labelsToRemove.length > 0) {
    await withGitToken(user, project, (ctx) => removeIssueLabels(project, iid, ctx.token, labelsToRemove))
  }
  await withGitToken(user, project, (ctx) => addIssueLabels(project, iid, ctx.token, [labelP]))
  // 검증자 검수 시간(verified_at) 기록 — 검증자가 머지 직후 액션이면 동시에 검증 완료로 본다.
  markIssueVerified(projectId, iid, { name: user.name, avatar: user.avatar, userId: user.id })

  // confirm_waiting 진입 시 확인자 preset 기반 assignee 교체
  try {
    const preset = getPresetRoles(projectId, iid).confirmer
    await withGitToken(user, project, (ctx) => applyRoleAssignee(project, iid, ctx.token, '확인자', preset, { currentUser: user }))
  } catch (e) { console.warn(`[MR] Confirmer preset apply failed for #${iid}:`, e) }

  // 머지 시점에는 dev/verify 단계의 active execution 만 닫는다 (검증자/개발자 작업 완료).
  // 확인 단계 execution 은 사용자가 [확인 시작] 을 눌러야 시작되므로 여기서 새로 만들지 않는다.
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
    detail: `머지 완료 → 확인대기 전환 (이슈 #${iid}, ${project.name})`,
    targetType: 'issue',
    targetId: `${projectId}:${iid}`,
  })

  try {
    triggerScan(projectId)
  } catch (e) {
    console.warn(`[MR] Failed to trigger scanner:`, e)
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

  // 권한 체크용 이슈 조회는 프로젝트 토큰 사용 (접속자 권한과 분리).
  // isIssueAssignee 내부에서 fetchSingleIssue 호출.
  const projectCtx: GitTokenCtx = getProjectTokenCtx(project)
  if (!user.isAdmin && !(await isIssueAssignee(project, Number(iid), projectCtx.token, user))) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  const sourceBranch = `dev-${iid}`
  try {
    const mr = await withGitToken(user, project, (ctx) =>
      fetchMRByBranch(project, ctx.token, sourceBranch, { isOAuth: ctx.isOAuth })
    )
    if (!mr) return NextResponse.json({ mr: null })

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
  } catch (err) {
    return NextResponse.json({ error: friendlyGitError(err, 'MR 조회') }, { status: 500 })
  }
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

  // 권한 체크는 프로젝트 토큰 기반 조회
  const projectCtx: GitTokenCtx = getProjectTokenCtx(project)
  if (!user.isAdmin && !(await isIssueAssignee(project, Number(iid), projectCtx.token, user))) {
    return NextResponse.json(
      { error: '이 이슈의 담당자 또는 관리자만 MR을 머지/처리할 수 있습니다' },
      { status: 403 }
    )
  }

  const body = await req.json()
  const sourceBranch = `dev-${iid}`

  if (body.action === 'merge') {
    // 1) MR 조회 — 접속자 토큰 우선 (권한 있으면 접속자로, 없으면 프로젝트)
    let mr: any
    try {
      mr = await withGitToken(user, project, (ctx) =>
        fetchMRByBranch(project, ctx.token, sourceBranch, { isOAuth: ctx.isOAuth })
      )
    } catch (err) {
      return NextResponse.json({ error: friendlyGitError(err, 'MR 조회') }, { status: 400 })
    }
    if (!mr) {
      return NextResponse.json({ error: 'MR not found' }, { status: 404 })
    }

    // 이미 머지된 상태라면 성공으로 처리 (사용자가 Git에서 직접 머지한 경우 대응)
    if (mr.state === 'merged') {
      console.log(`[MR] Issue #${iid} already merged in Git. Syncing labels...`)
      try {
        await syncLabelsToConfirmWait(project, Number(iid), user, id)
      } catch (err) {
        console.warn(`[MR] Label sync failed for #${iid}:`, err)
      }
      return NextResponse.json({ success: true, mr, alreadyMerged: true })
    }

    // 2) 실제 머지 — 접속자 토큰 우선. 권한 부족이면 프로젝트 토큰 fallback.
    try {
      const result = await withGitToken(user, project, (ctx) =>
        mergeMR(project, ctx.token, mr.iid, { isOAuth: ctx.isOAuth })
      )
      await syncLabelsToConfirmWait(project, Number(iid), user, id)
      return NextResponse.json({ success: true, mr: result })
    } catch (err) {
      return NextResponse.json({ error: friendlyGitError(err, '머지') }, { status: 400 })
    }
  }

  if (body.action === 'close') {
    let mr: any
    try {
      mr = await withGitToken(user, project, (ctx) =>
        fetchMRByBranch(project, ctx.token, sourceBranch, { isOAuth: ctx.isOAuth })
      )
    } catch (err) {
      return NextResponse.json({ error: friendlyGitError(err, 'MR 조회') }, { status: 400 })
    }
    if (!mr) {
      return NextResponse.json({ error: 'MR not found' }, { status: 404 })
    }
    if (mr.state !== 'opened') {
      return NextResponse.json({ error: 'MR is not open' }, { status: 400 })
    }

    try {
      const result = await withGitToken(user, project, (ctx) =>
        closeMR(project, ctx.token, mr.iid, { isOAuth: ctx.isOAuth })
      )
      return NextResponse.json({ success: true, mr: result })
    } catch (err) {
      return NextResponse.json({ error: friendlyGitError(err, 'MR 닫기') }, { status: 400 })
    }
  }

  return NextResponse.json({ error: 'Invalid action' }, { status: 400 })
}
