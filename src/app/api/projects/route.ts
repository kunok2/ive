import { NextResponse } from 'next/server'
import { getProjectsByUser, createProject, getProjectAssignments, getSharedProjectsForUser, countActiveExecutionsByProject } from '@/lib/db'
import { getCurrentUser } from '@/lib/auth'
import { encrypt } from '@/lib/crypto'
import { ensureLabels } from '@/lib/provider'
import { logActivity } from '@/lib/activity'

export async function GET() {
  const user = await getCurrentUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const ownProjects = getProjectsByUser(user.id)
  const ownData = ownProjects.map(p => ({
    ...p,
    accessToken: p.accessToken ? '••••••' : '',
    hasToken: !!p.accessToken,
    assignedAgents: getProjectAssignments(p.id),
    runningCount: countActiveExecutionsByProject(p.id),
    shareRole: null as string | null, // 소유자
  }))

  const sharedProjects = getSharedProjectsForUser(user.id)
  const sharedData = sharedProjects.map(p => ({
    ...p,
    accessToken: '', // 공유 사용자에게 토큰 노출하지 않음
    assignedAgents: getProjectAssignments(p.id),
    runningCount: countActiveExecutionsByProject(p.id),
  }))

  return NextResponse.json([...ownData, ...sharedData])
}

export async function POST(req: Request) {
  const user = await getCurrentUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const body = await req.json()
  const project = {
    ...body,
    userId: user.id,
    accessToken: encrypt(body.accessToken || '')
  }
  createProject(project)
  logActivity({ userId: user.id, category: 'project', action: 'create_project', detail: `프로젝트 생성: ${body.name}`, targetType: 'project', targetId: project.id, req })

  // 레이블 동기화 (백그라운드 — 실패해도 프로젝트 생성은 완료)
  ensureLabels(project, body.accessToken || '').catch(err =>
    console.warn(`[ensureLabels] ${project.name}:`, err)
  )

  return NextResponse.json(project, { status: 201 })
}
