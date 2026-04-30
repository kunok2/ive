import { NextRequest, NextResponse } from 'next/server'
import { getProject, getProjectAuthToken } from '@/lib/db'
import { uploadIssueAttachment } from '@/lib/provider'
import { verifyReportTokenSignature } from '@/lib/report-token'

// 외부 작업 접수 페이지(/p/[projectId]/report) 에서 textarea 에 붙여 넣은 이미지를
// 인증 없이 프로젝트 저장소(GitLab/GitHub)에 업로드하기 위한 엔드포인트.
// /api/report 와 동일한 HMAC 서명 토큰으로 보호하되, nonce 는 소비하지 않아
// 동일 URL 안에서 여러 장의 이미지를 연속으로 붙여 넣을 수 있도록 한다.

const MAX_BYTES = 10 * 1024 * 1024 // 10MB — 인증 사용자(25MB)보다 보수적

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

export async function POST(req: NextRequest) {
  let formData: FormData
  try {
    formData = await req.formData()
  } catch {
    return NextResponse.json({ error: 'multipart/form-data 요청이 아닙니다.' }, { status: 400 })
  }

  const projectId = String(formData.get('projectId') ?? '')
  const token = String(formData.get('token') ?? '')
  const nonce = String(formData.get('nonce') ?? '')
  const timestamp = parseInt(String(formData.get('timestamp') ?? '0'), 10)
  const expires = parseInt(String(formData.get('expires') ?? '0'), 10)
  const file = formData.get('file')

  if (!projectId || !token || !nonce || !timestamp || !expires) {
    return NextResponse.json({ error: '인증 정보가 부족합니다.' }, { status: 400 })
  }
  if (!file || typeof file === 'string') {
    return NextResponse.json({ error: '파일이 포함되지 않았습니다.' }, { status: 400 })
  }

  const ip = req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ?? req.headers.get('x-real-ip') ?? 'unknown'
  if (!checkRateLimit(`report-upload:ip:${ip}`, 60 * 1000, 20)) {
    return NextResponse.json({ error: '요청이 너무 많습니다. 잠시 후 다시 시도해주세요.' }, { status: 429 })
  }
  if (!checkRateLimit(`report-upload:token:${token}`, 60 * 1000, 30)) {
    return NextResponse.json({ error: '요청이 너무 많습니다. 잠시 후 다시 시도해주세요.' }, { status: 429 })
  }

  const project = getProject(projectId)
  if (!project) return NextResponse.json({ error: 'Project not found' }, { status: 404 })
  if (!project.reportSecret) {
    return NextResponse.json({ error: 'Report page is not enabled' }, { status: 403 })
  }

  const tokenVerify = verifyReportTokenSignature(
    project.reportSecret,
    projectId,
    token,
    nonce,
    timestamp,
    expires,
  )
  if (!tokenVerify.valid) {
    return NextResponse.json({ error: 'Invalid or expired token' }, { status: 403 })
  }

  const blob = file as File
  if (blob.size === 0) {
    return NextResponse.json({ error: '빈 파일입니다.' }, { status: 400 })
  }
  if (blob.size > MAX_BYTES) {
    return NextResponse.json({ error: `파일이 너무 큽니다. (최대 ${Math.floor(MAX_BYTES / 1024 / 1024)}MB)` }, { status: 413 })
  }
  if (blob.type && !blob.type.startsWith('image/')) {
    return NextResponse.json({ error: '이미지 파일만 업로드할 수 있습니다.' }, { status: 400 })
  }

  const authToken = getProjectAuthToken(projectId)
  if (!authToken) {
    return NextResponse.json({ error: '프로젝트 토큰이 설정되지 않았습니다.' }, { status: 500 })
  }

  try {
    const arrayBuffer = await blob.arrayBuffer()
    const buffer = Buffer.from(arrayBuffer)
    const filename = blob.name || `paste-${Date.now()}`
    const mime = blob.type || 'application/octet-stream'
    const result = await uploadIssueAttachment(project, authToken, filename, buffer, mime)
    return NextResponse.json(result)
  } catch (err) {
    const msg = err instanceof Error ? err.message : '파일 업로드 실패'
    console.error('[ReportUpload] failed:', msg)
    return NextResponse.json({ error: msg }, { status: 500 })
  }
}
