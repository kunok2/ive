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

/**
 * 검증·확인을 "사람"이 아니라 에이전트가 수행할 때의 절차 가이드.
 *
 * 원래 검증(V)/확인(C)은 사람 몫이었으나 점점 에이전트가 대신한다. 그런데 에이전트는
 * 사람과 달리 (a) 자기가 짠 코드를 자기가 통과시키기 쉽고 (b) 라벨 전이를 잊고 몰아서 바꾸며
 * (c) "확인했다"는 문장만 남기고 실제 화면은 보지 않는다. 그래서 검증은 "직접 고쳐 목표
 * 브랜치에 머지하고 개발 브랜치를 지우는 것"까지, 확인은 "실제 화면을 보고 캡처를 이슈에
 * 올리는 것"까지를 각 단계의 완료 조건으로 못 박는다.
 */
function generateAgentStageGuide(project: Project): string {
  const s = project.labelSchedule || 'IVE-S'
  const w = project.labelVerifyWait || 'IVE-W'
  const v = project.labelVerify || 'IVE-V'
  const pw = project.labelConfirmWait || 'IVE-P'
  const c = project.labelConfirm || 'IVE-C'
  const e = project.labelEnd || 'IVE-E'
  const isGitHub = /github\.com/i.test(project.repoUrl || '')

  // 코드 블록이 번호 목록 안에 들어가므로 줄바꿈 없이 한 줄로 만든다.
  // (이어지는 줄의 들여쓰기가 목록보다 얕으면 렌더러가 블록을 끊는다)
  const move = (from: string, to: string) => isGitHub
    ? `gh issue edit <번호> --remove-label "${from}" --add-label "${to}"`
    : `glab api --method PUT "projects/<네임스페이스%2F저장소>/issues/<번호>" -f "remove_labels=${from}" -f "add_labels=${to}"`

  const mergeCmd = isGitHub
    ? `gh pr merge <PR번호> --merge --delete-branch`
    : `glab mr merge <MR번호> -R <네임스페이스/저장소> --remove-source-branch --yes`

  const noteCmd = isGitHub
    ? `gh issue comment <번호> --body-file review.md`
    : `glab issue note <번호> -R <네임스페이스/저장소> --message "$(cat review.md)"`

  // 목록 항목(6번) 안에 들어가므로 3칸 들여쓰기를 유지한다.
  const uploadBlock = isGitHub
    ? `GitHub 이슈에는 **API 로 첨부를 올리는 방법이 없습니다.** 기본 브랜치의 \`.ive-assets/\` 에
   이미지를 커밋하고 그 raw URL 을 코멘트에 넣습니다(IVE 자체도 같은 방식입니다).

   \`\`\`bash
   gh api "repos/<owner>/<repo>/contents/.ive-assets/$(date +%s)-shot.png" -f message="chore(ive): confirm screenshot" -f content="$(base64 -i shot.png)" --jq .content.download_url
   # 출력된 URL 을 confirm.md 안에 ![confirm](<URL>) 로 넣고 코멘트로 올린다
   ${noteCmd.replace('review.md', 'confirm.md')}
   \`\`\``
    : `GitLab 은 업로드 API 가 있습니다. 업로드가 돌려주는 \`markdown\`(예: \`![shot](/uploads/xxxx/shot.png)\`)을
   코멘트 본문에 그대로 넣으세요.

   \`\`\`bash
   glab api --method POST "projects/<네임스페이스%2F저장소>/uploads" --form "file=@shot.png" --jq .markdown
   # 출력된 markdown 을 confirm.md 에 넣고 코멘트로 올린다
   ${noteCmd.replace('review.md', 'confirm.md')}
   \`\`\``

  const mergeTargetLine = project.baseBranch
    ? `이 프로젝트의 목표 브랜치는 \`${project.baseBranch}\` 입니다.`
    : `목표 브랜치가 IVE 프로젝트 설정에 등록되어 있지 않습니다. **추측해서 머지하지 말고
   사용자에게 "어느 브랜치로 머지할까요?"라고 물어 답을 받은 뒤 진행**합니다(스테이징 브랜치인지
   기본 브랜치인지). 받은 답은 검토 코멘트에 적어 두고, IVE 프로젝트 설정의 **베이스 브랜치**에
   등록해 달라고 함께 알립니다 — 다음부터는 묻지 않아도 됩니다.`

  const confirmUrlLine = project.testSiteUrl
    ? `이 프로젝트의 확인용 주소는 ${project.testSiteUrl} 입니다.`
    : `확인용 주소가 IVE 프로젝트 설정에 등록되어 있지 않습니다. 이슈·MR·README 에서 찾아보고,
   그래도 없으면 **사용자에게 "확인은 어느 주소에서 하면 될까요?"라고 물어 답을 받은 뒤 진행**합니다.
   로그인이 필요한 화면이면 **테스트 계정도 함께** 받습니다. 임의의 로컬 서버를 띄워 "확인했다"고
   하지 마세요 — 배포된 것을 본 것이 아닙니다. 받은 주소는 확인 코멘트에 적어 두고, IVE 프로젝트
   설정의 **테스트 사이트 URL** 에 등록해 달라고 함께 알립니다.`

  return `## IVE 검증·확인을 에이전트가 수행할 때

검증(\`${v}\`)·확인(\`${c}\`)은 원래 사람이 하던 단계지만 점점 에이전트가 대신합니다. 위 절차는
사람이 하든 에이전트가 하든 그대로 지키고, 아래는 **에이전트가 맡을 때 추가로** 지킬 것입니다.

두 단계는 목적이 다릅니다. 겹쳐서 하거나 한 번에 몰아서 하지 마세요.

| 단계 | 무엇을 보는가 | 무엇으로 끝나는가 |
|---|---|---|
| 검증 \`${v}\` | 브랜치의 **구현이 올바른가** — 검토자 입장의 코드 판단 | 틀린 곳은 직접 고쳐 목표 브랜치에 머지 + 개발 브랜치 삭제 + 검토 코멘트 → \`${pw}\` |
| 확인 \`${c}\` | 그것이 **실제 화면에서 그렇게 동작하는가** — 사용자 입장의 판단 | 실제 화면 캡처를 이슈에 올리고 확인 코멘트 → \`${e}\`(완료) |

### 공통 규칙

1. **시작할 때 시작 상태로, 끝낼 때 완료 상태로.** 착수하는 순간 \`${v}\`/\`${c}\` 로 올리고,
   결론이 나면 즉시 다음 단계로 옮깁니다. 다 하고 나서 몰아서 바꾸지 않습니다.
   > ⚠️ 검증·확인 단계는 **그 라벨이 열려 있던 근무시간(평일 09–18 KST)이 그대로 사람 비용으로
   > 집계**됩니다. 10분 만에 끝낸 일을 라벨만 이틀 열어 두면 보고서에는 이틀치 비용이 남습니다.
2. **자기가 개발한 것을 자기가 통과시키지 않습니다.** 개발 세션의 문맥을 그대로 이어서 검증하면
   "내가 방금 짠 게 맞다"를 재확인하는 절차가 됩니다. 새 세션에서, 이슈와 코드를 처음 보는 것처럼
   다시 읽고 판단하세요.
3. **증거 없이 통과시키지 않습니다.** 실행한 명령과 그 출력(수치)을 코멘트에 남깁니다.
   "정상 동작 확인함" 같은 문장은 통과 근거가 아닙니다.
4. **확인 못 한 것은 "확인 못 함"으로 적습니다.** 「확인 못 했다」와 「문제없다」는 다른 말입니다.
5. **판단 근거를 만들 수 없으면 통과가 아니라 멈춤**입니다. 무엇이 없어서 판단하지 못했는지
   코멘트에 적고 사람을 부릅니다.
6. 검증·확인도 작업입니다. 소요 시간과 토큰을 \`ive-meta\` 로 남깁니다(idle 제외).

### 검증(\`${v}\`)을 에이전트가 할 때

> 목표: **브랜치의 구현이 올바른지 검토자 입장에서 객관적으로 보고, 틀린 곳은 직접 고쳐서 목표
> 브랜치에 머지한 뒤, 개발 브랜치를 지우고 검토 코멘트를 남기는 것.** 판정만 하고 끝나는 자리가
> 아닙니다.

1. **시작 상태로 옮깁니다** (\`${w}\` → \`${v}\`). 보기 전에 먼저 옮깁니다.

   \`\`\`bash
   ${move(w, v)}
   \`\`\`

2. **대상을 특정합니다** — MR/PR 번호, 소스 브랜치, 목표 브랜치, 커밋 목록.
   MR 도 커밋도 없으면 **처리되지 않은 것**입니다(이슈 노트에 "완료"라고 적혀 있어도).
3. **객관적으로 검토합니다.** 이슈 본문과 **모든 코멘트**(마지막 정정이 우선)를 요구사항으로
   정리해 diff 와 1:1 로 맞춥니다. 범위 밖 변경(무관한 파일, 전면 포맷팅, 삭제된 테스트)은
   그 자체로 지적 대상입니다.
4. **실제로 돌려 봅니다** — 기준선 → 변경 후 → A/B, 그리고 실제 데이터 측정(위 절차 3·4).
5. **틀린 곳은 직접 고칩니다.** 사소한 결함까지 반려로 되던지면 왕복만 늘어납니다. 소스 브랜치에
   추가 커밋으로 고치고, **고친 부분도 같은 기준으로 다시 검증**합니다(내가 짠 코드라고 봐주지
   않습니다).
   되던지는 경우는 이럴 때뿐입니다 — 요구를 잘못 이해해 처음부터 다시 짜야 할 때, 설계 판단이
   필요할 때, 판단 근거를 만들 수 없을 때. 이때는 \`${v}\` → \`${s}\` 로 반려하고 **재현 명령과
   기대/실제**를 코멘트에 적습니다.
6. **목표 브랜치로 머지합니다.** ${mergeTargetLine}
   충돌은 소스 브랜치에서 해소하고 테스트를 다시 돌린 뒤 머지합니다.
7. **개발 브랜치를 지웁니다.**

   \`\`\`bash
   ${mergeCmd}
   \`\`\`

8. **검토 코멘트를 남깁니다** — 본 것, **직접 고친 것(커밋 SHA)**, 측정 수치, 못 본 구간,
   남은 조치, 결론.

   \`\`\`bash
   ${noteCmd}
   \`\`\`

9. **완료 상태로 옮깁니다** (\`${v}\` → \`${pw}\`).

   \`\`\`bash
   ${move(v, pw)}
   \`\`\`

### 확인(\`${c}\`)을 에이전트가 할 때

> 목표: **실제 화면을 직접 보고, 그 화면을 캡처해 이슈에 올려 "정말 봤다"는 것을 남기고, 이슈를
> 완료로 끝내는 것.** 코드를 다시 읽는 자리가 아닙니다 — 그건 검증에서 끝났습니다.

1. **시작 상태로 옮깁니다** (\`${pw}\` → \`${c}\`).

   \`\`\`bash
   ${move(pw, c)}
   \`\`\`

2. **원 요청으로 돌아갑니다.** 요청자가 쓴 문장과 결과가 맞는지 봅니다. 기술적으로 맞아도
   요청한 것이 아니면 통과시키지 않습니다.
3. **화면을 띄웁니다.** ${confirmUrlLine}
   먼저 **변경이 반영된 환경인지** 확인합니다(배포 시각·버전 표시·머지 커밋 반영 여부).
   반영 전이면 확인이 아니라 **기다림**입니다 — 그 사실을 코멘트에 적습니다.
4. **이슈에 적힌 경로 그대로 조작해 재현합니다.** 단위 테스트 통과는 확인 근거가 아닙니다.
5. **캡처합니다.** 헤드리스로도 됩니다.

   \`\`\`bash
   npx playwright screenshot --viewport-size=1280,800 "<확인 주소>" shot.png
   \`\`\`

   캡처에는 **판단 근거가 보여야** 합니다 — 바뀐 값, 목록, 오류가 사라진 화면. 필요하면 전/후 2장.
   화면이 없는 변경(배치·API·스키마)이면 화면 대신 **실행한 명령과 그 출력**(API 응답, 로그,
   조회 결과)을 같은 자리에 올리고 "화면 없음" 사유를 적습니다.
6. **캡처를 이슈에 올립니다.** 코멘트에서 이미지가 실제로 보여야 합니다.

   ${uploadBlock}

7. **내보내기 전 마무리** — 코드만 들어가서는 바뀌지 않는 것(기존 데이터 재처리, 설정,
   마이그레이션)이 남았는지 보고, 남았다면 **대상 건수**를 적습니다. 변경이력은 미출시 절에만
   적습니다. 후속 작업은 이 이슈에 붙이지 말고 **새 이슈**로 나눕니다.
8. **완료로 끝냅니다** (\`${c}\` → \`${e}\`). 이슈는 여기서 완료입니다.

   \`\`\`bash
   ${move(c, e)}
   \`\`\`

   다시 봐야 하면 \`${c}\` → \`${w}\`(재검증) 또는 \`${c}\` → \`${s}\`(재작업)로 되돌리고
   **무엇이 부족한지** 코멘트에 적습니다.

### 라벨을 직접 옮길 때 주의

- IVE 화면의 버튼으로 전이하면 검증 시작/완료 시각과 **누가 했는지**가 함께 기록됩니다.
  CLI 로 라벨만 옮기면 스캐너가 뒤늦게 전이를 감지하고, **주체는 이슈 담당자(assignee)로**
  기록됩니다. 에이전트로 처리하더라도 이슈 담당자를 실제 책임자로 맞춰 두세요.
- 라벨을 옮기는 계정이 봇(\`*-bot\`, \`*[bot]\`, \`project_*_bot_*\`)이면 검증자 통계에서 제외됩니다.
- 단계 라벨은 **항상 정확히 하나만** 남깁니다(옛 라벨을 반드시 함께 제거).

### 사람을 불러야 하는 때

- 운영 데이터를 바꾸거나 되돌릴 수 없는 작업(마이그레이션, 삭제, 외부 발송)
- 요구가 애매하거나 이슈 코멘트끼리 서로 어긋날 때
- 보안·권한·과금에 닿는 변경
- 테스트가 없고 A/B 로 증상을 잡을 방법도 없을 때
- 같은 이슈에서 반려·재작업이 2회 이상 반복될 때

> 확인용 주소·테스트 계정·목표 브랜치처럼 **진행에 반드시 필요한 정보가 없을 때는 멈추지 말고
> 사용자에게 물어서 받은 뒤 진행**합니다. 받은 값은 코멘트에 적어 다음 사람이 다시 묻지 않게 합니다.

### 검증·확인에 쓴 시간과 토큰 남기기 (\`ive-meta\`)

에이전트가 검증·확인을 하면 그 토큰과 시간은 **아무 데도 기록되지 않습니다.** 코멘트 맨 끝에
아래 블록을 붙이면 IVE 스캐너가 그 단계의 실행 기록에 토큰·비용·구간을 채웁니다. \`stage:\` 값이
핵심입니다 — 검증이면 \`verify\`, 확인이면 \`confirm\`(개발분을 뜻하는 기본값 \`dev\` 와 구분).

\`\`\`
<!-- ive-meta
stage: verify
model: <모델명>
input_tokens: <숫자>
output_tokens: <숫자>
cost_usd: <숫자>
turns: <숫자>
started_at: <KST 시각, 예 2026-08-31T10:00:00+09:00>
ended_at: <KST 시각>
-->
\`\`\`

- 검토 코멘트에는 \`stage: verify\`, 확인 코멘트에는 \`stage: confirm\` 을 넣습니다.
- 시각은 **실측**이고 idle(자리비움)은 뺍니다. 이슈 본문의 개발분 \`ive-meta\` 규칙과 같습니다.
- 이 블록이 있으면 그 단계는 **AI 가 한 것**으로 계산됩니다(사람 시간 0, 비용은 토큰).
  없으면 사람이 한 것으로 보고 **라벨이 열려 있던 근무시간이 사람 비용**으로 잡힙니다.
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

${generateStageLabelGuide(project)}

${generateAgentStageGuide(project)}`
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
