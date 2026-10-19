import { NextRequest, NextResponse } from 'next/server'
import { getDb, getProject, getProjectAccess, getUserById, getUserByGitUsername, getAgent } from '@/lib/db'
import { getCurrentUser } from '@/lib/auth'
import { verifyDecisions, confirmDecisions } from '@/lib/report-model/load'

/**
 * 작업 상세의 아바타를 눌렀을 때 보여 줄 작업자 카드.
 * 사람(IVE 사용자 / Git 계정만 있는 사람)이나 에이전트 한 명의 간단한 정보를 돌려준다.
 *
 * 식별 순서(사람): IVE 사용자 id → Git 계정(username, 프로젝트 provider 기준) → 이름이 한 명뿐일 때 그 사용자.
 * 에이전트는 사람처럼 가동률·바쁨 같은 부하 정보를 내지 않는다 — 같은 LLM 을 나눠 쓰는 실행 단위라서.
 */

const WINDOW_DAYS = 30

function gitProfileUrl(repoUrl: string, provider: 'github' | 'gitlab', username: string): string | null {
  try {
    const origin = new URL(repoUrl).origin
    return `${provider === 'github' ? 'https://github.com' : origin}/${encodeURIComponent(username)}`
  } catch { return null }
}

export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const user = await getCurrentUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { id: projectId } = await params
  const project = getProject(projectId)
  if (!project) return NextResponse.json({ error: 'not found' }, { status: 404 })
  if (!user.isAdmin && !getProjectAccess(projectId, user.id)) return NextResponse.json({ error: 'forbidden' }, { status: 403 })

  const q = req.nextUrl.searchParams
  const agentId = q.get('agentId')
  const userId = q.get('userId')
  const username = q.get('username')?.trim() || null
  const name = q.get('name')?.trim() || null

  if (agentId) {
    const agent = getAgent(agentId)
    if (!agent) return NextResponse.json({ kind: 'agent', name: name ?? '', avatar: null, cliName: null, model: null })
    return NextResponse.json({ kind: 'agent', name: agent.name, avatar: agent.avatar, cliName: agent.cliName, model: agent.modelName || null })
  }

  let u = userId ? getUserById(userId) : null
  if (!u && username) u = getUserByGitUsername(project.provider, username)
  if (!u && name) {
    const rows = getDb().prepare('SELECT id FROM users WHERE TRIM(name) = TRIM(?) COLLATE NOCASE LIMIT 2').all(name) as { id: string }[]
    if (rows.length === 1) u = getUserById(rows[0].id)
  }

  const gitUsername = username ?? (u ? (project.provider === 'github' ? u.githubUsername : u.gitlabUsername) ?? null : null)
  const base = {
    kind: 'person' as const,
    linked: !!u,
    name: u?.name ?? name ?? username ?? '',
    avatar: u?.avatar ?? null,
    userId: u?.id ?? null,
    email: u?.email ?? null,
    memberSince: u?.createdAt ?? null,
    gitUsername,
    gitUrl: gitUsername ? gitProfileUrl(project.repoUrl, project.provider, gitUsername) : null,
    provider: project.provider,
  }
  if (!u) return NextResponse.json({ ...base, stats: null })

  // 이 프로젝트에서 최근 30일간 이 사람이 내린 검증·확인 판정 — 보고서 「누가 검증·확인했나」와 같은 기록·같은 기준
  const end = new Date()
  const start = new Date(end.getTime() - WINDOW_DAYS * 86_400_000)
  const mine = <T extends { userId: string | null; byAgent: boolean }>(rows: T[]) => rows.filter(r => !r.byAgent && r.userId === u!.id)
  const verify = mine(verifyDecisions([projectId], start.toISOString(), end.toISOString())).filter(d => d.approvedAt || d.rejectedAt)
  const confirm = mine(confirmDecisions([projectId], start.toISOString(), end.toISOString())).filter(d => d.acceptedAt || d.rejectedAt)
  return NextResponse.json({
    ...base,
    stats: {
      days: WINDOW_DAYS,
      verify: verify.length,
      confirm: confirm.length,
      rejected: verify.filter(d => d.rejectedAt).length + confirm.filter(d => d.rejectedAt).length,
    },
  })
}
