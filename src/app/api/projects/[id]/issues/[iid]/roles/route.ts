import { NextResponse } from 'next/server'
import { getCurrentUser } from '@/lib/auth'
import { logActivity } from '@/lib/activity'
import {
  getProjectAuthToken, isIssueAuthor, getRoleCandidates, getStageWorkerNote, getIssueAutomationApproval,
  approveIssueAutomation, markRolesInitialized, getAgent, stageFromLabels, hasActiveExecution, setStageWorkerNote,
} from '@/lib/db'
import { fetchSingleIssue } from '@/lib/provider'
import { checkProjectSettingsAccess } from '@/lib/project-permissions'
import { getIssueRoles, autoAssignAllAgents } from '@/lib/role-assignment'
import { isAutomationAllowed } from '@/lib/scanner/stage-dispatch'
import { DEFAULT_LABELS } from '@/lib/labels'

/**
 * 이슈의 세 역할(처리자·검증자·확인자) — 한 번에 보기, 「모든 단계 자동배정」, 외부 작성자 이슈 자동 실행 승인.
 * 개별 역할 변경은 기존 경로를 쓴다(처리자: preferred-agent, 검증자·확인자: preset-roles).
 */
export async function GET(_req: Request, { params }: { params: Promise<{ id: string; iid: string }> }) {
  const user = await getCurrentUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const { id, iid } = await params
  const acc = checkProjectSettingsAccess(id, user.id)
  if ('error' in acc) return NextResponse.json({ error: acc.error }, { status: acc.status })

  const pick = (role: 'process' | 'verify' | 'confirm') => getRoleCandidates(id, role).map(c => ({
    subjectType: c.subjectType, subjectId: c.subjectId, name: c.name, avatar: c.avatar,
    gitUserId: c.gitUserId, cliName: c.cliName ?? null, enabled: c.enabled ?? true,
  }))
  let allowed: { ok: boolean; author: string | null } = { ok: true, author: null }
  try {
    const issue = await fetchSingleIssue(acc.project, Number(iid), getProjectAuthToken(id))
    if (issue) allowed = isAutomationAllowed(acc.project, Number(iid), issue)
  } catch { /* 조회 실패 — 표시만 생략 */ }
  const approval = getIssueAutomationApproval(id, Number(iid))
  return NextResponse.json({
    roles: getIssueRoles(id, Number(iid)),
    candidates: { process: pick('process'), verify: pick('verify'), confirm: pick('confirm') },
    workerNote: getStageWorkerNote(id, Number(iid)),
    automation: { allowed: allowed.ok, author: allowed.author, approvedAt: approval.approvedAt },
    canApprove: acc.canEdit,
  })
}

export async function POST(req: Request, { params }: { params: Promise<{ id: string; iid: string }> }) {
  const user = await getCurrentUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const { id, iid } = await params
  const acc = checkProjectSettingsAccess(id, user.id)
  if ('error' in acc) return NextResponse.json({ error: acc.error }, { status: acc.status })
  const project = acc.project
  const body = await req.json().catch(() => ({}))
  const token = getProjectAuthToken(id)

  if (body.action === 'approve_automation') {
    if (!acc.canEdit && !user.isAdmin) return NextResponse.json({ error: '소유자 또는 편집 권한자만 승인할 수 있습니다' }, { status: 403 })
    approveIssueAutomation(id, Number(iid), user.id)
    logActivity({ userId: user.id, category: 'task', action: 'approve_automation', detail: `자동 실행 승인: ${project.name} #${iid}`, targetType: 'issue', targetId: `${id}:${iid}`, req })
    return NextResponse.json({ ok: true })
  }

  if (body.action === 'auto_all') {
    // 역할 변경 권한: 기존 검증자·확인자 사전배정(preset-roles)과 같은 기준 — 관리자 또는 이슈 작성자
    if (!user.isAdmin && !(await isIssueAuthor(project, Number(iid), token, user))) {
      return NextResponse.json({ error: '이 이슈의 작성자 또는 관리자만 바꿀 수 있습니다' }, { status: 403 })
    }
    const issue = await fetchSingleIssue(project, Number(iid), token)
    const labelEnd = project.labelEnd || DEFAULT_LABELS.end
    if (issue && (issue.state === 'closed' || (issue.labels || []).includes(labelEnd))) {
      return NextResponse.json({ error: '완료된 작업은 역할을 바꿀 수 없습니다' }, { status: 409 })
    }
    // 처리 중(dev)에는 작업자 변경 불가 — preferred-agent 와 같은 규칙
    if (issue && stageFromLabels(issue.labels || [], project, { hasActiveExec: hasActiveExecution(id, Number(iid)) }) === 'dev') {
      return NextResponse.json({ error: '실행 중인 이슈는 작업자를 변경할 수 없습니다.' }, { status: 400 })
    }
    const out = autoAssignAllAgents(id, Number(iid), { isKo: user.locale !== 'en' })
    markRolesInitialized(id, Number(iid))
    // 이번 자동배정의 안내만 남긴다(이전 안내는 지운다)
    setStageWorkerNote(id, Number(iid), out.warnings.length ? out.warnings.join(' / ') : null)
    const names = [out.processor, out.verifier, out.confirmer].map(a => (a ? getAgent(a)?.name || a : '-'))
    logActivity({
      userId: user.id, category: 'task', action: 'auto_assign_all',
      detail: `모든 단계 자동배정: ${project.name} #${iid} (처리=${names[0]}, 검증=${names[1]}, 확인=${names[2]})`,
      targetType: 'issue', targetId: `${id}:${iid}`, req,
    })
    return NextResponse.json({ ...out, roles: getIssueRoles(id, Number(iid)) })
  }

  return NextResponse.json({ error: '요청이 올바르지 않습니다. 새로고침한 뒤 다시 시도해 주세요.' }, { status: 400 })
}
