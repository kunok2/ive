import { NextRequest, NextResponse } from 'next/server'
import { getProject, getProjectAuthToken, touchProjectActivity, hasAnyExecution } from '@/lib/db'
import { addIssueComment, fetchSingleIssue, updateIssue } from '@/lib/provider'
import { friendlyGitError } from '@/lib/git-token'
import { verifyReportToken } from '@/lib/report-token'

/**
 * 접수 보완 노트 — **이미 선 작업에 덧붙인다.**
 *
 * 왜 필요한가:
 *   설치처에서 규칙 요청을 낸 뒤 덧붙일 말이 생기면 지금까지는 접수를 한 건 더 냈다.
 *   그러면 같은 일로 이슈가 둘 서고, 받는 쪽은 둘이 같은 일인지 모른다.
 *   `/api/report` 는 **이슈를 만드는 창구**뿐이라 덧붙일 자리가 없었다 — 그 자리가 여기다.
 *
 * ⛔ **아직 한 번도 안 돈 작업이면 이슈 본문에도 덧붙인다.**
 *    에이전트의 1차 프롬프트에는 **이슈 본문만** 실린다(코멘트는 2차 이후의 피드백으로 읽힌다).
 *    코멘트만 달면 아직 대기 중인 작업에서는 그 보완이 **에이전트에게 아예 안 간다.**
 *    이미 돈 작업이면 본문을 건드리지 않는다 — 본문은 "원래 의뢰"로 남고, 보완은 코멘트로
 *    들어가 다음 회차의 사용자 피드백이 된다(검수 단계에서 적용된다).
 */

const MAX_CONTENT_LENGTH = 10000

// Rate limiting store (in-memory, single-instance)
const rateLimitStore = new Map<string, number[]>()

setInterval(() => {
  const now = Date.now()
  const maxAge = 30 * 60 * 1000
  for (const [key, timestamps] of rateLimitStore.entries()) {
    const recent = timestamps.filter(t => now - t < maxAge)
    if (recent.length === 0) rateLimitStore.delete(key)
    else rateLimitStore.set(key, recent)
  }
}, 5 * 60 * 1000)

function checkRateLimit(key: string, windowMs: number, maxRequests: number): boolean {
  const now = Date.now()
  const timestamps = rateLimitStore.get(key) ?? []
  const recent = timestamps.filter(t => now - t < windowMs)
  if (recent.length >= maxRequests) return false
  recent.push(now)
  rateLimitStore.set(key, recent)
  return true
}

// XSS 필터링 — /api/report 와 같은 규칙
function sanitizeContent(content: string): string {
  return content
    .replace(/<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi, '')
    .replace(/<iframe\b[^>]*>.*?<\/iframe>/gi, '')
    .replace(/<object\b[^>]*>.*?<\/object>/gi, '')
    .replace(/<embed\b[^>]*>.*?<\/embed>/gi, '')
    .replace(/javascript:/gi, '')
}

export async function POST(req: NextRequest) {
  const body = await req.json()
  const { projectId, token, nonce, timestamp, expires, iid, content } = body

  if (!projectId) return NextResponse.json({ error: '프로젝트 ID가 필요합니다.' }, { status: 400 })
  if (!token) return NextResponse.json({ error: '접근 토큰이 필요합니다.' }, { status: 400 })
  if (!content?.trim()) return NextResponse.json({ error: '내용을 입력하세요.' }, { status: 400 })

  const issueIid = Number(iid)
  if (!Number.isInteger(issueIid) || issueIid <= 0) {
    return NextResponse.json({ error: '보완할 작업 번호가 올바르지 않습니다.' }, { status: 400 })
  }

  // Rate limiting: IP 기준 1분 내 10회 (보완은 접수보다 잦다)
  const ip = req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ?? req.headers.get('x-real-ip') ?? 'unknown'
  if (!checkRateLimit(`report-note:ip:${ip}`, 60 * 1000, 10)) {
    return NextResponse.json({ error: '요청이 너무 많습니다. 잠시 후 다시 시도해주세요.' }, { status: 429 })
  }
  if (!checkRateLimit(`report-note:token:${token}`, 10 * 1000, 1)) {
    return NextResponse.json({ error: '잠시 후 다시 시도해주세요.' }, { status: 429 })
  }

  const project = getProject(projectId)
  if (!project) return NextResponse.json({ error: 'Project not found' }, { status: 404 })
  if (!project.reportSecret) {
    return NextResponse.json({ error: 'Report page is not enabled' }, { status: 403 })
  }

  const tokenVerify = verifyReportToken(project.reportSecret, projectId, token, nonce, timestamp, expires)
  if (!tokenVerify.valid) {
    return NextResponse.json({ error: 'Invalid or expired token' }, { status: 403 })
  }

  const cleanContent = sanitizeContent(String(content).trim().slice(0, MAX_CONTENT_LENGTH))
  if (!cleanContent) return NextResponse.json({ error: '내용을 입력하세요.' }, { status: 400 })

  const authToken = getProjectAuthToken(projectId)
  if (!authToken) return NextResponse.json({ error: '프로젝트 토큰이 설정되지 않았습니다.' }, { status: 500 })

  try {
    // ⛔ 이슈가 실제로 있는지 먼저 본다 — 없는 번호에 코멘트를 달면 Git API 오류가 500 으로
    //    올라가, 설치처 화면에는 "보완 실패"만 뜨고 왜인지 알 수 없다.
    const issue = await fetchSingleIssue(project, issueIid, authToken)
    if (!issue) {
      return NextResponse.json({ error: `작업 #${issueIid} 을 찾지 못했습니다.` }, { status: 404 })
    }

    await addIssueComment(project, issueIid, authToken, cleanContent, { isOAuth: project.usesOAuthToken })

    /*
     * 아직 한 번도 안 돈 작업이면 본문에도 덧붙인다(위 머리말 참조).
     * ⛔ 본문 덧붙이기가 실패해도 보완 자체를 실패로 만들지 않는다 — 코멘트는 이미 달렸고,
     *    그것만으로도 검수 단계에서는 읽힌다.
     */
    let appendedToBody = false
    if (!hasAnyExecution(projectId, issueIid)) {
      try {
        const current = String(issue.description ?? issue.body ?? '')
        await updateIssue(project, issueIid, authToken, {
          description: `${current}\n\n---\n\n${cleanContent}`.slice(0, MAX_CONTENT_LENGTH * 5),
        })
        appendedToBody = true
      } catch (e) {
        console.error('[report note] description append failed:', e)
      }
    }

    touchProjectActivity(projectId)

    return NextResponse.json({ iid: issueIid, appended_to_body: appendedToBody })
  } catch (err) {
    console.error('[report note POST] failed:', err)
    return NextResponse.json({ error: friendlyGitError(err, '보완 노트 등록') }, { status: 500 })
  }
}
