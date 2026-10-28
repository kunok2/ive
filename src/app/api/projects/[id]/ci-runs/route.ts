import { NextRequest, NextResponse } from 'next/server'
import { getCurrentUser } from '@/lib/auth'
import { getProject, getProjectAuthToken, getProjectAccess } from '@/lib/db'
import { fetchBranchPipelines } from '@/lib/provider'

// 아직 끝나지 않은 파이프라인 상태 — 돌고 있는 것(running 등)과 기다리는 것(pending 등)으로 나눈다
const RUNNING = new Set(['running', 'preparing'])
const WAITING = new Set(['pending', 'created', 'waiting_for_resource', 'scheduled', 'queued'])

// 작업취합 패널용 — 머지 대상 브랜치에서 지금 돌고 있거나 대기 중인 CI
export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const user = await getCurrentUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { id } = await params
  const project = getProject(id)
  if (!project || !getProjectAccess(id, user.id)) {
    return NextResponse.json({ error: 'Not found' }, { status: 404 })
  }

  let token: string
  try {
    token = getProjectAuthToken(id)
  } catch {
    return NextResponse.json({ error: 'Token decryption failed' }, { status: 500 })
  }

  const branch = project.baseBranch || 'main'
  const pipelines = ((await fetchBranchPipelines(project, token, branch)) || []) as any[]
  const runs = pipelines
    .filter(p => RUNNING.has(p.status) || WAITING.has(p.status))
    .map(p => ({
      id: p.id,
      status: p.status,
      state: RUNNING.has(p.status) ? 'running' : 'waiting',
      sha: p.sha ? String(p.sha).slice(0, 8) : null,
      webUrl: p.web_url || null,
      createdAt: p.created_at || null,
    }))

  return NextResponse.json({
    branch,
    runningCount: runs.filter(r => r.state === 'running').length,
    waitingCount: runs.filter(r => r.state === 'waiting').length,
    runs,
  })
}
