import { NextResponse } from 'next/server'
import { getProject, getProjectAccess, isIssueAssignee } from '@/lib/db'
import { getCurrentUser } from '@/lib/auth'
import { fetchMRByBranch, mergeMR, closeMR } from '@/lib/provider'
import { getProjectTokenCtx, withGitToken, friendlyGitError, type GitTokenCtx } from '@/lib/git-token'

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

    // 이미 머지된 상태라면 그냥 성공으로 응답 (사용자가 Git 에서 직접 머지한 경우 대응)
    if (mr.state === 'merged') {
      return NextResponse.json({ success: true, mr, alreadyMerged: true })
    }

    // 2) 실제 머지 — 접속자 토큰 우선. 권한 부족이면 프로젝트 토큰 fallback.
    //    머지만 수행한다. 검증 종료/레이블 전이는 검증자가 별도 "검증 통과" 액션으로 진행.
    try {
      const result = await withGitToken(user, project, (ctx) =>
        mergeMR(project, ctx.token, mr.iid, { isOAuth: ctx.isOAuth })
      )
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
