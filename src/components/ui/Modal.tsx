'use client'

import { ReactNode, useEffect, useRef } from 'react'

interface Props {
  open: boolean
  onClose: () => void
  title: string
  children: ReactNode
  size?: 'sm' | 'md'
  /** 오버레이(백드롭) 클릭 시 닫을지 여부. 기본 true */
  closeOnBackdrop?: boolean
}

export default function Modal({ open, onClose, title, children, size = 'md', closeOnBackdrop = true }: Props) {
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
      onClick={e => { if (closeOnBackdrop && e.target === backdropRef.current) onClose() }}
    >
      <div className="absolute inset-0 bg-black/60 backdrop-blur-sm pointer-events-none" />
      <div className={`relative w-full ${size === 'sm' ? 'max-w-xs' : 'max-w-lg'} bg-ive-bg-card border border-ive-border rounded-2xl max-h-[90vh] flex flex-col animate-slide-up overflow-hidden shadow-2xl`}>
        <div className="flex items-center justify-between px-4 py-3 border-b border-ive-border-dark shrink-0">
          <h2 className="text-base font-bold text-ive-text">{title}</h2>
          <button
            onClick={onClose}
            className="w-8 h-8 flex items-center justify-center rounded-full text-ive-text-muted hover:bg-ive-bg-deep transition-colors text-xl"
          >
            <i className="fa-solid fa-xmark" />
          </button>
        </div>
        <div className={`flex-1 overflow-y-auto ${size === 'sm' ? '' : 'px-4 py-4'}`}>
          {children}
        </div>
      </div>
    </div>
  )
}
