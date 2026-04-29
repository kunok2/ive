import { NextResponse } from 'next/server'
import { getProjectsByUser, createProject, getSharedProjectsForUser, countActiveExecutionsByProject, getUserOAuthTokenRaw } from '@/lib/db'
import { getCurrentUser } from '@/lib/auth'
import { encrypt, decrypt } from '@/lib/crypto'
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
    runningCount: countActiveExecutionsByProject(p.id),
    shareRole: null as string | null, // 소유자
  }))

  const sharedProjects = getSharedProjectsForUser(user.id)
  const sharedData = sharedProjects.map(p => ({
    ...p,
    accessToken: '', // 공유 사용자에게 토큰 노출하지 않음
    runningCount: countActiveExecutionsByProject(p.id),
  }))

  return NextResponse.json([...ownData, ...sharedData])
}

export async function POST(req: Request) {
  const user = await getCurrentUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const body = await req.json()

  // useOAuthToken 플래그가 true면 현재 유저의 OAuth access_token을 서버에서 복호화해 주입
  let plainToken = String(body.accessToken || '')
  if (body.useOAuthToken) {
    const raw = getUserOAuthTokenRaw(user.id)
    if (!raw || !raw.encrypted) {
      return NextResponse.json({ error: '연결된 OAuth 토큰이 없습니다' }, { status: 400 })
    }
    try {
      plainToken = decrypt(raw.encrypted)
    } catch {
      return NextResponse.json({ error: 'OAuth 토큰 복호화 실패' }, { status: 500 })
    }
  }

  // 저장 시에는 별도 암호화 (ENCRYPTION_KEY 기반)
  const { useOAuthToken, usesOAuthToken, ...rest } = body
  const project = {
    ...rest,
    userId: user.id,
    accessToken: encrypt(plainToken),
    usesOAuthToken: usesOAuthToken ? true : (useOAuthToken ? true : false),
  }
  createProject(project)
  logActivity({
    userId: user.id, category: 'project', action: 'create_project',
    detail: `프로젝트 생성: ${body.name}${body.useOAuthToken ? ' (OAuth 토큰 사용)' : ''}`,
    targetType: 'project', targetId: project.id, req,
  })

  // 레이블 동기화 (백그라운드 — 실패해도 프로젝트 생성은 완료)
  ensureLabels(project, plainToken).catch(err =>
    console.warn(`[ensureLabels] ${project.name}:`, err)
  )

  return NextResponse.json(project, { status: 201 })
}
