import { NextResponse } from 'next/server'
import { getCurrentUser } from '@/lib/auth'
import {
  getMyVerifierQueue, getOAuthProviderById, getProject, getProjectAuthToken,
  stageFromLabels, hasActiveExecution, upsertIssueStageSnapshot,
} from '@/lib/db'
import { fetchAllProjectIssues } from '@/lib/provider'
import type { Project } from '@/types'

type QueueRow = {
  projectId: string; projectName: string; projectColor: string
  issueIid: number; issueTitle: string; stage: string; waitingSince: string | null
}

type GitPerson = { id?: number | string; username?: string; login?: string; name?: string; avatar_url?: string }
type LiveIssue = {
  iid: number; title?: string; labels?: string[]
  assignees?: GitPerson[]; author?: GitPerson | null
}

/**
 * 캐시(issue_stages)가 신선한지 — 스캐너가 활성이고 최근(2주기 + 60초 여유) 체크됐으면 true.
 * 신선하면 라이브 Git 호출 없이 캐시를 신뢰한다. phantom 은 스캐너가 안 도는 프로젝트에서만
 * 생기므로, 그런 stale/비활성 프로젝트의 row 만 라이브로 재검증한다.
 */
function isCacheFresh(project: Project): boolean {
  if (!project.scannerActive) return false
  if (!project.lastCheckedAt) return false
  const last = new Date(project.lastCheckedAt).getTime()
  if (Number.isNaN(last)) return false
  const intervalMs = Math.max(1, project.checkInterval) * 60_000
  return Date.now() - last <= intervalMs * 2 + 60_000
}

/** 라이브 이슈에서 stage + 책임자(assignee[0] 또는 author) git user id 도출. */
function deriveStageAndOwner(project: Project, issue: LiveIssue): { stage: string | null; ownerId: string | null } {
  const labels: string[] = issue.labels || []
  const activeExec = hasActiveExecution(project.id, issue.iid)
  const stage = stageFromLabels(labels, project, { hasActiveExec: activeExec })
  const owner = (issue.assignees && issue.assignees.length > 0) ? issue.assignees[0] : (issue.author || null)
  const ownerId = owner && owner.id != null ? String(owner.id) : null
  return { stage, ownerId }
}

/** phantom 으로 판명된 행의 캐시를 라이브 진실로 갱신 — 다음 폴링부터 재검증/재집계 불필요. */
function healStaleSnapshot(project: Project, iid: number, issue: LiveIssue | null) {
  try {
    if (!issue) {
      // 라이브 Open 목록에 없음 → 닫혔거나 IVE 레이블 제거. 스캐너 stale 정리와 동일하게 done 처리.
      upsertIssueStageSnapshot(project.id, iid, {
        cachedStage: 'done',
        assigneeUsername: null, assigneeName: null, assigneeAvatar: null,
        assigneeProvider: project.provider, assigneeGitUserId: null, issueTitle: null,
      })
      return
    }
    const { stage } = deriveStageAndOwner(project, issue)
    const owner = (issue.assignees && issue.assignees.length > 0) ? issue.assignees[0] : (issue.author || null)
    upsertIssueStageSnapshot(project.id, iid, {
      cachedStage: stage,
      assigneeUsername: owner ? (owner.username || owner.login || null) : null,
      assigneeName: owner ? (owner.name || owner.username || owner.login || null) : null,
      assigneeAvatar: owner ? (owner.avatar_url || null) : null,
      assigneeProvider: project.provider,
      assigneeGitUserId: owner && owner.id != null ? String(owner.id) : null,
      issueTitle: issue.title || null,
    })
  } catch { /* heal 실패는 무시 — 다음 스캔/폴링에서 재시도 */ }
}

/**
 * 캐시 후보 행을 라이브 Git 상태로 검증해 phantom(닫힘/재배정/단계변경) 제거.
 * 신선한 프로젝트는 라이브 호출 없이 통과시켜 Git API 부하를 최소화한다.
 */
async function reconcileLiveStale(rows: QueueRow[], oauthUserId: string): Promise<QueueRow[]> {
  if (rows.length === 0) return rows

  const byProject = new Map<string, QueueRow[]>()
  for (const r of rows) {
    const arr = byProject.get(r.projectId) || []
    arr.push(r)
    byProject.set(r.projectId, arr)
  }

  const result: QueueRow[] = []
  for (const [projectId, group] of byProject) {
    const project = getProject(projectId)
    if (!project) continue // 프로젝트 삭제됨 → phantom (집계 제외)

    if (isCacheFresh(project)) {
      // 스캐너가 캐시를 신선하게 유지 중 — 신뢰
      result.push(...group)
      continue
    }

    // stale/비활성 프로젝트 — 라이브 Open 이슈로 검증
    let liveIssues: LiveIssue[]
    try {
      liveIssues = await fetchAllProjectIssues(project, getProjectAuthToken(projectId))
    } catch {
      // 라이브 조회 실패(토큰/네트워크 일시 오류) — 정상 큐를 숨기지 않도록 캐시값 유지
      result.push(...group)
      continue
    }

    const liveMap = new Map<number, LiveIssue>()
    for (const it of liveIssues) liveMap.set(it.iid, it)

    for (const r of group) {
      const it = liveMap.get(r.issueIid) || null
      const { stage, ownerId } = it ? deriveStageAndOwner(project, it) : { stage: null, ownerId: null }
      const stillValid = (stage === 'verify_waiting' || stage === 'verifying') && ownerId === String(oauthUserId)
      if (stillValid) {
        result.push({ ...r, stage: stage as string })
      } else {
        healStaleSnapshot(project, r.issueIid, it)
      }
    }
  }
  return result
}

/**
 * 현재 로그인한 사용자의 "내 검증 대기/중" 이슈 목록.
 * OAuth 로그인 시 저장된 provider user id를 assignee.git_user_id와 매칭합니다.
 * issue_stages 캐시를 라이브 Git 상태로 재검증해 phantom 을 제거합니다.
 *
 * 쿼리 파라미터:
 *   ?counts=1  → 개수만 반환 (뱃지용)
 */
export async function GET(req: Request) {
  const user = await getCurrentUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const url = new URL(req.url)
  const countsOnly = url.searchParams.get('counts') === '1'

  // OAuth 로그인 유저가 아니면 매칭 불가 — 빈 결과
  if (!user.oauthProviderId || !user.oauthUserId) {
    return countsOnly
      ? NextResponse.json({ verifyWaiting: 0, verifying: 0, total: 0, matched: false })
      : NextResponse.json({ issues: [], matched: false })
  }

  const provider = getOAuthProviderById(user.oauthProviderId)
  if (!provider) {
    return countsOnly
      ? NextResponse.json({ verifyWaiting: 0, verifying: 0, total: 0, matched: false })
      : NextResponse.json({ issues: [], matched: false })
  }

  const candidates = getMyVerifierQueue(user.id, user.oauthUserId, provider.type)
  const issues = await reconcileLiveStale(candidates, user.oauthUserId)

  if (countsOnly) {
    const verifyWaiting = issues.filter(i => i.stage === 'verify_waiting').length
    const verifying = issues.filter(i => i.stage === 'verifying').length
    return NextResponse.json({ verifyWaiting, verifying, total: issues.length, matched: true })
  }

  return NextResponse.json({ issues, matched: true })
}
