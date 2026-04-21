import { NextRequest, NextResponse } from 'next/server'
import { getProject, getProjectAccess, getProjectAuthToken, getChatSession, endChatSession, updateExecutionStatus, updateAgentStatus, countActiveExecutionsByAgent, isIssueAssignee } from '@/lib/db'
import { getCurrentUser } from '@/lib/auth'
import { killChatAgent } from '@/lib/chat-agent'

/**
 * POST: End an active chat session
 * - Kills agent process
 * - Marks execution as success (frees the agent for scanner)
 * - Updates agent status if no other running executions
 */
export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string; iid: string }> }
) {
  const user = await getCurrentUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { id: projectId, iid } = await params
  const project = getProject(projectId)
  if (!project) return NextResponse.json({ error: 'Project not found' }, { status: 404 })

  const access = getProjectAccess(projectId, user.id)
  if (!access) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }
  // 채팅 종료는 담당자 또는 관리자만 (viewer도 assignee면 허용)
  const token = getProjectAuthToken(projectId)
  if (!user.isAdmin && !(await isIssueAssignee(project, Number(iid), token, user))) {
    return NextResponse.json(
      { error: '이 이슈의 담당자 또는 관리자만 AI 채팅을 종료할 수 있습니다' },
      { status: 403 }
    )
  }

  const { sessionId } = await req.json()
  if (!sessionId) {
    return NextResponse.json({ error: 'sessionId required' }, { status: 400 })
  }

  const session = getChatSession(sessionId)
  if (!session) {
    return NextResponse.json({ error: 'Session not found' }, { status: 404 })
  }

  // Kill agent process if running
  killChatAgent(sessionId)

  // End the execution (free agent for scanner)
  if (session.executionId) {
    updateExecutionStatus(session.executionId, 'success', new Date().toISOString())
  }

  // Release agent if no other running executions
  if (session.agentId) {
    const remaining = countActiveExecutionsByAgent(session.agentId)
    if (remaining === 0) {
      updateAgentStatus(session.agentId, 'available')
    }
  }

  // Mark session as ended
  endChatSession(sessionId)

  return NextResponse.json({ ok: true })
}
