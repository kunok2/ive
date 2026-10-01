import { NextResponse } from 'next/server'
import { getCurrentUser } from '@/lib/auth'
import { logActivity } from '@/lib/activity'
import { getRoster, setRosterEntry, setRosterRates, getDb, type RoleKey } from '@/lib/db'
import { checkProjectSettingsAccess, rosterEligibleAgents } from '@/lib/project-permissions'
import { agentRoleAvailable } from '@/lib/role-assignment'

/**
 * 프로젝트 역할 명부 — 누가(사람·에이전트) 처리·검증·확인을 할 수 있는가.
 * GET : 명부 + 추가할 수 있는 후보(Git 멤버, 소유자·editor 의 에이전트)
 * PUT : 한 대상의 역할 저장 { subjectType, subjectId, roles: { process, verify, confirm } }
 *       사람의 역할별 단가 배수 저장 { subjectType: 'user', subjectId, rates: { process?, verify?, confirm? } } — 이 프로젝트에서 그 역할을 할 때 (기본 단가 × 배수)
 */
export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const user = await getCurrentUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const { id } = await params
  const acc = checkProjectSettingsAccess(id, user.id)
  if ('error' in acc) return NextResponse.json({ error: acc.error }, { status: acc.status })

  const roster = getRoster(id)
  const inRoster = new Set(roster.map(r => `${r.subjectType}:${r.subjectId}`))
  const members = (getDb().prepare(
    'SELECT username, name, avatar_url, git_user_id FROM project_members WHERE project_id = ? ORDER BY name COLLATE NOCASE'
  ).all(id) as { username: string; name: string; avatar_url: string; git_user_id: string | null }[])
    .filter(m => !inRoster.has(`user:${m.username}`))
    .map(m => ({ subjectType: 'user' as const, subjectId: m.username, name: m.name || m.username, avatar: m.avatar_url || 'av-01', gitUserId: m.git_user_id }))
  const agents = rosterEligibleAgents(acc.project)
    .filter(a => !inRoster.has(`agent:${a.id}`))
    .map(a => ({ subjectType: 'agent' as const, subjectId: a.id, name: a.name, avatar: a.avatar, cliName: a.cliName, ownerName: a.ownerName }))

  // 에이전트에게 맡길 수 있는 역할(단계 작업자가 있는 역할) — 화면이 검증자 에이전트 선택지를 숨기는 데 쓴다
  const agentRoles = { process: true, verify: agentRoleAvailable('verify'), confirm: agentRoleAvailable('confirm') }
  return NextResponse.json({ canEdit: acc.canEdit, roster, candidates: { members, agents }, agentRoles })
}

export async function PUT(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const user = await getCurrentUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const { id } = await params
  const acc = checkProjectSettingsAccess(id, user.id)
  if ('error' in acc) return NextResponse.json({ error: acc.error }, { status: acc.status })
  if (!acc.canEdit) return NextResponse.json({ error: '소유자 또는 편집 권한자만 역할을 바꿀 수 있습니다' }, { status: 403 })

  const body = await req.json().catch(() => ({}))
  const subjectType = body.subjectType === 'agent' ? 'agent' : body.subjectType === 'user' ? 'user' : null
  const subjectId = typeof body.subjectId === 'string' ? body.subjectId.trim() : ''
  if (!subjectType || !subjectId) return NextResponse.json({ error: 'subjectType, subjectId 가 필요합니다' }, { status: 400 })

  // 단가 배수만 바꾸는 요청 (역할은 그대로)
  if (body.rates && typeof body.rates === 'object' && body.roles === undefined) {
    if (subjectType !== 'user') return NextResponse.json({ error: '단가 배수는 사람에게만 둡니다' }, { status: 400 })
    const rates: Partial<Record<RoleKey, number>> = {}
    for (const k of ['process', 'verify', 'confirm'] as RoleKey[]) {
      if (body.rates[k] === undefined) continue
      const n = Number(body.rates[k])
      if (!Number.isFinite(n) || n < 0.1 || n > 100) return NextResponse.json({ error: '단가 배수는 0.1 ~ 100 사이로 적습니다' }, { status: 400 })
      rates[k] = Math.round(n * 100) / 100
    }
    if (!setRosterRates(id, subjectId, rates, user.id)) return NextResponse.json({ error: '명부에 없는 사람입니다' }, { status: 404 })
    const target = getRoster(id).find(r => r.subjectType === 'user' && r.subjectId === subjectId)
    logActivity({
      userId: user.id, category: 'project', action: 'update_role_rate',
      detail: `역할 단가 배수 변경: ${acc.project.name} ${target?.name || subjectId} → ${Object.entries(rates).map(([k, v]) => `${k}×${v}`).join(', ')}`,
      targetType: 'project', targetId: id, req,
    })
    return NextResponse.json({ roster: getRoster(id) })
  }
  const roles: Record<RoleKey, boolean> = {
    process: !!body.roles?.process, verify: !!body.roles?.verify, confirm: !!body.roles?.confirm,
  }

  let name = '', avatar = '', gitUserId: string | null = null
  if (subjectType === 'agent') {
    const agent = rosterEligibleAgents(acc.project).find(a => a.id === subjectId)
    const existing = getRoster(id).some(r => r.subjectType === 'agent' && r.subjectId === subjectId)
    if (!agent && !existing) return NextResponse.json({ error: '이 프로젝트 소유자·편집 권한자의 에이전트만 넣을 수 있습니다' }, { status: 400 })
    name = agent?.name || ''
    avatar = agent?.avatar || ''
  } else {
    const m = getDb().prepare('SELECT name, avatar_url, git_user_id FROM project_members WHERE project_id = ? AND username = ?').get(id, subjectId) as any
    const existing = getRoster(id).some(r => r.subjectType === 'user' && r.subjectId === subjectId)
    if (!m && !existing) return NextResponse.json({ error: '프로젝트 Git 멤버만 넣을 수 있습니다' }, { status: 400 })
    name = m?.name || ''
    avatar = m?.avatar_url || ''
    gitUserId = m?.git_user_id ?? null
  }

  setRosterEntry(id, { subjectType, subjectId, gitUserId, name, avatar, roles }, user.id)
  const on = (Object.keys(roles) as RoleKey[]).filter(k => roles[k])
  logActivity({
    userId: user.id, category: 'project', action: 'update_roster',
    detail: `역할 명부 변경: ${acc.project.name} ${subjectType === 'agent' ? '에이전트' : '사람'} ${name || subjectId} → ${on.length ? on.join(',') : '없음'}`,
    targetType: 'project', targetId: id, req,
  })
  return NextResponse.json({ roster: getRoster(id) })
}
