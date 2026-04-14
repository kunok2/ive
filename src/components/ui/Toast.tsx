'use client'

import { ReactNode, createContext, useCallback, useContext, useRef, useState } from 'react'
import { useTranslations } from 'next-intl'

// ── Types ──
interface ToastItem {
  id: number
  message: string
  variant: 'success' | 'error' | 'info' | 'warning'
  dismissing?: boolean
}

interface PipelineWatch {
  projectId: string
  issueIid: number
  mrIid: number
  label: string
}

interface ToastContext {
  toast: (message: string, variant?: 'success' | 'error' | 'info' | 'warning') => void
  watchPipeline: (watch: PipelineWatch) => void
}

const ToastCtx = createContext<ToastContext>({
  toast: () => {},
  watchPipeline: () => {},
})

export function useToast() {
  return useContext(ToastCtx)
}

// ── Provider ──
export function ToastProvider({ children }: { children: ReactNode }) {
  const tPipeline = useTranslations('pipeline')
  const [toasts, setToasts] = useState<ToastItem[]>([])
  const nextId = useRef(0)
  const watchTimers = useRef<Map<string, ReturnType<typeof setInterval>>>(new Map())

  const dismiss = useCallback((id: number) => {
    setToasts(prev => prev.map(t => t.id === id ? { ...t, dismissing: true } : t))
    setTimeout(() => {
      setToasts(prev => prev.filter(t => t.id !== id))
    }, 300)
  }, [])

  const toast = useCallback((message: string, variant: 'success' | 'error' | 'info' | 'warning' = 'info') => {
    const id = nextId.current++
    setToasts(prev => [...prev, { id, message, variant }])
    setTimeout(() => dismiss(id), 5000)
  }, [dismiss])

  const watchPipeline = useCallback((watch: PipelineWatch) => {
    const key = `${watch.projectId}-${watch.issueIid}`
    // 이미 모니터링 중이면 스킵
    if (watchTimers.current.has(key)) return

    let attempts = 0
    const maxAttempts = 60 // 최대 10분 (10초 × 60)

    const poll = async () => {
      attempts++
      if (attempts > maxAttempts) {
        const timer = watchTimers.current.get(key)
        if (timer) clearInterval(timer)
        watchTimers.current.delete(key)
        toast(tPipeline('monitoringTimeout', { mrIid: watch.mrIid }), 'info')
        return
      }

      try {
        const res = await fetch(
          `/api/projects/${watch.projectId}/issues/${watch.issueIid}/mr/pipeline`
        )
        if (!res.ok) return

        const data = await res.json()
        const pipeline = data.pipeline

        if (!pipeline) return

        if (pipeline.status === 'success') {
          const timer = watchTimers.current.get(key)
          if (timer) clearInterval(timer)
          watchTimers.current.delete(key)
          toast(tPipeline('deploySuccess', { label: watch.label }), 'success')
        } else if (pipeline.status === 'failed') {
          const timer = watchTimers.current.get(key)
          if (timer) clearInterval(timer)
          watchTimers.current.delete(key)
          toast(tPipeline('deployFailed', { label: watch.label }), 'error')
        } else if (pipeline.status === 'canceled') {
          const timer = watchTimers.current.get(key)
          if (timer) clearInterval(timer)
          watchTimers.current.delete(key)
          toast(tPipeline('deployCancelled', { label: watch.label }), 'info')
        }
        // running, pending → 계속 폴링
      } catch {
        // 네트워크 오류 시 무시하고 계속 폴링
      }
    }

    // 첫 폴링은 5초 후 시작 (머지 직후 파이프라인이 아직 생성 안 되었을 수 있음)
    setTimeout(() => {
      poll()
      const timer = setInterval(poll, 10000)
      watchTimers.current.set(key, timer)
    }, 5000)
  }, [toast, tPipeline])

  const iconMap: Record<string, string> = {
    success: 'fa-solid fa-circle-check text-ive-green',
    error: 'fa-solid fa-circle-xmark text-ive-red',
    info: 'fa-solid fa-circle-info text-ive-cyan',
    warning: 'fa-solid fa-circle-exclamation text-ive-amber',
  }

  const borderMap: Record<string, string> = {
    success: 'border-ive-green/30',
    error: 'border-ive-red/30',
    info: 'border-ive-cyan/30',
    warning: 'border-ive-amber/30',
  }

  return (
    <ToastCtx.Provider value={{ toast, watchPipeline }}>
      {children}
      {/* Toast Container */}
      <div className="fixed bottom-20 left-4 right-4 z-[70] flex flex-col gap-2 pointer-events-none">
        {toasts.map(t => (
          <div
            key={t.id}
            className={`pointer-events-auto w-full max-w-sm mx-auto bg-ive-bg-card border ${borderMap[t.variant]} rounded-lg px-4 py-3 flex items-center gap-3 ${
              t.dismissing ? 'animate-toast-out' : 'animate-toast-in'
            }`}
            onClick={() => dismiss(t.id)}
          >
            <i className={`${iconMap[t.variant]} text-lg shrink-0`} />
            <span className="text-sm text-ive-text flex-1">{t.message}</span>
          </div>
        ))}
      </div>
    </ToastCtx.Provider>
  )
}
