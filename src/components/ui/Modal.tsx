'use client'

import { ReactNode, useEffect, useRef } from 'react'

interface Props {
  open: boolean
  onClose: () => void
  title: string
  children: ReactNode
}

export default function Modal({ open, onClose, title, children }: Props) {
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
      className="fixed inset-0 z-50 flex items-center justify-center p-4"
      onClick={e => { if (e.target === backdropRef.current) onClose() }}
    >
      <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" />
      <div className="relative w-full max-w-lg bg-ive-bg-card border border-ive-border rounded-2xl max-h-[80vh] flex flex-col animate-slide-up">
        <div className="flex items-center justify-between px-4 py-3 border-b border-ive-border-dark shrink-0">
          <h2 className="text-sm font-bold text-ive-green-pale">{title}</h2>
          <button
            onClick={onClose}
            className="w-8 h-8 flex items-center justify-center rounded-full text-ive-text-muted hover:bg-ive-bg-deep transition-colors text-lg"
          >
            <i className="fa-solid fa-xmark" />
          </button>
        </div>
        <div className="px-4 py-4 pb-6 overflow-y-auto">
          {children}
        </div>
      </div>
    </div>
  )
}
