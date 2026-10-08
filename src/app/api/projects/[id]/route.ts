import { NextResponse } from 'next/server'
import { getProject, updateProject, deleteProject, getProjectAccess, deleteProjectShareByUser, getProjectAuthToken, countActiveExecutionsByProject } from '@/lib/db'
import { getCurrentUser } from '@/lib/auth'
import { encrypt } from '@/lib/crypto'
import { logActivity } from '@/lib/activity'
import { triggerScan, runWhileScannerHeld } from '@/lib/scanner'
import { diffLabels, labelChangeProblem, renameRepoLabels } from '@/lib/label-rename'
import { installAiGuide } from '@/lib/ai-guide'

export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const user = await getCurrentUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { id } = await params
  const project = getProject(id)
  const access = project ? getProjectAccess(id, user.id) : null
  if (!project || !access) {
    return NextResponse.json({ error: 'Not found' }, { status: 404 })
  }

  return NextResponse.json({
    ...project,
    accessToken: (access === 'owner' || access === 'editor') ? project.accessToken : '', // viewer에게만 토큰 숨김
    shareRole: access === 'owner' ? null : access,
  })
}

export async function PUT(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const user = await getCurrentUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { id } = await params
  const body = await req.json()

  const existing = getProject(id)
  if (!existing) return NextResponse.json({ error: 'Not found' }, { status: 404 })

  // 소유자 또는 editor 권한 확인
  const access = getProjectAccess(id, user.id)
  if (!access || access === 'viewer') {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  // accessToken이 비어있거나 마스킹된 값이면 기존 토큰 유지
  const rawToken = body.accessToken?.trim()
  const accessToken = rawToken && rawToken !== '••••••'
    ? encrypt(rawToken)
    : existing.accessToken

  const updatedProject = {
    ...body,
    id,
    userId: existing.userId,  // 소유자 ID는 변경 불가
    accessToken: (access === 'owner' || access === 'editor') ? accessToken : existing.accessToken,
    usesOAuthToken: access === 'owner' ? (body.usesOAuthToken ?? existing.usesOAuthToken) : existing.usesOAuthToken,
  }

  // 단계 레이블 이름을 바꾸면 저장소 레이블도 함께 이름 변경한다(붙어 있는 이슈까지 따라온다).
  // 저장소와 설정이 어긋난 순간 스캔이 돌면 열린 이슈를 사라진 것으로 정리하므로, 스캔을 멈춘 채 이름 변경 → 저장을 한 번에 한다.
  const labelChanges = diffLabels(existing, body)
  let labelRename: { renamed: string[]; guideMrUrl: string | null; guideError?: string } | null = null
  if (labelChanges.length > 0) {
    const problem = labelChangeProblem(existing, body, labelChanges)
    if (problem) return NextResponse.json({ error: problem }, { status: 409 })
    const running = countActiveExecutionsByProject(id)
    if (running > 0) {
      return NextResponse.json({
        error: `이 프로젝트에서 작업 ${running}건이 실행 중이라 레이블 이름을 바꿀 수 없습니다 — 실행 중인 작업은 시작 때 읽은 옛 이름으로 레이블을 옮겨 옛 레이블을 다시 만듭니다. 끝난 뒤 다시 저장하세요.`,
      }, { status: 409 })
    }
    const token = getProjectAuthToken(id)
    try {
      const { renamed } = await runWhileScannerHeld(async () => {
        const r = await renameRepoLabels(existing, token, labelChanges)
        updateProject(updatedProject)
        return r
      })
      labelRename = { renamed: renamed.map(c => `${c.from} → ${c.to}`), guideMrUrl: null }
    } catch (e) {
      return NextResponse.json({ error: e instanceof Error ? e.message : String(e) }, { status: 409 })
    }
    // 저장소에 IVE 가이드가 설치돼 있으면 새 이름으로 다시 써서 MR/PR 로 올린다(설치 안 된 저장소엔 만들지 않는다)
    try {
      const saved = getProject(id)
      if (saved) labelRename.guideMrUrl = (await installAiGuide(saved, token, { onlyInstalled: true, reason: 'labels' })).mrUrl
    } catch (e) {
      labelRename.guideError = e instanceof Error ? e.message : String(e)
    }
    logActivity({
      userId: user.id, category: 'project', action: 'rename_labels',
      detail: `레이블 이름 변경: ${labelChanges.map(c => `${c.from} → ${c.to}`).join(', ')}${labelRename.guideMrUrl ? ` · 가이드 MR: ${labelRename.guideMrUrl}` : ''}`,
      targetType: 'project', targetId: id, req,
    })
  } else {
    updateProject(updatedProject)
  }
  // 스캐너 재개 — 다음 주기를 기다리지 않고 바로 스캔
  if (!existing.scannerActive && updatedProject.scannerActive) triggerScan(id)
  logActivity({ userId: user.id, category: 'project', action: 'update_project', detail: `프로젝트 수정: ${body.name || id}`, targetType: 'project', targetId: id, req })
  return NextResponse.json({ ...updatedProject, labelRename })
}

export async function DELETE(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const user = await getCurrentUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { id } = await params
  const project = getProject(id)
  if (!project) return NextResponse.json({ error: 'Not found' }, { status: 404 })

  // 공유받은 사용자가 호출하면 자신의 공유만 해제 (프로젝트 자체는 유지).
  // 소유자만 프로젝트를 완전 삭제할 수 있다.
  if (project.userId !== user.id) {
    const removed = deleteProjectShareByUser(id, user.id)
    if (!removed) return NextResponse.json({ error: 'Not found' }, { status: 404 })
    logActivity({ userId: user.id, category: 'project', action: 'leave_share', detail: `공유 프로젝트 목록에서 제거: ${project.name}`, targetType: 'project_share', targetId: id, req: _req })
    return NextResponse.json({ success: true, left: true })
  }

  deleteProject(id, user.id)
  logActivity({ userId: user.id, category: 'project', action: 'delete_project', detail: `프로젝트 삭제: ${project.name}`, targetType: 'project', targetId: id, req: _req })
  return NextResponse.json({ success: true })
}
