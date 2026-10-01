import { NextResponse } from 'next/server'
import { getCurrentUser } from '@/lib/auth'
import { logActivity } from '@/lib/activity'
import { PROMPT_KINDS, getRolePromptOverride, getRolePromptHistory, saveRolePrompt, type PromptKind } from '@/lib/db'
import { checkProjectSettingsAccess } from '@/lib/project-permissions'
import { EDITABLE_DEFAULTS, WORKER_ACTIVE, fixedPreview } from '@/lib/role-prompts'

/**
 * 역할별 프롬프트 — 편집 가능한 부분(프로젝트 덮어쓰기)과 IVE 고정 부분(읽기 전용), 변경 이력.
 */
export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const user = await getCurrentUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const { id } = await params
  const acc = checkProjectSettingsAccess(id, user.id)
  if ('error' in acc) return NextResponse.json({ error: acc.error }, { status: acc.status })
  const isKo = user.locale !== 'en'
  // 작업자가 아직 없는 역할(재현 ①)은 IVE 단계에 없으므로 보이지 않는다
  const kinds = PROMPT_KINDS.filter(kind => WORKER_ACTIVE[kind]).map(kind => {
    const o = getRolePromptOverride(id, kind)
    return {
      kind,
      workerActive: WORKER_ACTIVE[kind],
      defaultBody: EDITABLE_DEFAULTS[kind],
      override: o ? { body: o.body, version: o.version, updatedAt: o.updatedAt } : null,
      fixed: fixedPreview(kind, isKo),
      history: getRolePromptHistory(id, kind, 20),
    }
  })
  // 프롬프트는 staging 비밀값을 가진 에이전트를 움직이므로 비밀값과 같은 기준 — 소유자(관리자)만 편집
  return NextResponse.json({ canEdit: acc.isOwner || user.isAdmin, kinds })
}

export async function PUT(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const user = await getCurrentUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const { id } = await params
  const acc = checkProjectSettingsAccess(id, user.id)
  if ('error' in acc) return NextResponse.json({ error: acc.error }, { status: acc.status })
  if (!acc.isOwner && !user.isAdmin) return NextResponse.json({ error: '프롬프트는 프로젝트 소유자만 바꿀 수 있습니다' }, { status: 403 })

  const body = await req.json().catch(() => ({}))
  const kind = body.kind as PromptKind
  if (!PROMPT_KINDS.includes(kind) || !WORKER_ACTIVE[kind]) return NextResponse.json({ error: '알 수 없는 역할' }, { status: 400 })
  let text: string | null = typeof body.body === 'string' ? body.body : null
  // 기본값과 같은 내용이면 덮어쓰기를 두지 않는다(기본값을 그대로 쓰게 — 처리 프롬프트 문자열 보존).
  if (text !== null && text.trim() === EDITABLE_DEFAULTS[kind].trim()) text = null
  if (text !== null && text.length > 20000) return NextResponse.json({ error: '프롬프트가 너무 깁니다(2만 자 이하)' }, { status: 400 })

  const version = saveRolePrompt(id, kind, text, { userId: user.id, name: user.name })
  if (version !== null) {
    logActivity({
      userId: user.id, category: 'project', action: 'update_role_prompt',
      detail: `역할 프롬프트 변경: ${acc.project.name} ${kind} → ${text === null ? '기본값' : `v${version}`}`,
      targetType: 'project', targetId: id, req,
    })
  }
  const o = getRolePromptOverride(id, kind)
  return NextResponse.json({
    kind, version,
    override: o ? { body: o.body, version: o.version, updatedAt: o.updatedAt } : null,
    history: getRolePromptHistory(id, kind, 20),
  })
}
