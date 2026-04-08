import { NextRequest, NextResponse } from 'next/server'
import fs from 'fs'
import { getExecution, getAgent, getProjectAccess } from '@/lib/db'
import { getCurrentUser } from '@/lib/auth'

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const user = await getCurrentUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { id } = await params
  const execution = getExecution(id)

  if (!execution) {
    return NextResponse.json({ content: '', status: 'not_found' }, { status: 404 })
  }

  // 프로젝트 접근 권한 확인
  if (!getProjectAccess(execution.projectId, user.id)) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  const agent = execution.agentId ? getAgent(execution.agentId) : null
  const content = fs.existsSync(execution.logPath) ? fs.readFileSync(execution.logPath, 'utf-8') : ''
  return Response.json({
    content,
    status: execution.status,
    issueIid: execution.issueIid,
    issueTitle: execution.issueTitle ?? '',
    startedAt: execution.startedAt,
    agentName: agent?.name ?? execution.agentName ?? '',
    agentAvatar: agent?.avatar ?? 'av-01',
    modelName: execution.modelName ?? '',
    assigneeType: execution.assigneeType ?? 'agent',
    userId: execution.userId ?? null,
    userName: execution.userName ?? null,
    userAvatar: execution.userAvatar ?? null,
  })
}
