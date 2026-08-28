/**
 * CLI 호출(명령/인자/환경) 단일 조립 지점.
 *
 * 스캐너 실행(cli-runner)과 채팅(chat-agent)이 같은 로직을 쓰도록 통합한다.
 * 이벤트 파싱·토큰 집계·스트리밍 같은 "소비" 로직은 호출 측이 각자 담당하고,
 * 여기서는 오직 "어떻게 spawn 할 것인가"만 책임진다.
 */
import fs from 'fs'
import path from 'path'
import { promisify } from 'util'
import { Agent, CliName } from '@/types'
import { getSystemSetting } from './db'

const execFile = promisify(require('child_process').execFile)

/**
 * CLI 경로를 검증/해석한다. 존재하지 않으면 which로 자동 탐색.
 * 스캐너/채팅 양쪽에서 중복 구현하던 것을 통합.
 */
export async function resolveCliPath(
  agent: Agent,
  log?: (msg: string, type?: 'info' | 'error' | 'warn' | 'system') => void,
): Promise<string> {
  const systemCliPath = getSystemSetting(`cli.${agent.cliName}.path`)
  let resolved = systemCliPath || agent.cliPath
  const mainBin = resolved.split(' ')[0]
  if (!fs.existsSync(mainBin)) {
    try {
      const { stdout } = await execFile('which', [path.basename(mainBin)])
      const detected = stdout.trim()
      if (detected) {
        log?.(`CLI 경로 "${mainBin}" 없음 → "${detected}" 감지`, 'system')
        resolved = resolved.replace(mainBin, detected)
      }
    } catch { /* which 실패 시 원래 경로 유지 */ }
  }
  return resolved
}

export interface CliInvocation {
  mainCmd: string
  args: string[]
  env: NodeJS.ProcessEnv
  /** 정의되면 프롬프트를 arg가 아니라 stdin으로 전달해야 함(opencode). */
  stdinInput?: string
}

export interface BuildCliOpts {
  cliName: CliName
  resolvedCliPath: string
  prompt: string
  token: string
  /** claude .mcp.json 기록 위치 등 */
  workspacePath: string
  /** claude --max-turns / opencode steps */
  maxTurns: number
  /** 모델명. 호출 측이 (agent.modelName || 시스템설정) 등으로 결정해 전달. */
  model?: string | null
  /** resume 세션 ID(채팅). 없으면 새 세션. */
  cliSessionId?: string | null
  /** MCP 서버 설정. undefined면 시스템 설정에서 로드. */
  mcpServers?: Record<string, any> | null
  /** 첨부 이미지 파일 경로(절대경로). codex는 -i, opencode는 -f로 전달.
   *  claude/agy는 전용 플래그가 없어 호출 측이 프롬프트에 경로를 안내한다(Read/파일참조). */
  imagePaths?: string[]
}

const shq = (s: string) => `'${s.replace(/'/g, `'\\''`)}'`

/** agy headless 대기 한도. 기본 5분이라 장시간 에이전트 작업이 중간에 잘린다. */
const AGY_PRINT_TIMEOUT = '12h'

export interface OpencodeInvocationOpts {
  cliParts: string[]
  prompt: string
  /** glab/gh 인증 토큰. 비어 있으면 토큰 env를 주입하지 않는다(인터뷰 등 git 불필요 경로). */
  token: string
  /** .octmp 임시 디렉토리를 만들 기준 경로 */
  workspacePath: string
  /** opencode steps(=maxTurns). 인터뷰처럼 1회성이면 1을 넘긴다. */
  maxTurns: number
  model?: string | null
  mcpServers?: Record<string, any> | null
  imagePaths?: string[]
  cliSessionId?: string | null
}

/**
 * opencode `run --format json` 호출(명령/인자/환경)을 조립한다.
 * 스캐너 실행과 인터뷰 엔드포인트가 동일 로직을 공유하도록 단일화한다.
 * (과거엔 interview/route.ts가 이 로직을 따로 복제해 #404 수정을 양쪽에 중복 반영해야 했음)
 *
 * - OPENCODE_CONFIG_CONTENT: 모델을 agent.coder.model에 주입(미설정 시 "model not supported" 에러 가능).
 * - -m: CLI 수준에서 모델을 명시해 config보다 우선 적용.
 * - --dangerously-skip-permissions: 비대화형에서 권한 프롬프트 없이 실행(config permission '*':'allow'와 함께).
 * - TMPDIR을 .octmp로 돌림: opencode가 외부 /tmp 접근을 비대화형에서 거부해 빈 응답이 나는 문제 회피.
 */
export function buildOpencodeInvocation(o: OpencodeInvocationOpts): CliInvocation {
  const { cliParts, prompt, token, workspacePath, maxTurns, model, mcpServers, cliSessionId } = o
  const imagePaths = o.imagePaths ?? []

  const opencodeConfig: any = {
    agent: { coder: { steps: maxTurns || 200, permission: { '*': 'allow' }, ...(model ? { model } : {}) } },
    compaction: { auto: true },
  }
  if (mcpServers) opencodeConfig.mcp = mcpServers

  const ocTmp = path.join(workspacePath, '.octmp')
  try { fs.mkdirSync(ocTmp, { recursive: true }) } catch { /* ignore */ }

  // 첨부 이미지: opencode는 -f(--file)로 메시지에 파일 첨부
  const ocImageArgs = imagePaths.flatMap(p => ['-f', p])
  const ocParts = [
    ...cliParts, 'run', '--format', 'json', '--dangerously-skip-permissions',
    ...(model ? ['-m', model] : []),
    ...ocImageArgs,
    ...(cliSessionId ? ['-s', cliSessionId] : []),
  ]
  return {
    mainCmd: 'sh',
    args: ['-c', `exec ${ocParts.map(shq).join(' ')}`],
    stdinInput: prompt, // 프롬프트는 arg 대신 stdin으로
    env: {
      ...process.env,
      OPENCODE_CONFIG_CONTENT: JSON.stringify(opencodeConfig),
      TMPDIR: ocTmp, TMP: ocTmp, TEMP: ocTmp,
      // glab/gh CLI 인증용 (에이전트가 이슈 조회·생성에 사용). 토큰이 있을 때만 주입.
      ...(token ? {
        GITLAB_TOKEN: token, GITLAB_API_TOKEN: token,
        GITHUB_TOKEN: token, GH_TOKEN: token,
        IVE_GITLAB_TOKEN: token, IVE_GITHUB_TOKEN: token,
      } : {}),
    },
  }
}

/**
 * IVE mcp.config(JSON, opencode 형식) → Claude/Gemini 공통 형식으로 변환.
 *   local  → { command, args, env }
 *   remote → { url, headers }
 * 잘못된/미지원 항목은 조용히 건너뛴다.
 */
function toStandardMcp(mcpServers: Record<string, any>): Record<string, any> {
  const out: Record<string, any> = {}
  for (const [name, cfg] of Object.entries(mcpServers || {})) {
    const c = cfg as any
    if (c.type === 'local' && Array.isArray(c.command) && c.command.length > 0) {
      out[name] = { command: c.command[0], args: c.command.slice(1), ...(c.environment ? { env: c.environment } : {}) }
    } else if (c.type === 'remote' && c.url) {
      out[name] = { url: c.url, ...(c.headers ? { headers: c.headers } : {}) }
    }
  }
  return out
}

/**
 * codex 용 MCP 주입: `-c mcp_servers.<name>.*` 설정 오버라이드 인자 배열을 만든다.
 * codex는 config.toml(=CODEX_HOME)에서 MCP를 읽지만 CODEX_HOME 을 바꾸면 로그인 인증이 깨지므로,
 * 인증은 그대로 두고 `-c` 오버라이드로만 MCP를 더한다(값은 JSON 으로 파싱됨).
 * 현재 codex는 stdio(local) 서버만 안정적으로 지원 → remote 는 건너뛴다.
 */
function buildCodexMcpArgs(mcpServers: Record<string, any>): string[] {
  const args: string[] = []
  for (const [name, cfg] of Object.entries(mcpServers || {})) {
    const c = cfg as any
    if (c.type === 'local' && Array.isArray(c.command) && c.command.length > 0) {
      args.push('-c', `mcp_servers.${name}.command=${JSON.stringify(c.command[0])}`)
      if (c.command.length > 1) args.push('-c', `mcp_servers.${name}.args=${JSON.stringify(c.command.slice(1))}`)
      if (c.environment) args.push('-c', `mcp_servers.${name}.env=${JSON.stringify(c.environment)}`)
    }
    // remote(streamable HTTP) 는 codex 지원이 실험적이라 현재 미주입.
  }
  return args
}

/**
 * CLI별 spawn 명령/인자/환경을 조립한다.
 *
 * 주의(opencode): Node가 바이너리를 직접 spawn하면 (특히 macOS) 출력 없이 종료되는 문제가 있어,
 * `sh -c "exec ..."` 로 감싸고 프롬프트를 stdin으로 전달한다. `exec` 라 PID는 유지된다.
 */
export function buildCliInvocation(o: BuildCliOpts): CliInvocation {
  const { cliName, resolvedCliPath, prompt, token, workspacePath, maxTurns, model, cliSessionId } = o
  const imagePaths = o.imagePaths ?? []
  const cliParts = resolvedCliPath.split(' ')
  const mainCmd = cliParts[0]

  // MCP 설정 (명시되지 않으면 시스템 설정에서 로드)
  let mcpServers = o.mcpServers
  if (mcpServers === undefined) {
    const raw = getSystemSetting('mcp.config')
    mcpServers = null
    if (raw) { try { mcpServers = JSON.parse(raw) } catch { /* ignore */ } }
  }

  if (cliName === 'opencode') {
    return buildOpencodeInvocation({
      cliParts, prompt, token, workspacePath, maxTurns, model, mcpServers, imagePaths, cliSessionId,
    })
  }

  if (cliName === 'codex') {
    // 첫 실행: codex exec, 이어가기: codex exec resume <SID>
    const codexFlags = [
      '--json',
      '--skip-git-repo-check',
      '--dangerously-bypass-approvals-and-sandbox',
      ...(model ? ['-m', model] : []),
      // MCP: -c mcp_servers.* 오버라이드로 주입 (설정 비어있으면 빈 배열 → 동작 불변)
      ...(mcpServers ? buildCodexMcpArgs(mcpServers) : []),
      // 첨부 이미지: codex는 -i(--image). prompt가 마지막 positional이라
      // 한 플래그에 여러 파일(variadic)을 넣으면 prompt까지 삼키므로 이미지마다 -i 반복.
      ...imagePaths.flatMap(p => ['-i', p]),
    ]
    const args = cliSessionId
      ? [...cliParts.slice(1), 'exec', 'resume', ...codexFlags, cliSessionId, prompt]
      : [...cliParts.slice(1), 'exec', ...codexFlags, prompt]
    return {
      mainCmd, args,
      env: {
        ...process.env,
        GITLAB_TOKEN: token, GITLAB_API_TOKEN: token,
        GITHUB_TOKEN: token,
        IVE_GITLAB_TOKEN: token,
        IVE_GITHUB_TOKEN: token,
      },
    }
  }

  if (cliName === 'agy') {
    // MCP: agy(Antigravity CLI)는 워크스페이스의 .agents/mcp_config.json 에서 mcpServers 를 읽는다.
    // (전역 설정은 ~/.gemini/config/mcp_config.json — 워크스페이스 설정이 우선)
    if (mcpServers) {
      const agyMcp = toStandardMcp(mcpServers)
      if (Object.keys(agyMcp).length > 0) {
        try {
          const dir = path.join(workspacePath, '.agents')
          fs.mkdirSync(dir, { recursive: true })
          fs.writeFileSync(path.join(dir, 'mcp_config.json'), JSON.stringify({ mcpServers: agyMcp }, null, 2))
        } catch { /* ignore */ }
      }
    }
    // headless(print) 모드. --print-timeout 기본값이 5분이라 장시간 작업이 잘리므로 넉넉히 준다.
    // 세션 이어가기는 --conversation <id> (result 이벤트의 conversation_id).
    const args = [
      ...cliParts.slice(1),
      '--dangerously-skip-permissions',
      '--output-format', 'stream-json',
      '--print-timeout', AGY_PRINT_TIMEOUT,
      ...(model ? ['--model', model] : []),
      ...(cliSessionId ? ['--conversation', cliSessionId] : []),
      '-p', prompt,
    ]
    return {
      mainCmd, args,
      env: {
        ...process.env,
        GITLAB_TOKEN: token, GITLAB_API_TOKEN: token,
        GITHUB_TOKEN: token,
        IVE_GITLAB_TOKEN: token,
        IVE_GITHUB_TOKEN: token,
      },
    }
  }

  // Claude Code: 워크스페이스의 .mcp.json 에서 mcpServers 를 읽는다.
  if (mcpServers) {
    const claudeMcp = toStandardMcp(mcpServers)
    if (Object.keys(claudeMcp).length > 0) {
      try { fs.writeFileSync(path.join(workspacePath, '.mcp.json'), JSON.stringify({ mcpServers: claudeMcp }, null, 2)) } catch { /* ignore */ }
    }
  }

  const allowedTools = ['Read', 'Edit', 'Write', 'Grep', 'Glob', 'Bash', 'WebFetch']
  const args = [
    ...cliParts.slice(1),
    '--dangerously-skip-permissions',
    '--output-format', 'stream-json',
    '--verbose',
    '--max-turns', String(maxTurns || 200),
    ...(model ? ['--model', model] : []),
    '--allowedTools', ...allowedTools,
    ...(cliSessionId ? ['--resume', cliSessionId] : []),
    '-p', prompt,
  ]
  return {
    mainCmd, args,
    env: {
      ...process.env,
      GITLAB_TOKEN: token, GITLAB_API_TOKEN: token,
      GITHUB_TOKEN: token,
      IVE_GITLAB_TOKEN: token,
      IVE_GITHUB_TOKEN: token,
    },
  }
}
