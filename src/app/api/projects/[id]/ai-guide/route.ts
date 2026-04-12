import { NextRequest, NextResponse } from 'next/server'
import { getProject, getProjectAccess, getProjectAuthToken } from '@/lib/db'
import { getCurrentUser } from '@/lib/auth'
import { readRepoFile, upsertRepoFile } from '@/lib/provider'
import { logActivity } from '@/lib/activity'
import { Project } from '@/types'

const IVE_MARKER_BEGIN = '<!-- ive:begin -->'
const IVE_MARKER_END = '<!-- ive:end -->'

const TARGET_FILES = ['CLAUDE.md', 'AGENTS.md']

/**
 * IVE 섹션을 기존 파일 내용에 병합한다.
 * - 마커가 이미 있으면 마커 사이만 교체
 * - 마커가 없으면 파일 맨 끝에 추가
 * - 파일이 없으면 IVE 섹션만으로 새로 생성
 */
function mergeIveSection(existing: string | null, iveSection: string): string {
  const block = `${IVE_MARKER_BEGIN}\n${iveSection}\n${IVE_MARKER_END}`

  if (!existing) return block

  const beginIdx = existing.indexOf(IVE_MARKER_BEGIN)
  const endIdx = existing.indexOf(IVE_MARKER_END)

  if (beginIdx !== -1 && endIdx !== -1 && endIdx > beginIdx) {
    // 마커 사이만 교체
    const before = existing.substring(0, beginIdx)
    const after = existing.substring(endIdx + IVE_MARKER_END.length)
    return `${before}${block}${after}`
  }

  // 마커 없음 — 끝에 추가 (빈 줄로 구분)
  const trimmed = existing.trimEnd()
  return `${trimmed}\n\n${block}\n`
}

function generateIveGuide(project: Project): string {
  const labelTarget = project.labelTarget || 'IVE'
  const labelDev = project.labelDev || 'IVE-D'
  const labelVerifyWait = project.labelVerifyWait || 'IVE-W'

  return `## IVE 작업 등록

이 프로젝트는 **${project.name}** (Spring IVE 관리 대상)입니다.

사용자가 "IVE용 이슈로 정리해줘", "IVE에 등록해줘" 등의 요청을 하면
대화 맥락에서 의미 단위로 작업을 쪼개어 **Git 이슈를 직접 생성**하세요.
IVE 스캐너가 이슈를 자동 감지하여 보고서에 반영합니다.

### 이슈 생성 규칙

1. 작업 단위로 각각 **Git 이슈를 생성**한다 (GitLab/GitHub API 또는 \`gh\`/\`glab\` CLI 사용)
2. 이슈에 아래 **레이블을 반드시 부착**한다:
   - 완료된 작업: \`${labelTarget}\`, \`${labelVerifyWait}\`
   - 아직 진행 중인 작업: \`${labelTarget}\`, \`${labelDev}\`
3. \`title\`은 간결하게 (이슈 제목이 보고서에 표시됨)
4. 이슈 본문(description/body)에 포함할 것:
   - 변경한 파일 목록
   - 관련 커밋 SHA
   - 작업 요약 (마크다운)
5. 하나의 대화에서 여러 기능을 작업했다면 **의미 단위로 쪼개서 각각 이슈 생성**

### 메타데이터 (선택)

토큰 사용량과 비용 등을 IVE 보고서에 반영하려면, 이슈 본문 **맨 끝에** 아래 형식의 HTML 주석을 추가하세요.
GitLab/GitHub UI에서는 보이지 않으며, IVE 스캐너가 파싱합니다.

\`\`\`
<!-- ive-meta
model: <모델명 (예: claude-opus-4-6)>
input_tokens: <숫자>
output_tokens: <숫자>
cost_usd: <숫자>
turns: <숫자>
started_at: <ISO 시각>
ended_at: <ISO 시각>
-->
\`\`\`

### 참고

- IVE 서버 주소나 IVE 토큰은 **필요하지 않습니다**
- Git에 이슈를 만들기만 하면 IVE가 자동 인식합니다
- 이슈 생성 후 결과(이슈 번호, URL)를 사용자에게 보여주세요`
}

/**
 * GET /api/projects/:id/ai-guide — 현재 설치 상태 확인
 */
export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const user = await getCurrentUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { id: projectId } = await params
  const project = getProject(projectId)
  if (!project) return NextResponse.json({ error: 'Project not found' }, { status: 404 })
  if (!getProjectAccess(projectId, user.id)) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  const token = getProjectAuthToken(projectId)
  const results: { path: string; hasIveSection: boolean }[] = []

  for (const filePath of TARGET_FILES) {
    try {
      const file = await readRepoFile(project, token, filePath)
      const hasIveSection = !!file && file.content.includes(IVE_MARKER_BEGIN) && file.content.includes(IVE_MARKER_END)
      results.push({ path: filePath, hasIveSection })
    } catch {
      results.push({ path: filePath, hasIveSection: false })
    }
  }

  return NextResponse.json({ files: results })
}

/**
 * POST /api/projects/:id/ai-guide — CLAUDE.md, AGENTS.md에 IVE 가이드 설치
 */
export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const user = await getCurrentUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { id: projectId } = await params
  const project = getProject(projectId)
  if (!project) return NextResponse.json({ error: 'Project not found' }, { status: 404 })

  const access = getProjectAccess(projectId, user.id)
  if (!access || access === 'viewer') {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  const iveSection = generateIveGuide(project)
  const token = getProjectAuthToken(projectId)
  const commitMsg = `chore(ive): update AI tool guide for ${project.name}`

  const results: { path: string; created: boolean; updated: boolean; unchanged: boolean; error?: string }[] = []

  for (const filePath of TARGET_FILES) {
    try {
      // 1. 기존 파일 읽기
      const existing = await readRepoFile(project, token, filePath)
      // 2. 마커 기반 병합 (기존 내용 보존)
      const merged = mergeIveSection(existing?.content ?? null, iveSection)
      // 3. 커밋
      const result = await upsertRepoFile(project, token, filePath, merged, commitMsg)
      results.push({ path: filePath, ...result })
    } catch (e) {
      results.push({
        path: filePath,
        created: false,
        updated: false,
        unchanged: false,
        error: e instanceof Error ? e.message : String(e),
      })
    }
  }

  logActivity({
    userId: user.id,
    category: 'project',
    action: 'install_ai_guide',
    detail: `AI 도구 가이드 설치: ${results.map(r => `${r.path}(${r.error ? '실패' : r.unchanged ? '변경없음' : r.created ? '생성' : '갱신'})`).join(', ')}`,
    targetType: 'project',
    targetId: projectId,
    req,
  })

  const hasError = results.some(r => r.error)
  return NextResponse.json({ results }, { status: hasError ? 207 : 200 })
}
