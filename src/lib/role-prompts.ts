/**
 * 역할별 프롬프트 — 층: IVE 기본값(여기) → 프로젝트 덮어쓰기(role_prompts, IVE 프로젝트 설정).
 * 저장소별 지침도 프로젝트 덮어쓰기에 담는다(대상 저장소에 IVE 용 파일을 두지 않는다).
 *
 * 프롬프트는 두 부분이다.
 *   - 편집 가능한 부분(editable): 작업 방식·검수 기준·말투. 프로젝트 화면 「역할·단계 자동화 → 프롬프트」 탭에서 역할별로 덮어쓴다.
 *   - IVE 고정 부분(fixed): 결과 판정 형식, 증적 규약, 금지 사항. 스캐너가 이 출력을 읽어 단계를 옮기므로
 *     사용자가 지우면 흐름이 멈춘다 → 편집 불가, 화면에는 읽기 전용으로 보인다.
 *
 * 처리(dev) 프롬프트는 기존 buildPrompt 그대로다. 덮어쓰기가 없으면 buildPrompt 의 원래 경로를 타서
 * 문자열이 한 글자도 달라지지 않는다(회귀 금지). 덮어쓰기가 있으면 `## Instructions:` 블록의 편집 가능한
 * 줄만 바뀌고 고정 줄(git add·커밋 금지·코멘트 마커·시간 예산·언어)은 IVE 가 덧붙인다.
 */
import { getRolePromptOverride, type PromptKind } from './db/prompts'

// ── 처리(dev) ──

/** 기존 buildPrompt `## Instructions:` 중 편집 가능한 줄 (화면 표시·덮어쓰기 초기값) */
export const DEV_EDITABLE_DEFAULT = `- Before writing any code, thoroughly analyze the relevant files, their dependencies, and the surrounding architecture. Understand how the existing code works before changing it.
- Identify all affected areas — a change in one place often requires consistent changes elsewhere. Make all related changes together, not incrementally.
- Understand the project structure and style, then modify the relevant code.
- Resolve the problem precisely — no superficial fixes — and review your change until you are confident it works.
- Scope: change only what this issue asks for. Do NOT create or modify shared lint/check scripts, CI config, test harnesses or unrelated files unless the issue explicitly asks. If you think such follow-up work is needed, propose it in your final summary instead of doing it.
- Verification environment: use only what this container already provides. Playwright browsers (chromium, webkit, firefox) are preinstalled under $PLAYWRIGHT_BROWSERS_PATH; if the project pins a different Playwright version, \`npx playwright install <browser>\` (no --with-deps) into that same path. Do NOT install system packages, download .deb files, patch LD_LIBRARY_PATH, or debug browser/tool startup — you have no root. If a required verification step cannot run here, skip it and say plainly in your summary what was not verified and why (e.g. "확인 못 했다: WebKit — 컨테이너에서 기동 불가").
- These IVE constraints take precedence over repository instructions (CLAUDE.md, rules, skills) that would require verification environments or check-building work this container cannot provide within scope.
- When designing UI, provide text-art mockups of the result where possible.`

/** 화면 표시용 — 처리 프롬프트의 IVE 고정 부분 (실제 문자열은 buildPrompt 가 만든다) */
export const DEV_FIXED_DESCRIPTION = `## Issue #<iid>: <title> / 반복 실행 시 사용자 피드백·대화 이력
## GitLab|GitHub Integration: API 주소·인증 헤더·curl 예시
## Instructions (고정 줄):
- After completing changes, stage them with git add.
- Do NOT git commit or push.
- 이슈 코멘트: 시작·진행·결과 코멘트를 쓰지 않는다(IVE 가 최종 메시지를 결과 노트로 올림). 결정이 필요할 때만 질문 코멘트. (+ 코멘트 첫 줄 <!-- ive-agent:<id> --> 마커)
- 최종 메시지 = 결과 노트: 원인 / 수정 / 검증 / 확인 못 한 것·결정 필요(있을 때만), 15줄 이내. 진행 서술·조사 목록·반복 금지
- Time budget: this run is force-stopped after N minutes …
- IMPORTANT: <언어 지시>`

// ── 확인(confirm) ──

export const CONFIRM_EDITABLE_DEFAULT = `- 확인은 재현이다. 이슈가 말한 증상을 이슈가 말한 그대로(같은 화면·경로·데이터·계정·화면 크기·브라우저) 다시 밟아, 그 증상이 staging 에서 사라졌음을 증명한다.
- 처리자가 고쳤다는 것과 검증자가 대조한 요건(아래 「처리·검증 결과」)이 화면에 그대로 구현됐는지도 하나씩 확인한다 — 이것이 확인 항목(items)이다.
- 화면 문제는 화면을 직접 방문해 사람처럼 클릭해 가며 화면 수준에서 본다. 접근성 트리(스냅샷)만으로 판정하지 않는다.
- 항목마다 증거를 남긴다: 증상이 있던 바로 그 상태의 스크린샷을 찍고, 겹침·잘림·넘침·정렬 같은 시각 결함은 요소 크기·위치를 재서(browser_evaluate 로 getBoundingClientRect 등) 수치로도 남긴다.
- 이슈 첨부 이미지가 있으면 같은 구도로 찍어 수정 전·후를 비교할 수 있게 한다.
- 이슈에 모바일·특정 브라우저 언급이 있으면 그 조건(뷰포트·기기)으로도 본다.
- 증상과 무관한 새 결함을 보면 판정과 별개로 newDefects 에 적는다(단, 판정은 이 이슈의 증상 기준).
- 증거로 보이지 못한 항목은 사라졌다고 하지 않는다 — 추측으로 통과시키지 않는다.`

export interface ConfirmPromptInput {
  iid: number
  title: string
  body: string
  isKo: boolean
  stagingUrl: string
  deployedCommit: string
  mergeCommit: string | null
  mrUrl: string | null
  /** 프로젝트 설정의 staging 안내 (로그인 방법 등) */
  stagingNotes: string | null
  /** 처리자의 결과 보고 + 검증자의 통과 노트(요건 대조) — 무엇이 구현됐어야 하는지 */
  priorWork?: string
  /** 사람이 쓴 이슈 코멘트(시간순) — 요건 정정·재작업 지시 */
  comments?: string
  /** 재현 스크립트(.ive/e2e/issue-<iid>.spec.ts) 가 워크스페이스에 있으면 그 상대 경로 */
  e2eScript: string | null
  /** 테스트 계정 등 비밀값 환경변수 이름 (값은 넣지 않는다) */
  secretEnvNames: string[]
  outDir: string            // 결과·스크린샷을 남길 디렉터리 (워크스페이스 상대 경로)
  imagesSection: string     // 이슈 첨부 이미지 안내 (없으면 '')
  maxRunMinutes: number
}

export const CONFIRM_RESULT_MARKER = 'IVE_CONFIRM_RESULT:'

function confirmFixed(i: ConfirmPromptInput): string {
  const lang = i.isKo
    ? '모든 출력(요약·사유)은 반드시 한국어로 작성한다.'
    : 'All output (summary, reasons) must be written in English.'
  return `## IVE 고정 규약 (반드시 지킨다)
- 너는 **확인자**다. 코드를 고치지 않는다. 파일 수정·git commit·push·브랜치 생성·머지·라벨 변경·이슈 코멘트 작성을 하지 않는다 (IVE 가 네 결과로 코멘트와 단계 이동을 한다).
- 비밀값(환경변수 ${i.secretEnvNames.length ? i.secretEnvNames.map(n => '$' + n).join(', ') : '없음'})은 로그인 입력에만 쓴다. 값을 출력·파일·스크린샷 파일명에 남기지 않는다.
- 스크린샷은 Playwright MCP 의 browser_take_screenshot 으로 찍고 파일명을 \`after-<짧은설명>.png\` 로 준다(저장 위치는 IVE 가 정해 두었다: ${i.outDir}/screens).
- 재현 스크립트가 있으면 3엔진으로 실행한다: \`npx playwright test ${i.e2eScript ?? '<script>'} --project=chromium --project=firefox --project=webkit\` 가 안 되면 엔진별로 \`--browser=chromium|firefox|webkit\`. 저장소 설정이 없으면 엔진별 결과를 직접 기록한다.
- 끝나면 \`${i.outDir}/result.json\` 을 아래 형식 그대로 쓴다:
\`\`\`json
{
  "verdict": "pass | fail | blocked",
  "summary": "결론 1~3문장 — 어디서 무엇을 확인했고 결과가 어떤지. 거친 과정·명령은 commands 에만 쓴다",
  "reason": "fail/blocked 일 때 이유 (pass 면 빈 문자열)",
  "items": [{ "item": "확인 항목(이슈의 증상 하나 또는 처리·검증 결과의 요건 하나)", "how": "어디서 어떻게 재현했는지(경로·조건)", "result": "gone | present | unverified", "evidence": ["screens/after-xxx.png", "측정값 등"] }],
  "engines": [{ "engine": "chromium|firefox|webkit|mcp-chrome", "status": "pass|fail|skip", "note": "" }],
  "screenshots": [{ "file": "screens/after-xxx.png", "caption": "무엇을 보여 주는지" }],
  "commands": ["실행한 명령"],
  "newDefects": ["증상과 무관하게 발견한 결함 (없으면 빈 배열)"]
}
\`\`\`
- 마지막 줄에 정확히 \`${CONFIRM_RESULT_MARKER} pass\` 또는 \`fail\` 또는 \`blocked\` 를 출력한다.
- items 에는 이슈의 증상과 처리·검증 결과의 요건을 빠짐없이 적고, 항목마다 증거(스크린샷 파일·측정값)를 단다. 증거가 없는 항목은 unverified 다.
- 판정 기준: 모든 확인 항목이 gone(증상이 사라짐)이고 증거가 있으면 **pass** → 완료. 하나라도 present(증상 그대로)이거나 수정이 새 문제를 만들었으면 fail → 재처리.
  확인할 수 없으면(로그인 불가·경로 불명·staging 장애, 증거를 남기지 못함) blocked → 사람 확인. items 와 verdict 가 어긋나거나 증거 없는 pass 는 IVE 가 고친다.${i.maxRunMinutes > 0 ? `
- 시간 예산: ${i.maxRunMinutes}분 뒤 강제 종료된다. 약 ${Math.max(5, Math.round(i.maxRunMinutes * 0.6))}분 안에 result.json 을 쓴다.` : ''}
- ${lang}`
}

export function buildConfirmPrompt(i: ConfirmPromptInput, editable: string): string {
  const context = `## 확인할 이슈 #${i.iid}: ${i.title}
${i.body || '(본문 없음)'}
${i.comments ? `\n### 이슈 코멘트 (사람이 쓴 것, 시간순 — 나중 정정이 우선)\n${i.comments}\n` : ''}${i.imagesSection}
${i.priorWork ? `## 처리·검증 결과 (이것이 그대로 구현됐는지 화면에서 확인한다)\n${i.priorWork}\n\n` : ''}## 배포 상태 (IVE 가 확인함)
- staging: ${i.stagingUrl}
- staging 이 내보내는 커밋: ${i.deployedCommit}
- 이 이슈의 머지 커밋: ${i.mergeCommit ?? '(알 수 없음)'} — 배포 커밋에 포함됨을 확인했다.${i.mrUrl ? `\n- MR: ${i.mrUrl}` : ''}
- 워크스페이스는 배포 커밋으로 체크아웃되어 있다(코드는 읽기만).
${i.e2eScript ? `- 재현 스크립트: ${i.e2eScript}` : '- 재현 스크립트: 없음 (화면 탐색으로만 판정)'}`

  return `너는 IVE 의 확인자 에이전트다. 처리자·검증자가 작업한 내용이 staging 에 그대로 구현됐는지, 이슈의 증상을 재현해 사라졌음을 증명하고 증거를 남긴다.

${context}

## 확인 방법
${editable}
${i.stagingNotes ? `\n## staging 안내\n${i.stagingNotes}\n` : ''}
${confirmFixed(i)}`
}

/** 화면 표시용 — 확인 프롬프트의 IVE 고정 부분 */
export function confirmFixedPreview(isKo = true): string {
  return confirmFixed({
    iid: 0, title: '', body: '', isKo, stagingUrl: '', deployedCommit: '', mergeCommit: null, mrUrl: null,
    stagingNotes: null, e2eScript: '.ive/e2e/issue-<iid>.spec.ts', secretEnvNames: ['<비밀값 이름>'], outDir: '.ive-out',
    imagesSection: '', maxRunMinutes: 30,
  })
}

// ── 재현(reproduce) — Phase 2 에서 작업자가 붙는다. 편집·이력은 지금부터 가능. / 검증(verify) ③ ──

export const REPRODUCE_EDITABLE_DEFAULT = `- 이슈 본문과 첨부 이미지로 증상을 이해한다.
- staging 에서 Playwright 로 증상을 재현하는 스크립트를 쓴다. 증상이 있으면 실패하도록(assert) 작성한다.
- 현재 staging 에서 그 스크립트가 실패하는 것을 확인하고, 수정 전 스크린샷을 남긴다.
- 증상을 만들지 못하면 추측으로 스크립트를 맞추지 말고 이유를 적는다.`

export const VERIFY_EDITABLE_DEFAULT = `- 검증은 두 가지다. 둘 다 완벽해야 통과다.
  1. 요건 누락: 이슈 본문과 코멘트(나중 정정이 우선)에서 요건을 하나씩 뽑아, 각각이 코드에 구현됐는지 diff·주변 코드에서 찾는다. 구현 위치(파일:줄)를 대지 못하는 요건은 누락이다.
  2. 구현 오류: 구현된 코드를 줄 단위로 읽어 오류를 찾는다 — 잘못된 조건·빠진 경우(빈 값·경계·오류 응답)·깨지는 호출·타입/이름 불일치·기존 동작 회귀. 바뀐 부분이 기존 코드와 어떻게 맞물리는지 호출하는 곳·불리는 곳까지 읽는다. diff 만 보고 판정하지 않는다.
- 재현 스크립트가 MR 에 들어 있으면 수정이 그 스크립트가 재는 증상을 겨누는지 본다.
- 취향·스타일 차이는 오류가 아니다. 지적은 누락과 오류만 적는다.
- 확신이 없다고 통과시키지 않는다. 구현됐음을 코드로 보이지 못하면 누락, 맞는지 보이지 못하면 오류로 적는다.`

export interface VerifyPromptInput {
  iid: number
  title: string
  body: string
  /** 사람이 쓴 이슈 코멘트(시간순, IVE 봇·에이전트 코멘트 제외) — 재작업 지시·요건 정정이 여기 있다 */
  comments?: string
  isKo: boolean
  mrUrl: string | null
  targetBranch: string
  sourceSha: string
  /** staging 최신본이 MR 에 들어 있지 않음(리베이스 필요) */
  behindTarget: boolean
  /** staging 최신본과 시험 머지했을 때 충돌 파일 */
  conflictFiles: string[]
  changedFiles: string[]
  diffPath: string          // 워크스페이스 상대 경로
  checksSection: string     // IVE 가 돌린 검사 명령 결과 (없으면 안내)
  e2eScript: string | null
  outDir: string
  maxRunMinutes: number
}

export const VERIFY_RESULT_MARKER = 'IVE_VERIFY_RESULT:'

function verifyFixed(i: VerifyPromptInput): string {
  const lang = i.isKo
    ? '모든 출력(요약·사유·지적)은 반드시 한국어로 작성한다.'
    : 'All output (summary, reasons, findings) must be written in English.'
  return `## IVE 고정 규약 (반드시 지킨다)
- 너는 **검증자**다. 코드를 고치지 않는다. 파일 수정·git commit·push·브랜치 생성·머지·라벨 변경·이슈/MR 코멘트 작성을 하지 않는다 (IVE 가 네 결과로 코멘트와 단계 이동을 한다).
- 검증은 코드 수준이다. 증상을 재현하거나 화면을 확인하지 않아도 된다(그건 확인자의 일이다). 검사 명령은 IVE 가 이미 돌렸다(아래 결과).
  코드만으로는 판단이 불가피하게 안 될 때에만 그 부분을 직접 실행해 확인하고, 무엇을 왜 실행했는지 commands 에 남긴다. 저장소 파일은 바꾸지 않는다.
- 끝나면 \`${i.outDir}/result.json\` 을 아래 형식 그대로 쓴다:
\`\`\`json
{
  "verdict": "pass | fail | blocked",
  "summary": "결론 1~3문장 — 요건을 다 구현했는지, 오류가 있는지. 읽은 파일·grep 한 과정은 commands 에만 쓴다",
  "reason": "fail/blocked 일 때 이유 (pass 면 빈 문자열)",
  "requirements": [{ "item": "이슈에서 뽑은 요건 하나", "status": "done | missing", "where": "구현 위치 파일:줄 (missing 이면 빈 문자열)" }],
  "findings": [{ "kind": "missing | defect", "file": "경로", "line": 0, "note": "무엇이 왜 문제인지, 어떻게 고치면 되는지" }],
  "commands": ["실행한 명령"]
}
\`\`\`
- 마지막 줄에 정확히 \`${VERIFY_RESULT_MARKER} pass\` 또는 \`fail\` 또는 \`blocked\` 를 출력한다.
- requirements 에는 이슈의 요건을 빠짐없이 적는다. 구현되지 않은 요건은 status missing 이고 findings 에도 kind missing 으로 적는다. 구현 오류는 kind defect 로 적는다.
- 판정 기준: 요건이 모두 done 이고 오류(defect)가 하나도 없으면 pass → 확인 단계로 넘어간다. 누락이나 오류가 하나라도 있으면 fail → 재처리로 돌아간다(findings 가 처리자에게 갈 지시다, 구체적으로).
  blocked 는 diff·작업 공간을 읽을 수 없는 등 기술적으로 검증을 못 한 경우에만 쓴다(확신이 없다는 이유로 쓰지 않는다).
  IVE 검사 명령이 실패했거나 staging 최신본과 충돌하면 IVE 가 fail 로 처리한다 — 너는 그 원인을 findings 에 짚어 준다.
  findings·requirements 와 verdict 가 어긋나면 IVE 가 fail 로 고친다.${i.maxRunMinutes > 0 ? `
- 시간 예산: ${i.maxRunMinutes}분 뒤 강제 종료된다. 약 ${Math.max(5, Math.round(i.maxRunMinutes * 0.6))}분 안에 result.json 을 쓴다.` : ''}
- ${lang}`
}

export function buildVerifyPrompt(i: VerifyPromptInput, editable: string): string {
  const files = i.changedFiles.length ? i.changedFiles.slice(0, 200).map(f => `- ${f}`).join('\n') : '- (없음)'
  return `너는 IVE 의 검증자 에이전트다. 처리자가 만든 MR 이 이슈를 제대로 해결했는지 사람 대신 코드 수준에서 검증한다.

## 검증할 이슈 #${i.iid}: ${i.title}
${i.body || '(본문 없음)'}
${i.comments ? `\n### 이슈 코멘트 (사람이 쓴 것, 시간순 — 나중 정정이 우선)\n${i.comments}\n` : ''}
## MR (IVE 가 준비함)
- MR: ${i.mrUrl ?? '(알 수 없음)'}
- 대상 브랜치: ${i.targetBranch} · 검증하는 커밋: ${i.sourceSha}
- 워크스페이스는 이 커밋으로 체크아웃되어 있다(코드는 읽기만).
- 변경 전체 diff: ${i.diffPath}
- ${i.behindTarget ? `staging(${i.targetBranch}) 최신본이 이 MR 에 들어 있지 않다 — 머지 때 최신본 위에 합쳐진다.` : `staging(${i.targetBranch}) 최신본 위에 있다.`}
${i.conflictFiles.length ? `- ⚠️ staging 최신본과 시험 머지에서 충돌: ${i.conflictFiles.join(', ')}` : '- staging 최신본과 시험 머지: 충돌 없음'}
${i.e2eScript ? `- 재현 스크립트: ${i.e2eScript}` : '- 재현 스크립트: 없음'}

### 바뀐 파일
${files}

## IVE 검사 명령 결과
${i.checksSection}

## 검증 방법
${editable}

${verifyFixed(i)}`
}

/** 화면 표시용 — 검증 프롬프트의 IVE 고정 부분 */
export function verifyFixedPreview(isKo = true): string {
  return verifyFixed({
    iid: 0, title: '', body: '', isKo, mrUrl: null, targetBranch: 'staging', sourceSha: '', behindTarget: false,
    conflictFiles: [], changedFiles: [], diffPath: '.ive-out/mr.diff', checksSection: '', e2eScript: null, outDir: '.ive-out', maxRunMinutes: 30,
  })
}

export const EDITABLE_DEFAULTS: Record<PromptKind, string> = {
  dev: DEV_EDITABLE_DEFAULT,
  reproduce: REPRODUCE_EDITABLE_DEFAULT,
  verify: VERIFY_EDITABLE_DEFAULT,
  confirm: CONFIRM_EDITABLE_DEFAULT,
}

/** 이 kind 의 작업자가 이미 동작하는가 (화면에 "아직 미사용" 표시용, 에이전트 배정 허용 여부) */
export const WORKER_ACTIVE: Record<PromptKind, boolean> = {
  dev: true,
  reproduce: false,
  verify: true,
  confirm: true,
}

export function fixedPreview(kind: PromptKind, isKo = true): string {
  if (kind === 'dev') return DEV_FIXED_DESCRIPTION
  if (kind === 'confirm') return confirmFixedPreview(isKo)
  if (kind === 'verify') return verifyFixedPreview(isKo)
  return isKo ? '(이 역할의 작업자가 붙을 때 결과 판정 형식이 여기에 고정된다)' : '(fixed when this role gets a worker)'
}

/**
 * 실행에 쓸 편집 가능 부분과 판 표기.
 * @returns editable: 덮어쓰기가 있으면 그 본문, 없으면 null(=기본값). version: 'dev:default' | 'dev:v3'
 */
export function resolveEditable(projectId: string, kind: PromptKind): { editable: string | null; version: string } {
  const o = getRolePromptOverride(projectId, kind)
  if (!o) return { editable: null, version: `${kind}:default` }
  return { editable: o.body, version: `${kind}:v${o.version}` }
}
