import { NextRequest } from 'next/server'
import { getProject, getProjectAccess, getChatSession, saveChatMessage, getAgent } from '@/lib/db'
import { getCurrentUser } from '@/lib/auth'
import { decrypt } from '@/lib/crypto'
import { runChatAgent, isChatAgentRunning } from '@/lib/chat-agent'
import { fetchSingleIssue } from '@/lib/provider'
import { getLocale } from 'next-intl/server'

/**
 * POST: Send a message and stream the AI response via SSE.
 * Uses CLI session ID for resume (--resume / -s) instead of replaying history.
 */
export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string; iid: string }> }
) {
  const user = await getCurrentUser()
  if (!user) return new Response(JSON.stringify({ error: 'Unauthorized' }), { status: 401 })

  const { id: projectId, iid } = await params
  const project = getProject(projectId)
  if (!project) return new Response(JSON.stringify({ error: 'Project not found' }), { status: 404 })

  const access = getProjectAccess(projectId, user.id)
  if (!access || access === 'viewer') {
    return new Response(JSON.stringify({ error: 'Forbidden' }), { status: 403 })
  }

  const { sessionId, message } = await req.json()
  if (!sessionId || !message?.trim()) {
    return new Response(JSON.stringify({ error: 'sessionId and message required' }), { status: 400 })
  }

  const session = getChatSession(sessionId)
  if (!session || session.status !== 'active') {
    return new Response(JSON.stringify({ error: 'Session not found or ended' }), { status: 404 })
  }

  // Check if another agent process is still running for this session
  if (isChatAgentRunning(sessionId)) {
    return new Response(JSON.stringify({ error: 'Agent is still processing' }), { status: 409 })
  }

  // Save user message
  saveChatMessage({
    id: `msg-${Date.now()}-${Math.floor(Math.random() * 10000)}`,
    sessionId,
    role: 'user',
    content: message.trim(),
  })

  // Get issue info for context (only needed for first message prompt)
  const decryptedToken = decrypt(project.accessToken)
  let issueTitle = `Issue #${iid}`
  let issueDescription = ''
  if (!session.cliSessionId) {
    // First message — fetch issue details for system prompt
    try {
      const issue = await fetchSingleIssue(project, Number(iid), decryptedToken)
      if (issue) {
        issueTitle = issue.title || issueTitle
        issueDescription = issue.description || ''
      }
    } catch { /* use defaults */ }
  }

  // Find the agent details
  const agent = session.agentId ? getAgent(session.agentId) : null
  if (!agent) {
    return new Response(JSON.stringify({ error: 'Agent not found' }), { status: 500 })
  }

  const currentLocale = await getLocale()

  // Stream response via SSE
  const encoder = new TextEncoder()
  const stream = new ReadableStream({
    async start(controller) {
      let fullResponse = ''
      try {
        const gen = runChatAgent({
          sessionId,
          cliSessionId: session.cliSessionId,
          project,
          agent,
          token: decryptedToken,
          issueIid: Number(iid),
          issueTitle,
          issueDescription,
          userMessage: message.trim(),
          workspacePath: session.workspacePath || '',
          userLocale: currentLocale,
        })

        for await (const chunk of gen) {
          if (chunk.type === 'text' && chunk.content) {
            fullResponse += chunk.content
            controller.enqueue(encoder.encode(`data: ${JSON.stringify(chunk)}\n\n`))
          } else if (chunk.type === 'done') {
            controller.enqueue(encoder.encode(`data: ${JSON.stringify({ type: 'done' })}\n\n`))
          } else if (chunk.type === 'error') {
            controller.enqueue(encoder.encode(`data: ${JSON.stringify(chunk)}\n\n`))
          }
          // session_id events are handled internally by chat-agent (saved to DB)
        }

        // Save assistant response
        if (fullResponse.trim()) {
          saveChatMessage({
            id: `msg-${Date.now()}-${Math.floor(Math.random() * 10000)}`,
            sessionId,
            role: 'assistant',
            content: fullResponse.trim(),
          })
        }
      } catch (err) {
        const errMsg = err instanceof Error ? err.message : 'Unknown error'
        controller.enqueue(encoder.encode(`data: ${JSON.stringify({ type: 'error', content: errMsg })}\n\n`))
      } finally {
        controller.close()
      }
    }
  })

  return new Response(stream, {
    headers: {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache, no-transform',
      'Connection': 'keep-alive',
      'Content-Encoding': 'none',
      'X-Accel-Buffering': 'no',
    },
  })
}
