'use client'

import { useEffect, useRef, useState } from 'react'
import { Terminal } from '@xterm/xterm'
import { FitAddon } from '@xterm/addon-fit'
import '@xterm/xterm/css/xterm.css'
import { TaskExecution } from '@/types'

export default function ExecutionTrace({ projectId, className = 'h-[70vh]' }: { projectId: string; className?: string }) {
  const [executions, setExecutions] = useState<TaskExecution[]>([])
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const terminalRef = useRef<HTMLDivElement>(null)
  const xtermRef = useRef<Terminal | null>(null)
  const fitAddonRef = useRef<FitAddon | null>(null)

  useEffect(() => {
    fetchExecutions()
    // 목록 열려 있는 동안 10초마다 자동 갱신
    const interval = setInterval(fetchExecutions, 10000)
    return () => clearInterval(interval)
  }, [projectId])

  async function fetchExecutions() {
    try {
      const res = await fetch(`/api/projects/${projectId}/executions`)
      if (res.ok) {
        const data = await res.json()
        setExecutions(data)
      }
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    if (selectedId && terminalRef.current) {
      // 터미널 초기화
      const term = new Terminal({
        theme: {
          background: '#000000',
          foreground: '#f8fafc',
          cursor: '#34d399',
          selectionBackground: '#334155',
        },
        fontSize: 12,
        fontFamily: 'JetBrains Mono, Menlo, Courier New, monospace',
        cursorBlink: true,
        scrollback: 10000,
      })

      const fitAddon = new FitAddon()
      term.loadAddon(fitAddon)
      
      term.open(terminalRef.current)
      fitAddon.fit()
      
      term.writeln('\x1b[1;32m[SYSTEM] Connecting to agent trace stream...\x1b[0m')
      
      xtermRef.current = term
      fitAddonRef.current = fitAddon

      // SSE 연결
      const eventSource = new EventSource(`/api/executions/${selectedId}/logs`)
      
      eventSource.onmessage = (event) => {
        // SSE data: 필드는 브라우저가 \n으로 join → xterm은 \r\n 필요
        term.write(event.data.replace(/\r?\n/g, '\r\n') + '\r\n')
      }

      eventSource.onerror = () => {
        eventSource.close()
      }

      return () => {
        eventSource.close()
        term.dispose()
      }
    }
  }, [selectedId])

  if (loading) return <div className="text-center py-10 text-ive-text-muted">실행 이력 로딩 중...</div>

  return (
    <div className={`flex flex-col ${className}`}>
      {selectedId ? (
        <div className="flex-1 flex flex-col min-h-0 bg-black rounded-xl overflow-hidden border border-ive-border-dark shadow-2xl">
          <div className="bg-ive-bg-deep px-4 py-2 border-b border-ive-border-dark flex items-center justify-between shrink-0">
            <span className="text-[10px] font-bold text-ive-green uppercase tracking-widest flex items-center gap-2">
              Agent Trace Log
              {(() => {
                const ex = executions.find(e => e.id === selectedId)
                if (!ex) return null
                return (
                  <span className="text-ive-text-muted font-mono normal-case tracking-normal">
                    {new Date(ex.startedAt).toLocaleString([], { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false })}
                  </span>
                )
              })()}
            </span>
            <button 
              onClick={() => setSelectedId(null)}
              className="text-[10px] font-bold text-ive-text-muted hover:text-ive-text bg-white/5 px-2 py-1 rounded"
            >
              목록으로 돌아가기
            </button>
          </div>
          <div className="flex-1 min-h-0 p-2" ref={terminalRef} />
        </div>
      ) : (
        <div className="flex-1 overflow-y-auto space-y-2 p-3 custom-scrollbar">
          {executions.length === 0 ? (
            <div className="text-center py-20 bg-ive-bg/50 rounded-2xl border border-dashed border-ive-border-subtle">
              <i className="fa-solid fa-list-check text-3xl text-ive-text-dim mb-3 block" />
              <p className="text-xs text-ive-text-muted">아직 실행된 태스크가 없습니다</p>
            </div>
          ) : (
            executions.map(ex => (
              <button
                key={ex.id}
                onClick={() => setSelectedId(ex.id)}
                className="w-full text-left bg-ive-bg-card border border-ive-border-subtle p-4 rounded-xl hover:border-ive-green/50 hover:bg-ive-green/5 transition-all group"
              >
                <div className="flex items-center justify-between mb-1">
                  <span className="text-xs font-black text-ive-green-pale">Issue #{ex.issueIid}</span>
                  <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full uppercase tracking-tighter ${
                    ex.status === 'running' ? 'bg-ive-amber/20 text-ive-amber animate-pulse' :
                    ex.status === 'success' ? 'bg-ive-green/20 text-ive-green' :
                    'bg-ive-red/20 text-ive-red'
                  }`}>
                    {ex.status}
                  </span>
                </div>
                <div className="text-[10px] text-ive-text-muted group-hover:text-ive-text-dim">
                  <i className="fa-solid fa-calendar-day mr-1" />
                  {new Date(ex.startedAt).toLocaleString()}
                </div>
              </button>
            ))
          )}
        </div>
      )}
    </div>
  )
}
