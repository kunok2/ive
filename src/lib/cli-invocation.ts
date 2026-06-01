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
   *  claude/gemini는 전용 플래그가 없어 호출 측이 프롬프트에 경로를 안내한다(Read/파일참조). */
  imagePaths?: string[]
}

const shq = (s: string) => `'${s.replace(/'/g, `'\\''`)}'`

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
    const opencodeConfig: any = {
      agent: { coder: { steps: maxTurns || 200, permission: { '*': 'allow' }, ...(model ? { model } : {}) } },
      compaction: { auto: true },
    }
    if (mcpServers) opencodeConfig.mcp = mcpServers

    // opencode는 외부 디렉토리(/tmp) 접근을 비대화형에서 자동 거부 → 빈 응답 유발.
    // 임시 디렉토리를 프로젝트 루트 안(.octmp)으로 돌려 opencode가 외부 /tmp를 건드리지 않게 함.
    const ocTmp = path.join(workspacePath, '.octmp')
    try { fs.mkdirSync(ocTmp, { recursive: true }) } catch { /* ignore */ }

    // 첨부 이미지: opencode는 -f(--file)로 메시지에 파일 첨부
    const ocImageArgs = imagePaths.flatMap(p => ['-f', p])
    // -m: 모델을 CLI 수준에서 명시적으로 지정. OPENCODE_CONFIG_CONTENT의 agent.coder.model과 함께
    //      사용해 "The requested model is not supported" 에러를 방지한다.
    // --dangerously-skip-permissions: 비대화형 환경에서 권한 확인 프롬프트 없이 실행.
    //      config의 permission: {'*': 'allow'}와 함께 사용해야 완전히 건너뜀.
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
        // glab/gh CLI 인증용 (에이전트가 이슈 조회·생성에 사용)
        GITLAB_TOKEN: token, GITLAB_API_TOKEN: token,
        GITHUB_TOKEN: token, GH_TOKEN: token,
        IVE_GITLAB_TOKEN: token,
        IVE_GITHUB_TOKEN: token,
      },
    }
  }

  if (cliName === 'codex') {
    // 첫 실행: codex exec, 이어가기: codex exec resume <SID>
    const codexFlags = [
      '--json',
      '--skip-git-repo-check',
      '--dangerously-bypass-approvals-and-sandbox',
      ...(model ? ['-m', model] : []),
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

  if (cliName === 'gemini') {
    const args = [
      ...cliParts.slice(1),
      '--yolo',
      '--skip-trust',
      '--output-format', 'stream-json',
      ...(model ? ['-m', model] : []),
      '-p', prompt,
    ]
    return {
      mainCmd, args,
      env: {
        ...process.env,
        GEMINI_CLI_TRUST_WORKSPACE: 'true',
        GITLAB_TOKEN: token, GITLAB_API_TOKEN: token,
        GITHUB_TOKEN: token,
        IVE_GITLAB_TOKEN: token,
        IVE_GITHUB_TOKEN: token,
      },
    }
  }

  // Claude Code
  if (mcpServers) {
    const claudeMcp: Record<string, any> = {}
    for (const [name, cfg] of Object.entries(mcpServers)) {
      if ((cfg as any).type === 'local' && Array.isArray((cfg as any).command) && (cfg as any).command.length > 0) {
        claudeMcp[name] = { command: (cfg as any).command[0], args: (cfg as any).command.slice(1), ...((cfg as any).environment ? { env: (cfg as any).environment } : {}) }
      } else if ((cfg as any).type === 'remote' && (cfg as any).url) {
        claudeMcp[name] = { url: (cfg as any).url, ...((cfg as any).headers ? { headers: (cfg as any).headers } : {}) }
      }
    }
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
