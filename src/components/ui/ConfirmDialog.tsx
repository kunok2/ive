'use client'

import { ReactNode, useEffect, useLayoutEffect, useRef, useState, createContext, useContext, useCallback } from 'react'
import { useTranslations } from 'next-intl'

type Anchor = { x: number; y: number }

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
    anchor: Anchor | null
  } | null>(null)

  // 마지막 포인터(클릭) 위치 추적 — 팝업을 누른 버튼 근처에 띄우기 위함.
  const lastPointerRef = useRef<{ x: number; y: number; t: number } | null>(null)
  useEffect(() => {
    const onDown = (e: PointerEvent) => {
      lastPointerRef.current = { x: e.clientX, y: e.clientY, t: Date.now() }
    }
    window.addEventListener('pointerdown', onDown, true)
    return () => window.removeEventListener('pointerdown', onDown, true)
  }, [])

  // 최근(2초 이내) 클릭이 있으면 그 좌표를 앵커로. 자동 트리거 팝업은 앵커 없음 → 가운데 표시.
  const grabAnchor = (): Anchor | null => {
    const p = lastPointerRef.current
    return p && Date.now() - p.t < 2000 ? { x: p.x, y: p.y } : null
  }

  const confirm = useCallback((options: DialogOptions) => {
    return new Promise<boolean>((resolve) => {
      setDialog({ type: 'confirm', options, resolve, anchor: grabAnchor() })
    })
  }, [])

  const alert = useCallback((options: AlertOptions) => {
    return new Promise<void>((resolve) => {
      setDialog({ type: 'alert', options, resolve, anchor: grabAnchor() })
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
          anchor={dialog.anchor}
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
  anchor,
  onClose,
}: {
  type: 'confirm' | 'alert'
  options: DialogOptions | AlertOptions
  anchor: Anchor | null
  onClose: (result: boolean) => void
}) {
  const backdropRef = useRef<HTMLDivElement>(null)
  const boxRef = useRef<HTMLDivElement>(null)
  const tDialog = useTranslations('dialog')
  const tCommon = useTranslations('common')

  // 앵커가 있으면 클릭 지점 근처에 팝오버로 배치. 렌더 후 실제 크기를 재서 뷰포트 안으로 클램프.
  const [pos, setPos] = useState<{ left: number; top: number } | null>(null)
  useLayoutEffect(() => {
    if (!anchor || !boxRef.current) return
    const b = boxRef.current.getBoundingClientRect()
    const vw = window.innerWidth
    const vh = window.innerHeight
    const margin = 8
    const gap = 10
    let left = anchor.x - b.width / 2
    left = Math.max(margin, Math.min(left, vw - b.width - margin))
    let top = anchor.y + gap // 클릭 아래
    if (top + b.height > vh - margin) {
      top = anchor.y - gap - b.height // 공간 부족 시 위쪽
      if (top < margin) top = Math.max(margin, vh - b.height - margin)
    }
    setPos({ left, top })
  }, [anchor])

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

  const popover = !!anchor

  return (
    <div
      ref={backdropRef}
      className={popover ? 'fixed inset-0 z-[60]' : 'fixed inset-0 z-[60] flex items-center justify-center p-4'}
      onClick={(e) => { if (e.target === backdropRef.current) onClose(false) }}
    >
      {/* 팝오버 모드: 투명 클릭-캐처(마우스 이동 최소화). 가운데 모드: 어두운 오버레이. */}
      {!popover && <div className="absolute inset-0 bg-black/60 backdrop-blur-sm pointer-events-none" />}
      <div
        ref={boxRef}
        className={
          popover
            ? 'fixed w-[min(320px,calc(100vw-16px))] bg-ive-bg-solid border border-ive-border rounded-2xl shadow-2xl animate-slide-up overflow-hidden'
            : 'relative w-full max-w-sm bg-ive-bg-solid border border-ive-border rounded-2xl shadow-2xl animate-slide-up overflow-hidden'
        }
        style={popover ? { left: pos?.left ?? -9999, top: pos?.top ?? -9999, visibility: pos ? 'visible' : 'hidden' } : undefined}
      >
        <div className="px-5 pt-5 pb-4">
          <div className="flex items-start gap-3">
            <div className="shrink-0 w-10 h-10 rounded-lg bg-ive-bg-deep flex items-center justify-center">
              <i className={`${iconMap[variant]} text-lg`} />
            </div>
            <div className="flex-1 min-w-0">
              <h3 className="text-base font-bold text-ive-text mb-1">
                {isConfirm ? (opts as DialogOptions).title : ((opts as AlertOptions).title || tDialog('notification'))}
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
                {(opts as DialogOptions).cancelText || tCommon('cancel')}
              </button>
              <button
                onClick={() => onClose(true)}
                className={`flex-1 py-2.5 rounded-lg text-sm font-bold active:scale-[0.98] transition-all ${confirmBtnClass[variant] || confirmBtnClass.info}`}
                autoFocus
              >
                {(opts as DialogOptions).confirmText || tCommon('confirm')}
              </button>
            </>
          ) : (
            <button
              onClick={() => onClose(false)}
              className="flex-1 py-2.5 rounded-lg text-sm font-bold bg-ive-green-dark text-white active:scale-[0.98] transition-all"
              autoFocus
            >
              {tCommon('confirm')}
            </button>
          )}
        </div>
      </div>
    </div>
  )
}
