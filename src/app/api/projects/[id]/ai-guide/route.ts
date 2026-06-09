import { NextRequest, NextResponse } from 'next/server'
import { getProject, getProjectAccess, getProjectAuthToken } from '@/lib/db'
import { getCurrentUser } from '@/lib/auth'
import { readRepoFile, upsertRepoFile, createBranch, createMR, getDefaultBranch } from '@/lib/provider'
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
  const labelEnd = project.labelEnd  || 'IVE-E'

  return `## IVE 작업 등록

이 프로젝트는 **${project.name}** (Springware IVE 관리 대상)입니다.

사용자가 "IVE용 이슈로 정리해줘", "IVE에 등록해줘" 등의 요청을 하면
대화 맥락에서 의미 단위로 작업을 쪼개어 **Git 이슈를 직접 생성**하세요.
IVE 스캐너가 이슈를 자동 감지하여 보고서에 반영합니다.

### 이슈 생성 규칙

1. 작업 단위로 각각 **Git 이슈를 생성**한다 (GitLab/GitHub API 또는 \`gh\`/\`glab\` CLI 사용)
2. 이슈에 레이블 \`${labelTarget}\`, \`${labelEnd}\`를 부착한다. 이슈는 **열린 상태로 둔다** (닫지 않는다).
   - IVE 스캐너가 이슈를 감지 → 유입으로 카운팅 → 처리 후 자동으로 닫는다.
3. \`title\`은 간결하게 (이슈 제목이 보고서에 표시됨)
4. 이슈 본문(description/body)에 포함할 것:
   - 변경한 파일 목록
   - 관련 커밋 SHA
   - 작업 요약 (마크다운)
5. 하나의 대화에서 여러 기능을 작업했다면 **의미 단위로 쪼개서 각각 이슈 생성**

### 메타데이터 (필수 — 절대 누락 금지)

이슈 본문 **맨 끝에** 반드시 아래 형식의 HTML 주석(\`ive-meta\`)을 추가하세요. **이것이 IVE가 작업시간·토큰·비용을 집계하는 유일한 기계 판독 기록**입니다. GitLab/GitHub UI에는 보이지 않고 IVE 스캐너만 파싱합니다.

> 🔴 **ive-meta가 없으면 그 작업의 작업시간은 0으로 집계됩니다.**
> GitLab의 \`/spend\`(Time tracking)는 GitLab 전용 보조 표시일 뿐 시스템이 의존하지 않으며, GitHub에는 그런 기능 자체가 없습니다.
> 따라서 **GitLab·GitHub 모두에서 작업시간을 남기는 방법은 ive-meta의 \`started_at\`/\`ended_at\` 뿐**입니다. 매 이슈에 반드시 넣으세요. (이슈가 열려 있던 기간이 아니라, 이 두 시각의 차이가 곧 작업시간으로 산정됩니다.)

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

\`started_at\` / \`ended_at\` 은 **한국시간(KST, +09:00)** 으로 기재. UTC \`Z\` 표기 사용 금지. 형식 예: \`TZ=Asia/Seoul date +"%Y-%m-%dT%H:%M:%S+09:00"\`

> ⚠️ **작업시간은 반드시 실측한다. 임의로 찍지 말 것. 그리고 \`started_at\`~\`ended_at\` 에 idle(자리비움·밤샘)을 절대 포함시키지 말 것.**
> ❌ **"세션 첫 시각 ~ 지금"을 그대로 쓰면 안 된다.** 세션이 밤새/장시간 열려 있으면 그 사이 idle(퇴근~출근 등)이 통째로 들어가 **말도 안 되는 값(예: 19시간)** 이 된다.
>
> 측정 방법(idle 제외 필수):
> 1. 세션 트랜스크립트의 메시지 타임스탬프들을 정렬해 인접 간격을 본다. **20분 이상 공백은 idle 로 간주해 제외**한다.
> 2. 남은 **활성 작업 구간들의 합**이 실제 작업시간이다. \`started_at\`/\`ended_at\` 은 그 활성 구간을 감싸도록 잡는다 — 첫 메시지/지금을 그대로 박지 않는다.
> 3. 추측·반올림·관행적 고정값(무조건 1h, 30m)도 금지.
>
> 한 세션에서 여러 작업/이슈를 나눠 처리했다면, **활성 작업 총합(idle 제외)을 각 이슈의 실제 처리 구간만큼만 분배**한다. 전체 세션 길이(idle 포함)를 모든 이슈에 중복으로 찍지 않는다.
> GitLab \`/spend\` 를 함께 남길 때는 **각 이슈의 \`(ended_at − started_at)\` 과 \`/spend\` 값이 반드시 일치**해야 한다 — 한쪽만 idle 빼고 다른 쪽엔 세션 양 끝을 박는 자기모순 금지(이것이 19시간 오기록의 직접 원인이었다).

### 참고

- IVE 서버 주소나 IVE 토큰은 **필요하지 않습니다**
- Git에 이슈를 만들기만 하면 IVE가 자동 인식합니다
- 이슈 생성 후 결과(이슈 번호, URL)를 사용자에게 보여주세요

### 소요시간 기록 (작업시간 산정 기준)

- IVE 보고서의 **작업시간 = ive-meta \`ended_at − started_at\`** 입니다. **GitLab·GitHub 공통 표준 소스** — 반드시 ive-meta로 남기세요.
- **GitLab**: 추가로 IVE가 완료 시 \`/spend\`(Time tracking)도 남기지만, 이는 GitLab UI 표시용 보조이며 시스템 산정의 주 소스가 아닙니다.
- **GitHub**: native time tracking이 없으므로 **ive-meta가 유일한 작업시간 소스**입니다. ive-meta 누락 시 그 작업의 시간은 0으로 잡힙니다.`
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
 * 보호 브랜치 대응: 별도 브랜치에 커밋 후 MR/PR을 생성한다.
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

  // 1. 기본 브랜치에서 기존 파일 읽고, 변경 사항이 있는지 확인
  const defaultBranch = await getDefaultBranch(project, token)
  const filesToWrite: { path: string; content: string; isNew: boolean }[] = []

  for (const filePath of TARGET_FILES) {
    try {
      const existing = await readRepoFile(project, token, filePath)
      const merged = mergeIveSection(existing?.content ?? null, iveSection)
      if (existing && existing.content === merged) {
        results.push({ path: filePath, created: false, updated: false, unchanged: true })
      } else {
        filesToWrite.push({ path: filePath, content: merged, isNew: !existing })
      }
    } catch (e) {
      results.push({ path: filePath, created: false, updated: false, unchanged: false, error: e instanceof Error ? e.message : String(e) })
    }
  }

  // 변경할 파일이 없으면 바로 반환
  if (filesToWrite.length === 0) {
    return NextResponse.json({ results })
  }

  // 2. 브랜치 생성 → 커밋 → MR/PR 생성
  const branchName = `ive/ai-guide-${Date.now()}`
  let mrUrl: string | null = null

  try {
    await createBranch(project, token, branchName, defaultBranch)

    for (const file of filesToWrite) {
      try {
        const result = await upsertRepoFile(project, token, file.path, file.content, commitMsg, branchName)
        results.push({ path: file.path, ...result })
      } catch (e) {
        results.push({ path: file.path, created: false, updated: false, unchanged: false, error: e instanceof Error ? e.message : String(e) })
      }
    }

    // 커밋된 파일이 있으면 MR/PR 생성
    const committed = results.filter(r => r.created || r.updated)
    if (committed.length > 0) {
      const mrTitle = `chore(ive): AI 도구 가이드 설치 (${committed.map(r => r.path).join(', ')})`
      const mrDesc = [
        '## AI 도구 가이드 설치',
        '',
        'IVE에서 자동 생성된 MR입니다.',
        '외부 AI CLI(Claude Code 등)가 IVE 이슈 등록을 인식하도록 가이드 파일을 추가/갱신합니다.',
        '',
        '### 변경 파일',
        ...committed.map(r => `- \`${r.path}\` — ${r.created ? '신규 생성' : '갱신'}`),
        '',
        '> 이 MR을 머지하면 가이드가 적용됩니다.',
      ].join('\n')

      const mr = await createMR(project, token, {
        source_branch: branchName,
        target_branch: defaultBranch,
        title: mrTitle,
        description: mrDesc,
      })
      if (mr) {
        mrUrl = mr.web_url || mr.html_url || null
      }
    }
  } catch (e) {
    // 브랜치 생성 실패 등
    const errMsg = e instanceof Error ? e.message : String(e)
    for (const file of filesToWrite) {
      if (!results.find(r => r.path === file.path)) {
        results.push({ path: file.path, created: false, updated: false, unchanged: false, error: errMsg })
      }
    }
  }

  logActivity({
    userId: user.id,
    category: 'project',
    action: 'install_ai_guide',
    detail: `AI 도구 가이드 설치: ${results.map(r => `${r.path}(${r.error ? '실패' : r.unchanged ? '변경없음' : r.created ? '생성' : '갱신'})`).join(', ')}${mrUrl ? ` → MR: ${mrUrl}` : ''}`,
    targetType: 'project',
    targetId: projectId,
    req,
  })

  const hasError = results.some(r => r.error)
  return NextResponse.json({ results, mrUrl }, { status: hasError ? 207 : 200 })
}
