import type { Project } from '@/types'
import { DEFAULT_LABELS } from '@/lib/labels'

/**
 * IVE 가 프로젝트에 설치하는 Claude Code 스킬 — 처리(ive-handle) · 검증(ive-verify) · 확인(ive-confirm).
 *
 * IVE 가 에이전트를 자동 배정해 처리하는 길과 별개로, 개발자가 자기 프롬프트를 띄우고
 * 「IVE 건 처리해줘 / 검증해줘 / 확인해줘」 라고 시킬 때 AI 가 같은 절차를 밟게 한다.
 * 루틴·서브에이전트 감시는 넣지 않는다 — 사람이 요청한 건만 그 자리에서 한다.
 * 세부 규칙(왜 그렇게 하는지)은 CLAUDE.md 의 IVE 구간이 원본이고, 스킬은 그 순서만 체크리스트로 뽑은 것이다.
 */

export const SKILL_DIR = '.claude/skills'
export const SKILL_NAMES = ['ive-handle', 'ive-verify', 'ive-confirm'] as const
export const skillPath = (name: string) => `${SKILL_DIR}/${name}/SKILL.md`

type Ctx = {
  s: string; d: string; w: string; v: string; pw: string; c: string; e: string
  isGitHub: boolean
  repo: string
  move: (from: string, to: string) => string
  note: string
  list: (label: string) => string
  base: string
  site: string
}

function repoPath(url: string | undefined): string | null {
  try {
    const p = new URL(url || '').pathname.replace(/^\/+|\/+$/g, '').replace(/\.git$/, '')
    return p || null
  } catch { return null }
}

function buildCtx(project: Project): Ctx {
  const isGitHub = /github\.com/i.test(project.repoUrl || '')
  const repo = repoPath(project.repoUrl) || '<네임스페이스/저장소>'
  const enc = encodeURIComponent(repo)
  return {
    s: project.labelSchedule || DEFAULT_LABELS.schedule,
    d: project.labelDev || DEFAULT_LABELS.dev,
    w: project.labelVerifyWait || DEFAULT_LABELS.verifyWait,
    v: project.labelVerify || DEFAULT_LABELS.verify,
    pw: project.labelConfirmWait || DEFAULT_LABELS.confirmWait,
    c: project.labelConfirm || DEFAULT_LABELS.confirm,
    e: project.labelEnd || DEFAULT_LABELS.end,
    isGitHub,
    repo,
    move: (from, to) => isGitHub
      ? `gh issue edit <번호> -R ${repo} --remove-label "${from}" --add-label "${to}"`
      : `glab api --method PUT "projects/${enc}/issues/<번호>" -f "remove_labels=${from}" -f "add_labels=${to}"`,
    note: isGitHub
      ? `gh issue comment <번호> -R ${repo} --body-file note.md`
      : `glab issue note <번호> -R ${repo} --message "$(cat note.md)"`,
    list: (label) => isGitHub
      ? `gh issue list -R ${repo} --label "${label}" --state open`
      : `glab api "projects/${enc}/issues?labels=${encodeURIComponent(label)}&state=opened"`,
    base: project.baseBranch
      ? `이 프로젝트의 목표 브랜치는 \`${project.baseBranch}\` 입니다.`
      : '목표 브랜치가 IVE 프로젝트 설정에 없습니다. 추측하지 말고 사용자에게 어느 브랜치인지 물어 답을 받은 뒤 진행하세요.',
    site: project.testSiteUrl
      ? `이 프로젝트의 확인용 주소는 ${project.testSiteUrl} 입니다.`
      : '확인용 주소가 IVE 프로젝트 설정에 없습니다. 이슈·MR·README 에서 찾고, 없으면 사용자에게 어디서 확인하면 되는지(로그인이 필요하면 테스트 계정도) 물어 받은 뒤 진행하세요. 임의의 로컬 서버를 띄워 「확인했다」고 하지 않습니다.',
  }
}

const frontMatter = (name: string, description: string) =>
  `---\nname: ${name}\ndescription: ${JSON.stringify(description)}\n---\n`

const SIBLINGS = '짝 스킬: 처리 `ive-handle` · 검증 `ive-verify` · 확인 `ive-confirm`. 단계 라벨의 뜻과 규칙의 이유는 CLAUDE.md 의 「IVE 단계 라벨」 절이 원본이다 — 이 스킬과 다르게 적혀 있거나 프로젝트 자체 규칙이 있으면 그쪽을 따르고 라벨 이름·단계 순서만 이 스킬을 따른다.'

function handleSkill(x: Ctx): string {
  return `${frontMatter('ive-handle', `IVE 이슈를 «처리자»로서 고치는 절차 — 요건 정리 → 구현 → 가능한 검수 → 커밋 → 결과 노트 → 「${x.w}」. 「IVE 건 처리해줘」, 「${x.s}」 라벨 이슈를 맡길 때 쓴다. 검증은 ive-verify, 확인은 ive-confirm.`)}
# IVE 이슈 처리 (처리자)

> ${SIBLINGS}

사용자가 직접 요청한 건만 처리한다. 대기 건을 스스로 찾아 줄줄이 시작하지 않는다.

## 체크리스트 — 이 순서대로

1. **대상을 정한다.** 사용자가 번호를 말했으면 그 이슈. 없으면 \`${x.list(x.s)}\` 로 처리대기 목록을 보여 주고 어느 건인지 묻는다.
2. **첫 동작 = 단계 이동.** 코드를 읽기 전에 \`${x.s}\` → \`${x.d}\`(개발 중). 이미 \`${x.d}\` 면 건드리지 않는다. 이동 뒤 라벨을 다시 읽어 **단계 라벨이 하나만** 남았는지 본다.
   \`\`\`bash
   ${x.move(x.s, x.d)}
   \`\`\`
3. **요건 목록을 먼저 쓴다.** 이슈 본문과 **모든 코멘트**(보완·지난 반려 지시·「🔁 반려 반복」)를 시각 순으로 읽고 요건을 한 줄씩 적는다. 마지막 정정이 우선이다. 반려된 건이면 지난 지시 항목을 전부 한 번에 끝낸다.
4. **프로젝트 규칙을 먼저 연다.** CLAUDE.md·AGENTS.md 의 다른 절과 건드릴 영역의 규칙 파일을 읽는다.
5. **브랜치.** \`dev-<번호>\` 에서 작업한다(이미 있으면 이어서 — 반려 건). ${x.base} 새 브랜치를 만들기 전에 사용자에게 한 줄로 알린다.
6. **요건을 전부 구현한다.** 축소·누락 금지. 같은 유형의 결함은 한 곳이 아니라 전수로 고친다.
7. **되는 검수는 다 한다.** 테스트는 **기준선(변경 전) → 변경 후 → A/B(새 테스트는 두고 소스만 되돌려 실패하는지)** 세 단으로, 명령은 절대경로로 돌린다. 이슈에 적힌 대상(문서·레코드·URL)이 있으면 합성 재현으로 끝내지 말고 실제 값으로 전/후를 잰다(읽기만).
8. **못 하는 검수는 「확인 요청」으로 넘긴다.** 앱 서버·DB·화면·운영 접근처럼 이 환경에 없는 것은 노트에 **어디서 · 순서 · 고쳐졌을 때/아닐 때 보이는 것 · 필요한 데이터·계정 · 먼저 할 일(DDL 등)** 을 적는다. 「화면 검수 못 함」 한 줄은 넘김이 아니다.
9. **커밋하고 MR/PR 을 올린다.** 푸시·MR 생성 전에 사용자에게 한 줄로 확인한다. MR/PR 본문에는 이슈 번호만 언급하고 ⛔ \`Closes #번호\` 같은 닫기 키워드는 쓰지 않는다 — 머지로 이슈가 닫히면 확인 단계가 통째로 건너뛰어진다.
10. **결과 노트를 남기고 \`${x.d}\` → \`${x.w}\`(검증 대기).** 노트에 **요건↔수정 대조표**, 기준선/변경 후/A/B 수치, 실측 전/후, 「확인 요청」, 못 한 것(「확인 못 했다」와 「문제없다」는 다르다)을 적는다. 이슈는 **닫지 않는다.**
    \`\`\`bash
    ${x.note}
    ${x.move(x.d, x.w)}
    \`\`\`
11. **\`ive-meta\` 를 남긴다.** 이슈 본문 또는 노트 끝에 처리 시간·토큰을 \`ive-meta\` 블록으로 남긴다(형식과 idle 제외 방법은 CLAUDE.md 「메타데이터」). 없으면 이 작업의 시간이 0 으로 집계된다.
12. **막히면 우회하지 말고 멈춘다.** 권한 거부·요건 모호·환경 없음이면 라벨은 \`${x.d}\` 에 두고 필요한 것과 이유를 노트·보고에 적는다.
13. **보고는 10줄 이내.** 첫 줄에 결과(완료·보류) + 현재 라벨 + 브랜치·커밋. 확인한 것만 쓴다.
`
}

function verifySkill(x: Ctx): string {
  return `${frontMatter('ive-verify', `IVE 이슈를 «검증자»로서 보는 절차 — 「${x.w}」 건을 「${x.v}」로 옮기고 코드 재검토 + 요청 대조 후, 통과면 머지해 「${x.pw}」, 못 미치면 재작업 지시와 함께 「${x.s}」. 「IVE 검증해줘」, 「IVE 작업 검수해줘」(=검증), 「${x.v}」 건에 쓴다. 처리는 ive-handle, 확인은 ive-confirm.`)}
# IVE 이슈 검증 (검증자)

> ${SIBLINGS}

검증 = **코드 재검토 + 요청 대조**, 이 둘뿐이다. 화면을 밟아 보는 것은 확인(\`ive-confirm\`)의 몫이다.
⛔ 자기가 처리한 건은 이어진 문맥에서 검증하지 않는다 — 새 세션에서 이슈와 코드를 처음 보는 것처럼 읽는다.

## 체크리스트 — 이 순서대로

1. **대상을 정한다.** 번호가 없으면 \`${x.list(x.w)}\` 로 검증대기 목록을 보여 주고 묻는다.
2. **첫 동작 = 단계 이동.** 코드를 읽기 전에 \`${x.w}\` → \`${x.v}\`. 이동 뒤 단계 라벨이 하나만 남았는지 다시 읽어 본다.
   \`\`\`bash
   ${x.move(x.w, x.v)}
   \`\`\`
3. **요건 목록을 먼저 쓴다.** 본문 + **모든 코멘트**를 시각 순으로 읽고 요건을 한 줄씩 적는다. 보완 코멘트의 시각이 커밋보다 늦으면 그 요건은 코드에 없을 수 있다.
4. **⛔ 처리자의 「완료」를 믿지 않는다.** 노트만 읽지 말고 MR/PR·커밋이 실제로 있는지부터 본다. 없으면 처리되지 않은 것이다.
5. **diff 를 줄 단위로 읽는다.** 이슈 본문·코멘트의 요건과 **1:1 대조표**를 만든다. 범위 밖 변경(무관한 파일·전면 포맷팅·삭제된 테스트)은 지적 대상이다. 공용 부품을 바꿨으면 쓰는 곳을 grep 해 표에 넣고 하나씩 맞는지 본다.
6. **바뀐 쪽 테스트만 돌린다.** 기준선 → 변경 후 → A/B 증적이 노트·MR 에 있는지 본다. 처리 환경에서 **할 수 있었던** 증적이 없으면 반려, **할 수 없었던**(화면·실제 DB·운영) 것은 반려하지 않고 통과 노트의 「확인 요청」으로 옮긴다.
7. **반려는 «머지하면 깨진다»에만.** 요건 누락·명백한 오류·충돌·테스트 실패만 반려한다. 사소한 결함은 직접 고쳐(추가 커밋) 같은 기준으로 다시 본다. 가상의 결함·표현·더 단단히 할 여지는 통과 노트의 「후속」에 적고 머지한다. ⛔ 같은 사유로 두 번 반려하지 않는다.
8. **통과면 머지.** ${x.base} 충돌은 소스 브랜치에서 풀고 테스트를 다시 돌린 뒤 머지하고 개발 브랜치를 지운다.
   \`\`\`bash
   ${x.isGitHub ? 'gh pr merge <PR번호> --merge --delete-branch' : `glab mr merge <MR번호> -R ${x.repo} --remove-source-branch --yes`}
   \`\`\`
9. **「확인 요청」을 구체화해 노트에 남긴다.** 처리자가 넘긴 것이 모호하면 코드를 읽어 **어디서 · 순서 · 기대 · 아니면 보이는 것 · 필요한 데이터·계정**으로 직접 풀어 쓴다. DDL 이 따르면 머지 **전에** 선적용한다.
10. **결론 단계로 옮긴다.** 통과 → \`${x.v}\` → \`${x.pw}\`(⛔ \`${x.e}\` 로 올리지 않는다 — 완료는 확인 뒤). 못 미침 → \`${x.v}\` → \`${x.s}\` + **파일·줄·고칠 방향**이 든 재작업 지시.
    \`\`\`bash
    ${x.note}
    ${x.move(x.v, x.pw)}
    \`\`\`
11. **\`ive-meta\` 에 \`stage: verify\` 를 넣어 노트 끝에 남긴다.** 이 블록이 있어야 검증이 AI 가 한 일로 집계된다(없으면 라벨이 열려 있던 근무시간이 사람 비용이 된다). 형식은 CLAUDE.md 「검증·확인에 쓴 시간과 토큰 남기기」.
12. **막히면 멈춘다.** 판단 근거를 만들 수 없으면 통과가 아니라 멈춤이다 — \`${x.v}\` 에 두고 무엇이 필요한지 노트에 적는다.
13. **보고는 10줄 이내.** 첫 줄에 결과(통과·반려·보류) + 현재 라벨.

**확인에서 반려돼 \`${x.w}\` 로 돌아온 건:** 확인자가 남긴 단서(요소·측정값·이긴 규칙·의심 파일)마다 원인 코드를 짚어 파일·줄·고칠 방향으로 재작업 지시를 쓰고 \`${x.s}\` 로 넘긴다. 이미 고쳐진 것이 보이면 근거를 적고 확인 요청으로 다시 넘긴다.
**「🔁 반려 반복 — 사람 판단 필요」 건:** 다시 반려하지 않는다. ① 남은 것이 확인 요청뿐이면 머지 → \`${x.pw}\` ② 구현이 모자라면 한 번에 끝낼 재작업 지시 ③ 요건을 정해야 하면 사용자에게 묻는다.
`
}

function confirmSkill(x: Ctx): string {
  return `${frontMatter('ive-confirm', `IVE 이슈를 «확인자»로서 보는 절차 — 「${x.pw}」 건을 「${x.c}」로 옮기고 반영된 환경에서 접수된 그 증상이 고쳐졌는지 증거와 함께 밟아, 고쳐졌으면 「${x.e}」, 여전하면 화면 단서와 함께 「${x.w}」. 「IVE 확인해줘」, 「${x.c}」 건에 쓴다. 처리는 ive-handle, 검증은 ive-verify.`)}
# IVE 이슈 확인 (확인자)

> ${SIBLINGS}

확인 = **머지·반영된 것이 실제로 그렇게 동작한다는 것을 남이 봐도 알 수 있게 증명**하는 일이다. 코드를 다시 읽는 자리가 아니다(검증에서 끝났다).

## 체크리스트 — 이 순서대로

1. **대상을 정한다.** 번호가 없으면 \`${x.list(x.pw)}\` 로 확인대기 목록을 보여 주고 묻는다.
2. **반영됐는지 먼저 본다.** 머지 커밋이 확인할 환경에 실제로 올라갔는지(배포 시각·버전 표시) 본다. ${x.site} 반영 전이면 확인이 아니라 **기다림**이다 — 그 사실을 노트에 적고 \`${x.pw}\` 에 둔다.
3. **⛔ 실제로 밟기 시작할 때 \`${x.pw}\` → \`${x.c}\`.** 기다리는 동안 올려 두지 않는다 — 아무도 안 본 시간이 확인 시간으로 잡힌다. 이동 뒤 단계 라벨이 하나만 남았는지 다시 읽는다.
   \`\`\`bash
   ${x.move(x.pw, x.c)}
   \`\`\`
4. **원 요청으로 돌아간다.** 요청자가 쓴 문장과 결과가 맞는지 본다. 처리·검증 노트의 **「확인 요청」을 전부** 확인 목록에 옮긴다 — 앞 단계가 못 한 검수가 여기서 처음 이뤄진다. 접수자의 브라우저·화면 모드·기기 정보가 본문에 있으면 그대로 따른다.
5. **무엇으로 증명할지 고른다.** 화면=스크린샷(전/후) · API=요청과 응답 그대로 · 규칙·정책=**막혀야 할 입력과 통과해야 할 입력 둘 다** · 배치=실행 로그+처리 건수 · 데이터=같은 쿼리 전/후 건수(읽기 전용) · 권한=권한 **없는** 계정으로 거부되는 것까지.
6. **증명에는 세 가지가 들어간다.** ① 재현 경로(주소·명령·대상 ID) ② 결과(요약이 아니라 붙여넣은 출력·화면) ③ 대조(전/후, 또는 성공·실패 두 케이스). ⛔ 「테스트 통과」「코드 확인함」「로직상 문제 없음」은 증명이 아니다.
   화면은 \`npx playwright screenshot --viewport-size=1280,800 "<확인 주소>/경로" after.png\` 처럼 찍는다.
7. **증거를 이슈에 올린다.** ${x.isGitHub
    ? 'GitHub 은 첨부 업로드 API 가 없다 — 기본 브랜치의 `.ive-assets/` 에 이미지를 커밋하고 raw URL 을 코멘트에 넣는다.'
    : `GitLab 은 \`glab api --method POST "projects/${encodeURIComponent(x.repo)}/uploads" --form "file=@shot.png" --jq .markdown\` 가 돌려주는 markdown 을 코멘트에 그대로 넣는다.`} 코멘트에서 실제로 보이는지 확인한다.
8. **막히면 멈춘다(우회 금지).** 로그인·권한·데이터가 없어 밟을 수 없으면 비슷한 다른 대상으로 대신하지 말고 필요한 것을 노트·보고에 적는다. 못 밟은 항목이 남으면 \`${x.e}\` 로 올리지 않는다.
9. **결론 단계로 옮긴다.** 고쳐졌다 → \`${x.c}\` → \`${x.e}\`(완료). 여전하다 → ⛔ **\`${x.w}\`(검증 대기)** — \`${x.s}\`(처리대기)로 바로 보내지 않는다. 반려 노트에는 화면을 본 사람만 줄 수 있는 단서를 남긴다: 화면·경로·뷰포트·데이터 / 문제 요소 선택자와 측정값(기대 vs 실제) / 이긴 규칙 / 의심 파일·고칠 방향. 「안 된다」만 적고 돌려보내지 않는다.
   \`\`\`bash
   ${x.note}
   ${x.move(x.c, x.e)}
   \`\`\`
10. **\`ive-meta\` 에 \`stage: confirm\` 을 넣어 노트 끝에 남긴다.** 형식은 CLAUDE.md 「검증·확인에 쓴 시간과 토큰 남기기」.
11. **내보내기 전 마무리.** 코드만 들어가서는 안 바뀌는 것(기존 데이터 재처리·설정)이 남았으면 대상 건수를 적는다. 후속 작업은 이 이슈에 붙이지 말고 새 이슈로 나눈다.
12. **보고는 10줄 이내.** 첫 줄에 결과(완료·반려·보류) + 현재 라벨.
`
}

/** 설치할 스킬 파일 3종 (경로 → 내용). 전체가 IVE 소유라 설치할 때마다 통째로 다시 쓴다. */
export function generateIveSkills(project: Project): { path: string; content: string }[] {
  const x = buildCtx(project)
  return [
    { path: skillPath('ive-handle'), content: handleSkill(x) },
    { path: skillPath('ive-verify'), content: verifySkill(x) },
    { path: skillPath('ive-confirm'), content: confirmSkill(x) },
  ]
}
