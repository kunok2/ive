/**
 * CLI 에이전트에 전달할 프롬프트 구성
 */
import { Project } from "@/types";

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
    const feedbackSection = latestFeedback
      ? `## 🚨 PRIMARY TASK — User Feedback (this is your ONLY instruction):
${latestFeedback}

**⚠️ IMPORTANT: Only perform the user request in the "PRIMARY TASK" section above. The original issue body has already been completed in previous iterations. The history and issue body below are for context only — do NOT re-implement the original request.**`
      : `## 🚨 PRIMARY TASK — Review and fix remaining issues:
The user has requested a re-run of this issue. Review the conversation history below and the previous work, then fix any remaining problems or incomplete parts.`;

    prompt = `This is follow-up iteration #${iterationCount} for issue #${iid} "${issue.title}". ${langInstruction}

${feedbackSection}
${iterationContext}

<details>
<summary>Reference: Original issue body (context only — do NOT re-implement)</summary>

${issue.description || "No description"}
</details>`;
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
    ? `\n- IMPORTANT: When posting any comment on the issue, ALWAYS prepend this exact HTML comment at the very top of the comment body, on its own line: \`<!-- ive-agent:${agentId} -->\`. It is invisible in Git UI but lets IVE show the correct agent name/avatar. Example comment body:\n\n    \`\`\`\n    <!-- ive-agent:${agentId} -->\n    작업 시작합니다.\n    \`\`\``
    : '';

  prompt += `

## Instructions:
- Before writing any code, thoroughly analyze the relevant files, their dependencies, and the surrounding architecture. Understand how the existing code works before changing it.
- Identify all affected areas — a change in one place often requires consistent changes elsewhere. Make all related changes together, not incrementally.
- Understand the project structure and style, then modify the relevant code.
- After completing changes, stage them with git add.
- Do NOT git commit or push.
- If you find important discoveries or have questions during work, leave a comment on the issue.
- Leave a brief start comment on the issue when you begin work.${agentMarkerHint}
- Take your time and be thorough — resolve the problem precisely. Do not rush or apply superficial fixes.
- Review repeatedly until there are zero reasons the intended functionality could fail.
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
