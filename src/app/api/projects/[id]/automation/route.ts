import { NextResponse } from 'next/server'
import { getCurrentUser } from '@/lib/auth'
import { logActivity } from '@/lib/activity'
import { getProjectAutomation, updateProjectAutomation, hasRole, DEFAULT_LIMITS, DEFAULT_BUNDLE, type AutomationLimits, type DefaultRoles, type RoleDefaults, type PresetRoleInfo, type BundleSettings, recordConfigChanges } from '@/lib/db'
import { checkProjectSettingsAccess } from '@/lib/project-permissions'
import { violatesSelfReview, autoAssignAllAgents, agentRoleAvailable } from '@/lib/role-assignment'

/**
 * 프로젝트 단계 자동화 설정 — 기본 배정(「모든 단계 자동배정」 포함), 작성자 허용 목록, 상한, staging 정보·비밀값.
 * 비밀값은 이름만 내보낸다(값은 절대 응답에 싣지 않는다).
 */
export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const user = await getCurrentUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const { id } = await params
  const acc = checkProjectSettingsAccess(id, user.id)
  if ('error' in acc) return NextResponse.json({ error: acc.error }, { status: acc.status })
  const a = getProjectAutomation(id)
  // 「모든 단계 자동배정」을 지금 켜면 누가 뽑히는지 미리보기 (저장 안 함)
  const preview = autoAssignAllAgents(id, null, { dryRun: true, isKo: user.locale !== 'en' })
  return NextResponse.json({ canEdit: acc.canEdit, canEditStaging: acc.isOwner || user.isAdmin, ...a, defaultLimits: DEFAULT_LIMITS, defaultBundle: DEFAULT_BUNDLE, autoAllPreview: preview })
}

function sanitizeRole(r: any): PresetRoleInfo | null {
  if (!r || typeof r !== 'object') return null
  const mode = ['creator', 'auto', 'specific', 'agent'].includes(r.mode) ? r.mode : null
  if (!mode) return null
  return {
    mode,
    userId: mode === 'specific' && r.userId ? String(r.userId) : null,
    username: mode === 'specific' && r.username ? String(r.username) : null,
    agentId: mode === 'agent' && r.agentId ? String(r.agentId) : null,
  }
}

export async function PUT(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const user = await getCurrentUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const { id } = await params
  const acc = checkProjectSettingsAccess(id, user.id)
  if ('error' in acc) return NextResponse.json({ error: acc.error }, { status: acc.status })
  if (!acc.canEdit) return NextResponse.json({ error: '소유자 또는 편집 권한자만 바꿀 수 있습니다' }, { status: 403 })

  const body = await req.json().catch(() => ({}))
  // staging 주소·비밀값은 소유자(또는 관리자)만 — editor 가 주소를 바꿔 비밀값을 자기 서버로 보내게 하는 것을 막는다
  if ((body.staging || body.stagingSecrets) && !acc.isOwner && !user.isAdmin) {
    return NextResponse.json({ error: 'staging 정보와 비밀값은 프로젝트 소유자만 바꿀 수 있습니다' }, { status: 403 })
  }
  // 검사 명령은 IVE 서버에서 실행되고, 자동 머지는 staging 에 사람 승인 없이 푸시한다 — 소유자(또는 관리자)만
  if (body.bundle && typeof body.bundle === 'object' && (body.bundle.checkCommands !== undefined || body.bundle.agentMerge !== undefined) && !acc.isOwner && !user.isAdmin) {
    return NextResponse.json({ error: '검사 명령과 자동 머지는 프로젝트 소유자만 바꿀 수 있습니다' }, { status: 403 })
  }
  const patch: Parameters<typeof updateProjectAutomation>[1] = {}
  const changed: string[] = []

  if (body.defaultRoles) {
    // 기본 배정 — 「IVE 에서 등록」(본 값)과 「작업 접수 페이지·API·Git 직접」(intake, 없으면 같게) 두 벌
    const parse = (d: any): RoleDefaults | string => {
      const p = d?.processor && ['auto', 'assignee', 'agent'].includes(d.processor.mode)
        ? { mode: d.processor.mode, agentId: d.processor.mode === 'agent' ? (d.processor.agentId || null) : null }
        : null
      const roles: RoleDefaults = { autoAllAgents: !!d?.autoAllAgents, processor: p, verifier: sanitizeRole(d?.verifier), confirmer: sanitizeRole(d?.confirmer) }
      // 기본 배정의 에이전트는 명부에서 그 역할을 가진 것만
      const inRoster = (role: 'process' | 'verify' | 'confirm', agentId?: string | null) => !agentId || hasRole(id, role, 'agent', agentId)
      if ((p?.mode === 'agent' && !inRoster('process', p.agentId))
        || (roles.verifier?.mode === 'agent' && !inRoster('verify', roles.verifier.agentId))
        || (roles.confirmer?.mode === 'agent' && !inRoster('confirm', roles.confirmer.agentId))) {
        return '명부에서 그 역할을 가진 에이전트만 기본 배정에 둘 수 있습니다'
      }
      if (roles.verifier?.mode === 'agent' && !agentRoleAvailable('verify')) return '검증 에이전트 작업자는 아직 없어 검증자 기본값을 에이전트로 둘 수 없습니다'
      if (!roles.autoAllAgents && violatesSelfReview(p?.agentId, roles.verifier)) return '처리자와 검증자를 같은 에이전트로 둘 수 없습니다'
      return roles
    }
    const d = body.defaultRoles
    const base = parse(d)
    if (typeof base === 'string') return NextResponse.json({ error: base }, { status: 400 })
    let intake: RoleDefaults | null = null
    if (d.intake) {
      const r = parse(d.intake)
      if (typeof r === 'string') return NextResponse.json({ error: r }, { status: 400 })
      intake = r
    }
    const cur = getProjectAutomation(id).defaultRoles
    const intakeAutoRun = d.intakeAutoRun === undefined ? !!cur.intakeAutoRun : !!d.intakeAutoRun
    // 접수 페이지 이슈를 승인 없이 돌리는 것은 외부 입력을 그대로 에이전트에 넘기는 결정 — 소유자(또는 관리자)만
    if (intakeAutoRun !== !!cur.intakeAutoRun && !acc.isOwner && !user.isAdmin) {
      return NextResponse.json({ error: '접수 페이지 이슈의 자동 실행 허용은 프로젝트 소유자만 바꿀 수 있습니다' }, { status: 403 })
    }
    patch.defaultRoles = { ...base, intake, intakeAutoRun } as DefaultRoles
    changed.push('기본 배정')
  }
  if (Array.isArray(body.authorAllowlist)) {
    patch.authorAllowlist = Array.from(new Set(body.authorAllowlist.map((s: unknown) => String(s).trim()).filter(Boolean))) as string[]
    changed.push('작성자 허용 목록')
  }
  if (body.limits && typeof body.limits === 'object') {
    const lim: Partial<AutomationLimits> = {}
    for (const k of Object.keys(DEFAULT_LIMITS) as (keyof AutomationLimits)[]) {
      const n = Number(body.limits[k])
      if (Number.isFinite(n) && n >= 1 && n <= 1000) lim[k] = Math.floor(n)
    }
    patch.limits = lim
    changed.push('상한')
  }
  if (body.staging && typeof body.staging === 'object') {
    const st: Record<string, string> = {}
    for (const k of ['url', 'versionSource', 'versionUrl', 'commitField', 'branch', 'notes'] as const) {
      if (body.staging[k] === undefined) continue
      const v = String(body.staging[k] ?? '').trim()
      if (k === 'versionSource' && v !== 'url' && v !== 'pipeline') return NextResponse.json({ error: `배포 커밋 확인 방법이 올바르지 않습니다: ${v}` }, { status: 400 })
      if (k === 'branch' && v && !/^[\w.\-/]+$/.test(v)) return NextResponse.json({ error: `브랜치 이름이 올바르지 않습니다: ${v}` }, { status: 400 })
      if ((k === 'url' || k === 'versionUrl') && v && !/^https?:\/\/[^\s]+$/i.test(v)) {
        return NextResponse.json({ error: `http(s) 주소가 아닙니다: ${v}` }, { status: 400 })
      }
      if (k === 'notes' && v.length > 2000) return NextResponse.json({ error: '안내가 너무 깁니다(2천 자 이하)' }, { status: 400 })
      st[k] = v
    }
    patch.staging = st
    changed.push('staging')
  }
  if (body.bundle && typeof body.bundle === 'object') {
    const b: Partial<BundleSettings> = {}
    const RANGE: Record<'maxWaiting' | 'quietMin' | 'maxSize' | 'checkTimeoutMin', [number, number]> = {
      maxWaiting: [1, 50], quietMin: [1, 1440], maxSize: [1, 50], checkTimeoutMin: [1, 120],
    }
    for (const k of Object.keys(RANGE) as (keyof typeof RANGE)[]) {
      if (body.bundle[k] === undefined) continue
      const n = Math.floor(Number(body.bundle[k]))
      if (!Number.isFinite(n) || n < RANGE[k][0] || n > RANGE[k][1]) return NextResponse.json({ error: `${k} 값 범위: ${RANGE[k][0]}~${RANGE[k][1]}` }, { status: 400 })
      b[k] = n
    }
    if (body.bundle.agentMerge !== undefined) b.agentMerge = !!body.bundle.agentMerge
    if (body.bundle.times !== undefined) {
      const times = String(body.bundle.times || '').split(',').map((x: string) => x.trim()).filter(Boolean)
      if (times.some((x: string) => !/^([01]?\d|2[0-3]):[0-5]\d$/.test(x))) return NextResponse.json({ error: '출발 시각은 HH:MM 을 쉼표로 구분해 적습니다' }, { status: 400 })
      b.times = times.join(', ')
    }
    if (body.bundle.checkCommands !== undefined) {
      const v = String(body.bundle.checkCommands || '')
      if (v.length > 4000) return NextResponse.json({ error: '검사 명령이 너무 깁니다(4천 자 이하)' }, { status: 400 })
      b.checkCommands = v
    }
    patch.bundle = b
    changed.push('묶음 배포')
  }
  if (typeof body.closeIssueOnMerge === 'boolean') {
    patch.closeIssueOnMerge = body.closeIssueOnMerge
    changed.push(`MR 머지로 이슈 자동 닫기 ${body.closeIssueOnMerge ? '켬' : '끔'}`)
  }
  if (body.stagingSecrets && typeof body.stagingSecrets === 'object') {
    const s: Record<string, string | null> = {}
    for (const [k, v] of Object.entries(body.stagingSecrets)) {
      if (!/^[A-Z_][A-Z0-9_]*$/.test(k)) return NextResponse.json({ error: `비밀값 이름은 대문자·숫자·밑줄만: ${k}` }, { status: 400 })
      s[k] = v === null ? null : String(v)
    }
    patch.stagingSecrets = s
    changed.push(`비밀값(${Object.keys(s).join(',')})`)   // 값은 기록하지 않는다
  }

  const beforeAuto = getProjectAutomation(id)
  try {
    updateProjectAutomation(id, patch, user.id)
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 409 })
  }
  // 설정 변경 로그 — 자동화 규칙이 바뀐 시점 전후로 작업 결과를 비교할 수 있게. 비밀값(stagingSecrets)은 이름 목록만 담긴다
  recordConfigChanges('automation', id, beforeAuto as unknown as Record<string, unknown>, getProjectAutomation(id) as unknown as Record<string, unknown>,
    ['defaultRoles', 'authorAllowlist', 'stagingSecretNames', 'limits', 'staging', 'bundle', 'closeIssueOnMerge'], { projectId: id, actorUserId: user.id })
  logActivity({
    userId: user.id, category: 'project', action: 'update_automation',
    detail: `단계 자동화 설정 변경: ${acc.project.name} — ${changed.join(', ') || '없음'}`,
    targetType: 'project', targetId: id, req,
  })
  const a = getProjectAutomation(id)
  return NextResponse.json({ canEdit: true, canEditStaging: acc.isOwner || user.isAdmin, ...a, defaultLimits: DEFAULT_LIMITS, defaultBundle: DEFAULT_BUNDLE, autoAllPreview: autoAssignAllAgents(id, null, { dryRun: true, isKo: user.locale !== 'en' }) })
}
