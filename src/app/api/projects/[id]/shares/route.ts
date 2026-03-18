import { NextRequest, NextResponse } from 'next/server'
import { getCurrentUser } from '@/lib/auth'
import { getProject, getProjectShares, getAllUsers, createProjectShare, updateProjectShareRole, deleteProjectShare } from '@/lib/db'
import { ShareRole } from '@/types'

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const user = await getCurrentUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { id } = await params
  const project = getProject(id)
  if (!project || project.userId !== user.id) {
    return NextResponse.json({ error: 'Not found' }, { status: 404 })
  }

  const shares = getProjectShares(id)
  const allUsers = getAllUsers()
  // 자신과 이미 공유된 사용자를 제외한 선택 가능 사용자 목록
  const sharedUserIds = new Set(shares.map(s => s.userId))
  const candidates = allUsers
    .filter(u => u.id !== user.id && !sharedUserIds.has(u.id))
    .map(u => ({ id: u.id, name: u.name, email: u.email }))
  return NextResponse.json({ shares, candidates })
}

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const user = await getCurrentUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { id } = await params
  const project = getProject(id)
  if (!project || project.userId !== user.id) {
    return NextResponse.json({ error: 'Not found' }, { status: 404 })
  }

  const { userId: targetUserId, role } = await req.json() as { userId: string; role: ShareRole }
  if (!targetUserId) return NextResponse.json({ error: '사용자를 선택하세요.' }, { status: 400 })
  if (!['viewer', 'editor'].includes(role)) return NextResponse.json({ error: '잘못된 권한입니다.' }, { status: 400 })
  if (targetUserId === user.id) return NextResponse.json({ error: '자신에게는 공유할 수 없습니다.' }, { status: 400 })

  // 이미 공유되어 있는지 확인
  const existing = getProjectShares(id).find(s => s.userId === targetUserId)
  if (existing) return NextResponse.json({ error: '이미 공유된 사용자입니다.' }, { status: 409 })

  const share = {
    id: `ps-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    projectId: id,
    userId: targetUserId,
    role,
    createdAt: new Date().toISOString(),
  }
  createProjectShare(share)
  return NextResponse.json(share, { status: 201 })
}

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const user = await getCurrentUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { id } = await params
  const project = getProject(id)
  if (!project || project.userId !== user.id) {
    return NextResponse.json({ error: 'Not found' }, { status: 404 })
  }

  const { shareId, role } = await req.json() as { shareId: string; role: ShareRole }
  if (!['viewer', 'editor'].includes(role)) return NextResponse.json({ error: '잘못된 권한입니다.' }, { status: 400 })

  updateProjectShareRole(shareId, role)
  return NextResponse.json({ success: true })
}

export async function DELETE(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const user = await getCurrentUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { id } = await params
  const project = getProject(id)
  if (!project || project.userId !== user.id) {
    return NextResponse.json({ error: 'Not found' }, { status: 404 })
  }

  const { shareId } = await req.json() as { shareId: string }
  deleteProjectShare(shareId)
  return NextResponse.json({ success: true })
}
