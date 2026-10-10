import { NextResponse } from 'next/server'
import { getProject, getProjectAccess, isIssueAssignee } from '@/lib/db'
import { getCurrentUser } from '@/lib/auth'
import { logActivity } from '@/lib/activity'
import { fetchMRByBranch, mergeMR, closeMR } from '@/lib/provider'
import { getProjectTokenCtx, withGitToken, friendlyGitError, type GitTokenCtx } from '@/lib/git-token'
import { watchMergePipeline } from '@/lib/merge-watcher'

/** 머지 후 CI 완료 시 머지한 본인+확인자에게 Slack DM. notify 체크 + 본인 Slack 연결 시에만. */
function startMergeNotifyWatch(
  project: Awaited<ReturnType<typeof getProject>>,
  projectToken: string,
  iid: number,
  user: Awaited<ReturnType<typeof getCurrentUser>>,
) {
  if (!project || !user?.slackUserId) return
  watchMergePipeline(project, projectToken, iid, {
    slackWorkspaceId: project.slackWorkspaceId || '',
    slackUserId: user.slackUserId,
    locale: user.locale === 'en' ? 'en' : 'ko',
  })
}

// 머지는 단순히 MR 을 머지하는 행위만 수행한다.
// 검증 종료(IVE-V → IVE-P 전이, verified_at 기록, 검증자 execution 종결, 확인자 preset 적용)는
// 검증자가 별도로 "검증 통과(approve)" 액션을 눌렀을 때 stage/route.ts 가 처리한다.
// "머지 = 검증 종료" 자동 연결은 의도적으로 끊는다.

export async function GET(_req: Request, { params }: { params: Promise<{ id: string; iid: string }> }) {
  const user = await getCurrentUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { id, iid } = await params
  const project = getProject(id)
  if (!project) return NextResponse.json({ error: 'Not found' }, { status: 404 })

  // MR 조회도 담당자/관리자만 (머지 영역 UI 표시 권한과 동일)
  const access = getProjectAccess(id, user.id)
  if (!access) return NextResponse.json({ error: '이 프로젝트에서 이 작업을 할 권한이 없습니다. 프로젝트 소유자에게 권한을 요청해 주세요.' }, { status: 403 })

  // 권한 체크용 이슈 조회는 프로젝트 토큰 사용 (접속자 권한과 분리).
  // isIssueAssignee 내부에서 fetchSingleIssue 호출.
  const projectCtx: GitTokenCtx = getProjectTokenCtx(project)
  if (!user.isAdmin && !(await isIssueAssignee(project, Number(iid), projectCtx.token, user))) {
    return NextResponse.json({ error: '이 프로젝트에서 이 작업을 할 권한이 없습니다. 프로젝트 소유자에게 권한을 요청해 주세요.' }, { status: 403 })
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
  if (!access) return NextResponse.json({ error: '이 프로젝트에서 이 작업을 할 권한이 없습니다. 프로젝트 소유자에게 권한을 요청해 주세요.' }, { status: 403 })

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
      return NextResponse.json({ error: '이 작업의 MR을 찾지 못했습니다. Git에서 MR이 삭제되었는지 확인해 주세요.' }, { status: 404 })
    }

    // 이미 머지된 상태라면 그냥 성공으로 응답 (사용자가 Git 에서 직접 머지한 경우 대응)
    if (mr.state === 'merged') {
      if (body.notify) startMergeNotifyWatch(project, projectCtx.token, Number(iid), user)
      return NextResponse.json({ success: true, mr, alreadyMerged: true })
    }

    // 2) 실제 머지 — 접속자 토큰 우선. 권한 부족이면 프로젝트 토큰 fallback.
    //    머지만 수행한다. 검증 종료/레이블 전이는 검증자가 별도 "검증 통과" 액션으로 진행.
    try {
      const result = await withGitToken(user, project, (ctx) =>
        mergeMR(project, ctx.token, mr.iid, { isOAuth: ctx.isOAuth })
      )
      logActivity({
        userId: user.id,
        category: 'task',
        action: 'merge_mr',
        detail: `MR 머지: ${project.name} #${iid} (MR !${mr.iid})`,
        targetType: 'mr',
        targetId: `${id}:${mr.iid}`,
        req,
      })
      // 머지 후 CI 완료 시 Slack DM (서버측 감시, 탭이 닫혀도 동작). fire-and-forget.
      if (body.notify) startMergeNotifyWatch(project, projectCtx.token, Number(iid), user)
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
      return NextResponse.json({ error: '이 작업의 MR을 찾지 못했습니다. Git에서 MR이 삭제되었는지 확인해 주세요.' }, { status: 404 })
    }
    if (mr.state !== 'opened') {
      return NextResponse.json({ error: '이미 머지되었거나 닫힌 MR이라 닫을 수 없습니다. 새로고침해 주세요.' }, { status: 400 })
    }

    try {
      const result = await withGitToken(user, project, (ctx) =>
        closeMR(project, ctx.token, mr.iid, { isOAuth: ctx.isOAuth })
      )
      logActivity({
        userId: user.id,
        category: 'task',
        action: 'close_mr',
        detail: `MR 닫기: ${project.name} #${iid} (MR !${mr.iid})`,
        targetType: 'mr',
        targetId: `${id}:${mr.iid}`,
        req,
      })
      return NextResponse.json({ success: true, mr: result })
    } catch (err) {
      return NextResponse.json({ error: friendlyGitError(err, 'MR 닫기') }, { status: 400 })
    }
  }

  return NextResponse.json({ error: '요청이 올바르지 않습니다. 새로고침한 뒤 다시 시도해 주세요.' }, { status: 400 })
}
