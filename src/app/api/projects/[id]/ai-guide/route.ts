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

/**
 * 단계 라벨 사용법 + "에이전트가 해 둔 일을 검토·확인·마무리하는" 절차 가이드.
 *
 * IVE 관리 대상이 되면 이슈에 단계 라벨(S/D/W/V/P/C/E)이 붙는데, 사이트 쪽 에이전트는
 * 그 라벨이 무슨 뜻인지도, 검토를 맡았을 때 무엇을 해야 하는지도 모른다. 실제로
 * 「코드 변경사항 없이 완료」로 닫힌 이슈가 손도 안 댄 상태였던 사고가 있었다 —
 * 검토자가 이슈 노트만 읽고 통과시켰기 때문이다. 그 절차를 여기서 못 박는다.
 */
function generateStageLabelGuide(project: Project): string {
  const s = project.labelSchedule || 'IVE-S'
  const d = project.labelDev || 'IVE-D'
  const w = project.labelVerifyWait || 'IVE-W'
  const v = project.labelVerify || 'IVE-V'
  const pw = project.labelConfirmWait || 'IVE-P'
  const c = project.labelConfirm || 'IVE-C'
  const e = project.labelEnd || 'IVE-E'
  const isGitHub = /github\.com/i.test(project.repoUrl || '')
  const cli = isGitHub
    ? `gh issue edit <번호> --remove-label "${w}" --add-label "${v}"`
    : `glab api --method PUT "projects/<네임스페이스%2F저장소>/issues/<번호>" \\
  -f "remove_labels=${w}" -f "add_labels=${v}"`
  const noteCli = isGitHub
    ? 'gh issue comment <번호> --body-file note.md'
    : 'glab issue note <번호> -R <네임스페이스/저장소> --message "$(cat note.md)"'

  return `## IVE 단계 라벨 — 에이전트가 해 둔 일을 검토·확인·마무리하기

이 저장소의 이슈에는 진행 단계를 나타내는 라벨이 붙습니다. **단계 라벨은 이슈마다 정확히
하나만** 남아야 합니다(옛 라벨을 반드시 함께 떼세요).

| 라벨 | 단계 | 뜻 |
|---|---|---|
| \`${s}\` | 스케줄 | 처리 대기. 스캐너가 이 라벨의 이슈를 에이전트에 배정합니다 |
| \`${d}\` | 개발 중 | 에이전트가 작업 중 |
| \`${w}\` | 검증 대기 | 개발이 끝났고 **사람의 검토를 기다리는 중** |
| \`${v}\` | 검증 중 | 검토자가 지금 보고 있는 중 |
| \`${pw}\` | 확인 대기 | 검증을 통과해 확인을 기다리는 중 |
| \`${c}\` | 확인 중 | 확인자가 지금 보고 있는 중 |
| \`${e}\` | 완료 | 확인까지 끝남 |

흐름: \`${s}\` → \`${d}\` → \`${w}\` → \`${v}\` → \`${pw}\` → \`${c}\` → \`${e}\`

---

### 검토를 맡았을 때 — 이 순서대로 하세요

사용자가 "이 작업 검토해줘 / 확인해줘 / 마무리해줘" 라고 하면 아래를 그대로 밟습니다.

#### 0. 먼저 단계를 옮깁니다 (나중에 몰아서 바꾸지 않습니다)

착수하는 순간 \`${v}\`(검증 중)로 올립니다. 그래야 IVE 화면에 "지금 누가 무엇을 보고 있는지"가
드러납니다. 다 보고 나서 한꺼번에 바꾸면 그동안은 계속 대기로 보입니다.

\`\`\`bash
${cli}
\`\`\`

확인 단계로 넘길 때 \`${c}\`, 전부 끝나면 \`${e}\` 로 같은 방식으로 옮깁니다.

#### 1. ⛔ 에이전트의 1차 처리를 그대로 믿지 않습니다

**이슈 노트만 읽고 판단하지 마세요.** \`✅ 개발 완료\` 라고 적혀 있어도 실제로는 아무것도
하지 않은 경우가 있습니다(「코드 변경사항 없이 완료되었습니다」).

- **MR/PR 이 있는지, 커밋이 있는지부터 확인**합니다.
- 없으면 **처리되지 않은 것**입니다. 그 자리에서 직접 원인을 짚고 고칩니다.

#### 2. 원인 설명이 실제 증거와 맞는지 봅니다

이슈에 적힌 원인 추정이 틀린 경우가 흔합니다(신고자는 화면만 봅니다). 에이전트가 원인을 다시
짚었다면, 그 설명이 **첨부된 관측 자료·로그의 모양과 실제로 맞아떨어지는지** 대조하세요.

#### 3. 테스트는 세 단으로 — 기준선 → 변경 후 → A/B

1. **기준선 먼저**: 변경 **전** 코드로 테스트를 돌려 통과/실패 개수를 적어 둡니다.
   저장소에는 이번 변경과 무관하게 원래 실패하는 테스트가 있을 수 있습니다. 기준선을 안 재면
   남의 실패를 내 탓으로 오해하거나, **반대로 내가 깬 것을 못 봅니다.**
2. **변경 후**: 같은 방법으로 다시 재어 견줍니다.
3. **A/B**: **새 테스트는 그대로 두고 소스만 옛 코드로 되돌려** 돌립니다.
   새 테스트가 **실패해야** 정상입니다. 여기서 통과해 버리면 그 테스트는 증상을 못 잡는
   테스트입니다 — 그 상태로 「고쳤다」고 하면 안 됩니다.

> ⚠️ 테스트 명령은 **절대경로**로 돌리세요. 앞선 명령의 작업 디렉터리가 남아 **다른 트리를
> 재고도 모르는** 일이 실제로 있습니다(기준선이라 믿고 잰 수치가 사실은 변경본).

#### 4. 합성 재현으로 끝내지 않습니다 — 실제 데이터로 잽니다

단위 테스트가 다 통과해도 실제 입력에서는 그대로 깨져 있을 수 있습니다. 이슈에 적힌 **그
대상**(문서 번호·레코드 ID·URL)을 실제로 가져와 전/후를 수치로 재세요. 가능하면 **읽기만**
하는 방식으로 — 검토 때문에 운영 데이터를 덮어쓰지 않습니다.

#### 5. 고친 것이 **이미 쌓인 데이터**에 미치는 영향을 봅니다

코드만 배포하면 화면은 그대로인 경우가 많습니다. 기존 데이터를 다시 처리해야 결과가 바뀐다면
**그 사실을 이슈에 적고**, 범위(몇 건인지)를 실제로 세어 보세요.

#### 6. 릴리스 노트·변경이력을 볼 때

⛔ **이미 배포된 판의 절에 항목을 끼워 넣지 않습니다.** 그 판을 쓰는 설치처가 「이미 반영됨」
으로 잘못 보게 되고, 대개 **경고도 나지 않아 조용히 넘어갑니다.** 아직 안 나간 고침은
미출시 절(\`Unreleased\` 등)에 적습니다.

#### 7. 이슈에 처리 상태를 노트로 남깁니다

다음 사람이 이슈만 열어도 무엇을 어떻게 확인했는지 알 수 있어야 합니다.

\`\`\`bash
${noteCli}
\`\`\`

노트에 반드시 넣을 것:

1. **확인한 것** — 기준선/변경 후 수치, A/B 결과, 실제 데이터 측정값
2. **못 한 것** — 확인 못 한 구간을 그대로 적습니다. 「확인 못 했다」와 「문제없다」는 다른 말입니다
3. **남은 조치** — 기존 데이터 재처리 필요 여부 등
4. **결론** — 다음 단계로 올렸는지, 아니면 왜 멈춰 있는지

#### 8. 마무리

- 문제가 없으면 MR/PR 을 머지하고 **소스 브랜치를 지웁니다.**
- 단계 라벨을 \`${e}\`(완료)로 옮깁니다.
- 고쳐야 할 것이 남았으면 **올리지 말고** \`${v}\` 에 둔 채, 무엇을 고쳐야 하는지 노트에
  구체적으로 적습니다.

---

### 올리기 전 체크리스트

- [ ] 이슈에 적힌 요구와 구현이 1:1 로 맞는다
- [ ] MR/커밋이 실제로 있다 (노트만 보고 판단하지 않았다)
- [ ] 테스트 **기준선**을 재고 변경 후와 견주었다
- [ ] 새 테스트가 있고, **A/B 로 그 증상을 실제로 잡는다**
- [ ] 기존 테스트를 지우지 않았다
- [ ] **실제 데이터**로 전/후를 쟀다 (합성 재현만으로 끝내지 않았다)
- [ ] 기존 데이터 재처리 필요 여부를 노트에 적었다
- [ ] 이슈에 처리 상태 노트를 달았다
- [ ] 단계 라벨이 정확히 하나만 남아 있다

### 흔히 밟는 지뢰

| 지뢰 | 증상 | 피하는 법 |
|---|---|---|
| 「코드 변경 없이 완료」를 믿음 | 손도 안 댄 이슈가 닫힘 | MR·커밋 유무부터 확인 |
| 앞 명령의 작업 디렉터리가 남음 | 기준선이라 믿고 잰 수치가 변경본 | 절대경로로 실행 |
| 기존 실패를 모르고 시작 | 남의 실패를 내 탓으로 / 내가 깬 것을 못 봄 | 기준선을 먼저 재고 적어 둔다 |
| 합성 테스트만 통과 | 실제 데이터는 그대로 깨져 있음 | 이슈에 적힌 그 대상으로 실측 |
| 단계 라벨 두 개 | IVE 집계가 어긋남 | 옛 라벨을 반드시 함께 뗀다 |
| 검토 시간을 안 남김 | 보고서에 0으로 집계 | 검토도 작업이다 — ive-meta/\`/spend\` 로 남긴다 |
`
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
> 1. ⚠️ **먼저 "현재 대화"의 트랜스크립트 jsonl 파일을 정확히 특정한다.** 같은 프로젝트 디렉터리에 다른 세션의 jsonl 이 동시에 열려 있을 수 있어, "가장 최근 수정 파일"(\`ls -t | head -1\`)로 잡으면 **엉뚱한 세션을 측정**한다. **이번 대화에만 등장한 고유 문자열로 \`grep -l\` 해서 파일을 특정**한 뒤, 그 파일에서만 타임스탬프·토큰을 읽는다. (파일을 틀리면 시간·토큰·비용이 전부 다른 세션 값이 됨)
> 2. 세션 트랜스크립트의 메시지 타임스탬프들을 정렬해 인접 간격을 본다. **20분 이상 공백은 idle 로 간주해 제외**한다.
> 3. 남은 **활성 작업 구간들의 합**이 실제 작업시간이다. \`started_at\`/\`ended_at\` 은 그 활성 구간을 감싸도록 잡는다 — 첫 메시지/지금을 그대로 박지 않는다.
> 4. 추측·반올림·관행적 고정값(무조건 1h, 30m)도 금지.
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

  const iveSection = `${generateIveGuide(project)}

${generateStageLabelGuide(project)}`
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
