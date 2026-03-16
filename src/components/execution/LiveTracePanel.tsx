'use client'

import { useEffect, useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import { TaskExecution, Agent } from '@/types'
import { Terminal } from '@xterm/xterm'
import { FitAddon } from '@xterm/addon-fit'
import '@xterm/xterm/css/xterm.css'

function formatDuration(startedAt: string): string {
  const s = Math.floor((Date.now() - new Date(startedAt).getTime()) / 1000)
  if (s < 60) return `${s}s`
  if (s < 3600) return `${Math.floor(s / 60)}m ${s % 60}s`
  return `${Math.floor(s / 3600)}h ${Math.floor((s % 3600) / 60)}m`
}

interface AgentTab {
  agent: Agent
  execution: TaskExecution | null
}

interface Props {
  agents: AgentTab[]
  onKill?: (id: string) => void
}

export default function LiveTracePanel({ agents, onKill }: Props) {
  const router = useRouter()
  const [activeIdx, setActiveIdx] = useState(0)
  const [tick, setTick] = useState(0)

  useEffect(() => {
    const timer = setInterval(() => setTick(t => t + 1), 1000)
    return () => clearInterval(timer)
  }, [])

  if (agents.length === 0) {
    return (
      <div className="text-center py-10 text-ive-text-dim text-sm">
        배정된 개발자가 없습니다
      </div>
    )
  }

  const current = agents[activeIdx]

  return (
    <div className="border-t border-ive-cyan/20 flex-1 flex flex-col min-h-0">
      {/* 에이전트 탭 */}
      <div className="flex border-b border-ive-border-dark bg-ive-bg-deep/50 shrink-0">
        {agents.map((tab, idx) => {
          const isRunning = tab.execution?.status === 'running'
          return (
            <button
              key={tab.agent.id}
              onClick={() => setActiveIdx(idx)}
              className={`flex-1 px-3 py-2 text-sm font-bold flex items-center justify-center gap-1.5 transition-all ${
                idx === activeIdx
                  ? 'text-ive-cyan border-b-2 border-ive-cyan bg-ive-cyan/5'
                  : 'text-ive-text-dim hover:text-ive-text-muted'
              }`}
            >
              {isRunning ? (
                <i className="fa-solid fa-gear fa-spin text-ive-amber text-xs" />
              ) : (
                <i className="fa-solid fa-robot text-xs" />
              )}
              <span className="truncate">{tab.agent.name}</span>
            </button>
          )
        })}
      </div>

      {/* 현재 선택된 에이전트 내용 */}
      {current.execution ? (
        <div className="flex-1 flex flex-col min-h-0 p-3 gap-2">
          <div className="flex items-center justify-between shrink-0">
            <div className="min-w-0">
              <span className="text-sm font-black text-ive-green">#{current.execution.issueIid}</span>
              {current.execution.issueTitle && (
                <span className="text-sm text-ive-text ml-1.5 font-semibold">{current.execution.issueTitle}</span>
              )}
            </div>
            <span className="text-xs font-mono font-bold text-ive-amber shrink-0 ml-2">
              {formatDuration(current.execution.startedAt)}
              {tick >= 0 ? '' : ''}
            </span>
          </div>

          {/* 실시간 로그 xterm — 남은 공간 채움 */}
          <XtermMiniView executionId={current.execution.id} />

          <div className="flex gap-2 shrink-0">
            {onKill && (
              <button
                onClick={() => onKill(current.execution!.id)}
                className="flex-1 text-xs font-bold text-ive-red/70 border border-ive-red/30 py-1.5 rounded-lg bg-ive-bg-deep hover:bg-ive-red/10 transition-colors"
              >
                <i className="fa-solid fa-skull-crossbones mr-1" />강제종료
              </button>
            )}
            <button
              onClick={() => router.push(`/executions/${current.execution!.id}`)}
              className="flex-1 text-xs font-bold text-ive-cyan border border-ive-cyan/30 py-1.5 rounded-lg bg-ive-bg-deep hover:bg-ive-cyan/10 transition-colors"
            >
              <i className="fa-solid fa-expand mr-1" />전체화면
            </button>
          </div>
        </div>
      ) : (
        <div className="flex-1 flex items-center justify-center text-ive-text-dim text-sm">
          <div className="text-center">
            <i className="fa-solid fa-coffee text-xl mb-2 block" />
            현재 진행 중인 작업이 없습니다
          </div>
        </div>
      )}
    </div>
  )
}

/** SSE + xterm.js 미니뷰 */
function XtermMiniView({ executionId }: { executionId: string }) {
  const termRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!termRef.current) return

    const term = new Terminal({
      theme: {
        background: '#0a0a0a',
        foreground: '#d4d4d4',
        cursor: '#4ade80',
        black: '#171717', red: '#f87171', green: '#4ade80', yellow: '#facc15',
        blue: '#60a5fa', magenta: '#c084fc', cyan: '#22d3ee', white: '#e5e5e5',
        brightBlack: '#737373', brightRed: '#fca5a5', brightGreen: '#86efac', brightYellow: '#fde68a',
        brightBlue: '#93c5fd', brightMagenta: '#d8b4fe', brightCyan: '#67e8f9', brightWhite: '#ffffff',
      },
      fontSize: 11,
      fontFamily: '"JetBrains Mono", "Fira Code", Menlo, Monaco, monospace',
      lineHeight: 1.3,
      cursorStyle: 'bar',
      cursorBlink: false,
      scrollback: 500,
      convertEol: true,
      disableStdin: true,
    })

    const fit = new FitAddon()
    term.loadAddon(fit)
    term.open(termRef.current)
    fit.fit()

    const eventSource = new EventSource(`/api/executions/${executionId}/logs`)
    eventSource.onmessage = (event) => {
      const lines = event.data.split('\n')
      for (const line of lines) {
        term.writeln(line)
      }
    }
    eventSource.onerror = () => eventSource.close()

    // 모바일 터치 스크롤 지원 (iOS Safari)
    const el = termRef.current!
    let touchY = 0
    const onTouchStart = (e: TouchEvent) => { touchY = e.touches[0].clientY }
    const onTouchMove = (e: TouchEvent) => {
      e.preventDefault()
      const dy = touchY - e.touches[0].clientY
      touchY = e.touches[0].clientY
      const lines = Math.round(dy / 14)
      if (lines !== 0) term.scrollLines(lines)
    }
    el.addEventListener('touchstart', onTouchStart, { passive: true })
    el.addEventListener('touchmove', onTouchMove, { passive: false })

    const handleResize = () => fit.fit()
    window.addEventListener('resize', handleResize)

    return () => {
      eventSource.close()
      window.removeEventListener('resize', handleResize)
      el.removeEventListener('touchstart', onTouchStart)
      el.removeEventListener('touchmove', onTouchMove)
      term.dispose()
    }
  }, [executionId])

  return (
    <div
      ref={termRef}
      className="rounded-lg overflow-hidden flex-1 min-h-0"
    />
  )
}
