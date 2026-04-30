'use client'

import { useEffect, useRef, useState, useMemo } from 'react'

export interface CustomSelectOption {
  value: string
  label: string
  hint?: string
}

interface CustomSelectProps {
  value: string
  onChange: (v: string) => void
  options: CustomSelectOption[]
  placeholder?: string
  size?: 'sm' | 'md'
  className?: string
  disabled?: boolean
}

/**
 * 표준 콤보박스. ive-* 색상과 fa-chevron 어포던스를 사용하며,
 * 외부 클릭/Esc로 닫힌다. 모바일/데스크톱 공통.
 */
export default function CustomSelect({
  value,
  onChange,
  options,
  placeholder,
  size = 'md',
  className = '',
  disabled = false,
}: CustomSelectProps) {
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    function onDoc(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false)
    }
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') setOpen(false)
    }
    document.addEventListener('mousedown', onDoc)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('mousedown', onDoc)
      document.removeEventListener('keydown', onKey)
    }
  }, [])

  const selected = useMemo(() => options.find(o => o.value === value), [options, value])
  const displayLabel = selected?.label ?? placeholder ?? ''
  const isPlaceholder = !selected

  const padding = size === 'sm' ? 'px-2.5 py-1.5 text-xs' : 'px-3 py-2 text-sm'

  return (
    <div ref={ref} className={`relative ${open ? 'z-50' : ''} ${className}`}>
      <button
        type="button"
        disabled={disabled}
        onClick={() => !disabled && setOpen(o => !o)}
        className={`w-full bg-ive-bg-input border border-ive-border rounded-lg ${padding} text-left flex items-center justify-between focus:outline-none focus:border-ive-green/50 disabled:opacity-50 disabled:cursor-not-allowed`}
      >
        <span className={`truncate ${isPlaceholder ? 'text-ive-text-dim' : 'text-ive-text'}`}>
          {displayLabel}
        </span>
        <i className={`fa-solid fa-chevron-${open ? 'up' : 'down'} text-xs text-ive-text-dim ml-2 shrink-0`} />
      </button>

      {open && (
        <div
          className="absolute z-50 top-full left-0 right-0 mt-1 border border-ive-border-subtle rounded-lg overflow-hidden shadow-lg max-h-60 overflow-y-auto overscroll-contain [&::-webkit-scrollbar]:w-[3px] [&::-webkit-scrollbar-track]:bg-transparent [&::-webkit-scrollbar-thumb]:bg-ive-text-dim/30 [&::-webkit-scrollbar-thumb]:rounded-full hover:[&::-webkit-scrollbar-thumb]:bg-ive-text-dim/50"
          style={{ backgroundColor: '#1c1c20', backdropFilter: 'none', WebkitBackdropFilter: 'none' }}
        >
          {options.map(o => {
            const isSel = o.value === value
            return (
              <button
                key={o.value}
                type="button"
                onClick={() => { onChange(o.value); setOpen(false) }}
                className={`w-full ${padding} text-left hover:bg-white/[0.05] flex items-center gap-2 ${
                  isSel ? 'text-ive-green font-bold' : 'text-ive-text'
                }`}
              >
                <i className={`fa-solid fa-check text-xs shrink-0 ${isSel ? '' : 'invisible'}`} />
                <span className="flex-1 truncate">{o.label}</span>
                {o.hint && <span className="text-[11px] text-ive-text-dim shrink-0">{o.hint}</span>}
              </button>
            )
          })}
        </div>
      )}
    </div>
  )
}
