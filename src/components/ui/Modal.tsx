'use client'

import { ReactNode, useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'

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
  const [mounted, setMounted] = useState(false)

  useEffect(() => { setMounted(true) }, [])

  useEffect(() => {
    if (open) {
      document.body.style.overflow = 'hidden'
    } else {
      document.body.style.overflow = ''
    }
    return () => { document.body.style.overflow = '' }
  }, [open])

  if (!open || !mounted) return null

  // Portal 로 document.body 에 렌더 — backdrop-filter 가 있는 조상의 containing block 영향에서 벗어남
  return createPortal(
    <div
      ref={backdropRef}
      className="fixed inset-0 z-50 flex items-center justify-center p-4"
      onClick={e => { if (closeOnBackdrop && e.target === backdropRef.current) onClose() }}
    >
      <div className="absolute inset-0 bg-black/60 backdrop-blur-sm pointer-events-none" />
      <div className={`relative w-full ${size === 'sm' ? 'max-w-xs' : 'max-w-lg'} bg-ive-bg-card border border-ive-border rounded-2xl max-h-[90dvh] flex flex-col animate-slide-up overflow-hidden shadow-2xl`}>
        <div className="flex items-center justify-between px-4 py-3 border-b border-ive-border-dark shrink-0">
          <h2 className="text-base font-bold text-ive-text">{title}</h2>
          <button
            onClick={onClose}
            className="w-8 h-8 flex items-center justify-center rounded-lg text-ive-text-muted hover:bg-ive-bg-deep transition-colors text-xl"
          >
            <i className="fa-solid fa-xmark" />
          </button>
        </div>
        <div className={`flex-1 min-h-0 overflow-y-auto overscroll-contain ${size === 'sm' ? '' : 'px-4 py-4'}`}>
          {children}
        </div>
      </div>
    </div>,
    document.body,
  )
}
