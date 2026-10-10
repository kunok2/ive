import { NextResponse } from 'next/server'
import { getCurrentUser } from '@/lib/auth'
import { getProject, getProjectAccess, getProjectAuthToken } from '@/lib/db'
import { fetchAllPages } from '@/lib/git-paging'

export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const user = await getCurrentUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { id } = await params
  const project = getProject(id)
  if (!project) return NextResponse.json({ error: 'Not found' }, { status: 404 })

  const access = getProjectAccess(id, user.id)
  if (!access) return NextResponse.json({ error: '이 프로젝트에서 이 작업을 할 권한이 없습니다. 프로젝트 소유자에게 권한을 요청해 주세요.' }, { status: 403 })

  const token = getProjectAuthToken(id)
  if (!token) return NextResponse.json({ branches: [] })

  try {
    const branches = await fetchBranches(
      project.provider,
      project.repoUrl,
      token,
      project.authType,
      project.gitUsername,
      project.usesOAuthToken,
    )
    return NextResponse.json({ branches })
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    return NextResponse.json({ error: msg, branches: [] }, { status: 400 })
  }
}

async function fetchBranches(
  provider: 'github' | 'gitlab',
  repoUrl: string,
  token: string,
  authType: string,
  gitUsername: string,
  usesOAuthToken: boolean,
): Promise<string[]> {
  const cleanUrl = repoUrl.replace(/\.git$/, '').replace(/\/+$/, '')
  const url = new URL(cleanUrl)
  const pathStr = (url.pathname.startsWith('/') ? url.pathname.slice(1) : url.pathname).replace(/\/+$/, '')

  if (provider === 'github') {
    const res = await fetchAllPages(`https://api.github.com/repos/${pathStr}/branches`, {
      'Authorization': `Bearer ${token}`,
      'Accept': 'application/vnd.github+json',
    })
    if (!res.ok) throw new Error(`GitHub API ${res.status}: ${res.statusText}`)
    return res.items.map((b: any) => b.name).filter(Boolean)
  }

  const apiBase = `${url.protocol}//${url.host}/api/v4`
  const projectPath = encodeURIComponent(pathStr)
  const headers: Record<string, string> = {}
  if (authType === 'basic') {
    headers['Authorization'] = `Basic ${Buffer.from(`${gitUsername}:${token}`).toString('base64')}`
  } else if (usesOAuthToken) {
    // OAuth 토큰은 Authorization: Bearer 사용. PRIVATE-TOKEN은 PAT 전용.
    headers['Authorization'] = `Bearer ${token}`
  } else {
    headers['PRIVATE-TOKEN'] = token
  }
  const res = await fetchAllPages(`${apiBase}/projects/${projectPath}/repository/branches`, headers)
  if (!res.ok) throw new Error(`GitLab API ${res.status}: ${res.statusText}`)
  return res.items.map((b: any) => b.name).filter(Boolean)
}
