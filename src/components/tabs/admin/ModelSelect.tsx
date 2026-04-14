'use client'

import { useState, useEffect, useRef } from 'react'
import { useTranslations } from 'next-intl'

interface ModelSelectProps {
  models: string[]
  value: string
  onChange: (v: string) => void
}

export default function ModelSelect({ models, value, onChange }: ModelSelectProps) {
  const t = useTranslations('admin')
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    function handleClick(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener('mousedown', handleClick)
    return () => document.removeEventListener('mousedown', handleClick)
  }, [])

  const options = [{ value: '', label: t('cliDefault') }, ...models.map(m => ({ value: m, label: m }))]
  const selected = options.find(o => o.value === value) || options[0]

  return (
    <div ref={ref} className={`relative ${open ? 'z-50' : ''}`}>
      <button
        type="button"
        onClick={() => setOpen(!open)}
        className="w-full bg-ive-bg-input border border-ive-border rounded-lg px-3 py-2 text-sm text-left flex items-center justify-between focus:outline-none focus:border-ive-green/50"
      >
        <span className={value ? 'text-ive-text' : 'text-ive-text-dim'}>{selected.label}</span>
        <i className={`fa-solid fa-chevron-${open ? 'up' : 'down'} text-xs text-ive-text-dim`} />
      </button>
      {open && (
        <div className="absolute z-50 top-full left-0 right-0 mt-1 bg-ive-bg-card border border-ive-border-subtle rounded-lg overflow-hidden shadow-lg max-h-52 overflow-y-auto overscroll-contain [&::-webkit-scrollbar]:w-[3px] [&::-webkit-scrollbar-track]:bg-transparent [&::-webkit-scrollbar-thumb]:bg-ive-text-dim/30 [&::-webkit-scrollbar-thumb]:rounded-full hover:[&::-webkit-scrollbar-thumb]:bg-ive-text-dim/50">
          {options.map(o => (
            <button
              key={o.value}
              type="button"
              onClick={() => { onChange(o.value); setOpen(false) }}
              className={`w-full px-3 py-2 text-sm text-left hover:bg-white/[0.05] ${
                o.value === value ? 'text-ive-green font-bold' : 'text-ive-text'
              } ${o.value === '' ? 'text-ive-text-dim' : ''}`}
            >
              {o.value === value && <i className="fa-solid fa-check text-xs mr-2" />}
              {o.label}
            </button>
          ))}
        </div>
      )}
    </div>
  )
}
