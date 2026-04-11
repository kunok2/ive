import { NextResponse } from 'next/server'
import { getCurrentUser } from '@/lib/auth'
import { getUserOAuthTokenRaw, getOAuthProviderById } from '@/lib/db'
import { decrypt } from '@/lib/crypto'

/**
 * OAuth로 로그인한 사용자가 가진 git 저장소 목록을 반환.
 *
 * 응답: { provider: 'github' | 'gitlab', projects: [{ id, name, fullPath, repoUrl, avatarUrl, defaultBranch, visibility, openIssuesCount }] }
 *
 * 쿼리 파라미터:
 *   - q: 검색어 (선택)
 *   - page: 페이지 (기본 1)
 *   - per_page: 페이지당 개수 (기본 30, 최대 100)
 */
export async function GET(req: Request) {
  const user = await getCurrentUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const raw = getUserOAuthTokenRaw(user.id)
  if (!raw || !raw.encrypted || !raw.providerId) {
    return NextResponse.json({ error: '연결된 OAuth 토큰이 없습니다' }, { status: 400 })
  }
  const provider = getOAuthProviderById(raw.providerId)
  if (!provider) {
    return NextResponse.json({ error: 'OAuth 공급자를 찾을 수 없습니다' }, { status: 400 })
  }

  let token: string
  try {
    token = decrypt(raw.encrypted)
  } catch {
    return NextResponse.json({ error: 'OAuth 토큰 복호화 실패' }, { status: 500 })
  }

  const url = new URL(req.url)
  const q = (url.searchParams.get('q') || '').trim()
  const page = Math.max(1, Number(url.searchParams.get('page') || '1') || 1)
  const perPage = Math.min(100, Math.max(1, Number(url.searchParams.get('per_page') || '30') || 30))

  try {
    if (provider.type === 'github') {
      return await fetchGitHubRepos(token, q, page, perPage)
    }
    return await fetchGitLabProjects(provider.baseUrl, token, q, page, perPage)
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    return NextResponse.json({ error: `프로젝트 목록 조회 실패: ${msg}` }, { status: 400 })
  }
}

async function fetchGitHubRepos(token: string, q: string, page: number, perPage: number) {
  const headers = {
    'Authorization': `Bearer ${token}`,
    'Accept': 'application/vnd.github+json',
    'X-GitHub-Api-Version': '2022-11-28',
  }

  // GitHub /user/repos는 search 파라미터를 지원하지 않음 → 큰 목록을 받아와 서버에서 필터링
  // (일반 사용자가 가진 저장소는 수백 개 이내로 가정)
  const listUrl = q
    ? `https://api.github.com/user/repos?per_page=100&sort=pushed&affiliation=owner,collaborator,organization_member`
    : `https://api.github.com/user/repos?per_page=${perPage}&page=${page}&sort=pushed&affiliation=owner,collaborator,organization_member`

  const res = await fetch(listUrl, { headers })
  if (!res.ok) {
    return NextResponse.json({ error: `GitHub API 오류 (${res.status}): ${res.statusText}` }, { status: 400 })
  }
  let repos = await res.json() as any[]
  let total = repos.length

  if (q) {
    const needle = q.toLowerCase()
    repos = repos.filter(r =>
      r.name?.toLowerCase().includes(needle) ||
      r.full_name?.toLowerCase().includes(needle) ||
      (r.description && r.description.toLowerCase().includes(needle))
    )
    total = repos.length
    repos = repos.slice((page - 1) * perPage, page * perPage)
  }

  return NextResponse.json({
    provider: 'github',
    page,
    perPage,
    hasMore: repos.length === perPage,
    total,
    projects: repos.map(r => ({
      id: String(r.id),
      name: r.name,
      fullPath: r.full_name,
      description: r.description || '',
      repoUrl: r.html_url,
      cloneUrl: r.clone_url,
      avatarUrl: r.owner?.avatar_url || '',
      defaultBranch: r.default_branch,
      visibility: r.private ? 'private' : 'public',
      openIssuesCount: r.open_issues_count ?? 0,
      lastActivityAt: r.pushed_at || r.updated_at || null,
    })),
  })
}

async function fetchGitLabProjects(baseUrl: string, token: string, q: string, page: number, perPage: number) {
  const headers = { 'Authorization': `Bearer ${token}` }
  const apiBase = `${baseUrl.replace(/\/+$/, '')}/api/v4`

  // membership=true → 내가 멤버인 프로젝트만, min_access_level=20 → Reporter 이상 (이슈 조회 가능)
  const params = new URLSearchParams({
    membership: 'true',
    order_by: 'last_activity_at',
    sort: 'desc',
    per_page: String(perPage),
    page: String(page),
    simple: 'false',
    min_access_level: '20',
  })
  if (q) params.set('search', q)

  const res = await fetch(`${apiBase}/projects?${params.toString()}`, { headers })
  if (!res.ok) {
    return NextResponse.json({ error: `GitLab API 오류 (${res.status}): ${res.statusText}` }, { status: 400 })
  }
  const projects = await res.json() as any[]
  const total = Number(res.headers.get('x-total') || '0')
  const baseOrigin = baseUrl.replace(/\/+$/, '')

  // GitLab은 avatar_url이 상대경로(/uploads/...)인 경우가 많고, private 프로젝트는 인증 헤더가 필요해
  // 브라우저 <img>로는 불러올 수 없음 → 절대경로 + 인증 필요한 상대경로는 빈값으로 처리(클라이언트 폴백)
  const normalizeAvatar = (url: string | null | undefined): string => {
    if (!url) return ''
    if (/^https?:\/\//i.test(url)) {
      // /uploads/ 경로는 GitLab 인증이 필요하므로 브라우저에서 로드 불가
      if (url.includes('/uploads/')) return ''
      return url
    }
    // 상대경로 — /uploads/는 스킵, 그 외는 절대경로로 변환
    if (url.includes('/uploads/')) return ''
    return `${baseOrigin}${url.startsWith('/') ? '' : '/'}${url}`
  }

  return NextResponse.json({
    provider: 'gitlab',
    page,
    perPage,
    hasMore: projects.length === perPage,
    total,
    projects: projects.map(p => ({
      id: String(p.id),
      name: p.name,
      fullPath: p.path_with_namespace,
      description: p.description || '',
      repoUrl: p.web_url,
      cloneUrl: p.http_url_to_repo,
      avatarUrl: normalizeAvatar(p.avatar_url),
      defaultBranch: p.default_branch,
      visibility: p.visibility,
      openIssuesCount: p.open_issues_count ?? 0,
      lastActivityAt: p.last_activity_at || null,
    })),
  })
}
