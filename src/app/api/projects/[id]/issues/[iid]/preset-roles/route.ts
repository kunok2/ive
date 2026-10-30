import { NextRequest, NextResponse } from 'next/server'
import { getProject, getProjectAccess, getPresetRoles, setPresetRoles, isIssueAuthor, getProjectAuthToken, hasRole, getAssignMode, markRolesInitialized, setStageWorkerNote } from '@/lib/db'
import { violatesSelfReview, agentRoleAvailable } from '@/lib/role-assignment'
import { getCurrentUser } from '@/lib/auth'
import { logActivity } from '@/lib/activity'
import { fetchSingleIssue, updateIssue, fetchProjectMembers } from '@/lib/provider'
import { stagePersonFromGit, hasOpenHumanStageExec, moveOpenStageExecs, type StagePerson } from '@/lib/stage-person'
import { runAutoAssign } from '@/lib/scanner/auto-assign'
import { DEFAULT_LABELS } from '@/lib/labels'

/**
 * 이슈의 검증자/확인자 사전 배정(preset)을 갱신한다.
 *
 * Body 형태 (둘 중 한 쪽 또는 둘 다 보낼 수 있음):
 *   {
 *     verifier?:  { mode: 'creator' | 'auto' | 'specific' | 'agent', userId?, username?, agentId? }
 *     confirmer?: { mode: 'creator' | 'auto' | 'specific' | 'agent', userId?, username?, agentId? }
 *   }
 *
 * 권한: 프로젝트 접근 + (관리자 OR 이슈 작성자) — 검증자/확인자 사전배정은 작성자가 결정.
 */
export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string; iid: string }> }
) {
  const user = await getCurrentUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { id: projectId, iid } = await params
  const project = getProject(projectId)
  if (!project) return NextResponse.json({ error: '프로젝트를 찾을 수 없습니다. 삭제되었을 수 있습니다 — 새로고침해 주세요.' }, { status: 404 })

  if (!getProjectAccess(projectId, user.id)) {
    return NextResponse.json({ error: '이 프로젝트에서 이 작업을 할 권한이 없습니다. 프로젝트 소유자에게 권한을 요청해 주세요.' }, { status: 403 })
  }

  // 권한 체크: 관리자 또는 이슈 작성자
  const token = getProjectAuthToken(projectId)
  if (!user.isAdmin && !(await isIssueAuthor(project, Number(iid), token, user))) {
    return NextResponse.json({ error: '이 이슈의 작성자 또는 관리자만 수정할 수 있습니다' }, { status: 403 })
  }

  // 완료된 작업은 검증자/확인자 변경 금지 — 통계/보고서 일관성 보호.
  const issueNow = await fetchSingleIssue(project, Number(iid), token)
  if (issueNow) {
    const labelEnd = project.labelEnd || DEFAULT_LABELS.end
    if (issueNow.state === 'closed' || (issueNow.labels || []).includes(labelEnd)) {
      return NextResponse.json({ error: '완료된 작업은 검증자/확인자를 변경할 수 없습니다' }, { status: 409 })
    }
  }

  const body = await req.json()
  const current = getPresetRoles(projectId, Number(iid))

  const sanitize = (input: any, fallback: typeof current.verifier, role: 'verify' | 'confirm') => {
    if (!input) return fallback
    const mode = input.mode === 'auto' || input.mode === 'specific' || input.mode === 'agent' ? input.mode : 'creator'
    if (mode === 'specific') {
      return {
        mode: 'specific' as const,
        userId: input.userId ? String(input.userId) : null,
        username: input.username ? String(input.username) : null,
        agentId: null,
      }
    }
    if (mode === 'agent') {
      // 에이전트는 역할 명부에서 그 역할을 가진 것만
      const agentId = input.agentId ? String(input.agentId) : ''
      if (!agentRoleAvailable(role)) throw new Error('검증 에이전트 작업자는 아직 없어 검증자를 에이전트로 지정할 수 없습니다')
      if (!agentId || !hasRole(projectId, role, 'agent', agentId)) throw new Error(`명부에 ${role === 'verify' ? '검증' : '확인'} 역할로 올라 있는 에이전트만 지정할 수 있습니다`)
      return { mode: 'agent' as const, userId: null, username: null, agentId }
    }
    return { mode, userId: null, username: null, agentId: null }
  }

  let next: { verifier: ReturnType<typeof sanitize>; confirmer: ReturnType<typeof sanitize> }
  try {
    next = {
      verifier: sanitize(body.verifier, current.verifier, 'verify'),
      confirmer: sanitize(body.confirmer, current.confirmer, 'confirm'),
    }
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 400 })
  }
  // 자기 작업을 자기가 검수하지 않는다
  const proc = getAssignMode(projectId, Number(iid))
  if (proc.mode === 'agent' && violatesSelfReview(proc.agentId, next.verifier)) {
    return NextResponse.json({ error: '처리자와 같은 에이전트를 검증자로 지정할 수 없습니다' }, { status: 400 })
  }

  // 검증 중·확인 중(사람이 연 기록이 있음)에는 화면의 검증자·확인자가 그 기록의 사람이라 규칙만 바꿔서는 반영되지 않는다 —
  // 새 사람으로 그 기록과 Git 담당자를 함께 옮긴다. IVE 계정이 없는 Git 사람이어도 된다.
  // 에이전트로의 교체는 취소·기동이 필요한 stage-agent 경로로 안내한다.
  const provider = project.provider as 'github' | 'gitlab'
  let members: Awaited<ReturnType<typeof fetchProjectMembers>> | null = null
  const memberOf = async (id: string | null, username: string | null) => {
    members ??= await fetchProjectMembers(project, token).catch(() => [])
    return members.find((m: any) => (id && String(m.id) === id) || (username && String(m.username).toLowerCase() === username.toLowerCase())) ?? null
  }
  const moves: { kind: 'verify' | 'confirm'; person: StagePerson; syncGit: boolean }[] = []
  for (const kind of ['verify', 'confirm'] as const) {
    const role = kind === 'verify' ? next.verifier : next.confirmer
    if (!(kind === 'verify' ? body.verifier : body.confirmer) || !hasOpenHumanStageExec(projectId, Number(iid), kind)) continue
    const roleName = kind === 'verify' ? '검증' : '확인'
    if (role.mode === 'agent') {
      return NextResponse.json({ error: `${roleName} 중인 작업의 ${roleName}을 에이전트에게 맡기려면 「에이전트에게 맡기기」를 사용해 주세요` }, { status: 409 })
    }
    let person: StagePerson | null = null
    if (role.mode === 'specific') {
      person = stagePersonFromGit(provider, (await memberOf(role.userId, role.username)) ?? { id: role.userId, username: role.username })
    } else if (role.mode === 'creator') {
      person = stagePersonFromGit(provider, issueNow?.author as any)
    } else if (role.mode === 'auto') {
      // 자동배정은 고르면서 Git 담당자도 바꾼다
      const r = await runAutoAssign(project, Number(iid), token, kind).catch(() => null)
      if (r) person = stagePersonFromGit(provider, (await memberOf(null, r.username)) ?? { username: r.username, name: r.name })
    }
    if (!person) {
      return NextResponse.json({ error: `새 ${roleName}자를 찾지 못해 바꾸지 못했습니다. 화면을 새로고침한 뒤 다시 골라 주세요.` }, { status: 400 })
    }
    moves.push({ kind, person, syncGit: role.mode !== 'auto' })
  }
  // 바꿀 사람을 모두 찾은 뒤에 Git 담당자를 옮긴다 — 실패로 끝나는 요청이 Git 담당자만 바꿔 두지 않게
  for (const m of moves) {
    if (!m.syncGit) continue
    try {
      await updateIssue(project, Number(iid), token, {
        assigneeIds: m.person.gitUserId ? [Number(m.person.gitUserId)] : undefined,
        assignees: m.person.username ? [m.person.username] : undefined,
      })
    } catch (e) { console.warn(`[PresetRoles] ${m.kind} assignee sync failed for #${iid}:`, e) }
  }

  setPresetRoles(projectId, Number(iid), next)
  for (const m of moves) moveOpenStageExecs(projectId, Number(iid), m.kind, m.person)
  // 사람이 직접 정한 역할 — 프로젝트 기본 배정이 덮어쓰지 않게
  markRolesInitialized(projectId, Number(iid))
  setStageWorkerNote(projectId, Number(iid), null)   // 역할을 다시 정했으니 이전 안내(배정 불가 등)는 지운다
  logActivity({
    userId: user.id,
    category: 'task',
    action: 'update_preset_roles',
    detail: `검증자/확인자 사전배정 변경: ${project.name} #${iid} (검증=${next.verifier.mode}, 확인=${next.confirmer.mode})`,
    targetType: 'issue',
    targetId: `${projectId}:${iid}`,
    req,
  })
  const saved = getPresetRoles(projectId, Number(iid))
  return NextResponse.json({ verifier: saved.verifier, confirmer: saved.confirmer })
}
