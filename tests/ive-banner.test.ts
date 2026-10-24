import { describe, it, expect } from 'vitest'
import { buildBannerFile, buildBannerChatFile, mergeBannerHook } from '@/lib/ive-banner'

describe('IVE 시작 배너', () => {
  it('배너 파일은 systemMessage JSON 이고 로고·사용 예시·프로젝트명을 담는다', () => {
    const j = JSON.parse(buildBannerFile({ name: '메타샵' }))
    expect(j.systemMessage).toContain('메타샵')
    expect(j.systemMessage).toContain('IVE 작업으로 정리해줘')
    expect(j.systemMessage).toContain('|___|   \\_/   |_____|')
  })
  it('settings.json 이 없으면 훅만 담아 새로 만든다', () => {
    const s = JSON.parse(mergeBannerHook(null))
    expect(s.hooks.SessionStart[0].hooks[0].command).toContain('ive-banner.json')
  })
  it('기존 설정·훅은 보존하고, 두 번 돌려도 중복되지 않는다', () => {
    const base = JSON.stringify({ permissions: { allow: ['Bash(ls)'] }, hooks: { SessionStart: [{ hooks: [{ type: 'command', command: 'echo hi' }] }], Stop: [] } })
    const once = mergeBannerHook(base)
    const s = JSON.parse(once)
    expect(s.permissions.allow).toEqual(['Bash(ls)'])
    expect(s.hooks.Stop).toEqual([])
    expect(s.hooks.SessionStart).toHaveLength(2)
    expect(mergeBannerHook(once)).toBe(once)
  })
  it('JSON 이 아니면 덮어쓰지 않고 오류', () => {
    expect(() => mergeBannerHook('{ // comment\n}')).toThrow(/JSON/)
  })
  it('VS Code 용 파일은 첫 응답에 배너를 싣게 하는 컨텍스트를 담는다', () => {
    const j = JSON.parse(buildBannerChatFile({ name: '메타샵' }))
    expect(j.hookSpecificOutput.hookEventName).toBe('SessionStart')
    expect(j.hookSpecificOutput.additionalContext).toContain('첫 응답')
    expect(j.hookSpecificOutput.additionalContext).toContain('IVE 작업으로 정리해줘')
    expect(j.hookSpecificOutput.additionalContext).toContain('```\n ___ __     __ _____\n|_ _|') // 로고 첫 줄 앞 공백 보존
  })
  it('옛 설치본의 훅 명령은 현재 명령으로 바뀌고, 다시 돌리면 그대로다', () => {
    const old = JSON.stringify({ hooks: { SessionStart: [{ matcher: 'startup', hooks: [{ type: 'command', command: 'cat "$CLAUDE_PROJECT_DIR/.claude/ive-banner.json"' }] }] } })
    const once = mergeBannerHook(old)
    expect(once).toContain('claude-vscode')
    expect(JSON.parse(once).hooks.SessionStart).toHaveLength(1)
    expect(mergeBannerHook(once)).toBe(once)
  })
})
