'use client'

import { ReactNode, useEffect, useRef } from 'react'

interface Props {
  open: boolean
  onClose: () => void
  title: string
  children: ReactNode
  dark?: boolean
}

export default function Modal({ open, onClose, title, children, dark }: Props) {
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
      <div className="absolute inset-0 bg-black/60 backdrop-blur-sm pointer-events-none" />
      <div className={`relative w-full max-w-lg ${dark ? 'bg-[#0f172a] border-[#1e293b]' : 'bg-ive-bg-card border-ive-border'} border rounded-2xl max-h-[90vh] flex flex-col animate-slide-up overflow-hidden shadow-2xl`}>
        <div className={`flex items-center justify-between px-4 py-3 border-b ${dark ? 'border-[#1e293b]' : 'border-ive-border-dark'} shrink-0`}>
          <h2 className={`text-base font-bold ${dark ? 'text-slate-200' : 'text-ive-green-pale'}`}>{title}</h2>
          <button
            onClick={onClose}
            className={`w-8 h-8 flex items-center justify-center rounded-full ${dark ? 'text-slate-400 hover:bg-white/5' : 'text-ive-text-muted hover:bg-ive-bg-deep'} transition-colors text-xl`}
          >
            <i className="fa-solid fa-xmark" />
          </button>
        </div>
        <div className={`flex-1 overflow-y-auto ${dark ? '' : 'px-4 py-4'}`}>
          {children}
        </div>
      </div>
    </div>
  )
}
