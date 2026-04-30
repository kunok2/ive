import { NextRequest, NextResponse } from 'next/server'
import { getProject, getProjectAccess, updateProjectReportSecret, touchProjectActivity } from '@/lib/db'
import { getCurrentUser } from '@/lib/auth'
import { randomBytes } from 'crypto'
import { generateReportToken } from '@/lib/report-token'

function generateSecret(): string {
  return randomBytes(24).toString('hex')
}

/** 작업 접수 페이지 토큰 생성 또는 교체 */
export async function POST(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const user = await getCurrentUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { id: projectId } = await params
  const project = getProject(projectId)
  if (!project) return NextResponse.json({ error: 'Project not found' }, { status: 404 })

  const access = getProjectAccess(projectId, user.id)
  if (!access || access === 'viewer') {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  const secret = generateSecret()
  updateProjectReportSecret(projectId, secret)
  touchProjectActivity(projectId)

  // HMAC 토큰 생성 (기본 7일 만료)
  const reportToken = generateReportToken(secret, projectId, 168) // 7 days

  return NextResponse.json({ secret, reportToken })
}

/** 작업 접수 페이지 토큰 제거 */
export async function DELETE(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const user = await getCurrentUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { id: projectId } = await params
  const project = getProject(projectId)
  if (!project) return NextResponse.json({ error: 'Project not found' }, { status: 404 })

  const access = getProjectAccess(projectId, user.id)
  if (!access || access === 'viewer') {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  updateProjectReportSecret(projectId, null)
  touchProjectActivity(projectId)

  return NextResponse.json({ success: true })
}
