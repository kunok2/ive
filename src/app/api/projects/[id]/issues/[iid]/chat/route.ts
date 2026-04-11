import { NextRequest, NextResponse } from 'next/server'
import { getProject, getProjectAccess, isIssueAssignee, getActiveChatSession, getAnyActiveChatSession, getLastEndedChatSession, getChatMessages, createChatSession, createExecution, updateAgentStatus, getAgent } from '@/lib/db'
import { getCurrentUser } from '@/lib/auth'
import { pickAgentForChat, prepareChatWorkspace } from '@/lib/chat-agent'

/**
 * GET: Check if there's an active chat session for this issue
 */
export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string; iid: string }> }
) {
  const user = await getCurrentUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { id: projectId, iid } = await params
  const project = getProject(projectId)
  if (!project) return NextResponse.json({ error: 'Project not found' }, { status: 404 })

  if (!getProjectAccess(projectId, user.id)) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  const session = getActiveChatSession(projectId, Number(iid))
  if (session?.agentId) {
    const agent = getAgent(session.agentId)
    return NextResponse.json({ session, agentName: agent?.name, agentAvatar: agent?.avatar })
  }
  if (session) {
    return NextResponse.json({ session })
  }

  // No active session — return last ended session history for read-only display
  const lastEnded = getLastEndedChatSession(projectId, Number(iid))
  if (lastEnded) {
    const messages = getChatMessages(lastEnded.id)
    const agent = lastEnded.agentId ? getAgent(lastEnded.agentId) : null
    return NextResponse.json({ session: null, lastChat: { sessionId: lastEnded.id, agentName: agent?.name, agentAvatar: agent?.avatar, messages } })
  }

  return NextResponse.json({ session: null })
}

/**
 * POST: Start a new chat session (or return existing active one)
 * - Picks an available agent (no running executions)
 * - Creates a task_execution record (agent becomes busy)
 * - Prepares workspace
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
  if (!access || access === 'viewer') {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }
  // 채팅 시작은 담당자 또는 관리자만
  if (!user.isAdmin && !isIssueAssignee(projectId, Number(iid), user)) {
    return NextResponse.json(
      { error: '이 이슈의 담당자 또는 관리자만 AI 채팅을 시작할 수 있습니다' },
      { status: 403 }
    )
  }

  let body: any = {}
  try { body = await req.json() } catch { /* empty body ok */ }

  // Return existing active session for this issue
  const existing = getActiveChatSession(projectId, Number(iid))
  if (existing) {
    const agent = existing.agentId ? getAgent(existing.agentId) : null
    return NextResponse.json({ sessionId: existing.id, existing: true, agentName: agent?.name, agentAvatar: agent?.avatar })
  }

  // Check if there's an active chat on another issue in this project
  const otherChat = getAnyActiveChatSession(projectId)
  if (otherChat && otherChat.issueIid !== Number(iid) && !body.force) {
    return NextResponse.json({ existingChatOnIssue: otherChat.issueIid, existingSessionId: otherChat.id }, { status: 409 })
  }

  // Find an available agent (not busy with any execution)
  const agentInfo = pickAgentForChat(projectId)
  if (!agentInfo) {
    return NextResponse.json({ error: 'noAgentAvailable' }, { status: 400 })
  }

  try {
    const workspacePath = await prepareChatWorkspace(project, Number(iid), agentInfo.token)

    const sessionId = `chat-${Date.now()}-${Math.floor(Math.random() * 10000)}`
    const executionId = `exec-chat-${Date.now()}-${Math.floor(Math.random() * 10000)}`

    // Create execution — makes this agent "busy" for the scanner
    createExecution({
      id: executionId,
      projectId,
      agentId: agentInfo.agent.id,
      issueIid: Number(iid),
      issueTitle: `💬 Chat #${iid}`,
      status: 'running',
      startedAt: new Date().toISOString(),
      logPath: '',
      inputTokens: 0,
      outputTokens: 0,
      costUsd: 0,
      turns: 0,
    })

    // Mark agent as busy
    updateAgentStatus(agentInfo.agent.id, 'busy')

    // Create chat session linked to execution
    createChatSession({
      id: sessionId,
      projectId,
      issueIid: Number(iid),
      agentId: agentInfo.agent.id,
      executionId,
      workspacePath,
    })

    return NextResponse.json({ sessionId, existing: false, agentName: agentInfo.agent.name, agentAvatar: agentInfo.agent.avatar })
  } catch (err) {
    console.error('[Chat] Failed to start session:', err)
    return NextResponse.json({ error: err instanceof Error ? err.message : 'Failed to start chat' }, { status: 500 })
  }
}
