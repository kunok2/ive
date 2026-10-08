'use client'

/**
 * 보고서 프로젝트 필터 — 보고 싶은 프로젝트만 골라 본다(여럿 선택). 아무것도 고르지 않으면 전체.
 * 모양은 이슈 탭의 프로젝트 선택(ProjectSelector)과 같고, 고를 때마다 닫지 않는다(여럿을 연달아 고르게).
 */
import { useState, useRef, useEffect } from 'react'
import { projectSwatchStyles, type Tr } from './format'

export interface ProjectOption { id: string; name: string; color: string }

export default function ProjectFilter({ options, selected, onChange, tr }: {
  options: ProjectOption[]
  /** 고른 프로젝트 id — 비면 전체 */
  selected: string[]
  onChange: (ids: string[]) => void
  tr: Tr
}) {
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!open) return
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [open])

  if (options.length <= 1) return null

  const chosen = options.filter(o => selected.includes(o.id))
  const label = chosen.length === 0
    ? tr('projectFilterAll')
    : chosen.length === 1 ? chosen[0].name : tr('projectFilterMore', { name: chosen[0].name, n: chosen.length - 1 })
  // 보고서의 프로젝트 색 견본과 같게(같은 색 프로젝트는 진하기로 구분)
  const swatches = projectSwatchStyles(options)
  const toggle = (id: string) => onChange(selected.includes(id) ? selected.filter(x => x !== id) : [...selected, id])

  return (
    <div ref={ref} className="relative mb-2">
      <button
        type="button"
        aria-label={tr('projectFilterLabel')}
        aria-expanded={open}
        onClick={() => setOpen(v => !v)}
        className="w-full min-h-11 appearance-none bg-none bg-ive-bg-card border border-ive-border-subtle rounded-lg px-4 py-2 text-left flex items-center justify-between gap-2 focus:outline-none focus:border-ive-green/50 transition-colors"
      >
        <span className="flex items-center gap-2 min-w-0">
          <i className="fa-solid fa-filter text-xs text-ive-text-dim" />
          <span className={`text-sm font-bold truncate ${chosen.length ? 'text-ive-text' : 'text-ive-text-secondary'}`}>{label}</span>
        </span>
        <i className={`fa-solid fa-chevron-down text-xs text-ive-text-dim transition-transform ${open ? 'rotate-180' : ''}`} />
      </button>
      {open && (
        <div
          className="absolute z-50 top-full left-0 right-0 mt-1 border border-ive-border-subtle rounded-lg overflow-hidden shadow-lg max-h-80 overflow-y-auto"
          style={{ backgroundColor: '#1c1c20' }}
        >
          <button
            type="button"
            onClick={() => onChange([])}
            className={`w-full px-4 py-3 text-left text-sm font-bold flex items-center gap-2.5 transition-colors ${
              chosen.length === 0 ? 'bg-ive-cyan/10 text-ive-cyan' : 'text-ive-text hover:bg-white/5'
            }`}
          >
            <i className={`fa-${chosen.length === 0 ? 'solid fa-square-check' : 'regular fa-square'} w-4`} />
            {tr('projectFilterAll')}
          </button>
          {options.map((p, i) => {
            const on = selected.includes(p.id)
            return (
              <button
                key={p.id}
                type="button"
                onClick={() => toggle(p.id)}
                className={`w-full px-4 py-3 text-left text-sm font-bold flex items-center gap-2.5 transition-colors ${
                  on ? 'bg-ive-cyan/10 text-ive-cyan' : 'text-ive-text hover:bg-white/5'
                }`}
              >
                <i className={`fa-${on ? 'solid fa-square-check' : 'regular fa-square'} w-4`} />
                <span className="w-2 h-2 rounded-full shrink-0" style={swatches[i]} />
                <span className="truncate">{p.name}</span>
              </button>
            )
          })}
        </div>
      )}
    </div>
  )
}
