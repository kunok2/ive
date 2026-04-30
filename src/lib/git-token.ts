/**
 * Git API 호출 시 사용할 토큰 결정 공통 모듈.
 *
 * 대원칙:
 *   1) 로그인한 사용자가 OAuth로 접속한 상태이고 프로젝트 provider와 타입이 일치하면
 *      → 접속자의 OAuth 토큰을 최우선으로 시도 (이슈 작성자/머지 수행자가 실제 사용자로 기록)
 *   2) 1) 이 없거나 실패한 경우
 *      → 프로젝트의 공식 토큰으로 fallback
 *   3) 프로젝트 토큰은 project.usesOAuthToken 에 따라
 *      - true  → 프로젝트 생성자의 OAuth 토큰 (Authorization: Bearer)
 *      - false → 저장된 PAT (GitLab: PRIVATE-TOKEN / GitHub: Bearer)
 *
 * 이 원칙을 이슈 생성, MR 머지 등 모든 "사용자 행위" Git 호출에서 동일하게 적용하기 위해
 * withGitToken() 헬퍼로 묶는다. 호출부는 apiFn(ctx) 만 구현하면 fallback 이 자동 처리된다.
 *
 * 레이블 생성/확인 같은 "프로젝트 레벨 config 점검" 은 의도적으로 이 헬퍼를 쓰지 않고
 * getProjectTokenCtx 만 직접 사용한다 (접속자 권한과 분리).
 */
import { User, Project } from '@/types'
import {
  getUserOAuthTokenRaw,
  getUserOAuthFullRaw,
  getOAuthProviderById,
  getOAuthProviderRaw,
  getProjectAuthToken,
  updateUserOAuthTokens,
} from '@/lib/db'
import { decrypt, encrypt } from '@/lib/crypto'
import { refreshGitLabToken } from '@/lib/gitlab/common'

export interface GitTokenCtx {
  token: string
  /** true → Authorization: Bearer 헤더 사용. false → 공급자별 기본(GitLab PRIVATE-TOKEN / GitHub Bearer) */
  isOAuth: boolean
  source: 'user' | 'project'
}

/**
 * 만료가 임박했거나 이미 만료된 사용자 OAuth 토큰을 refresh_token으로 갱신.
 * 성공 시 DB에 새 토큰을 저장하고 평문 access_token 반환.
 * refresh_token이 없거나 provider 가 GitLab 이 아니거나 갱신 실패 시 null.
 *
 * 스캐너의 프로젝트 토큰 갱신 로직(scanner/index.ts)과 동일한 방식.
 */
async function refreshUserOAuthIfNeeded(
  userId: string,
  project: Project,
): Promise<string | null> {
  if (project.provider !== 'gitlab') return null  // GitHub OAuth refresh 미구현
  const full = getUserOAuthFullRaw(userId)
  if (!full?.providerId || !full.refreshEncrypted) return null

  const expiresAtMs = full.expiresAt ? new Date(full.expiresAt).getTime() : 0
  // 만료 10분 이내면 갱신
  if (expiresAtMs >= Date.now() + 10 * 60 * 1000) return null

  const providerRaw = getOAuthProviderRaw(full.providerId)
  if (!providerRaw) return null
  try {
    const refreshPlain = decrypt(full.refreshEncrypted)
    const clientSecretPlain = providerRaw.client_secret ? decrypt(providerRaw.client_secret) : ''
    const refreshed = await refreshGitLabToken(project.repoUrl, providerRaw.client_id, clientSecretPlain, refreshPlain)
    if (!refreshed?.access_token) return null

    const newExpiry = new Date(Date.now() + (refreshed.expires_in || 7200) * 1000).toISOString()
    updateUserOAuthTokens(userId, {
      accessTokenEncrypted: encrypt(refreshed.access_token),
      refreshTokenEncrypted: encrypt(refreshed.refresh_token || refreshPlain),
      tokenExpiresAt: newExpiry,
    })
    return refreshed.access_token
  } catch (e) {
    console.warn('[git-token] user OAuth refresh failed:', e instanceof Error ? e.message : e)
    return null
  }
}

/**
 * 접속자 OAuth 토큰을 담은 TokenContext 반환.
 * 아래 조건을 모두 만족할 때만 non-null:
 *   - user.oauthProviderId 설정됨
 *   - OAuth provider가 project.provider 와 타입 일치 (예: 둘 다 gitlab)
 *   - 복호화 성공
 *
 * 토큰 만료 10분 이내면 자동으로 refresh_token 으로 갱신 후 새 토큰 반환.
 */
export async function getUserTokenCtx(user: Pick<User, 'id' | 'oauthProviderId'>, project: Project): Promise<GitTokenCtx | null> {
  if (!user.oauthProviderId) return null
  const provider = getOAuthProviderById(user.oauthProviderId)
  if (!provider || provider.type !== project.provider) return null

  // 만료 임박 시 갱신 시도
  const refreshed = await refreshUserOAuthIfNeeded(user.id, project)
  if (refreshed) return { token: refreshed, isOAuth: true, source: 'user' }

  const raw = getUserOAuthTokenRaw(user.id)
  if (!raw?.encrypted) return null
  try {
    const token = decrypt(raw.encrypted)
    if (!token) return null
    return { token, isOAuth: true, source: 'user' }
  } catch (e) {
    console.warn('[git-token] user OAuth token decrypt failed:', e)
    return null
  }
}

/**
 * 프로젝트 공식 토큰 TokenContext 반환.
 * usesOAuthToken=true 면 프로젝트 생성자의 OAuth 토큰이 들어있으며 Bearer 로 전송돼야 함.
 * usesOAuthToken=false 면 저장된 PAT.
 */
export function getProjectTokenCtx(project: Project): GitTokenCtx {
  const token = getProjectAuthToken(project.id)
  return { token, isOAuth: !!project.usesOAuthToken, source: 'project' }
}

/**
 * 대원칙 구현: 사용자 토큰 우선 시도 → 실패 시 프로젝트 토큰 fallback.
 *
 * apiFn 은 주어진 TokenContext 로 Git API 를 호출하고 실패 시 throw 해야 한다.
 * 호출부는 `ctx.token` 과 `ctx.isOAuth` 를 API 함수에 그대로 전달하기만 하면 된다.
 *
 * 로그인 사용자가 OAuth 연동이 안 됐거나 provider 불일치면 처음부터 프로젝트 토큰 사용.
 */
export async function withGitToken<T>(
  user: Pick<User, 'id' | 'oauthProviderId'>,
  project: Project,
  apiFn: (ctx: GitTokenCtx) => Promise<T>,
): Promise<T> {
  const userCtx = await getUserTokenCtx(user, project)
  const projectCtx = getProjectTokenCtx(project)

  if (userCtx) {
    try {
      return await apiFn(userCtx)
    } catch (e) {
      // 사용자 토큰 권한 부족/만료 등 → 프로젝트 토큰으로 재시도
      console.warn(`[git-token] user token failed, falling back to project token:`, e instanceof Error ? e.message : e)
      return await apiFn(projectCtx)
    }
  }
  return await apiFn(projectCtx)
}

/**
 * Git API 에러를 사용자에게 친절한 한국어 메시지로 변환.
 * 원본 메시지에서 HTTP 상태 코드/GitLab 표준 에러를 감지해 의미 있는 안내로 바꾼다.
 * 매치되지 않으면 원본 메시지를 그대로 반환 (최소 원본은 보존).
 *
 * 사용 예:
 *   try { ... } catch (e) {
 *     return NextResponse.json({ error: friendlyGitError(e, '머지') }, { status: 400 })
 *   }
 */
export function friendlyGitError(err: unknown, action: string = '작업'): string {
  const raw = err instanceof Error ? err.message : String(err)
  const lower = raw.toLowerCase()

  // 401 Unauthorized — 토큰 유효하지 않거나 만료
  if (/\b401\b|unauthorized/.test(lower)) {
    return `Git 인증 실패: ${action} 권한이 없거나 토큰이 만료됐습니다. 로그아웃 후 다시 로그인하거나 프로젝트의 토큰을 확인하세요. (401 Unauthorized)`
  }
  // 403 Forbidden — 권한 부족
  if (/\b403\b|forbidden/.test(lower)) {
    return `Git 권한 부족: ${action} 권한이 없습니다. 저장소에서 해당 작업을 수행할 수 있는 역할(Maintainer+ 등)이 있는지 확인하세요. (403 Forbidden)`
  }
  // 405 Method Not Allowed — 주로 "not allowed to merge" (보호된 브랜치)
  if (/\b405\b|not allowed to merge|protected branch/.test(lower)) {
    return `보호된 브랜치 정책으로 ${action} 이 막혀있습니다. GitLab/GitHub의 브랜치 보호 설정에서 현재 사용자 역할에 ${action} 허용이 포함돼있는지 확인하세요. (405 Method Not Allowed)`
  }
  // 404 Not Found — 대상이 없거나 접근 권한 없음으로 숨겨짐
  if (/\b404\b|not found/.test(lower)) {
    return `Git 리소스를 찾을 수 없습니다. 삭제됐거나 접근 권한이 없을 수 있습니다. (404 Not Found)`
  }
  // 409 Conflict — 머지 충돌
  if (/\b409\b|conflict/.test(lower)) {
    return `${action} 충돌이 있습니다. Git에서 수동으로 충돌을 해결한 뒤 다시 시도하세요.`
  }
  // 422 — merge 불가 상태 (checking, cannot_be_merged 등)
  if (/\b422\b|cannot be merged|merge_status/.test(lower)) {
    return `${action}이 현재 불가능한 상태입니다. 파이프라인/충돌/승인 요건을 확인하세요.`
  }

  // 한국어 원본이 이미 있으면 그대로, 아니면 상태 코드만 뽑아 안내
  if (/[가-힣]/.test(raw)) return raw
  return `${action} 실패: ${raw}`
}
