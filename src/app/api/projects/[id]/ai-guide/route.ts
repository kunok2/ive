import { NextRequest, NextResponse } from 'next/server'
import { getProject, getProjectAccess, getProjectAuthToken } from '@/lib/db'
import { getCurrentUser } from '@/lib/auth'
import { logActivity } from '@/lib/activity'
import { getAiGuideStatus, installAiGuide } from '@/lib/ai-guide'

/**
 * GET /api/projects/:id/ai-guide — 현재 설치 상태 확인
 */
export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const user = await getCurrentUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { id: projectId } = await params
  const project = getProject(projectId)
  if (!project) return NextResponse.json({ error: '프로젝트를 찾을 수 없습니다. 삭제되었을 수 있습니다 — 새로고침해 주세요.' }, { status: 404 })
  if (!getProjectAccess(projectId, user.id)) {
    return NextResponse.json({ error: '이 프로젝트에서 이 작업을 할 권한이 없습니다. 프로젝트 소유자에게 권한을 요청해 주세요.' }, { status: 403 })
  }

  return NextResponse.json({ files: await getAiGuideStatus(project, getProjectAuthToken(projectId)) })
}

/**
 * POST /api/projects/:id/ai-guide — CLAUDE.md, AGENTS.md에 IVE 가이드 설치
 * 보호 브랜치 대응: 별도 브랜치에 커밋 후 MR/PR을 생성한다.
 */
export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const user = await getCurrentUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { id: projectId } = await params
  const project = getProject(projectId)
  if (!project) return NextResponse.json({ error: '프로젝트를 찾을 수 없습니다. 삭제되었을 수 있습니다 — 새로고침해 주세요.' }, { status: 404 })

  const access = getProjectAccess(projectId, user.id)
  if (!access || access === 'viewer') {
    return NextResponse.json({ error: '이 프로젝트에서 이 작업을 할 권한이 없습니다. 프로젝트 소유자에게 권한을 요청해 주세요.' }, { status: 403 })
  }

  const { results, mrUrl } = await installAiGuide(project, getProjectAuthToken(projectId))

  logActivity({
    userId: user.id,
    category: 'project',
    action: 'install_ai_guide',
    detail: `AI 도구 가이드 설치: ${results.map(r => `${r.path}(${r.error ? '실패' : r.unchanged ? '변경없음' : r.created ? '생성' : '갱신'})`).join(', ')}${mrUrl ? ` → MR: ${mrUrl}` : ''}`,
    targetType: 'project',
    targetId: projectId,
    req,
  })

  const hasError = results.some(r => r.error)
  return NextResponse.json({ results, mrUrl }, { status: hasError ? 207 : 200 })
}
