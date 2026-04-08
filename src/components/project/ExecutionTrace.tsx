'use client'

import { useEffect, useState } from 'react'
import { TaskExecution } from '@/types'
import LogViewer from '@/components/ui/LogViewer'
import MarqueeText from '@/components/ui/MarqueeText'
import { useStore } from '@/lib/store'

function formatDuration(startedAt: string, endedAt?: string): string {
  const start = new Date(startedAt).getTime()
  const end = endedAt ? new Date(endedAt).getTime() : Date.now()
  const s = Math.floor((end - start) / 1000)
  if (s < 60) return `${s}s`
  if (s < 3600) return `${Math.floor(s / 60)}m ${s % 60}s`
  return `${Math.floor(s / 3600)}h ${Math.floor((s % 3600) / 60)}m`
}

export default function ExecutionTrace({ projectId, className = 'h-[70vh]' }: { projectId: string; className?: string }) {
  const [executions, setExecutions] = useState<TaskExecution[]>([])
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [killing, setKilling] = useState<string | null>(null)
  const [tick, setTick] = useState(0)
  const { state } = useStore()
  const userLocale = state.user?.locale
  const userTz = state.user?.timezone

  useEffect(() => {
    const hasRunning = executions.some(e => e.status === 'running' || e.status === 'assigned')
    if (!hasRunning) return
    const timer = setInterval(() => setTick(t => t + 1), 1000)
    return () => clearInterval(timer)
  }, [executions])

  useEffect(() => {
    fetchExecutions()
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

  if (loading) return <div className="text-center py-10 text-ive-text-muted">실행 이력 로딩 중...</div>

  return (
    <div className={`flex flex-col ${className}`}>
      {selectedId ? (
        <div className="flex-1 flex flex-col min-h-0 bg-black rounded-lg overflow-hidden border border-ive-border-dark">
          <div className="bg-ive-bg-deep px-4 py-2 border-b border-ive-border-dark flex items-center justify-between shrink-0">
            <span className="text-sm font-bold text-ive-green uppercase tracking-widest flex items-center gap-2">
              에이전트 실행 로그
              {(() => {
                const ex = executions.find(e => e.id === selectedId)
                if (!ex) return null
                const elapsed = formatDuration(ex.startedAt, ex.endedAt)
                return (
                  <span className="text-ive-text-muted font-mono normal-case tracking-normal">
                    {(ex.status === 'running' || ex.status === 'assigned') && <span className={ex.status === 'assigned' ? 'text-ive-cyan' : 'text-ive-amber'}>{elapsed}{tick >= 0 ? '' : ''}</span>}
                    {ex.status !== 'running' && ex.status !== 'assigned' && <span className="text-ive-text-dim">{elapsed}</span>}
                  </span>
                )
              })()}
            </span>
            <button
              onClick={() => setSelectedId(null)}
              className="text-sm font-bold text-ive-text-muted hover:text-ive-text bg-white/5 px-2 py-1 rounded"
            >
              목록으로
            </button>
          </div>
          <LogViewer
            sseUrl={`/api/executions/${selectedId}/logs`}
            initialFetchUrl={`/api/executions/${selectedId}/content`}
            fontSize={12}
            maxLines={10000}
            className="flex-1 min-h-0"
            initialAutoScroll={['running', 'assigned'].includes(executions.find(e => e.id === selectedId)?.status ?? '')}
            timezone={userTz}
          />
        </div>
      ) : (
        <div className="flex-1 overflow-y-auto space-y-2 p-3 custom-scrollbar">
          {executions.length === 0 ? (
            <div className="text-center py-20 bg-ive-bg/50 rounded-2xl border border-dashed border-ive-border-subtle">
              <i className="fa-solid fa-list-check text-3xl text-ive-text-dim mb-3 block" />
              <p className="text-base text-ive-text-muted">아직 실행된 태스크가 없습니다</p>
            </div>
          ) : (
            executions.map(ex => (
              <div key={ex.id}>
                <div
                  onClick={() => setSelectedId(ex.id)}
                  className="w-full text-left bg-ive-bg-card border border-ive-border-subtle p-4 rounded-lg hover:border-ive-green/50 hover:bg-ive-green/5 transition-all group cursor-pointer"
                >
                  <div className="flex items-center justify-between mb-1.5 gap-2">
                    <MarqueeText className="text-base font-bold text-ive-green-pale">Issue #{ex.issueIid}{ex.issueTitle && ` — ${ex.issueTitle}`}</MarqueeText>
                    <span className={`text-sm font-bold px-2 py-0.5 rounded-full tracking-tighter ${
                      ex.status === 'assigned' ? 'bg-ive-cyan/20 text-ive-cyan' :
                      ex.status === 'running' ? 'bg-ive-amber/20 text-ive-amber animate-pulse' :
                      ex.status === 'success' ? 'bg-ive-green/20 text-ive-green' :
                      'bg-ive-red/20 text-ive-red'
                    }`}>
                      {ex.status === 'assigned' ? '배정됨' : ex.status === 'running' ? '실행 중' : ex.status === 'success' ? '완료' : '실패'}
                    </span>
                  </div>
                  {(ex.agentName || ex.modelName || ex.assigneeType === 'user') && (
                    <div className="flex items-center gap-2 mb-1.5 flex-wrap">
                      {ex.assigneeType === 'user' ? (
                        <span className="text-sm font-bold text-ive-cyan/70 bg-ive-cyan/10 border border-ive-cyan/20 px-1.5 py-0.5 rounded">
                          <i className="fa-solid fa-user mr-1 text-sm" />{ex.userName || ''}
                        </span>
                      ) : ex.agentName && (
                        <span className="text-sm font-bold text-ive-green/70 bg-ive-green/10 border border-ive-green/20 px-1.5 py-0.5 rounded">
                          <i className="fa-solid fa-robot mr-1 text-sm" />{ex.agentName}
                        </span>
                      )}
                      {ex.modelName && (
                        <span className="text-sm font-mono text-ive-cyan bg-ive-cyan/10 border border-ive-cyan/20 px-1.5 py-0.5 rounded">
                          <i className="fa-solid fa-microchip mr-1 text-sm" />{ex.modelName}
                        </span>
                      )}
                    </div>
                  )}
                  <div className="flex items-center justify-end text-sm text-ive-text-muted group-hover:text-ive-text-dim">
                    <span className={`font-mono font-bold ${ex.status === 'running' ? 'text-ive-amber' : ex.status === 'assigned' ? 'text-ive-cyan' : 'text-ive-text-dim'}`}>
                      {(ex.status === 'running' || ex.status === 'assigned') && <i className="fa-solid fa-stopwatch mr-1 text-sm" />}
                      {formatDuration(ex.startedAt, ex.endedAt)}
                      {(ex.status === 'running' || ex.status === 'assigned') && tick >= 0 ? '' : ''}
                    </span>
                  </div>
                  {(ex.status === 'running' || ex.status === 'assigned') && (
                    <div className="mt-2 pt-2 border-t border-ive-border-dark">
                      <button
                        onClick={(e) => {
                          e.stopPropagation()
                          setKilling(ex.id)
                          fetch(`/api/executions/${ex.id}/kill`, { method: 'POST' })
                            .then(() => fetchExecutions())
                            .finally(() => setKilling(null))
                        }}
                        disabled={killing === ex.id}
                        className="w-full text-sm font-bold text-ive-red/70 border border-ive-red/30 px-2 py-1.5 rounded-lg bg-ive-bg-deep hover:bg-ive-red/10 transition-colors disabled:opacity-40"
                      >
                        {killing === ex.id
                          ? <i className="fa-solid fa-circle-notch fa-spin" />
                          : <><i className="fa-solid fa-skull-crossbones mr-1" />강제종료</>
                        }
                      </button>
                    </div>
                  )}
                </div>
              </div>
            ))
          )}
        </div>
      )}
    </div>
  )
}
