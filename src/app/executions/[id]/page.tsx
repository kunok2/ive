'use client'

import { useEffect, useRef, useState, use } from 'react'
import { useRouter } from 'next/navigation'
import { Terminal } from '@xterm/xterm'
import { FitAddon } from '@xterm/addon-fit'
import '@xterm/xterm/css/xterm.css'

export default function ExecutionDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params)
  const router = useRouter()
  const [killing, setKilling] = useState(false)
  const [lineCount, setLineCount] = useState(0)
  const [connected, setConnected] = useState(false)
  const termRef = useRef<HTMLDivElement>(null)
  const termInstance = useRef<Terminal | null>(null)
  const fitAddon = useRef<FitAddon | null>(null)

  // xterm 초기화 + SSE 연결
  useEffect(() => {
    if (!termRef.current) return

    const term = new Terminal({
      theme: {
        background: '#0a0a0a',
        foreground: '#d4d4d4',
        cursor: '#4ade80',
        selectionBackground: '#4ade8040',
        black: '#171717',
        red: '#f87171',
        green: '#4ade80',
        yellow: '#facc15',
        blue: '#60a5fa',
        magenta: '#c084fc',
        cyan: '#22d3ee',
        white: '#e5e5e5',
        brightBlack: '#737373',
        brightRed: '#fca5a5',
        brightGreen: '#86efac',
        brightYellow: '#fde68a',
        brightBlue: '#93c5fd',
        brightMagenta: '#d8b4fe',
        brightCyan: '#67e8f9',
        brightWhite: '#ffffff',
      },
      fontSize: 13,
      fontFamily: '"JetBrains Mono", "Fira Code", "Cascadia Code", Menlo, Monaco, monospace',
      lineHeight: 1.4,
      cursorStyle: 'bar',
      cursorBlink: false,
      scrollback: 50000,
      convertEol: true,
      disableStdin: true,
    })

    const fit = new FitAddon()
    term.loadAddon(fit)
    term.open(termRef.current)
    fit.fit()

    termInstance.current = term
    fitAddon.current = fit

    let count = 0
    const eventSource = new EventSource(`/api/executions/${id}/logs`)

    eventSource.onopen = () => setConnected(true)

    eventSource.onmessage = (event) => {
      const lines = event.data.split('\n')
      for (const line of lines) {
        term.writeln(line)
        count++
      }
      setLineCount(count)
    }

    eventSource.onerror = () => {
      eventSource.close()
      setConnected(false)
    }

    // 모바일 터치 스크롤 지원
    const el = termRef.current!
    const xtScreen = el.querySelector('.xterm-screen') as HTMLElement
    const xtViewport = el.querySelector('.xterm-viewport') as HTMLElement
    if (xtScreen) xtScreen.style.touchAction = 'pan-y'
    if (xtViewport) xtViewport.style.touchAction = 'pan-y'
    let touchY = 0
    const onTouchStart = (e: TouchEvent) => { touchY = e.touches[0].clientY }
    const onTouchMove = (e: TouchEvent) => {
      const dy = touchY - e.touches[0].clientY
      touchY = e.touches[0].clientY
      const lines = Math.round(dy / 20)
      if (lines !== 0) term.scrollLines(lines)
    }
    el.addEventListener('touchstart', onTouchStart, { passive: true })
    el.addEventListener('touchmove', onTouchMove, { passive: true })

    const handleResize = () => fit.fit()
    window.addEventListener('resize', handleResize)

    return () => {
      eventSource.close()
      window.removeEventListener('resize', handleResize)
      el.removeEventListener('touchstart', onTouchStart)
      el.removeEventListener('touchmove', onTouchMove)
      term.dispose()
      termInstance.current = null
    }
  }, [id])

  const handleKill = async () => {
    setKilling(true)
    try {
      await fetch(`/api/executions/${id}/kill`, { method: 'POST' })
    } finally {
      setKilling(false)
    }
  }

  const scrollToBottom = () => {
    termInstance.current?.scrollToBottom()
  }

  return (
    <div className="h-screen bg-[#0a0a0a] flex flex-col overflow-hidden">
      {/* 헤더 */}
      <div className="bg-ive-bg-card border-b border-ive-border-dark px-4 py-3 flex items-center justify-between shrink-0">
        <div className="flex items-center gap-3 min-w-0">
          <button
            onClick={() => router.back()}
            className="w-8 h-8 rounded-lg bg-ive-bg-deep border border-ive-border-dark flex items-center justify-center text-ive-text-muted hover:text-ive-green transition-colors shrink-0"
          >
            <i className="fa-solid fa-arrow-left" />
          </button>
          <div className="min-w-0">
            <div className="text-base font-bold text-ive-green-pale truncate">
              <i className="fa-solid fa-terminal mr-1.5 text-ive-green" />
              Execution Trace
            </div>
            <div className="text-xs text-ive-text-dim font-mono truncate">{id}</div>
          </div>
        </div>
        <div className="flex items-center gap-2 shrink-0">
          <button
            onClick={handleKill}
            disabled={killing}
            className="text-xs font-bold text-ive-red/70 border border-ive-red/30 px-3 py-1.5 rounded-lg bg-ive-bg-deep hover:bg-ive-red/10 transition-colors disabled:opacity-40"
          >
            {killing ? <i className="fa-solid fa-circle-notch fa-spin" /> : <><i className="fa-solid fa-skull-crossbones mr-1" />강제종료</>}
          </button>
        </div>
      </div>

      {/* xterm 터미널 */}
      <div ref={termRef} className="flex-1 min-h-0" />

      {/* 하단 바 */}
      <div className="bg-ive-bg-card border-t border-ive-border-dark px-4 py-2 flex items-center justify-between shrink-0">
        <div className="flex items-center gap-3 text-xs text-ive-text-dim">
          <span><i className="fa-solid fa-lines-leaning mr-1" />{lineCount} lines</span>
          <span className="text-ive-text-dim/30">|</span>
          <span className={connected ? 'text-ive-green' : 'text-ive-text-dim'}>
            <i className={`fa-solid ${connected ? 'fa-circle' : 'fa-circle-xmark'} mr-1`} />
            {connected ? '연결됨' : '종료됨'}
          </span>
        </div>
        <button
          onClick={scrollToBottom}
          className="text-xs px-2 py-1 rounded border transition-colors text-ive-text-dim border-ive-border-dark hover:text-ive-green hover:border-ive-green/30"
        >
          <i className="fa-solid fa-arrow-down mr-1" />하단으로
        </button>
      </div>
    </div>
  )
}
