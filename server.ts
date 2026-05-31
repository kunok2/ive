import './src/lib/load-env' // 반드시 첫 import — 다른 모듈이 process.env를 읽기 전에 .env 로드
import { createServer as createHttpServer } from 'http'
import { createServer as createHttpsServer } from 'https'
import { readFileSync, existsSync } from 'fs'
import { parse } from 'url'
import next from 'next'
import { WebSocketServer, WebSocket } from 'ws'
import * as pty from 'node-pty'
import jwt from 'jsonwebtoken'
import { handleChatWebSocket } from './src/lib/chat-ws'

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
    const clientIp = req.headers['x-forwarded-for'] || req.socket.remoteAddress
    console.log(`[WS] Connection from ${clientIp} (${req.url})`)

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
    if (!verifyToken(token)) {
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
        wss.emit('connection', ws, req)
      })
    }
  })

  wss.on('connection', (ws: WebSocket) => {
    const shell = process.env.SHELL || (process.platform === 'win32' ? 'powershell.exe' : '/bin/zsh')

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

    ws.on('close', () => { try { ptyProcess.kill() } catch { /* ignore */ } })
    ws.on('error', () => { try { ptyProcess.kill() } catch { /* ignore */ } })
  })

  server.listen(port, () => {
    console.log(`> Ready on ${useHttps ? 'https' : 'http'}://localhost:${port}`)
  })
}

main().catch(console.error)
