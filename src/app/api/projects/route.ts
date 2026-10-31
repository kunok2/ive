import { NextResponse } from 'next/server'
import { getProjectsByUser, createProject, getSharedProjectsForUser, countActiveExecutionsByProject, getLastExecutionActivityAt, getUserOAuthTokenRaw, getActiveChatSessionsByProject } from '@/lib/db'
import { isChatAgentRunning } from '@/lib/chat-agent'
import { getCurrentUser } from '@/lib/auth'
import { encrypt, decrypt } from '@/lib/crypto'
import { ensureLabels } from '@/lib/provider'
import { logActivity } from '@/lib/activity'

// 카드 정렬 기준: 저장된 최종 활동 시각과 실행 기록의 가장 늦은 시각 중 나중 것.
// 활동 시각 갱신을 빠뜨린 경로가 있어도 실제 기록(DB 상태)으로 바로잡힌다.
const toMs = (t: string | null | undefined) => {
  if (!t) return 0
  const ms = Date.parse(/[zZ]|[+-]\d\d:?\d\d$/.test(t) ? t : t.replace(' ', 'T') + 'Z')
  return Number.isNaN(ms) ? 0 : ms
}
const withActivity = <T extends { id: string; lastActivityAt: string | null }>(p: T): T => {
  const execAt = getLastExecutionActivityAt(p.id)
  return toMs(execAt) > toMs(p.lastActivityAt) ? { ...p, lastActivityAt: execAt } : p
}

export async function GET() {
  const user = await getCurrentUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  // 진행 중인 AI 채팅 플래그 (카드 "대화중"/"생각중" 표시용)
  const chatFlags = (projectId: string) => {
    const sessions = getActiveChatSessionsByProject(projectId)
    return { chatActive: sessions.length > 0, chatProcessing: sessions.some(s => isChatAgentRunning(s.id)) }
  }

  const ownProjects = getProjectsByUser(user.id)
  const ownData = ownProjects.map(withActivity).map(p => ({
    ...p,
    accessToken: p.accessToken ? '••••••' : '',
    hasToken: !!p.accessToken,
    runningCount: countActiveExecutionsByProject(p.id),
    ...chatFlags(p.id),
    shareRole: null as string | null, // 소유자
  }))

  const sharedProjects = getSharedProjectsForUser(user.id)
  const sharedData = sharedProjects.map(withActivity).map(p => ({
    ...p,
    accessToken: '', // 공유 사용자에게 토큰 노출하지 않음
    runningCount: countActiveExecutionsByProject(p.id),
    ...chatFlags(p.id),
  }))

  // 소유/공유를 한 배열로 합쳐 반환. 정렬(마지막 변경 시각 최신순)은
  // 클라이언트(store.tsx refresh)가 단일 출처로 수행하므로 여기서는 순서를 보장하지 않음.
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
      return NextResponse.json({ error: 'GitLab/GitHub 계정이 연결되어 있지 않습니다. GitLab/GitHub 계정으로 다시 로그인해 주세요.' }, { status: 400 })
    }
    try {
      plainToken = decrypt(raw.encrypted)
    } catch {
      return NextResponse.json({ error: '저장된 Git 계정 연결 정보를 읽지 못했습니다. 로그아웃한 뒤 GitLab/GitHub 계정으로 다시 로그인해 주세요.' }, { status: 500 })
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
