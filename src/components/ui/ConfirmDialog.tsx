'use client'

import { ReactNode, useEffect, useRef, useState, createContext, useContext, useCallback } from 'react'

// ── Types ──
interface DialogOptions {
  title: string
  message: string | ReactNode
  confirmText?: string
  cancelText?: string
  variant?: 'danger' | 'warning' | 'info'
}

interface AlertOptions {
  title?: string
  message: string | ReactNode
  variant?: 'error' | 'success' | 'info'
}

interface DialogContext {
  confirm: (options: DialogOptions) => Promise<boolean>
  alert: (options: AlertOptions) => Promise<void>
}

const DialogCtx = createContext<DialogContext>({
  confirm: async () => false,
  alert: async () => {},
})

export function useDialog() {
  return useContext(DialogCtx)
}

// ── Provider ──
export function DialogProvider({ children }: { children: ReactNode }) {
  const [dialog, setDialog] = useState<{
    type: 'confirm' | 'alert'
    options: DialogOptions | AlertOptions
    resolve: (value: any) => void
  } | null>(null)

  const confirm = useCallback((options: DialogOptions) => {
    return new Promise<boolean>((resolve) => {
      setDialog({ type: 'confirm', options, resolve })
    })
  }, [])

  const alert = useCallback((options: AlertOptions) => {
    return new Promise<void>((resolve) => {
      setDialog({ type: 'alert', options, resolve })
    })
  }, [])

  const handleClose = (result: boolean) => {
    if (!dialog) return
    dialog.resolve(dialog.type === 'confirm' ? result : undefined)
    setDialog(null)
  }

  return (
    <DialogCtx.Provider value={{ confirm, alert }}>
      {children}
      {dialog && (
        <DialogOverlay
          type={dialog.type}
          options={dialog.options}
          onClose={handleClose}
        />
      )}
    </DialogCtx.Provider>
  )
}

// ── Overlay ──
function DialogOverlay({
  type,
  options,
  onClose,
}: {
  type: 'confirm' | 'alert'
  options: DialogOptions | AlertOptions
  onClose: (result: boolean) => void
}) {
  const backdropRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose(false)
      if (e.key === 'Enter') onClose(type === 'alert' ? false : true)
    }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [onClose, type])

  const isConfirm = type === 'confirm'
  const opts = options as any
  const variant = opts.variant || (isConfirm ? 'info' : 'info')

  const iconMap: Record<string, string> = {
    danger: 'fa-solid fa-triangle-exclamation text-ive-red',
    warning: 'fa-solid fa-circle-exclamation text-ive-amber',
    error: 'fa-solid fa-circle-xmark text-ive-red',
    success: 'fa-solid fa-circle-check text-ive-green',
    info: 'fa-solid fa-circle-info text-ive-cyan',
  }

  const confirmBtnClass: Record<string, string> = {
    danger: 'bg-ive-red text-white',
    warning: 'bg-ive-amber text-ive-bg-deep',
    info: 'bg-ive-green-dark text-white',
  }

  return (
    <div
      ref={backdropRef}
      className="fixed inset-0 z-[60] flex items-center justify-center p-4"
      onClick={(e) => { if (e.target === backdropRef.current) onClose(false) }}
    >
      <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" />
      <div className="relative w-full max-w-sm bg-ive-bg-card border border-ive-border rounded-2xl shadow-2xl animate-slide-up overflow-hidden">
        <div className="px-5 pt-5 pb-4">
          <div className="flex items-start gap-3">
            <div className="shrink-0 w-10 h-10 rounded-full bg-ive-bg-deep flex items-center justify-center">
              <i className={`${iconMap[variant]} text-lg`} />
            </div>
            <div className="flex-1 min-w-0">
              <h3 className="text-base font-bold text-ive-text mb-1">
                {isConfirm ? (opts as DialogOptions).title : ((opts as AlertOptions).title || '알림')}
              </h3>
              <div className="text-sm text-ive-text-muted whitespace-pre-line">
                {opts.message}
              </div>
            </div>
          </div>
        </div>
        <div className="flex gap-2 px-5 pb-4">
          {isConfirm ? (
            <>
              <button
                onClick={() => onClose(false)}
                className="flex-1 py-2.5 rounded-lg text-sm font-bold bg-ive-bg-deep text-ive-text-dim border border-ive-border-subtle active:scale-[0.98] transition-all"
              >
                {(opts as DialogOptions).cancelText || '취소'}
              </button>
              <button
                onClick={() => onClose(true)}
                className={`flex-1 py-2.5 rounded-lg text-sm font-bold active:scale-[0.98] transition-all ${confirmBtnClass[variant] || confirmBtnClass.info}`}
                autoFocus
              >
                {(opts as DialogOptions).confirmText || '확인'}
              </button>
            </>
          ) : (
            <button
              onClick={() => onClose(false)}
              className="flex-1 py-2.5 rounded-lg text-sm font-bold bg-ive-green-dark text-white active:scale-[0.98] transition-all"
              autoFocus
            >
              확인
            </button>
          )}
        </div>
      </div>
    </div>
  )
}
