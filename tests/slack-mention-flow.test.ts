/**
 * handleAppMention 통합 흐름 테스트 — "사용자가 슬랙에서 누르던 시퀀스"를 자동화한다.
 *
 * 그동안 단위 테스트는 selectThreadProject(순수 함수)만 봤고, 실제 멘션→바인딩→연속 대화의
 * 배선은 사람이 슬랙에서 눌러봐야 드러났다(되묻기 루프도 그래서 운영에서 터짐). 이 테스트는
 * 그 배선을 fake sink + 인메모리 DB + CLI/네트워크 스텁으로 자동 검증한다.
 *
 * I/O 경계만 스텁:
 *  - @/lib/chat-agent: CLI 스폰(runChatAgentWithCallback)·워크스페이스 준비·실행중여부
 *  - @/lib/provider:   fetchSingleIssue
 *  - global.fetch:     Slack API(users.info/conversations.replies)
 * 나머지(세션 DB·프로젝트 선택·전환·이슈 바인딩)는 실제 코드를 그대로 탄다.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import Database from 'better-sqlite3'
import fs from 'fs'
import os from 'os'
import path from 'path'
import { setupTestDb, teardownTestDb, seedUser, seedProject, seedAgent } from './helpers/test-db'

// ── I/O 경계 스텁 (hoist 되므로 외부 변수 참조 금지) ──
vi.mock('@/lib/chat-agent', () => ({
  isChatAgentRunning: vi.fn(() => false),
  maskSecrets: (s: string) => s,
  prepareGeneralWorkspace: vi.fn(),
  prepareProjectWorkspace: vi.fn(),
  prepareChatWorkspace: vi.fn(),
  runChatAgentWithCallback: vi.fn(),
}))
vi.mock('@/lib/provider', () => ({
  fetchSingleIssue: vi.fn(async () => ({ title: 'T', description: 'D' })),
}))

import { handleAppMention, type MentionSink, type DecryptedWorkspace } from '@/lib/slack'
import { runChatAgentWithCallback, prepareGeneralWorkspace, prepareProjectWorkspace, prepareChatWorkspace } from '@/lib/chat-agent'

let db: Database.Database

const SLACK_SCHEMA = `
  CREATE TABLE slack_thread_session (
    workspace_id TEXT NOT NULL, channel_id TEXT NOT NULL, thread_ts TEXT NOT NULL,
    issue_iid INTEGER, cli_session_id TEXT, cli_name TEXT, project_id TEXT,
    updated_at TEXT NOT NULL DEFAULT (datetime('now')),
    PRIMARY KEY (workspace_id, channel_id, thread_ts)
  );`

const WS: DecryptedWorkspace = {
  id: 'w1', teamId: 'T1', botToken: 'xoxb-test', signingSecret: 's', botUserId: 'BOT', defaultUserId: 'u1',
}

// 마지막으로 runChatAgentWithCallback 에 전달된 opts (project/projectless/cliSessionId 검증용)
function lastRunOpts(): any {
  const calls = vi.mocked(runChatAgentWithCallback).mock.calls
  return calls[calls.length - 1]?.[0]
}

function makeSink(): MentionSink & { posts: string[]; updates: string[]; uploads: string[] } {
  const posts: string[] = []
  const updates: string[] = []
  const uploads: string[] = []
  return {
    posts, updates, uploads,
    post: async (t: string) => { posts.push(t); return `ts-${posts.length}` },
    update: async (_id: string, t: string) => { updates.push(t) },
    uploadImage: async (filePath: string) => { uploads.push(filePath); return true },
  }
}

// 멘션 이벤트 1건을 처리. channel=대화키(스레드 없는 채널 최상위 대화).
async function mention(channel: string, text: string, sink: MentionSink) {
  await handleAppMention(WS, {
    type: 'app_mention', user: 'u-slack', text: `<@BOT> ${text}`, ts: `${Date.now()}`, channel,
  }, sink)
}

beforeEach(() => {
  db = setupTestDb()
  db.exec(SLACK_SCHEMA)
  seedUser(db, 'u1', 'Owner')
  // apm 이 먼저 → ownerProjects[0] (과거 "[0]로 튐" 재현 순서)
  seedProject(db, 'p-apm', 'u1', 'springware-apm')
  seedProject(db, 'p-splink', 'u1', 'splink')
  seedAgent(db, 'a1', 'u1', 'Claude', { cliName: 'claude' })

  // 워크스페이스 준비 스텁: 호출마다 격리된 임시 디렉토리(이전 실행 산출물 간섭 방지).
  const freshWs = () => fs.mkdtempSync(path.join(os.tmpdir(), 'ive-ws-'))
  vi.mocked(prepareGeneralWorkspace).mockImplementation(() => freshWs())
  vi.mocked(prepareProjectWorkspace).mockImplementation(async () => freshWs())
  vi.mocked(prepareChatWorkspace).mockImplementation(async () => freshWs())

  // CLI 스폰 스텁: 프로젝트별로 결정적 세션 id 를 emit 하고 텍스트 응답 후 종료.
  vi.mocked(runChatAgentWithCallback).mockImplementation(async (opts: any, onEvent: any) => {
    onEvent({ type: 'session_id', content: `sess-${opts.project?.id ?? 'none'}` })
    onEvent({ type: 'text', content: 'ok' })
    onEvent({ type: 'done' })
  })

  // Slack API 스텁: users.info(locale)·conversations.replies(files 없음).
  ;(globalThis as any).fetch = vi.fn(async () => ({
    ok: true,
    headers: { get: () => 'application/json' },
    json: async () => ({ ok: true, user: { locale: 'ko-KR' }, messages: [] }),
  }))
})
afterEach(() => {
  teardownTestDb()
  vi.clearAllMocks()
})

function sessionRow(channel: string) {
  return db.prepare('SELECT project_id, cli_session_id, issue_iid FROM slack_thread_session WHERE workspace_id=? AND channel_id=? AND thread_ts=?')
    .get('w1', channel, channel) as any
}

describe('handleAppMention — 프로젝트 없음으로 시작, 거론 시 바인딩, 루프 없음', () => {
  it('첫 멘션(프로젝트 미거론)은 프로젝트 없이 일반 대화로 처리한다', async () => {
    const sink = makeSink()
    await mention('C1', '안녕? 오늘 뭐하지', sink)

    const opts = lastRunOpts()
    expect(opts.projectless).toBe(true)
    expect(opts.project).toBeNull()
    expect(sessionRow('C1').project_id).toBeNull()   // 세션은 "프로젝트 없음"으로 고정
    expect(sink.posts.length).toBe(1)                 // 되묻기 없이 바로 답
  })

  it('프로젝트 이름을 거론하면 그 프로젝트로 바인딩(새 CLI 세션)', async () => {
    const sink = makeSink()
    await mention('C1', '안녕?', sink)                 // 1) 일반 대화
    await mention('C1', 'splink 구조 보여줘', sink)     // 2) 바인딩

    const opts = lastRunOpts()
    expect(opts.projectless).toBe(false)
    expect(opts.project?.id).toBe('p-splink')
    expect(opts.cliSessionId).toBeNull()              // 바인딩=새 대화(이전 일반대화 세션 resume 안 함)
    expect(sessionRow('C1').project_id).toBe('p-splink')
  })

  it('바인딩 후 이름 없는 후속 질문은 같은 프로젝트로 이어가고 CLI 세션을 resume 한다', async () => {
    const sink = makeSink()
    await mention('C1', 'splink 구조 보여줘', sink)     // 바인딩 → sess-p-splink 저장
    await mention('C1', '그거 자세히 설명해줘', sink)    // 후속(이름 없음)

    const opts = lastRunOpts()
    expect(opts.project?.id).toBe('p-splink')          // ★ [0](apm)로 안 튐
    expect(opts.cliSessionId).toBe('sess-p-splink')    // ★ 맥락 유지(resume)
  })

  it('다른 프로젝트 이름을 거론하면 전환하고 CLI 세션을 새로 시작', async () => {
    const sink = makeSink()
    await mention('C1', 'splink 구조 보여줘', sink)
    await mention('C1', 'springware-apm 쪽은 어때?', sink)

    const opts = lastRunOpts()
    expect(opts.project?.id).toBe('p-apm')
    expect(opts.cliSessionId).toBeNull()               // 전환=새 대화
    expect(sessionRow('C1').project_id).toBe('p-apm')
  })

  it('★ 첫 멘션이 한글 프로젝트명("스프링크")이어도 루프 없이 일반 대화로 처리한다', async () => {
    const sink = makeSink()
    await mention('C2', '스프링크 이야기 좀 하자', sink) // "splink" 와 매칭 안 됨

    const opts = lastRunOpts()
    expect(opts.projectless).toBe(true)                // 되묻기/루프 대신 일반 대화
    expect(sessionRow('C2').project_id).toBeNull()
    expect(sink.posts.length).toBe(1)                  // 무한 되묻기 아님
  })

  it('에이전트가 outbox 에 만든 이미지를 채널에 업로드한다', async () => {
    const sink = makeSink()
    // 이번 실행에 에이전트가 .slack-outbox/ 에 SVG 를 저장하는 상황 재현
    vi.mocked(runChatAgentWithCallback).mockImplementationOnce(async (opts: any, onEvent: any) => {
      const dir = path.join(opts.workspacePath, opts.imageOutbox)
      fs.mkdirSync(dir, { recursive: true })
      fs.writeFileSync(path.join(dir, 'diagram.svg'), '<svg xmlns="http://www.w3.org/2000/svg" width="10" height="10"/>')
      onEvent({ type: 'session_id', content: 'sess-x' })
      onEvent({ type: 'text', content: '그렸어요' })
      onEvent({ type: 'done' })
    })
    await mention('C3', 'splink 구조 그려서 보여줘', sink)

    expect(sink.uploads.length).toBe(1)               // 실행 산출물 1장 업로드 시도
    expect(sink.uploads[0]).toMatch(/diagram\.svg$/)  // outbox 의 그 파일
  })
})
