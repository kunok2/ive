'use client'

import { useEffect, useRef } from 'react'
import { useTranslations } from 'next-intl'

interface Props {
  open: boolean
  onClose: () => void
  onConfirm: () => void
  title: string
  message: string
  confirmLabel?: string
  cancelLabel?: string
  danger?: boolean
}

export default function ConfirmModal({
  open, onClose, onConfirm, title, message,
  confirmLabel, cancelLabel, danger = false,
}: Props) {
  const tc = useTranslations('common')
  const confirmText = confirmLabel ?? tc('confirm')
  const cancelText = cancelLabel ?? tc('cancel')
  const backdropRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (open) {
      document.body.style.overflow = 'hidden'
    } else {
      document.body.style.overflow = ''
    }
    return () => { document.body.style.overflow = '' }
  }, [open])

  if (!open) return null

  return (
    <div
      ref={backdropRef}
      className="fixed inset-0 z-[60] flex items-center justify-center p-4"
      onClick={e => { if (e.target === backdropRef.current) onClose() }}
    >
      <div className="absolute inset-0 bg-black/60 backdrop-blur-sm pointer-events-none" />
      <div className="relative w-full max-w-sm bg-ive-bg-card border border-ive-border rounded-2xl animate-slide-up">
        <div className="px-5 pt-5 pb-4 text-center">
          <div className={`w-12 h-12 rounded-full mx-auto mb-3 flex items-center justify-center ${danger ? 'bg-ive-red/15' : 'bg-ive-green/15'}`}>
            <i className={`fa-solid ${danger ? 'fa-triangle-exclamation text-ive-red' : 'fa-circle-question text-ive-green'} text-xl`} />
          </div>
          <h3 className="text-base font-bold text-ive-green-pale mb-1">{title}</h3>
          <p className="text-base text-ive-text-muted">{message}</p>
        </div>
        <div className="flex border-t border-ive-border-dark">
          <button
            onClick={onClose}
            className="flex-1 py-3 text-base font-bold text-ive-text-muted border-r border-ive-border-dark rounded-bl-2xl active:bg-ive-bg-deep transition-colors"
          >
            {cancelText}
          </button>
          <button
            onClick={() => { onConfirm(); onClose() }}
            className={`flex-1 py-3 text-base font-bold rounded-br-2xl active:opacity-80 transition-colors ${
              danger ? 'text-ive-red' : 'text-ive-green'
            }`}
          >
            {confirmText}
          </button>
        </div>
      </div>
    </div>
  )
}
