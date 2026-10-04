/**
 * CLI 에이전트에 전달할 프롬프트 구성
 */
import { Project } from "@/types";

/** 처리 결과 표시 — 최종 메시지 마지막 줄. mr-creator 가 읽어 검증대기 / 처리 미완(재처리)을 가른다. */
export const DEV_RESULT_MARKER = 'IVE-RESULT:';

/** 최종 보고에서 결과 표시를 읽는다. 표시가 없으면 null(종전 동작 — 검증대기). */
export function devResultOf(report: string): 'complete' | 'incomplete' | null {
  const m = [...report.matchAll(/IVE-RESULT:\s*`?\s*(complete|incomplete)\b/gi)].pop();
  return m ? (m[1].toLowerCase() as 'complete' | 'incomplete') : null;
}

// 요건·공용 부품 전수·범위 — IVE 고정 줄(프로젝트 덮어쓰기로 지우지 못한다).
//   #1972·#1975(2026-10-04): 공용 목록 부품을 바꾸면서 쓰는 곳을 훑지 않아 다른 화면이 깨졌고(스크롤바가 화면 밖),
//   이슈가 명시한 검사 축을 「범위 밖」이라며 건너뛰었다.
export const DEV_REQUIREMENT_LINES = `- Requirements: list every requirement in the issue body and in every later rejection/confirmation note (later corrections win) and implement all of them. Ending your run while a requirement is unimplemented is a failure, not a result — stop early only when you need the issue author's decision (then ask in a comment).
- Shared code: when you change a shared component, style class, CSS variable, composable or utility, grep every usage in the repository and make sure each one is still correct — including screens the issue does not name. A fix that is right for one screen and breaks another is not done.
- Scope: requirements written in the issue or in a rejection note are in scope — including any checks, lint axes or tests they ask for. Do NOT create or modify shared lint/check scripts, CI config, test harnesses or unrelated files that nobody asked for; if you think such follow-up work is needed, propose it in your final summary instead.`;

// ⛔ 「IVE 제약이 저장소 규칙(CLAUDE.md·rules·skills)보다 우선」이라고 넓게 쓰지 않는다 (#1975) —
//    환경 우회 금지만 막으려던 줄이 요건·전수 확인까지 끊어도 된다고 읽혔다. 예외는 환경 하나뿐이다.
export const DEV_REPO_RULES_LINE = `- Repository rules (CLAUDE.md, .claude/rules, skills) apply in full. The only IVE exception is the environment: when a repository rule needs something this container lacks (running app server, database, real screen), do the code-level part and report the rest as not verified.`;

/**
 * 이슈 처리용 프롬프트를 구성합니다.
 */
export function buildPrompt(
  project: Project,
  issue: any,
  iid: number,
  isConflictTask: boolean,
  isGitHub: boolean,
  isKo: boolean,
  iterationCount: number,
  latestFeedback: string,
  iterationContext: string,
  isOAuthToken: boolean = false,
  agentId?: string,
  maxRunMinutes: number = 0,
  /** 프로젝트 덮어쓰기(역할 프롬프트 「처리」). null/undefined 면 기존 문자열 그대로 */
  instructionsOverride?: string | null,
): string {
  const repoUrlParsed = new URL(project.repoUrl.replace(/\.git$/, ''));
  const providerLabel = isGitHub ? 'GitHub' : 'GitLab';
  const langInstruction = isKo
    ? 'You MUST respond in the user\'s language: Korean (ko). 모든 출력 — 코멘트, 설명, 상태 업데이트, 작업 요약 — 반드시 한국어로 작성하세요. All output MUST be written in Korean.'
    : 'You MUST respond in the user\'s language: English (en). All output must be in English.';

  let prompt: string;

  if (isConflictTask) {
    prompt = `${langInstruction}\n\n${issue.description}`;
  } else if (iterationCount === 1) {
    prompt = `Please resolve the following ${providerLabel} issue. ${langInstruction}

## Issue #${iid}: ${issue.title}
${issue.description || "No description"}`;
  } else {
    // ⛔ 「피드백이 유일한 지시, 원래 요건은 이미 끝났다」고 쓰지 않는다 (#1972·#1975, 2026-10-04).
    //   1회차가 요건 4개 중 1개만 하고 끝났는데, 2회차부터 이 문구 때문에 반려 노트의 증상만 고치고
    //   원래 요건·공용 부품 전수는 다시 보지 않았다 → 처리 4회·반려 5회 뒤 사람이 직접 고쳤다.
    const feedbackSection = latestFeedback
      ? `## 🚨 Feedback since the last run (address every point):
${latestFeedback}

**⚠️ The original issue below is still in force.** The feedback lists what was rejected or found missing — it does NOT mean the rest of the issue is done. Address every point in the feedback, re-check every requirement of the original issue against the current branch and finish whatever is still missing, and do not regress what earlier runs fixed.`
      : `## 🚨 Re-run — finish the issue:
The user has requested a re-run of this issue. Review the conversation history below and the previous work, re-check every requirement of the original issue against the current branch, then fix any remaining problems or incomplete parts.`;

    prompt = `This is follow-up iteration #${iterationCount} for issue #${iid} "${issue.title}". ${langInstruction}

${feedbackSection}
${iterationContext}

## Original issue #${iid} (requirements still in force)
${issue.description || "No description"}`;
  }

  // Provider API 정보 추가
  if (isGitHub) {
    const ownerRepo = repoUrlParsed.pathname.startsWith('/') ? repoUrlParsed.pathname.slice(1) : repoUrlParsed.pathname;
    prompt += `

## GitHub Integration:
- GitHub API: https://api.github.com
- Repository: ${ownerRepo}
- Issue Number: ${iid}
- Auth: Use IVE_GITHUB_TOKEN env var (Authorization: Bearer header)

### Available GitHub API Examples:
\`\`\`bash
# Post a comment on the issue
curl -s -H "Authorization: Bearer $IVE_GITHUB_TOKEN" -H "Accept: application/vnd.github+json" -X POST "https://api.github.com/repos/${ownerRepo}/issues/${iid}/comments" -d '{"body":"Comment text"}'

# Get issue details
curl -s -H "Authorization: Bearer $IVE_GITHUB_TOKEN" -H "Accept: application/vnd.github+json" "https://api.github.com/repos/${ownerRepo}/issues/${iid}"

# List issue comments
curl -s -H "Authorization: Bearer $IVE_GITHUB_TOKEN" -H "Accept: application/vnd.github+json" "https://api.github.com/repos/${ownerRepo}/issues/${iid}/comments"
\`\`\``;
  } else {
    const gitlabBaseUrl = `${repoUrlParsed.protocol}//${repoUrlParsed.host}`;
    const projectPath = repoUrlParsed.pathname.startsWith('/') ? repoUrlParsed.pathname.slice(1) : repoUrlParsed.pathname;
    const encodedProjectPath = encodeURIComponent(projectPath);
    // 토큰 유형에 맞는 인증 헤더 지시:
    //   OAuth access_token → Authorization: Bearer (PRIVATE-TOKEN 으로 보내면 401)
    //   PAT → PRIVATE-TOKEN
    // 잘못된 헤더를 알려주면 에이전트가 401을 "토큰 만료"로 오해하고 glab CLI fallback 등 헛수고를 함.
    const authHeader = isOAuthToken
      ? `--header "Authorization: Bearer $IVE_GITLAB_TOKEN"`
      : `--header "PRIVATE-TOKEN: $IVE_GITLAB_TOKEN"`;
    const authHint = isOAuthToken
      ? 'Use IVE_GITLAB_TOKEN env var. This is an OAuth access token — send via `Authorization: Bearer` header. Do NOT use `PRIVATE-TOKEN` header (it will return 401).'
      : 'Use IVE_GITLAB_TOKEN env var (PRIVATE-TOKEN header)';
    prompt += `

## GitLab Integration:
- GitLab API: ${gitlabBaseUrl}/api/v4
- Project: ${projectPath} (encoded: ${encodedProjectPath})
- Issue IID: ${iid}
- Auth: ${authHint}

### Available GitLab API Examples:
\`\`\`bash
# Post a comment on the issue
curl -s ${authHeader} -X POST "${gitlabBaseUrl}/api/v4/projects/${encodedProjectPath}/issues/${iid}/notes" --data-urlencode "body=Comment text"

# Get issue details
curl -s ${authHeader} "${gitlabBaseUrl}/api/v4/projects/${encodedProjectPath}/issues/${iid}"

# List issue comments
curl -s ${authHeader} "${gitlabBaseUrl}/api/v4/projects/${encodedProjectPath}/issues/${iid}/notes"
\`\`\``;
  }

  // IVE UI 에서 에이전트가 작성한 코멘트로 표시되려면 매 코멘트 본문 최상단에 아래 마커를 붙여야 함.
  // Git UI 상으로는 HTML 주석이라 보이지 않고, IVE UI 가 이 마커로 에이전트 이름/아바타를 복원함.
  const agentMarkerHint = agentId
    ? `\n- IMPORTANT: When posting any comment on the issue, ALWAYS prepend this exact HTML comment at the very top of the comment body, on its own line: \`<!-- ive-agent:${agentId} -->\`. It is invisible in Git UI but lets IVE show the correct agent name/avatar. Example comment body:\n\n    \`\`\`\n    <!-- ive-agent:${agentId} -->\n    진행하려면 결정이 필요합니다: …\n    \`\`\``
    : '';

  // 결과 노트 규약 — IVE 가 최종 메시지를 이슈 결과 노트로 올린다(mr-creator.buildWorkSummary).
  // 시작·진행·결과 코멘트를 에이전트가 따로 쓰면 같은 내용이 노트 2~3개로 겹치고, 처리 중 말까지 실려 아무도 읽지 않는다.
  const reportSections = isKo
    ? '**원인** / **수정** / **검증** / **요건 대조** / **확인 못 한 것**(있을 때만) / **결정 필요**(있을 때만)'
    : '**Cause** / **Fix** / **Verified** / **Requirements** / **Not verified** (only if any) / **Decision needed** (only if any)';
  // 결과 표시 — IVE(mr-creator)가 이 줄로 「검증대기」와 「처리 미완(재처리)」을 가른다.
  const reportRule = `- Issue comments: do NOT post start, progress or result comments — IVE posts your final message on the issue as the result note. Post a comment only when you need the issue author's decision to continue.${agentMarkerHint}
- Your FINAL message is that result note, and people only read short ones. Write it as a brief report, not a work log — at most ~25 lines:
  ${reportSections} — 1–3 short bullets each; name the changed files once.
  The requirements section has one line per requirement (issue body + rejection/confirmation notes): ✅ done (where) or ❌ not done (why).
  No progress narration ("checking…", "now I will…"), no lists or tables of places you inspected, no repetition, no remarks about git add/commit status.
- The very last line of your final message must be exactly \`${DEV_RESULT_MARKER} complete\` (every requirement ✅) or \`${DEV_RESULT_MARKER} incomplete\` (any ❌). An incomplete run goes back to the queue to be continued; it is never passed on as done.`;

  // ⛔ 「상한의 60% 안에 끝내라·검증이 길면 멈추고 보고하라」를 두지 않는다 (#1975, 2026-10-04):
  //   요건 4개 중 1개만 하고 8분 만에 스스로 끝냈다. 시간 상한은 헛돌기(환경 우회)를 끊는 안전장치일 뿐이다.
  const timeBudget = maxRunMinutes > 0 ? `
- Time budget: this run is force-stopped after ${maxRunMinutes} minutes (your changes are then preserved as a patch). Stage your changes (git add) as soon as each fix is in place. Spend the time on implementing every requirement first; if time runs short, skip optional verification — never requirements.` : '';

  if (instructionsOverride && instructionsOverride.trim()) {
    // 덮어쓰기: 편집 가능한 줄만 바꾸고 IVE 고정 줄(스테이징·커밋 금지·코멘트 마커·시간 예산·언어)은 유지.
    prompt += `

## Instructions:
${instructionsOverride.trim()}
${DEV_REQUIREMENT_LINES}
${DEV_REPO_RULES_LINE}
- After completing changes, stage them with git add.
- Do NOT git commit or push.
${reportRule}${timeBudget}
- IMPORTANT: ${langInstruction}`;
    return prompt;
  }

  prompt += `

## Instructions:
- Before writing any code, thoroughly analyze the relevant files, their dependencies, and the surrounding architecture. Understand how the existing code works before changing it.
- Identify all affected areas — a change in one place often requires consistent changes elsewhere. Make all related changes together, not incrementally.
- Understand the project structure and style, then modify the relevant code.
- After completing changes, stage them with git add.
- Do NOT git commit or push.
${reportRule}
- Resolve the problem precisely — no superficial fixes — and review your change until you are confident it works.
${DEV_REQUIREMENT_LINES}
- Verification environment: use only what this container already provides. Playwright browsers (chromium, webkit, firefox) are preinstalled under $PLAYWRIGHT_BROWSERS_PATH; if the project pins a different Playwright version, \`npx playwright install <browser>\` (no --with-deps) into that same path. Do NOT install system packages, download .deb files, patch LD_LIBRARY_PATH, or debug browser/tool startup — you have no root. If a verification step cannot run here, skip only that step and say plainly in your summary what was not verified and why (e.g. "확인 못 했다: WebKit — 컨테이너에서 기동 불가"). A verification you cannot run never excuses an unimplemented requirement.
${DEV_REPO_RULES_LINE}${timeBudget}
- When designing UI, provide text-art mockups of the result where possible.
- IMPORTANT: ${langInstruction}`;

  return prompt;
}

/**
 * 충돌 감지 작업의 이슈 description (프롬프트)을 생성합니다.
 */
export function buildConflictPrompt(project: Project, doneIids: number[]): string {
  const branches = doneIids.map(iid => `dev-${iid}`);
  return `## MR Conflict Analysis Task

There are ${branches.length} completed MR branches in this project that have not been merged yet.
When merging them sequentially, conflicts may occur between branches.

### Branches to analyze:
${branches.map(b => `- \`${b}\``).join('\n')}

### Instructions:
1. Fetch all the branches listed above from origin.
2. For each branch, try merging it into the base branch (staging or main) locally:
   - \`git checkout <base>\`
   - \`git merge --no-commit --no-ff origin/<branch>\`
   - Check if conflicts arise. Record which files conflict.
   - \`git merge --abort\` to reset after each test.
3. If merging branch A changes the base, test branch B against the updated base (simulate sequential merge).
4. After analysis, output a summary line in this EXACT format:
   \`CONFLICT_RESULT: <number of branches that would have conflicts>\`
5. If conflicts are found, describe which branches conflict and which files are affected.
6. Do NOT push any changes. This is an analysis task.
7. Leave a brief comment on the project about your findings.`;
}
