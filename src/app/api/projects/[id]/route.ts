import { NextResponse } from 'next/server'
import { getProject, updateProject, deleteProject, getProjectAccess, deleteProjectShareByUser } from '@/lib/db'
import { getCurrentUser } from '@/lib/auth'
import { encrypt } from '@/lib/crypto'
import { logActivity } from '@/lib/activity'
import { triggerScan } from '@/lib/scanner'

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

  updateProject(updatedProject)
  // 스캐너 재개 — 다음 주기를 기다리지 않고 바로 스캔
  if (!existing.scannerActive && updatedProject.scannerActive) triggerScan(id)
  logActivity({ userId: user.id, category: 'project', action: 'update_project', detail: `프로젝트 수정: ${body.name || id}`, targetType: 'project', targetId: id, req })
  return NextResponse.json({ ...updatedProject })
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
