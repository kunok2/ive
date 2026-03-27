import { NextResponse } from 'next/server'
import { getCurrentUser } from '@/lib/auth'
import { getProject } from '@/lib/db'
import { decrypt } from '@/lib/crypto'
import { AuthType, detectProvider } from '@/types'

export async function POST(req: Request) {
  const user = await getCurrentUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { repoUrl, authType, gitUsername, accessToken, projectId } = await req.json() as {
    repoUrl: string
    authType: AuthType
    gitUsername: string
    accessToken: string
    projectId?: string
  }

  if (!repoUrl) {
    return NextResponse.json({ error: '저장소 URL을 입력해주세요' }, { status: 400 })
  }

  // 인증 정보 결정: 새로 입력된 토큰 우선, 없으면 기존 프로젝트의 저장된 토큰 사용
  let token = accessToken
  let username = gitUsername
  let authMode = authType || 'token'

  if (!token && projectId) {
    const existing = getProject(projectId)
    if (existing && existing.userId === user.id) {
      try {
        token = decrypt(existing.accessToken)
      } catch {
        token = existing.accessToken
      }
      if (!username) username = existing.gitUsername
      if (!authType) authMode = existing.authType
    }
  }

  if (!token) {
    return NextResponse.json({ error: '인증 정보를 입력해주세요' }, { status: 400 })
  }

  if (authMode === 'basic' && !username) {
    return NextResponse.json({ error: 'Git 사용자 이름을 입력해주세요' }, { status: 400 })
  }

  const provider = detectProvider(repoUrl)

  try {
    if (provider === 'github') {
      return await testGitHub(repoUrl, token)
    } else {
      return await testGitLab(repoUrl, token, authMode, username)
    }
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    return NextResponse.json({ error: `연결 실패: ${msg}` }, { status: 400 })
  }
}

async function testGitHub(repoUrl: string, token: string) {
  const headers: Record<string, string> = {
    'Authorization': `Bearer ${token}`,
    'Accept': 'application/vnd.github+json',
  }

  // 1단계: 인증 확인
  const userRes = await fetch('https://api.github.com/user', { headers })
  if (!userRes.ok) {
    if (userRes.status === 401) {
      return NextResponse.json({ error: '인증 실패: 토큰이 올바르지 않거나 만료되었습니다' }, { status: 400 })
    }
    return NextResponse.json({ error: `인증 확인 실패 (${userRes.status}): ${userRes.statusText}` }, { status: 400 })
  }
  const gitUser = await userRes.json()

  // 2단계: 리포지토리 정보 조회
  const cleanUrl = repoUrl.replace(/\.git$/, '').replace(/\/+$/, '')
  const url = new URL(cleanUrl)
  const ownerRepo = (url.pathname.startsWith('/') ? url.pathname.slice(1) : url.pathname).replace(/\/+$/, '')

  const repoRes = await fetch(`https://api.github.com/repos/${ownerRepo}`, { headers })
  if (!repoRes.ok) {
    if (repoRes.status === 404) {
      return NextResponse.json({
        error: `인증은 성공했지만 (${gitUser.login}), 리포지토리 "${ownerRepo}"를 찾을 수 없습니다. URL 또는 접근 권한을 확인하세요.`
      }, { status: 400 })
    }
    if (repoRes.status === 403) {
      return NextResponse.json({
        error: `"${gitUser.login}" 계정에 이 리포지토리 접근 권한이 없습니다`
      }, { status: 400 })
    }
    return NextResponse.json({ error: `GitHub API 오류 (${repoRes.status}): ${repoRes.statusText}` }, { status: 400 })
  }

  const repo = await repoRes.json()

  return NextResponse.json({
    success: true,
    project: {
      name: repo.name,
      fullPath: repo.full_name,
      defaultBranch: repo.default_branch,
      visibility: repo.private ? 'private' : 'public',
      openIssuesCount: repo.open_issues_count,
      avatarUrl: repo.owner?.avatar_url || '',
      user: gitUser.login,
      userAvatarUrl: gitUser.avatar_url || '',
    }
  })
}

async function testGitLab(repoUrl: string, token: string, authMode: string, username: string) {
  const cleanUrl = repoUrl.replace(/\.git$/, '').replace(/\/+$/, '')
  const url = new URL(cleanUrl)
  const pathStr = (url.pathname.startsWith('/') ? url.pathname.slice(1) : url.pathname).replace(/\/+$/, '')
  const projectPath = encodeURIComponent(pathStr)
  const apiBase = `${url.protocol}//${url.host}/api/v4`

  const headers: Record<string, string> = {}
  if (authMode === 'basic') {
    headers['Authorization'] = `Basic ${Buffer.from(`${username}:${token}`).toString('base64')}`
  } else {
    headers['PRIVATE-TOKEN'] = token
  }

  // 1단계: 인증 정보 먼저 확인
  const userRes = await fetch(`${apiBase}/user`, { headers })
  if (!userRes.ok) {
    if (userRes.status === 401) {
      if (authMode === 'basic') {
        return NextResponse.json({
          error: '인증 실패: 사용자 이름 또는 비밀번호가 올바르지 않습니다. GitLab API는 비밀번호 대신 Personal Access Token이 필요할 수 있습니다.'
        }, { status: 400 })
      }
      return NextResponse.json({ error: '인증 실패: 토큰이 올바르지 않거나 만료되었습니다' }, { status: 400 })
    }
    return NextResponse.json({ error: `인증 확인 실패 (${userRes.status}): ${userRes.statusText}` }, { status: 400 })
  }
  const gitUser = await userRes.json()

  // 2단계: 프로젝트 정보 조회
  const res = await fetch(`${apiBase}/projects/${projectPath}`, { headers })
  if (!res.ok) {
    if (res.status === 404) {
      return NextResponse.json({
        error: `인증은 성공했지만 (${gitUser.username}), 프로젝트 "${pathStr}"를 찾을 수 없습니다. URL 또는 접근 권한을 확인하세요.`
      }, { status: 400 })
    }
    if (res.status === 403) {
      return NextResponse.json({
        error: `"${gitUser.username}" 계정에 이 프로젝트 접근 권한이 없습니다`
      }, { status: 400 })
    }
    return NextResponse.json({ error: `GitLab API 오류 (${res.status}): ${res.statusText}` }, { status: 400 })
  }

  const project = await res.json()

  return NextResponse.json({
    success: true,
    project: {
      name: project.name,
      fullPath: project.path_with_namespace,
      defaultBranch: project.default_branch,
      visibility: project.visibility,
      openIssuesCount: project.open_issues_count,
      avatarUrl: project.avatar_url || '',
      user: gitUser.username,
      userAvatarUrl: gitUser.avatar_url || '',
    }
  })
}
