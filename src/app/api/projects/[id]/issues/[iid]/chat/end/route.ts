import { NextRequest, NextResponse } from 'next/server'
import { getProject, getProjectAccess, getChatSession, endChatSession, updateExecutionStatus, updateAgentStatus, countActiveExecutionsByAgent } from '@/lib/db'
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

  const { id: projectId } = await params
  const project = getProject(projectId)
  if (!project) return NextResponse.json({ error: 'Project not found' }, { status: 404 })

  const access = getProjectAccess(projectId, user.id)
  if (!access || access === 'viewer') {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
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
