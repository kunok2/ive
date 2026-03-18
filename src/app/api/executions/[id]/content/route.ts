import { NextRequest } from 'next/server'
import fs from 'fs'
import { getExecution, getAgent } from '@/lib/db'

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params
  const execution = getExecution(id)

  if (!execution || !fs.existsSync(execution.logPath)) {
    return Response.json({ content: '', status: 'not_found' })
  }

  const agent = getAgent(execution.agentId)
  const content = fs.readFileSync(execution.logPath, 'utf-8')
  return Response.json({
    content,
    status: execution.status,
    issueIid: execution.issueIid,
    issueTitle: execution.issueTitle ?? '',
    startedAt: execution.startedAt,
    agentName: agent?.name ?? execution.agentName ?? '',
    agentAvatar: agent?.avatar ?? 'av-01',
  })
}
