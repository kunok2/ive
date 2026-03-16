'use client'

import { useState, useRef, useCallback, use } from 'react'
import { useRouter } from 'next/navigation'
import LogViewer from '@/components/ui/LogViewer'

export default function ExecutionDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params)
  const router = useRouter()
  const [killing, setKilling] = useState(false)
  const [lineCount, setLineCount] = useState(0)
  const [connected, setConnected] = useState(false)
  const containerRef = useRef<HTMLDivElement>(null)

  const handleKill = async () => {
    setKilling(true)
    try {
      await fetch(`/api/executions/${id}/kill`, { method: 'POST' })
    } finally {
      setKilling(false)
    }
  }

  const scrollToBottom = useCallback(() => {
    const el = containerRef.current?.querySelector('[data-log-scroll]')
    if (el) el.scrollTop = el.scrollHeight
  }, [])

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

      {/* 커스텀 로그 뷰어 */}
      <div ref={containerRef} className="flex-1 min-h-0">
        <LogViewer
          sseUrl={`/api/executions/${id}/logs`}
          fontSize={13}
          maxLines={50000}
          className="h-full"
          onConnectionChange={setConnected}
          onLineCountChange={setLineCount}
        />
      </div>

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
