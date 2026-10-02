import './src/lib/load-env' // 반드시 첫 import — 다른 모듈이 process.env를 읽기 전에 .env 로드
import { createServer as createHttpServer } from 'http'
import { createServer as createHttpsServer } from 'https'
import { readFileSync, existsSync } from 'fs'
import { parse } from 'url'
import cluster from 'cluster'
import os from 'os'
import next from 'next'
import { WebSocketServer, WebSocket } from 'ws'
import * as pty from 'node-pty'
import jwt from 'jsonwebtoken'
import { handleChatWebSocket } from './src/lib/chat-ws'
import { AsyncLocalStorage } from 'async_hooks'

// 백그라운드 작업(스캐너 등)을 시작할 "요청과 무관한" 실행 컨텍스트. 아무 요청도 받기 전인
// 지금(모듈 로드 시점) 잡아 둔다. 스캐너는 첫 getDb() 호출 때 시작되는데, 그 호출이 페이지
// 렌더링 중이면 setInterval 이 그 요청의 컨텍스트를 물려받아 Next/React 의 요청 단위 fetch
// 메모이즈가 영구히 적용된다 → 같은 GitLab 조회가 첫 응답을 계속 재사용해 새 이슈·레이블 변경을
// 못 보게 된다(1.8.0 배포 후 대기 건 미시작·IVE-E 미닫힘 장애). connection.ts 가 이걸로 감싸 시작한다.
globalThis.__iveRunInRootContext = AsyncLocalStorage.snapshot()

const KNOWN_DEFAULT_JWT_SECRETS = [
  'springware-ive-dev-secret-change-in-production',
  'springware-ive-secret-change-me',
]
const JWT_SECRET = process.env.JWT_SECRET || 'springware-ive-dev-secret-change-in-production'
if (process.env.NODE_ENV === 'production' && KNOWN_DEFAULT_JWT_SECRETS.includes(JWT_SECRET)) {
  console.warn('\x1b[31m[SECURITY WARNING] JWT_SECRET is set to a known default value. Set a strong, unique JWT_SECRET environment variable!\x1b[0m')
}
function verifyToken(token: string): { userId: string } | null {
  try {
    return jwt.verify(token, JWT_SECRET) as { userId: string }
  } catch {
    return null
  }
}

const dev = process.env.NODE_ENV !== 'production'
const SSL_CERT = process.env.SSL_CERT || '/app/ssl/cert.pem'
const SSL_KEY = process.env.SSL_KEY || '/app/ssl/key.pem'
const useHttps = !dev && existsSync(SSL_CERT) && existsSync(SSL_KEY)
const port = parseInt(process.env.PORT || (useHttps ? '443' : '3000'), 10)

// ── 동시성 설정 ────────────────────────────────────────────────────────────────
// 웹 워커 수. Node 는 프로세스당 코어 1개만 쓰므로 SSR 처리량은 단일 프로세스에서
// 코어 1개에 묶인다(멀티코어 서버에서 나머지 코어가 논다). WEB_CONCURRENCY 를 올리면
// cluster 로 워커를 늘려 그만큼 동시 처리량이 늘어난다.
//   - 'auto' 는 코어 수를 쓴다. 미설정 시 1(종전 동작 유지).
//   - 백그라운드 작업(스캐너/통계/리포트)은 워커 0 에서만 돈다. 나머지 워커는
//     IVE_BACKGROUND_JOBS=0 을 받아 스캐너를 띄우지 않는다 — 중복 실행 방지.
//   - dev 는 Next 개발 서버 특성상 1로 고정한다.
const WEB_CONCURRENCY = (() => {
  if (dev) return 1
  const raw = process.env.WEB_CONCURRENCY
  if (!raw) return 1
  if (raw === 'auto') return Math.max(1, os.cpus().length)
  const n = parseInt(raw, 10)
  return Number.isFinite(n) && n > 0 ? n : 1
})()

// 터미널(PTY) 동시 세션 상한. PTY 는 연결마다 셸 프로세스를 띄우므로 무제한이면
// 한 사용자가 탭을 계속 열어 서버 메모리/PID 를 고갈시킬 수 있다.
const MAX_TERMINALS = parseInt(process.env.MAX_TERMINALS || '100', 10)
const MAX_TERMINALS_PER_USER = parseInt(process.env.MAX_TERMINALS_PER_USER || '5', 10)

// 터미널 PTY에 전달할 환경변수에서 민감한 서버 시크릿 제거
const EXCLUDED_ENV_KEYS = new Set([
  'JWT_SECRET', 'ENCRYPTION_KEY',
  'MAIL_SMTP_PASSWORD', 'MAIL_SMTP_AUTH',
  'DATABASE_URL', 'DB_PASSWORD',
])
function getSafeEnv(): Record<string, string> {
  return Object.fromEntries(
    Object.entries(process.env).filter(([k, v]) => !EXCLUDED_ENV_KEYS.has(k) && v !== undefined)
  ) as Record<string, string>
}

function parseCookies(header: string): Record<string, string> {
  if (!header) return {}
  return Object.fromEntries(
    header.split(';').map(c => {
      const [k, ...v] = c.trim().split('=')
      return [k.trim(), decodeURIComponent(v.join('='))]
    })
  )
}

async function main() {
  const app = next({ dev })
  const handle = app.getRequestHandler()
  await app.prepare()

  const handler = (req: any, res: any) => handle(req, res, parse(req.url!, true))
  const server = useHttps
    ? createHttpsServer({ cert: readFileSync(SSL_CERT), key: readFileSync(SSL_KEY) }, handler)
    : createHttpServer(handler)

  const wss = new WebSocketServer({ noServer: true })

  // Chat WebSocket server (separate from terminal)
  const chatWss = new WebSocketServer({ noServer: true })

  chatWss.on('connection', (ws: WebSocket) => {
    handleChatWebSocket(ws)
  })

  server.on('upgrade', (req, socket, head) => {
    // 연결마다 동기 stdout 쓰기가 발생하면 동시 접속이 많을 때 그 자체가 비용이다.
    // 문제 추적이 필요할 때만 WS_LOG=1 로 켠다.
    if (process.env.WS_LOG === '1') {
      const clientIp = req.headers['x-forwarded-for'] || req.socket.remoteAddress
      console.log(`[WS] Connection from ${clientIp} (${req.url})`)
    }

    // /_next/ 경로는 Next.js HMR용이므로 그냥 통과
    if (!req.url || req.url.startsWith('/_next/')) return

    const pathname = req.url.split('?')[0]

    if (pathname !== '/api/terminal' && pathname !== '/api/chat') {
      socket.destroy()
      return
    }

    // 쿠키에서 JWT 검증
    const cookies = parseCookies(req.headers.cookie || '')
    const token = cookies['ive-token']
    if (!token) {
      console.log(`[WS] Auth failed: no ive-token cookie (${pathname})`)
      socket.write('HTTP/1.1 401 Unauthorized\r\n\r\n')
      socket.destroy()
      return
    }
    const auth = verifyToken(token)
    if (!auth) {
      console.log(`[WS] Auth failed: invalid token (${pathname})`)
      socket.write('HTTP/1.1 401 Unauthorized\r\n\r\n')
      socket.destroy()
      return
    }

    if (pathname === '/api/chat') {
      chatWss.handleUpgrade(req, socket, head, (ws) => {
        chatWss.emit('connection', ws, req)
      })
    } else {
      wss.handleUpgrade(req, socket, head, (ws) => {
        wss.emit('connection', ws, req, auth.userId)
      })
    }
  })

  // 살아있는 터미널 수 (전체 / 사용자별) — 상한 초과 시 새 연결을 거절한다.
  let terminalCount = 0
  const terminalsByUser = new Map<string, number>()

  wss.on('connection', (ws: WebSocket, _req: unknown, userId: string) => {
    const perUser = terminalsByUser.get(userId) ?? 0
    if (terminalCount >= MAX_TERMINALS || perUser >= MAX_TERMINALS_PER_USER) {
      const reason = terminalCount >= MAX_TERMINALS
        ? `서버 터미널 동시 세션 한도(${MAX_TERMINALS})에 도달했습니다.`
        : `사용자당 터미널 동시 세션 한도(${MAX_TERMINALS_PER_USER})에 도달했습니다.`
      ws.send(`\r\n\x1b[31m${reason} 사용하지 않는 터미널 탭을 닫고 다시 시도해주세요.\x1b[0m\r\n`)
      ws.close()
      return
    }
    terminalCount++
    terminalsByUser.set(userId, perUser + 1)

    const shell = process.env.SHELL || (process.platform === 'win32' ? 'powershell.exe' : '/bin/zsh')

    // 정리(PTY kill + 카운터 감소)는 close/error/heartbeat 어디서 와도 한 번만 돌게 한다.
    let released = false
    const release = () => {
      if (released) return
      released = true
      terminalCount--
      const n = (terminalsByUser.get(userId) ?? 1) - 1
      if (n <= 0) terminalsByUser.delete(userId)
      else terminalsByUser.set(userId, n)
      if (heartbeat) clearInterval(heartbeat)
      try { ptyProcess?.kill() } catch { /* ignore */ }
    }

    // 브라우저 탭이 죽거나 네트워크가 끊기면 TCP FIN 이 오지 않는 경우가 있다.
    // 그때 ws 는 열린 채로 남고 PTY 셸 프로세스가 영원히 살아 자원을 먹는다.
    // ping/pong 으로 죽은 연결을 걷어낸다(chat WS 에는 이미 있던 장치).
    let alive = true
    ws.on('pong', () => { alive = true })
    const heartbeat: ReturnType<typeof setInterval> = setInterval(() => {
      if (!alive) {
        ws.terminate()
        release()
        return
      }
      alive = false
      try { ws.ping() } catch { /* ignore */ }
    }, 30_000)

    let ptyProcess: pty.IPty
    try {
      ptyProcess = pty.spawn(shell, [], {
        name: 'xterm-256color',
        cols: 80,
        rows: 24,
        cwd: process.cwd(),
        env: getSafeEnv(),
      })
    } catch (err: any) {
      ws.send(`\r\n\x1b[31mFailed to start terminal: ${err.message}\x1b[0m\r\n`)
      ws.send(`\r\n\x1b[33mTry running: npm rebuild node-pty\x1b[0m\r\n`)
      ws.close()
      release()
      return
    }

    ptyProcess.onData((data) => {
      if (ws.readyState === WebSocket.OPEN) ws.send(data)
    })

    ptyProcess.onExit(() => {
      if (ws.readyState === WebSocket.OPEN) ws.close()
    })

    ws.on('message', (message: Buffer) => {
      try {
        const msg = JSON.parse(message.toString())
        if (msg.type === 'input') {
          ptyProcess.write(msg.data)
        } else if (msg.type === 'resize') {
          ptyProcess.resize(Math.max(1, msg.cols), Math.max(1, msg.rows))
        }
      } catch {
        ptyProcess.write(message.toString())
      }
    })

    ws.on('close', release)
    ws.on('error', release)
  })

  // nginx 는 upstream 으로 keepalive 커넥션을 유지한다(keepalive_timeout 65s).
  // Node 기본 keepAliveTimeout 은 5초라 nginx 가 재사용하려는 순간 서버가 먼저 끊어
  // 간헐적 502 가 난다. nginx 값보다 길게 잡아 커넥션 재사용이 실제로 이득이 되게 한다.
  server.keepAliveTimeout = 72_000
  server.headersTimeout = 75_000

  server.listen(port, () => {
    console.log(`> Ready on ${useHttps ? 'https' : 'http'}://localhost:${port} (worker ${process.pid}, bg=${process.env.IVE_BACKGROUND_JOBS !== '0'})`)
  })
}

if (WEB_CONCURRENCY > 1 && cluster.isPrimary) {
  // 프라이머리는 요청을 처리하지 않고 워커만 관리한다(DB 도 열지 않는다).
  console.log(`> Starting ${WEB_CONCURRENCY} web workers on ${os.cpus().length} cores`)

  const spawn = (index: number) => {
    const worker = cluster.fork({
      // 워커 0 만 스캐너·통계·리포트 스케줄러를 돌린다. 나머지는 순수 웹 처리 전용.
      IVE_BACKGROUND_JOBS: index === 0 ? '1' : '0',
      IVE_WORKER_INDEX: String(index),
    })
    worker.on('exit', (code, signal) => {
      if (worker.exitedAfterDisconnect) return // 의도적 종료(재시작/셧다운)
      console.error(`[cluster] worker ${worker.process.pid} (index ${index}) exited code=${code} signal=${signal} — 1초 후 재기동`)
      // 즉시 재fork 하면 기동 직후 죽는 오류에서 CPU 를 태우는 루프가 된다.
      setTimeout(() => spawn(index), 1000)
    })
  }

  for (let i = 0; i < WEB_CONCURRENCY; i++) spawn(i)

  const shutdown = () => {
    for (const w of Object.values(cluster.workers ?? {})) w?.kill()
    process.exit(0)
  }
  process.on('SIGTERM', shutdown)
  process.on('SIGINT', shutdown)
} else {
  main().catch(console.error)
}
