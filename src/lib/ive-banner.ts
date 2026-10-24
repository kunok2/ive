import type { Project } from '@/types'

/**
 * Claude Code 를 열 때 보이는 IVE 시작 배너.
 *
 * 가이드(CLAUDE.md)는 AI 가 읽는 것이라 사람 개발자는 "작업 정리해줘" 한마디로 IVE 에 등록된다는 걸 모른다.
 * Claude Code 의 SessionStart 훅이 `systemMessage` 를 돌려주면 화면에 그대로 보이므로,
 * Spring Boot 시작 배너처럼 IVE 마크와 사용 예시를 띄운다. 훅은 파일을 읽어 출력만 한다(AI 컨텍스트에는 안 들어간다).
 */

export const BANNER_FILE = '.claude/ive-banner.json'
export const CLAUDE_SETTINGS_FILE = '.claude/settings.json'

const HOOK_COMMAND = `cat "$CLAUDE_PROJECT_DIR/${BANNER_FILE}"`
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
    ' 이 프로젝트의 작업은 IVE 로 기록·관리됩니다. 이렇게 말해 보세요.',
    '   • "지금까지 한 작업을 IVE 작업으로 정리해줘."',
    '       → 주제별로 나눠 작업으로 등록합니다 (변경 파일·커밋·소요시간 포함)',
    '',
    ' 등록된 작업은 단계별 스킬로 직접 진행할 수도 있습니다.',
    '   • "IVE 처리해줘"  (ive-handle)   처리대기 → 구현 → 검증대기',
    '   • "IVE 검증해줘"  (ive-verify)   코드 재검토·요청 대조 → 머지 → 확인대기',
    '   • "IVE 확인해줘"  (ive-confirm)  반영된 것을 증거와 함께 확인 → 완료',
    '',
  ].join('\n')
}

/** 훅이 그대로 출력하는 JSON (SessionStart 훅의 systemMessage = 사용자 화면에 표시) */
export function buildBannerFile(project: Pick<Project, 'name'>): string {
  return JSON.stringify({ systemMessage: buildBannerText(project) }, null, 2) + '\n'
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

  const has = sessionStart.some(e => e?.hooks?.some(h => h?.command?.includes('ive-banner.json')))
  if (has && existing) return existing

  const next = {
    ...settings,
    hooks: {
      ...hooks,
      SessionStart: [...sessionStart, { matcher: HOOK_MATCHER, hooks: [{ type: 'command', command: HOOK_COMMAND }] }],
    },
  }
  return JSON.stringify(next, null, 2) + '\n'
}
