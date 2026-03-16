'use client'

import { useEffect, useRef, useState } from 'react'
import '@xterm/xterm/css/xterm.css'

export default function TerminalTab() {
  const containerRef = useRef<HTMLDivElement>(null)
  const termRef = useRef<any>(null)
  const wsRef = useRef<WebSocket | null>(null)
  const fitAddonRef = useRef<any>(null)
  const [error, setError] = useState<string | null>(null)
  const initializedRef = useRef(false)

  useEffect(() => {
    if (initializedRef.current) return
    initializedRef.current = true

    let destroyed = false

    async function init() {
      const { Terminal } = await import('@xterm/xterm')
      const { FitAddon } = await import('@xterm/addon-fit')

      if (destroyed || !containerRef.current) return

      const term = new Terminal({
        theme: {
          background: '#0d1117',
          foreground: '#e6edf3',
          cursor: '#58a6ff',
          selectionBackground: '#264f78',
        },
        fontFamily: "'JetBrains Mono', 'Fira Code', 'Cascadia Code', monospace",
        fontSize: 14,
        lineHeight: 1.4,
        cursorBlink: true,
        allowProposedApi: true,
      })
      termRef.current = term

      const fitAddon = new FitAddon()
      fitAddonRef.current = fitAddon
      term.loadAddon(fitAddon)
      term.open(containerRef.current)
      fitAddon.fit()

      const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:'
      const ws = new WebSocket(`${protocol}//${window.location.host}/api/terminal`)
      wsRef.current = ws

      ws.onopen = () => {
        term.writeln('\x1b[32mConnected to server terminal.\x1b[0m')
        term.writeln('')
        ws.send(JSON.stringify({ type: 'resize', cols: term.cols, rows: term.rows }))
      }

      ws.onmessage = (e) => {
        term.write(e.data)
      }

      ws.onerror = () => {
        if (!destroyed) setError('WebSocket 연결 실패. 서버가 실행 중인지, 로그인 상태인지 확인하세요.')
        term.writeln('\x1b[31mConnection failed.\x1b[0m')
      }

      ws.onclose = (e) => {
        if (!destroyed) {
          if (e.code === 1006) setError('서버에 연결할 수 없습니다 (코드 1006). 서버를 재시작하세요.')
          term.writeln(`\x1b[33m\r\nConnection closed (code ${e.code}).\x1b[0m`)
        }
      }

      term.onData((data) => {
        if (ws.readyState === WebSocket.OPEN) {
          ws.send(JSON.stringify({ type: 'input', data }))
        }
      })

      term.onSelectionChange(() => {
        const sel = term.getSelection()
        if (sel && navigator.clipboard) {
          navigator.clipboard.writeText(sel).catch(() => {})
        }
      })

      // 모바일 터치 스크롤 지원 (iOS Safari)
      let touchStartY = 0
      const handleTouchStart = (e: TouchEvent) => {
        touchStartY = e.touches[0].clientY
      }
      const handleTouchMove = (e: TouchEvent) => {
        e.preventDefault()
        const dy = touchStartY - e.touches[0].clientY
        touchStartY = e.touches[0].clientY
        const lines = Math.round(dy / 14)
        if (lines !== 0) term.scrollLines(lines)
      }
      containerRef.current!.addEventListener('touchstart', handleTouchStart, { passive: true })
      containerRef.current!.addEventListener('touchmove', handleTouchMove, { passive: false })

      containerRef.current!.addEventListener('contextmenu', (e) => {
        e.preventDefault()
        navigator.clipboard.readText().then(text => {
          if (text && ws.readyState === WebSocket.OPEN) {
            ws.send(JSON.stringify({ type: 'input', data: text }))
          }
        }).catch(() => {})
      })

      const handleResize = () => {
        fitAddon.fit()
        if (ws.readyState === WebSocket.OPEN) {
          ws.send(JSON.stringify({ type: 'resize', cols: term.cols, rows: term.rows }))
        }
      }
      window.addEventListener('resize', handleResize)

      return () => {
        window.removeEventListener('resize', handleResize)
      }
    }

    let cleanup: (() => void) | void
    init().then(fn => { cleanup = fn })

    return () => {
      destroyed = true
      cleanup?.()
      wsRef.current?.close()
      termRef.current?.dispose()
      initializedRef.current = false
    }
  }, [])

  return (
    <div className="min-h-screen pb-20">
      <main className="px-4 py-4 max-w-lg mx-auto">
        {error && (
          <div className="bg-red-900/90 text-red-200 text-base px-4 py-2 rounded-lg flex items-center gap-2 mb-3">
            <i className="fa-solid fa-triangle-exclamation" />
            {error}
          </div>
        )}
        <div ref={containerRef} className="bg-[#0d1117] rounded-lg overflow-hidden" style={{ height: 'calc(100vh - 10rem)' }} />
      </main>
    </div>
  )
}
