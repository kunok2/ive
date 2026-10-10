import { NextRequest, NextResponse } from 'next/server'
import { getProject, getProjectAccess, updateProjectReportSecret, touchProjectActivity } from '@/lib/db'
import { getCurrentUser } from '@/lib/auth'
import { logActivity } from '@/lib/activity'
import { randomBytes } from 'crypto'
import { generateReportToken } from '@/lib/report-token'

function generateSecret(): string {
  return randomBytes(24).toString('hex')
}

/** 기존 secret으로 새 HMAC 토큰 발급 (페이지 재진입 시 사용) */
export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
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

  if (!project.reportSecret) {
    return NextResponse.json({ secret: null, reportToken: null })
  }

  const reportToken = generateReportToken(project.reportSecret, projectId, 168)
  return NextResponse.json({ secret: project.reportSecret, reportToken })
}

/** 작업 접수 페이지 토큰 생성 또는 교체 */
export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
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

  const secret = generateSecret()
  updateProjectReportSecret(projectId, secret)
  touchProjectActivity(projectId)

  // HMAC 토큰 생성 (기본 7일 만료)
  const reportToken = generateReportToken(secret, projectId, 168) // 7 days

  logActivity({
    userId: user.id,
    category: 'project',
    action: 'rotate_report_secret',
    detail: `작업 접수 토큰 생성/교체: ${project.name}`,
    targetType: 'project',
    targetId: projectId,
    req,
  })

  return NextResponse.json({ secret, reportToken })
}

/** 작업 접수 페이지 토큰 제거 */
export async function DELETE(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
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

  updateProjectReportSecret(projectId, null)
  touchProjectActivity(projectId)

  logActivity({
    userId: user.id,
    category: 'project',
    action: 'revoke_report_secret',
    detail: `작업 접수 토큰 제거: ${project.name}`,
    targetType: 'project',
    targetId: projectId,
    req,
  })

  return NextResponse.json({ success: true })
}
