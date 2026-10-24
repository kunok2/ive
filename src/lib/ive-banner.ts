import type { Project } from '@/types'

/**
 * Claude Code 를 열 때 보이는 IVE 시작 배너.
 *
 * 가이드(CLAUDE.md)는 AI 가 읽는 것이라 사람 개발자는 "작업 정리해줘" 한마디로 IVE 에 등록된다는 걸 모른다.
 * Claude Code 의 SessionStart 훅이 `systemMessage` 를 돌려주면 화면에 그대로 보이므로,
 * Spring Boot 시작 배너처럼 IVE 마크와 사용 예시를 띄운다. 훅은 파일을 읽어 출력만 한다(AI 컨텍스트에는 안 들어간다).
 */

export const BANNER_FILE = '.claude/ive-banner.json'
export const BANNER_CHAT_FILE = '.claude/ive-banner-chat.json'
export const CLAUDE_SETTINGS_FILE = '.claude/settings.json'

// 터미널은 systemMessage(화면 표시)를, VS Code 확장은 훅 메시지를 화면에 그리지 않아 첫 응답에 배너를 싣게 하는 컨텍스트 쪽을 쓴다.
const HOOK_COMMAND = `f=${BANNER_FILE.split('/')[1]}; [ "$CLAUDE_CODE_ENTRYPOINT" = claude-vscode ] && f=${BANNER_CHAT_FILE.split('/')[1]}; cat "$CLAUDE_PROJECT_DIR/.claude/$f"`
const HOOK_MATCHER = 'startup|resume|clear'

const LOGO = [
  ' ___ __     __ _____',
  '|_ _|\\ \\   / /| ____|',
  ' | |  \\ \\ / / |  _|',
  ' | |   \\ V /  | |___',
  '|___|   \\_/   |_____|',
]

export function buildBannerText(project: Pick<Project, 'name'>): string {
  return [
    '',
    ...LOGO,
    ` :: Springware IVE ::   ${project.name}`,
    '',
    ' 작업 내용을 IVE 에 남기면 보고서·통계에 자동으로 반영됩니다.',
    '',
    '  ① 일을 마친 뒤',
    '     "지금까지 한 작업을 IVE 작업으로 정리해줘."',
    '     → 주제별로 나눠 이슈로 등록해 줍니다',
    '',
    '  ② 등록된 이슈를 직접 진행할 때',
    '     "IVE 처리해줘" · "IVE 검증해줘" · "IVE 확인해줘"',
    '     → 개발 → 검증 → 확인, 단계별 절차대로 (검증은 새 세션에서)',
    '',
    '  ③ 대기 건을 자동으로 맡기고 싶을 때',
    '     "IVE 처리 루틴 돌려" · "IVE 검증 루틴 돌려"',
    '     → 5분마다 대기 건을 찾아 서브에이전트가 처리 (이 세션이 열려 있는 동안)',
    '',
  ].join('\n')
}

/** 훅이 그대로 출력하는 JSON (SessionStart 훅의 systemMessage = 사용자 화면에 표시) */
export function buildBannerFile(project: Pick<Project, 'name'>): string {
  return JSON.stringify({ systemMessage: buildBannerText(project) }, null, 2) + '\n'
}

/** VS Code 용 — AI 컨텍스트에 넣어 첫 응답 맨 앞에 배너를 보여 주게 한다 */
export function buildBannerChatFile(project: Pick<Project, 'name'>): string {
  const additionalContext = [
    'IVE 안내: 이 세션의 첫 응답 맨 앞에, 사용자의 요청에 답하기 전에 아래 배너를 코드 블록 그대로 한 번만 보여 주세요.',
    '그 다음 줄부터 평소처럼 요청에 답합니다. 두 번째 응답부터는 배너를 반복하지 않습니다.',
    '',
    '```',
    buildBannerText(project).trim(),
    '```',
  ].join('\n')
  return JSON.stringify({ hookSpecificOutput: { hookEventName: 'SessionStart', additionalContext } }, null, 2) + '\n'
}

type HookEntry = { matcher?: string; hooks?: { type?: string; command?: string }[] }

/**
 * .claude/settings.json 에 IVE 배너 훅을 넣는다. 다른 설정·훅은 건드리지 않고, 이미 있으면 그대로 둔다.
 * 파싱이 안 되면(주석이 든 JSON 등) 망가뜨리지 않도록 예외를 던진다.
 */
export function mergeBannerHook(existing: string | null): string {
  let settings: Record<string, unknown> = {}
  if (existing && existing.trim()) {
    let parsed: unknown
    try { parsed = JSON.parse(existing) } catch { throw new Error(`${CLAUDE_SETTINGS_FILE} 을 JSON 으로 읽을 수 없어 배너 훅을 넣지 않았습니다`) }
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw new Error(`${CLAUDE_SETTINGS_FILE} 형식이 객체가 아니어서 배너 훅을 넣지 않았습니다`)
    settings = parsed as Record<string, unknown>
  }
  const hooks = (settings.hooks && typeof settings.hooks === 'object' && !Array.isArray(settings.hooks) ? settings.hooks : {}) as Record<string, unknown>
  const sessionStart: HookEntry[] = Array.isArray(hooks.SessionStart) ? (hooks.SessionStart as HookEntry[]) : []

  // 이미 IVE 훅이 있으면 명령만 현재 것으로 맞춘다(옛 설치본 → VS Code 대응 명령)
  const isIve = (h?: { command?: string }) => !!h?.command?.includes('ive-banner')
  if (sessionStart.some(e => e?.hooks?.some(isIve))) {
    const updated = sessionStart.map(e => e?.hooks?.some(isIve)
      ? { ...e, hooks: e.hooks!.map(h => isIve(h) ? { ...h, command: HOOK_COMMAND } : h) }
      : e)
    const out = JSON.stringify({ ...settings, hooks: { ...hooks, SessionStart: updated } }, null, 2) + '\n'
    return existing && JSON.stringify(JSON.parse(existing)) === JSON.stringify(JSON.parse(out)) ? existing : out
  }

  const next = {
    ...settings,
    hooks: {
      ...hooks,
      SessionStart: [...sessionStart, { matcher: HOOK_MATCHER, hooks: [{ type: 'command', command: HOOK_COMMAND }] }],
    },
  }
  return JSON.stringify(next, null, 2) + '\n'
}
