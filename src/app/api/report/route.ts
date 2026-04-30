import { NextRequest, NextResponse } from 'next/server'
import { getProject, getProjectAuthToken, touchProjectActivity } from '@/lib/db'
import { createIssue, checkLabelsExist } from '@/lib/provider'
import { friendlyGitError } from '@/lib/git-token'
import { verifyReportToken } from '@/lib/report-token'

// Rate limiting store (in-memory, single-instance)
const rateLimitStore = new Map<string, number[]>()

// Clean up old entries every 5 minutes
setInterval(() => {
  const now = Date.now()
  const maxAge = 30 * 60 * 1000 // 30분
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

// XSS 필터링: HTML 스크립트 태그 제거
function sanitizeContent(content: string): string {
  return content
    .replace(/<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi, '')
    .replace(/<iframe\b[^>]*>.*?<\/iframe>/gi, '')
    .replace(/<object\b[^>]*>.*?<\/object>/gi, '')
    .replace(/<embed\b[^>]*>.*?<\/embed>/gi, '')
    .replace(/javascript:/gi, '')
}

const MAX_CONTENT_LENGTH = 10000 // 10,000자 제한

export async function POST(req: NextRequest) {
  const body = await req.json()
  const { projectId, token, nonce, timestamp, expires, content, browserInfo } = body

  if (!projectId) return NextResponse.json({ error: '프로젝트 ID가 필요합니다.' }, { status: 400 })
  if (!token) return NextResponse.json({ error: '접근 토큰이 필요합니다.' }, { status: 400 })
  if (!content?.trim()) return NextResponse.json({ error: '내용을 입력하세요.' }, { status: 400 })

  // Rate limiting: IP 기준 1분 내 5회
  const ip = req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ?? req.headers.get('x-real-ip') ?? 'unknown'
  const ipKey = `report:ip:${ip}`
  if (!checkRateLimit(ipKey, 60 * 1000, 5)) {
    return NextResponse.json({ error: '요청이 너무 많습니다. 잠시 후 다시 시도해주세요.' }, { status: 429 })
  }

  // Rate limiting: 토큰 기준 10초 내 1회 (동일 URL 중복 요청 차단)
  const tokenKey = `report:token:${token}`
  if (!checkRateLimit(tokenKey, 10 * 1000, 1)) {
    return NextResponse.json({ error: '잠시 후 다시 시도해주세요.' }, { status: 429 })
  }

  const project = getProject(projectId)
  if (!project) return NextResponse.json({ error: 'Project not found' }, { status: 404 })

  if (!project.reportSecret) {
    return NextResponse.json({ error: 'Report page is not enabled' }, { status: 403 })
  }

  // HMAC 토큰 검증
  const tokenVerify = verifyReportToken(
    project.reportSecret,
    projectId,
    token,
    nonce,
    timestamp,
    expires
  )
  if (!tokenVerify.valid) {
    return NextResponse.json({ error: 'Invalid or expired token' }, { status: 403 })
  }

  // 콘텐츠 validation
  const sanitizedContent = content.trim().slice(0, MAX_CONTENT_LENGTH)
  if (sanitizedContent.length < 1) {
    return NextResponse.json({ error: '내용을 입력하세요.' }, { status: 400 })
  }

  // XSS 필터링 적용
  const cleanContent = sanitizeContent(sanitizedContent)

  // 내용 파싱: 첫 줄 = 제목, 나머지 = 본문
  const lines = cleanContent.split('\n')
  const title = lines[0]?.trim().slice(0, 255) // 제목 최대 255자
  const bodyRest = lines.slice(1).join('\n').trim()

  if (!title) return NextResponse.json({ error: '제목을 입력하세요.' }, { status: 400 })

  // 브라우저 정보 마크다운 블록
  const browserBlock = [
    browserInfo?.referrer ? `📄 이전 페이지: ${browserInfo.referrer}` : '',
    `🌐 URL: ${browserInfo?.url ?? 'N/A'}`,
    `🖥 브라우저: ${browserInfo?.userAgent ?? 'N/A'}`,
    `🌍 언어: ${browserInfo?.language ?? 'N/A'}`,
    `📐 화면: ${browserInfo?.screenWidth ?? 0}×${browserInfo?.screenHeight ?? 0}`,
    `🕐 접수 시간: ${browserInfo?.timestamp ?? new Date().toISOString()}`,
  ].filter(Boolean).join('\n')

  const description = bodyRest
    ? `${bodyRest}\n\n---\n\n## 접수 환경\n${browserBlock}`
    : `## 접수 환경\n${browserBlock}`

  const authToken = getProjectAuthToken(projectId)
  if (!authToken) return NextResponse.json({ error: '프로젝트 토큰이 설정되지 않았습니다.' }, { status: 500 })

  try {
    // 레이블 존재 확인
    const labelCheck = await checkLabelsExist(project, authToken)
    const targetLabel = labelCheck.find(l => l.label === project.labelTarget)
    if (targetLabel && !targetLabel.exists) {
      return NextResponse.json({
        error: `레이블 "${project.labelTarget}"이 Git에 없습니다. 프로젝트 설정에서 레이블을 생성해주세요.`,
        labelMissing: true,
      }, { status: 400 })
    }

    // IVE + IVE-S (스케줄 대기) 레이블 부착
    const labels = [project.labelTarget, project.labelSchedule || 'IVE-S']

    const issue = await createIssue(project, authToken, title, description, labels, undefined, { isOAuth: project.usesOAuthToken })

    touchProjectActivity(projectId)

    return NextResponse.json(issue)
  } catch (err) {
    console.error('[report POST] failed:', err)
    return NextResponse.json({ error: friendlyGitError(err, '접수 등록') }, { status: 500 })
  }
}
