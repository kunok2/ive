import { createServer } from 'http'
import { parse } from 'url'
import next from 'next'
import { WebSocketServer, WebSocket } from 'ws'
import * as pty from 'node-pty'
import { verifyToken } from './src/lib/auth'

const dev = process.env.NODE_ENV !== 'production'
const port = parseInt(process.env.PORT || '3000', 10)

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

  const server = createServer((req, res) => {
    handle(req, res, parse(req.url!, true))
  })

  const wss = new WebSocketServer({ noServer: true })

  server.on('upgrade', (req, socket, head) => {
    if (req.url !== '/api/terminal') {
      socket.destroy()
      return
    }

    // 쿠키에서 JWT 검증
    const cookies = parseCookies(req.headers.cookie || '')
    const token = cookies['ive-token']
    if (!token || !verifyToken(token)) {
      socket.write('HTTP/1.1 401 Unauthorized\r\n\r\n')
      socket.destroy()
      return
    }

    wss.handleUpgrade(req, socket, head, (ws) => {
      wss.emit('connection', ws, req)
    })
  })

  wss.on('connection', (ws: WebSocket) => {
    const shell = process.env.SHELL || (process.platform === 'win32' ? 'powershell.exe' : 'bash')

    const ptyProcess = pty.spawn(shell, [], {
      name: 'xterm-256color',
      cols: 80,
      rows: 24,
      cwd: process.cwd(),
      env: process.env as Record<string, string>,
    })

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
    console.log(`> Ready on http://localhost:${port}`)
  })
}

main().catch(console.error)
