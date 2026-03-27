import { NextRequest, NextResponse } from 'next/server'
import { getProject, getProjectAccess, getChatSession, getChatMessages } from '@/lib/db'
import { getCurrentUser } from '@/lib/auth'
import { isChatAgentRunning } from '@/lib/chat-agent'

/**
 * GET: Fetch all messages for a chat session + agent running status
 */
export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string; iid: string }> }
) {
  const user = await getCurrentUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { id: projectId } = await params
  const project = getProject(projectId)
  if (!project) return NextResponse.json({ error: 'Project not found' }, { status: 404 })

  if (!getProjectAccess(projectId, user.id)) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  const sessionId = req.nextUrl.searchParams.get('sessionId')
  if (!sessionId) {
    return NextResponse.json({ error: 'sessionId required' }, { status: 400 })
  }

  const session = getChatSession(sessionId)
  if (!session) {
    return NextResponse.json({ error: 'Session not found' }, { status: 404 })
  }

  const messages = getChatMessages(sessionId)
  const agentProcessing = isChatAgentRunning(sessionId)
  return NextResponse.json({ messages, agentProcessing })
}
