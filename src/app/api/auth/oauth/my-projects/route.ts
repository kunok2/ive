import { NextResponse } from 'next/server'
import { getCurrentUser } from '@/lib/auth'
import { getUserOAuthTokenRaw, getOAuthProviderById } from '@/lib/db'
import { decrypt } from '@/lib/crypto'
import { fetchAllPages } from '@/lib/git-paging'

/**
 * OAuth로 로그인한 사용자가 가진 git 저장소 목록을 반환.
 *
 * 응답: { provider: 'github' | 'gitlab', total, projects: [{ id, name, fullPath, repoUrl, avatarUrl, defaultBranch, visibility, openIssuesCount }] }
 * 전체 목록을 한 번에 돌려주고, 검색 필터는 클라이언트(피커)가 입력 즉시 수행한다.
 */
export async function GET() {
  const user = await getCurrentUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const raw = getUserOAuthTokenRaw(user.id)
  if (!raw || !raw.encrypted || !raw.providerId) {
    return NextResponse.json({ error: 'GitLab/GitHub 계정이 연결되어 있지 않습니다. GitLab/GitHub 계정으로 다시 로그인해 주세요.' }, { status: 400 })
  }
  const provider = getOAuthProviderById(raw.providerId)
  if (!provider) {
    return NextResponse.json({ error: 'OAuth 공급자를 찾을 수 없습니다' }, { status: 400 })
  }

  let token: string
  try {
    token = decrypt(raw.encrypted)
  } catch {
    return NextResponse.json({ error: '저장된 Git 계정 연결 정보를 읽지 못했습니다. 로그아웃한 뒤 GitLab/GitHub 계정으로 다시 로그인해 주세요.' }, { status: 500 })
  }

  try {
    if (provider.type === 'github') {
      return await fetchGitHubRepos(token)
    }
    return await fetchGitLabProjects(provider.baseUrl, token)
  } catch (err) {
    console.error('[oauth/my-projects] failed:', err)
    return NextResponse.json({ error: '프로젝트 목록 조회에 실패했습니다' }, { status: 400 })
  }
}

// 사용자가 가진 저장소를 모두 받는다(최대 1000개).
// 피커가 받은 목록을 입력 즉시 클라이언트에서 거르므로, 검색어로 서버를 다시 부르지 않는다.
const MAX_PAGES = 10

async function fetchGitHubRepos(token: string) {
  const res = await fetchAllPages(
    'https://api.github.com/user/repos?sort=pushed&affiliation=owner,collaborator,organization_member',
    {
      'Authorization': `Bearer ${token}`,
      'Accept': 'application/vnd.github+json',
      'X-GitHub-Api-Version': '2022-11-28',
    },
    MAX_PAGES,
  )
  if (!res.ok) {
    return NextResponse.json({ error: `GitHub API 오류 (${res.status}): ${res.statusText}` }, { status: 400 })
  }
  const repos = res.items

  return NextResponse.json({
    provider: 'github',
    total: repos.length,
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

async function fetchGitLabProjects(baseUrl: string, token: string) {
  const headers = { 'Authorization': `Bearer ${token}` }
  const apiBase = `${baseUrl.replace(/\/+$/, '')}/api/v4`

  // membership=true → 내가 멤버인 프로젝트만, min_access_level=20 → Reporter 이상 (이슈 조회 가능)
  const params = new URLSearchParams({
    membership: 'true',
    order_by: 'last_activity_at',
    sort: 'desc',
    simple: 'false',
    min_access_level: '20',
  })
  const res = await fetchAllPages(`${apiBase}/projects?${params.toString()}`, headers, MAX_PAGES)
  if (!res.ok) {
    return NextResponse.json({ error: `GitLab API 오류 (${res.status}): ${res.statusText}` }, { status: 400 })
  }
  const projects = res.items
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
    total: projects.length,
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
