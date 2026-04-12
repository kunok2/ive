'use client'

import { useEffect, useRef, useState } from 'react'
import { useTranslations } from 'next-intl'
import '@xterm/xterm/css/xterm.css'

export default function TerminalTab() {
  const tWs = useTranslations('ws')
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

      // xterm 테마는 runtime 값이 필요 — CSS 변수에서 읽어옴
      const css = getComputedStyle(document.documentElement)
      const term = new Terminal({
        theme: {
          background: css.getPropertyValue('--color-ive-bg-deep').trim() || '#0e0e11',
          foreground: css.getPropertyValue('--color-ive-text').trim() || '#e4e4e7',
          cursor: css.getPropertyValue('--color-ive-cyan').trim() || '#22d3ee',
          selectionBackground: css.getPropertyValue('--color-ive-cyan').trim() || '#22d3ee',
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
        if (!destroyed) setError(tWs('connectionFailed'))
        term.writeln('\x1b[31mConnection failed.\x1b[0m')
      }

      ws.onclose = (e) => {
        if (!destroyed) {
          if (e.code === 1006) setError(tWs('serverDisconnected'))
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

      // 모바일 터치 스크롤 지원 (iOS Safari — 관성 포함)
      const { setupXtermTouchScroll } = await import('@/lib/xterm-touch')
      const cleanupTouch = setupXtermTouchScroll(containerRef.current!, term)

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
        cleanupTouch()
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
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  return (
    <div className="flex-1 min-h-0 flex flex-col">
      {error && (
        <div className="bg-ive-red/15 text-ive-red text-base px-4 py-2 rounded-lg flex items-center gap-2 mb-3 border border-ive-red/30 shrink-0">
          <i className="fa-solid fa-triangle-exclamation" />
          {error}
        </div>
      )}
      <div ref={containerRef} className="flex-1 min-h-0 bg-ive-bg-deep rounded-lg overflow-hidden border border-ive-border-dark" />
    </div>
  )
}
