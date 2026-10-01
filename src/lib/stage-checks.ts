/**
 * 검사 명령 실행 — 검증(③)과 묶음 출발(3.5.1)이 같은 명령을 같은 방식으로 돌린다.
 *
 * 명령은 프로젝트 설정(IVE DB, 소유자만 편집)의 「검사 명령」이다. IVE 컨테이너 안에서 서버를 띄우지 않고 도는
 * 명령(린트·타입·빌드·단위 테스트)만 적는다. 결과 판정은 종료 코드로 한다 — 에이전트의 말이 아니라 IVE 가 판정한다.
 */
import { spawn } from 'child_process'
import { maskSecrets } from './secret-mask'

export interface CheckResult {
  command: string
  ok: boolean
  exitCode: number | null
  timedOut: boolean
  durationSec: number
  /** 출력 끝부분 (비밀값 가림) */
  outputTail: string
}

const TAIL_CHARS = 4000

/** 설정 문자열 → 명령 목록 (빈 줄·# 주석 제외) */
export function parseCheckCommands(raw: string | null | undefined): string[] {
  return (raw || '').split('\n').map(s => s.trim()).filter(s => s && !s.startsWith('#'))
}

export async function runCheckCommand(
  cwd: string, command: string, timeoutMin: number, secrets: string[],
  onOutput?: (chunk: string) => void,
): Promise<CheckResult> {
  const started = Date.now()
  return new Promise(resolve => {
    let out = ''
    let timedOut = false
    // 토큰이 든 환경변수는 넘기지 않는다(검사 명령은 저장소 코드를 실행한다)
    const env: NodeJS.ProcessEnv = { ...process.env, CI: '1' }
    for (const k of Object.keys(env)) if (/TOKEN|SECRET|PASSWORD|API_KEY|ENCRYPTION_KEY/i.test(k)) delete env[k]
    const child = spawn('sh', ['-c', command], { cwd, env, detached: true })
    const add = (b: Buffer) => {
      const s = b.toString('utf8')
      out = (out + s).slice(-TAIL_CHARS * 4)
      onOutput?.(maskSecrets(s, secrets))
    }
    child.stdout.on('data', add)
    child.stderr.on('data', add)
    const timer = setTimeout(() => {
      timedOut = true
      try { process.kill(-child.pid!, 'SIGKILL') } catch { try { child.kill('SIGKILL') } catch { /* ignore */ } }
    }, (timeoutMin > 0 ? timeoutMin : 1) * 60_000)
    const done = (code: number | null) => {
      clearTimeout(timer)
      resolve({
        command, exitCode: code, timedOut, ok: !timedOut && code === 0,
        durationSec: Math.round((Date.now() - started) / 1000),
        outputTail: maskSecrets(out.slice(-TAIL_CHARS), secrets),
      })
    }
    child.on('error', () => done(null))
    child.on('close', code => done(code))
  })
}

/** 명령을 차례로 실행한다. 하나라도 실패하면 거기서 멈춘다(뒤 명령은 앞 명령 결과에 기대는 경우가 많다). */
export async function runCheckCommands(
  cwd: string, commands: string[], timeoutMin: number, secrets: string[],
  log?: (msg: string, type?: 'info' | 'error' | 'warn' | 'system') => void,
  onOutput?: (chunk: string) => void,
): Promise<CheckResult[]> {
  const results: CheckResult[] = []
  for (const c of commands) {
    log?.(`$ ${c}`, 'system')
    const r = await runCheckCommand(cwd, c, timeoutMin, secrets, onOutput)
    log?.(`  → ${r.ok ? '통과' : r.timedOut ? '시간 초과' : `실패 (종료 코드 ${r.exitCode})`} · ${r.durationSec}s`, r.ok ? 'system' : 'error')
    results.push(r)
    if (!r.ok) break
  }
  return results
}

export const checksPassed = (rs: CheckResult[]) => rs.every(r => r.ok)
